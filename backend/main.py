import os
import json
import re
import shutil
import traceback
import wave
from typing import List, Optional, cast, Any

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, File, UploadFile, Form, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlmodel import Session, select

import azure.cognitiveservices.speech as speechsdk
import google.generativeai as genai
import urllib.parse

try:
    from openai import AsyncOpenAI
except Exception:
    AsyncOpenAI = None

from analyzer import get_total_weak_patterns, get_user_progress
from database import get_session, init_db, engine
from deps import get_current_user
from interview_manager import InterviewManager
from learning_features import router as learning_router
from models import User, StudySession, Question, SpeakingLog, WordLog, InterviewReport
from schemas import SignupRequest, LoginRequest, TokenResponse, MeResponse
from security import hash_password, verify_password, create_access_token, decode_access_token
from utils import get_transcript_via_whisper, extract_text_from_pdf


load_dotenv()

AZURE_KEY = os.getenv("AZURE_SPEECH_KEY")
AZURE_REGION = os.getenv("AZURE_SPEECH_REGION")
GEMINI_KEY = os.getenv("GEMINI_API_KEY")
OPENAI_KEY = os.getenv("OPENAI_API_KEY")

# 면접 세션 1건의 기본 질문 한계 (초기 + 꼬리질문 합산).
# 사용자가 setup 화면에서 1~9 사이로 조정할 수 있으며, 선택값은
# StudySession.metadata_json에 함께 저장된다. setup에서 값이 누락되거나
# 메타데이터 파싱이 실패할 경우 이 기본값으로 폴백한다.
DEFAULT_MAX_QUESTIONS_PER_INTERVIEW = 5

GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL", "models/gemini-2.0-flash-lite")

genai.configure(api_key=GEMINI_KEY)
gemini_model = genai.GenerativeModel(GEMINI_MODEL_NAME)
interview_manager = InterviewManager(gemini_model)

openai_client = None
if AsyncOpenAI and OPENAI_KEY:
    openai_client = AsyncOpenAI(api_key=OPENAI_KEY)

app = FastAPI(title="Sync Capstone API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(learning_router)

os.makedirs("static", exist_ok=True)
os.makedirs("static/audio", exist_ok=True)
os.makedirs("temp_uploads", exist_ok=True)

app.mount("/static", StaticFiles(directory="static"), name="static")

init_db()


class InterviewSetup(BaseModel):
    position: str
    tech_stack: List[str]
    experience_level: str
    project_summary: str
    interview_mode: str


def parse_question_block(text: str):
    parsed = []
    lines = [line.strip() for line in text.split("\n") if "|" in line]

    for idx, line in enumerate(lines, start=1):
        parts = [p.strip() for p in line.split("|")]

        question_text = parts[0] if len(parts) > 0 else ""
        question_ko = parts[1] if len(parts) > 1 else ""
        model_answer = parts[2] if len(parts) > 2 else ""

        model_answer = re.sub(r"^\[?\s*모범\s*답안\s*:\s*", "", model_answer)
        model_answer = model_answer.rstrip("]").strip()

        if question_text:
            parsed.append({
                "order_no": idx,
                "question_text": question_text,
                "question_ko": question_ko,
                "model_answer": model_answer,
            })

    return parsed


def extract_model_answer(feedback: str) -> str:
    model_match = re.search(
        r"Model Answer[^\w]*([a-zA-Z].+?)(?=\n|$)",
        feedback,
        re.IGNORECASE
    )

    if not model_match:
        return ""

    return model_match.group(1).replace('"', "").strip()


def process_pronunciation_result(result_obj):
    actual_result = getattr(result_obj, "result", result_obj)
    pron_result = speechsdk.PronunciationAssessmentResult(actual_result)

    word_details = []

    for word in pron_result.words:
        phonemes = [
            {
                "ph": ph.phoneme,
                "score": round(ph.accuracy_score, 2)
            }
            for ph in word.phonemes
        ]

        word_details.append({
            "word": word.word,
            "accuracy": round(word.accuracy_score, 2),
            "error_type": getattr(word, "error_type", None),
            "phonemes": phonemes,
        })

    return {
        "sentence": {
            "text": actual_result.text,
            "accuracy": round(pron_result.accuracy_score, 2),
            "pronunciation": round(pron_result.pronunciation_score, 2),
            "fluency": round(pron_result.fluency_score, 2),
        },
        "words": word_details,
    }


async def get_ai_coaching(final_data, current_question):
    prompt = f"""
    당신은 1:1 영어 회화 및 면접 발음 코치입니다.
    사용자의 답변을 분석해 주세요.

    [질문]
    {current_question}

    [사용자의 음성 인식 답변]
    {final_data['sentence']['text']}

    [발음 분석 데이터]
    {final_data['words']}

    [작성 조건]
    1. 사용자의 답변이 질문에 적절했는지 한국어로 평가해 주세요.
    2. 발음, 유창성, 정확도 측면에서 간단히 피드백해 주세요.
    3. 너무 많은 음소 기호를 나열하지 말고, 사용자가 이해하기 쉽게 설명해 주세요.
    4. 부족한 단어가 있다면 2~3개만 짚어 주세요.
    5. 마지막에는 반드시 아래 형식으로 자연스러운 영어 모범답안을 한 줄로 작성해 주세요.

    Model Answer: 영어 문장
    """

    try:
        response = await gemini_model.generate_content_async(prompt)
        return response.text
    except Exception as e:
        return f"코칭 생성 실패: {str(e)}"


async def generate_native_audio(text, file_name):
    if not text or len(text.strip()) < 2:
        return None

    speech_config = speechsdk.SpeechConfig(
        subscription=AZURE_KEY,
        region=AZURE_REGION
    )
    speech_config.speech_synthesis_voice_name = "en-US-JennyNeural"

    audio_path = f"static/audio/{file_name}.mp3"
    audio_config = speechsdk.audio.AudioOutputConfig(filename=audio_path)

    synthesizer = speechsdk.SpeechSynthesizer(
        speech_config=speech_config,
        audio_config=audio_config
    )

    result = synthesizer.speak_text_async(text).get()
    result = cast(Any, result)

    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        return f"/static/audio/{file_name}.mp3"

    return None


def save_pcm_as_wav(
    audio_bytes: bytearray,
    user_id: int,
    session_id: int,
    question_id: Optional[int],
    file_key: str
):
    if not audio_bytes:
        return None

    question_part = question_id if question_id is not None else "none"

    folder = f"static/audio/user_{user_id}/session_{session_id}"
    os.makedirs(folder, exist_ok=True)

    file_path = f"{folder}/answer_q{question_part}_{file_key}.wav"

    with wave.open(file_path, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        wav_file.writeframes(bytes(audio_bytes))

    return "/" + file_path.replace("\\", "/")


def safe_json_loads(text: str):
    cleaned = text.strip()

    if "```" in cleaned:
        parts = cleaned.split("```")
        if len(parts) >= 2:
            cleaned = parts[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]

    return json.loads(cleaned.strip())


def calculate_tech_stack_percent(full_transcript: str, metadata_json: Optional[str]):
    default_result = {
        "FastAPI": 30,
        "Python": 30,
        "WebSocket": 20,
        "PostgreSQL": 20,
    }

    tech_list = []

    if metadata_json:
        try:
            metadata = json.loads(metadata_json)
            tech_list = metadata.get("tech_stack", [])
        except Exception:
            tech_list = []

    if not tech_list:
        tech_list = ["FastAPI", "Python", "WebSocket", "PostgreSQL"]

    total_text = full_transcript.lower()
    counts = {}

    for tech in tech_list:
        counts[str(tech)] = total_text.count(str(tech).lower())

    total_mentions = sum(counts.values())

    if total_mentions <= 0:
        return default_result

    return {
        tech: round((count / total_mentions) * 100)
        for tech, count in counts.items()
    }


async def generate_persona_image(animal_generation_prompt: str):
    try:
        prompt = f"A detailed square profile picture of {animal_generation_prompt}. Anthropomorphic animal developer style. High quality digital art."
        
        encoded_prompt = urllib.parse.quote(prompt)
        image_url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width=1024&height=1024&nologo=true"
        
        return image_url

    except Exception as img_err:
        print(f"AI 이미지 생성 실패: {img_err}")
        return "https://via.placeholder.com/400x400?text=AI+Image+Pending"


@app.get("/")
def root():
    return {"message": "Sync Capstone API is running"}


@app.get("/test")
async def get_test_page():
    return FileResponse("static/all_in_one_test.html")


@app.get("/all-test")
async def get_all_test_page():
    return FileResponse("static/all_in_one_test.html")


@app.get("/interview-test")
async def get_interview_test_page():
    return FileResponse("static/all_in_one_test.html")


@app.post("/signup")
def signup(request: SignupRequest, session: Session = Depends(get_session)):
    existing_user = session.exec(
        select(User).where(User.email == request.email)
    ).first()

    if existing_user:
        raise HTTPException(status_code=400, detail="이미 존재하는 이메일입니다.")

    new_user = User(
        email=request.email,
        hashed_password=hash_password(request.password),
        nickname=request.nickname,
        role="user",
    )

    session.add(new_user)
    session.commit()
    session.refresh(new_user)

    return {
        "message": "회원가입 성공",
        "user_id": new_user.id,
        "email": new_user.email,
        "nickname": new_user.nickname,
    }


@app.post("/login", response_model=TokenResponse)
def login(request: LoginRequest, session: Session = Depends(get_session)):
    user = session.exec(
        select(User).where(User.email == request.email)
    ).first()

    if not user:
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다.")

    if not verify_password(request.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다.")

    access_token = create_access_token(
        cast(int, user.id),
        cast(str, user.email)
    )

    return {
        "message": "로그인 성공",
        "access_token": access_token,
        "token_type": "bearer",
    }


@app.get("/me", response_model=MeResponse)
def read_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "nickname": current_user.nickname,
        "role": current_user.role,
    }


@app.get("/generate-questions")
async def generate_questions(
    url: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    try:
        transcript_raw = get_transcript_via_whisper(url)

        if not transcript_raw:
            return {"error": "유튜브 분석 실패"}

        transcript = str(transcript_raw)

        prompt = f"""
        다음 영어 스크립트를 분석해 영어 회화 질문 3개를 만들어줘.

        [출력 조건]
        1. 인사말 없이 오직 아래 형식으로만 3줄을 출력해.
        2. 형식: 질문? | (한국어 해석) | [모범 답안: 영어 문장]
        3. 각 질문은 반드시 한 줄에 하나씩 작성해.

        [스크립트]
        {transcript[:2500]}
        """

        response = await gemini_model.generate_content_async(prompt)
        questions_text = response.text
        parsed_questions = parse_question_block(questions_text)

        study_session = StudySession(
            user_id=cast(int, current_user.id),
            session_type="youtube",
            title="YouTube Speaking Practice",
            source_url=url,
            source_text=transcript,
            metadata_json=json.dumps(
                {"question_count": len(parsed_questions)},
                ensure_ascii=False
            ),
        )

        session.add(study_session)
        session.commit()
        session.refresh(study_session)

        saved_questions = []

        for q in parsed_questions:
            question = Question(
                session_id=cast(int, study_session.id),
                order_no=q["order_no"],
                question_type="youtube_generated",
                question_text=q["question_text"],
                question_ko=q["question_ko"],
                model_answer=q["model_answer"],
            )

            session.add(question)
            session.commit()
            session.refresh(question)

            saved_questions.append({
                "id": question.id,
                "order_no": question.order_no,
                "question_text": question.question_text,
                "question_ko": question.question_ko,
                "model_answer": question.model_answer,
            })

        return {
            "session_id": study_session.id,
            "questions_text": questions_text,
            "questions": saved_questions,
        }

    except Exception as e:
        return {"error": str(e)}


@app.websocket("/ws/audio")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    recognizer = None
    db = Session(engine)

    current_user = None
    current_session_id = None
    current_question_id = None
    current_question = "General Conversation"
    audio_bytes = bytearray()

    try:
        token = websocket.query_params.get("token")
        session_param = websocket.query_params.get("session_id")
        question_param = websocket.query_params.get("question_id")

        if token:
            try:
                payload = decode_access_token(token)
                user_id = int(payload["sub"])
                current_user = db.exec(
                    select(User).where(User.id == user_id)
                ).first()
            except Exception:
                current_user = None

        if session_param:
            current_session_id = int(session_param)

        if question_param:
            current_question_id = int(question_param)

        if current_question_id:
            q_obj = db.exec(
                select(Question).where(Question.id == current_question_id)
            ).first()

            if q_obj:
                current_question = q_obj.question_text

        speech_config = speechsdk.SpeechConfig(
            subscription=AZURE_KEY,
            region=AZURE_REGION
        )

        stream_format = speechsdk.audio.AudioStreamFormat(
            samples_per_second=16000,
            bits_per_sample=16,
            channels=1
        )

        push_stream = speechsdk.audio.PushAudioInputStream(stream_format)
        audio_config = speechsdk.audio.AudioConfig(stream=push_stream)

        pron_config = speechsdk.PronunciationAssessmentConfig(
            reference_text="",
            grading_system=speechsdk.PronunciationAssessmentGradingSystem.HundredMark,
            granularity=speechsdk.PronunciationAssessmentGranularity.Phoneme
        )

        recognizer = speechsdk.SpeechRecognizer(
            speech_config=speech_config,
            audio_config=audio_config
        )

        pron_config.apply_to(recognizer)

        while True:
            message = await websocket.receive()

            if "text" in message:
                data = json.loads(message["text"])

                if data.get("type") == "stop":
                    if data.get("session_id") is not None:
                        current_session_id = int(data["session_id"])

                    if data.get("question_id") is not None:
                        current_question_id = int(data["question_id"])

                    if data.get("question"):
                        current_question = data["question"]

                    break

            elif "bytes" in message:
                raw_audio = message["bytes"]
                audio_bytes.extend(raw_audio)
                push_stream.write(raw_audio)

        push_stream.close()

        # ── WS 처리 단계 status 메시지 (BACKEND_PR.md TODO #4, 옵션 B) ──
        await websocket.send_text(json.dumps(
            {"type": "status", "stage": "asr"}, ensure_ascii=False
        ))

        result = recognizer.recognize_once_async().get()
        result = cast(Any, result)

        if result.reason != speechsdk.ResultReason.RecognizedSpeech:
            await websocket.send_text(json.dumps({
                "error": "음성을 인식하지 못했습니다."
            }, ensure_ascii=False))
            return

        await websocket.send_text(json.dumps(
            {"type": "status", "stage": "scoring"}, ensure_ascii=False
        ))

        final_data = process_pronunciation_result(result)

        await websocket.send_text(json.dumps(
            {"type": "status", "stage": "coaching"}, ensure_ascii=False
        ))

        feedback = await get_ai_coaching(final_data, current_question)

        user_tts = await generate_native_audio(
            result.text,
            f"u_{result.result_id}"
        )

        model_text = extract_model_answer(feedback)

        model_tts = await generate_native_audio(
            model_text,
            f"m_{result.result_id}"
        )

        saved_log_id = None
        next_question_id = None
        next_question = None
        session_type = None
        audio_url = None

        if current_user and current_session_id:
            session_obj = db.exec(
                select(StudySession).where(StudySession.id == current_session_id)
            ).first()

            if session_obj:
                session_type = session_obj.session_type

            reference_text = current_question

            if current_question_id:
                q_obj = db.exec(
                    select(Question).where(Question.id == current_question_id)
                ).first()

                if q_obj:
                    reference_text = q_obj.model_answer or q_obj.question_text

            audio_url = save_pcm_as_wav(
                audio_bytes=audio_bytes,
                user_id=cast(int, current_user.id),
                session_id=current_session_id,
                question_id=current_question_id,
                file_key=result.result_id
            )

            speaking_log = SpeakingLog(
                user_id=cast(int, current_user.id),
                session_id=current_session_id,
                question_id=current_question_id,
                reference_text=reference_text,
                recognized_text=result.text,
                accuracy_score=float(final_data["sentence"]["accuracy"]),
                pronunciation_score=float(final_data["sentence"]["pronunciation"]),
                fluency_score=float(final_data["sentence"]["fluency"]),
                coaching_message=feedback,
                audio_url=audio_url,
                user_tts_url=user_tts,
                model_tts_url=model_tts,
                pronunciation_guide=model_text,
            )

            db.add(speaking_log)
            db.commit()
            db.refresh(speaking_log)

            saved_log_id = speaking_log.id

            for word in final_data["words"]:
                word_log = WordLog(
                    speaking_log_id=cast(int, speaking_log.id),
                    word=word["word"],
                    accuracy_score=float(word["accuracy"]),
                    error_type=word.get("error_type"),
                    phoneme_data=json.dumps(
                        word["phonemes"],
                        ensure_ascii=False
                    ),
                )

                db.add(word_log)

            db.commit()

            if session_type == "interview":
                # 세션별 한계값 추출 — metadata_json(setup_data)에서 읽고, 누락/파싱 실패 시
                # 안전 기본값으로 폴백. 1~9 범위를 벗어난 값(과거 데이터 등)도 default로 복원.
                max_questions = DEFAULT_MAX_QUESTIONS_PER_INTERVIEW
                if session_obj and session_obj.metadata_json:
                    try:
                        meta = json.loads(session_obj.metadata_json)
                        if isinstance(meta, dict):
                            raw = meta.get("max_questions")
                            if isinstance(raw, int) and 1 <= raw <= 9:
                                max_questions = raw
                    except json.JSONDecodeError:
                        pass  # 기본값 유지

                # 깊이 카운트 (방금 답한 질문도 이미 DB에 있음)
                all_questions = db.exec(
                    select(Question).where(Question.session_id == current_session_id)
                ).all()

                if len(all_questions) >= max_questions:
                    # 한계 도달 — 꼬리질문 생성 스킵 (next_question/next_question_id는 None 유지)
                    pass
                else:
                    follow_up = await interview_manager.generate_follow_up(
                        current_question,
                        result.text
                    )
                    
                    next_order = len(all_questions) + 1
                    
                    next_q = Question(
                        session_id=current_session_id,
                        order_no=next_order,
                        question_type="interview_followup",
                        question_text=follow_up,
                    )
                    
                    db.add(next_q)
                    db.commit()
                    db.refresh(next_q)
                    
                    next_question_id = next_q.id
                    next_question = next_q.question_text

        await websocket.send_text(json.dumps({
            "type": "final",
            "user_said": result.text,
            "score": final_data["sentence"],
            "words": final_data["words"],
            "feedback": feedback,
            "audio_url": audio_url,
            "user_tts_url": user_tts,
            "model_tts_url": model_tts,
            "saved_log_id": saved_log_id,
            "session_type": session_type,
            "next_question_id": next_question_id,
            "next_question": next_question,
        }, ensure_ascii=False))

    except Exception:
        traceback.print_exc()
        await websocket.send_text(json.dumps({
            "error": "서버 내부 오류가 발생했습니다."
        }, ensure_ascii=False))

    finally:
        if recognizer:
            del recognizer
        db.close()


@app.post("/interview/start-unified")
async def start_unified_interview(
    position: str = Form(...),
    tech_stack: str = Form(...),
    experience_level: str = Form(...),
    project_summary: str = Form(...),
    interview_mode: str = Form(...),
    max_questions: int = Form(DEFAULT_MAX_QUESTIONS_PER_INTERVIEW),  # 신규
    file: Optional[UploadFile] = File(None),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    # 사용자 조절 한계값 검증 (Step 10-C1)
    if not (1 <= max_questions <= 9):
        raise HTTPException(
            status_code=400,
            detail="질문 개수는 1과 9 사이여야 합니다.",
        )
        
    pdf_text = ""

    if file:
        safe_filename = file.filename or "uploaded_file.pdf"
        file_path = os.path.join("temp_uploads", safe_filename)

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        try:
            pdf_text = extract_text_from_pdf(file_path)
        finally:
            if os.path.exists(file_path):
                os.remove(file_path)

    tech_list = json.loads(tech_stack)

    setup_data = {
        "position": position,
        "tech_stack": tech_list,
        "experience_level": experience_level,
        "project_summary": project_summary,
        "interview_mode": interview_mode,
        "max_questions": max_questions,  # 신규 — /ws/audio가 이 값을 읽는다
    }

    question_text = await interview_manager.generate_unified_question(
        setup_data,
        pdf_text if pdf_text else None
    )

    study_session = StudySession(
        user_id=cast(int, current_user.id),
        session_type="interview",
        title=f"{position} Interview",
        source_text=pdf_text if pdf_text else project_summary,
        metadata_json=json.dumps(setup_data, ensure_ascii=False),
    )

    session.add(study_session)
    session.commit()
    session.refresh(study_session)

    question = Question(
        session_id=cast(int, study_session.id),
        order_no=1,
        question_type="interview_initial",
        question_text=question_text,
    )

    session.add(question)
    session.commit()
    session.refresh(question)

    return {
        "status": "success",
        "session_id": study_session.id,
        "question_id": question.id,
        "question": question_text,
    }


@app.post("/interview/upload-pdf")
async def upload_pdf_interview(
    position: str = Form(...),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    safe_filename = file.filename or "uploaded_file.pdf"
    file_path = os.path.join("temp_uploads", safe_filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        pdf_text = extract_text_from_pdf(file_path)
        question_text = await interview_manager.generate_question_from_pdf(
            pdf_text,
            position
        )

        study_session = StudySession(
            user_id=cast(int, current_user.id),
            session_type="interview",
            title=f"{position} PDF Interview",
            source_text=pdf_text,
            metadata_json=json.dumps({"position": position}, ensure_ascii=False),
        )

        session.add(study_session)
        session.commit()
        session.refresh(study_session)

        question = Question(
            session_id=cast(int, study_session.id),
            order_no=1,
            question_type="interview_pdf",
            question_text=question_text,
        )

        session.add(question)
        session.commit()
        session.refresh(question)

        return {
            "status": "success",
            "session_id": study_session.id,
            "question_id": question.id,
            "question": question_text,
            "extracted_text_preview": pdf_text[:200] + "...",
        }

    except Exception as e:
        return {"status": "error", "message": str(e)}

    finally:
        if os.path.exists(file_path):
            os.remove(file_path)


@app.post("/interview/finalize")
async def finalize_interview(
    session_id: int = Form(...),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    study_session = session.exec(
        select(StudySession).where(
            StudySession.id == session_id,
            StudySession.user_id == cast(int, current_user.id),
            StudySession.session_type == "interview",
        )
    ).first()

    if not study_session:
        return {
            "status": "error",
            "animal_reason": "해당 면접 세션을 찾을 수 없습니다."
        }

    questions = session.exec(
        select(Question).where(Question.session_id == session_id)
    ).all()

    logs = session.exec(
        select(SpeakingLog).where(SpeakingLog.session_id == session_id)
    ).all()

    logs = sorted(logs, key=lambda log: log.created_at)

    if not logs:
        return {
            "status": "error",
            "animal_reason": "진행된 면접 답변 데이터가 존재하지 않아 리포트를 생성할 수 없습니다."
        }

    question_map: dict[int, Question] = {
        cast(int, q.id): q
        for q in questions
        if q.id is not None
    }

    interview_history = []
    full_transcript = ""

    for idx, log in enumerate(logs, start=1):
        q = None

        if log.question_id is not None:
            q = question_map.get(cast(int, log.question_id))

        question_text = q.question_text if q else log.reference_text
        transcription = log.recognized_text or ""

        full_transcript += f"질문 {idx}: {question_text}\n"
        full_transcript += f"답변 {idx}: {transcription}\n\n"

        interview_history.append({
            "question": question_text,
            "transcription": transcription,
            "pronunciation_guide": log.pronunciation_guide or "",
            "user_audio_url": log.audio_url,
            "accuracy_score": log.accuracy_score,
            "pronunciation_score": log.pronunciation_score,
            "fluency_score": log.fluency_score,
            "feedback": log.coaching_message,
        })

    analysis_prompt = f"""
    You are an expert technical interview recruiter and behavior analyst.
    Analyze the following technical interview transcript to determine a unique Animal Persona
    for the candidate based on their communication style, technical depth, and confidence.

    [Interview Transcript]
    {full_transcript}

    [Instructions]
    1. Select an animal that matches the candidate's technical responding style.
    2. Combine it with a professional adjective in Korean.
       Example: "치밀한 고양이", "날카로운 독수리", "성실한 비버".
    3. Provide a detailed reason in Korean explaining why this animal fits the candidate.
    4. Provide an English prompt fragment for a profile image. 
       CRITICAL: Dynamically vary the clothing, actions (e.g., drawing on a whiteboard, inspecting servers), and backgrounds to perfectly match the persona. 
       STRICTLY AVOID repetitive patterns like "hoodie", "laptop", or "coffee mug".

    [Strict Rule]
    Return the output ONLY as a valid JSON string.
    Do NOT include markdown code block formatting.

    [Output Format]
    {{
        "animal_name": "형용사 + 동물 이름",
        "animal_reason": "상세한 분석 및 선정 이유",
        "animal_generation_prompt": "English image prompt fragment"
    }}
    """

    try:
        response = await gemini_model.generate_content_async(analysis_prompt)
        analysis_data = safe_json_loads(response.text)

        animal_name = analysis_data.get("animal_name", "신중한 올빼미")
        animal_reason = analysis_data.get(
            "animal_reason",
            "기술적 질문에 신중하고 차분하게 답변하는 성향이 나타났습니다."
        )
        animal_generation_prompt = analysis_data.get(
            "animal_generation_prompt",
            "a thoughtful owl developer"
        ).strip()

    except Exception as e:
        animal_name = "신중한 올빼미"
        animal_reason = (
            "페르소나 분석 중 일부 오류가 있었지만, "
            f"전체 답변에서 신중한 문제 해결 성향이 확인되었습니다. 오류: {str(e)}"
        )
        animal_generation_prompt = "a thoughtful owl developer"

    animal_image_url = await generate_persona_image(animal_generation_prompt)

    tech_stack_percent = calculate_tech_stack_percent(
        full_transcript,
        study_session.metadata_json
    )

    content_prompt = f"""
    당신은 기술 면접 코치입니다.
    아래 면접 전체 기록을 바탕으로 사용자의 답변 내용에 대한 총평과 보완 추천을 작성해 주세요.

    [면접 전체 기록]
    {full_transcript}

    [작성 조건]
    1. 한국어로 작성하세요.
    2. 답변의 장점 1~2개를 먼저 말하세요.
    3. 보완할 점 2~3개를 구체적으로 말하세요.
    4. 다음 면접을 위한 연습 방향을 제안하세요.
    5. 너무 길지 않게 5~8문장 정도로 작성하세요.
    """

    try:
        content_response = await gemini_model.generate_content_async(content_prompt)
        content_improvement = content_response.text.strip()
    except Exception:
        content_improvement = (
            f"전반적으로 {animal_name} 성향에 맞는 답변 흐름을 보여주었습니다. "
            "다만 실제 프로젝트 수치, 문제 해결 과정, 본인의 역할을 더 명확히 제시하면 "
            "면접 답변의 설득력이 높아질 수 있습니다."
        )

    existing_report = session.exec(
        select(InterviewReport).where(InterviewReport.session_id == session_id)
    ).first()

    if existing_report:
        existing_report.animal_name = animal_name
        existing_report.animal_reason = animal_reason
        existing_report.animal_image_url = animal_image_url
        existing_report.content_improvement = content_improvement
        existing_report.tech_stack_percent_json = json.dumps(
            tech_stack_percent,
            ensure_ascii=False
        )

        session.add(existing_report)
        session.commit()
        session.refresh(existing_report)

        report_id = existing_report.id

    else:
        report = InterviewReport(
            user_id=cast(int, current_user.id),
            session_id=session_id,
            animal_name=animal_name,
            animal_reason=animal_reason,
            animal_image_url=animal_image_url,
            content_improvement=content_improvement,
            tech_stack_percent_json=json.dumps(
                tech_stack_percent,
                ensure_ascii=False
            ),
        )

        session.add(report)
        session.commit()
        session.refresh(report)

        report_id = report.id

    return {
        "status": "success",
        "report_id": report_id,
        "session_id": session_id,
        "animal_name": animal_name,
        "animal_image_url": animal_image_url,
        "animal_reason": animal_reason,
        "content_improvement": content_improvement,
        "tech_stack_percent": tech_stack_percent,
        "interview_history": interview_history,
    }


def _build_session_dict(s, session):
    """세션 하나를 응답 dict로 변환하는 공용 헬퍼.
    GET /history 와 GET /history/{session_id} 양쪽에서 사용."""
    questions = session.exec(
        select(Question).where(Question.session_id == cast(int, s.id))
    ).all()
    questions = sorted(questions, key=lambda item: item.order_no)

    logs = session.exec(
        select(SpeakingLog).where(SpeakingLog.session_id == cast(int, s.id))
    ).all()
    logs = sorted(logs, key=lambda item: item.created_at)

    # word_logs 일괄 조회 — N+1 방지 (BACKEND_PR.md TODO #3)
    log_ids = [cast(int, log.id) for log in logs]
    word_logs_all = []
    if log_ids:
        word_logs_all = session.exec(
            select(WordLog).where(WordLog.speaking_log_id.in_(log_ids))  # type: ignore
        ).all()

    word_logs_map: dict[int, list] = {}
    for wl in word_logs_all:
        word_logs_map.setdefault(wl.speaking_log_id, []).append(wl)

    report = session.exec(
        select(InterviewReport).where(InterviewReport.session_id == cast(int, s.id))
    ).first()

    report_data = None
    if report:
        try:
            tech_stack_percent = json.loads(report.tech_stack_percent_json or "{}")
        except Exception:
            tech_stack_percent = {}

        report_data = {
            "report_id": report.id,
            "animal_name": report.animal_name,
            "animal_reason": report.animal_reason,
            "animal_image_url": report.animal_image_url,
            "content_improvement": report.content_improvement,
            "tech_stack_percent": tech_stack_percent,
            "overall_score": report.overall_score,
            "pronunciation_avg": report.pronunciation_avg,
            "accuracy_avg": report.accuracy_avg,
            "fluency_avg": report.fluency_avg,
            "content_score": report.content_score,
            "technical_score": report.technical_score,
            "confidence_score": report.confidence_score,
            "score_json": report.score_json,
            "created_at": str(report.created_at),
        }

    return {
        "session_id": s.id,
        "session_type": s.session_type,
        "title": s.title,
        "source_url": s.source_url,
        "created_at": str(s.created_at),
        "questions": [
            {
                "question_id": q.id,
                "order_no": q.order_no,
                "question_type": q.question_type,
                "question_text": q.question_text,
                "question_ko": q.question_ko,
                "model_answer": q.model_answer,
            }
            for q in questions
        ],
        "logs": [
            {
                "log_id": log.id,
                "question_id": log.question_id,
                "reference_text": log.reference_text,
                "recognized_text": log.recognized_text,
                "accuracy_score": log.accuracy_score,
                "pronunciation_score": log.pronunciation_score,
                "fluency_score": log.fluency_score,
                "coaching_message": log.coaching_message,
                "audio_url": log.audio_url,
                "user_tts_url": log.user_tts_url,
                "model_tts_url": log.model_tts_url,
                "created_at": str(log.created_at),
                # WsWord 스키마와 동일한 형태 (BACKEND_PR.md TODO #3)
                "word_logs": [
                    {
                        "word": wl.word,
                        "accuracy": wl.accuracy_score,
                        "error_type": wl.error_type,
                        "phonemes": json.loads(wl.phoneme_data)
                            if wl.phoneme_data else [],
                    }
                    for wl in word_logs_map.get(cast(int, log.id), [])
                ],
            }
            for log in logs
        ],
        "interview_report": report_data,
    }


@app.get("/history")
def get_history(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
):
    user_id = cast(int, current_user.id)

    # 전체 세션 수 — has_more 판정용 (BACKEND_PR.md TODO #1)
    all_sessions = session.exec(
        select(StudySession).where(StudySession.user_id == user_id)
    ).all()
    total = len(all_sessions)

    # created_at DESC 정렬 후 limit/offset 적용
    all_sessions = sorted(all_sessions, key=lambda item: item.created_at, reverse=True)
    paged_sessions = all_sessions[offset : offset + limit]

    result = [_build_session_dict(s, session) for s in paged_sessions]

    return {
        "history": result,
        "total": total,
        "has_more": (offset + limit) < total,
    }


@app.get("/history/{session_id}")
def get_history_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """단일 세션 조회 (BACKEND_PR.md TODO #2)"""
    s = session.exec(
        select(StudySession).where(StudySession.id == session_id)
    ).first()

    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")

    # 본인 소유 검증
    if s.user_id != cast(int, current_user.id):
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    return _build_session_dict(s, session)


@app.delete("/history/{session_id}")
def delete_history_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """
    히스토리 세션 삭제 (Step 10-D / feedback.md 2순위).

    삭제 정책:
      - 본인 소유 세션만 삭제 가능 (403)
      - 답변(SpeakingLog)·페르소나 리포트(InterviewReport) 보유 여부와
        무관하게 삭제 가능. 우발 삭제 방어는 프론트의
        "정말 삭제하시겠습니까?" 컨펌 팝업이 담당한다.

    Cascade 순서 (외래키 의존 그래프, 자식 → 부모):
        WordLog ← SpeakingLog ← StudySession
                                ↑
        InterviewReport ────────┤
        Question ───────────────┘

    정적 오디오/이미지 파일(audio_url, user_tts_url, model_tts_url 등)은
    여러 곳에서 참조될 가능성이 있고 외부(pollinations.ai) URL도 섞여 있어
    여기서는 DB row만 정리한다. 디스크 정리는 별도 정리 잡 영역.
    """
    study_session = session.exec(
        select(StudySession).where(StudySession.id == session_id)
    ).first()

    if not study_session:
        raise HTTPException(status_code=404, detail="해당 세션을 찾을 수 없습니다.")

    if study_session.user_id != cast(int, current_user.id):
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    # 1) WordLog 정리 — 해당 세션의 SpeakingLog ID를 모아 한 번에 매칭
    logs = session.exec(
        select(SpeakingLog).where(SpeakingLog.session_id == session_id)
    ).all()
    log_ids = [cast(int, log.id) for log in logs if log.id is not None]

    if log_ids:
        word_logs = session.exec(
            select(WordLog).where(WordLog.speaking_log_id.in_(log_ids))  # type: ignore
        ).all()
        for wl in word_logs:
            session.delete(wl)

    # 2) SpeakingLog 정리
    for log in logs:
        session.delete(log)

    # 3) InterviewReport 정리 (면접 세션이면 1건, 그 외 없음)
    report = session.exec(
        select(InterviewReport).where(InterviewReport.session_id == session_id)
    ).first()
    if report:
        session.delete(report)

    # 4) Question 정리
    questions = session.exec(
        select(Question).where(Question.session_id == session_id)
    ).all()
    for q in questions:
        session.delete(q)

    # 5) StudySession 삭제 + 일괄 커밋
    session.delete(study_session)
    session.commit()

    return {"message": "세션이 삭제되었습니다.", "session_id": session_id}


@app.get("/progress")
def get_my_progress(
    current_user: User = Depends(get_current_user),
):
    user_id = cast(int, current_user.id)
    return get_user_progress(user_id)


@app.get("/progress/summary")
async def get_my_progress_summary(
    current_user: User = Depends(get_current_user),
):
    user_id = cast(int, current_user.id)

    progress = get_user_progress(user_id)
    weak_patterns = get_total_weak_patterns(user_id)

    if progress.get("total_logs", 0) == 0:
        return {
            "message": "아직 학습 기록이 부족합니다.",
            "summary": "학습 기록이 쌓이면 향상률 분석을 제공할 수 있습니다.",
        }

    prompt = f"""
    당신은 영어 발음 코치입니다.
    아래 사용자의 학습 기록 분석 데이터를 바탕으로 한국어 학습 리포트를 작성해 주세요.

    [전체 향상률]
    {progress}

    [현재 주요 약점]
    {weak_patterns}

    [작성 조건]
    1. 사용자가 실제로 얼마나 향상되었는지 설명하세요.
    2. pronunciation, accuracy, fluency 중 어떤 항목이 가장 좋아졌는지 설명하세요.
    3. 아직 보완하면 좋은 부분을 2~3개 정도만 간단히 짚어 주세요.
    4. 앞으로 어떤 연습을 하면 좋을지 구체적으로 제안하세요.
    5. 너무 딱딱하지 않게 코치처럼 작성하세요.
    6. 음소 기호를 너무 많이 나열하지 말고, 사용자가 이해하기 쉬운 말로 설명하세요.
    """

    try:
        response = await gemini_model.generate_content_async(prompt)
        ai_summary = response.text
    except Exception as e:
        ai_summary = f"AI 요약 생성 실패: {str(e)}"

    return {
        "message": "향상률 요약 생성 완료",
        "progress": progress,
        "weak_patterns": weak_patterns,
        "summary": ai_summary,
    }


@app.get("/cumulative-analysis/{user_id}")
async def get_cumulative_report(
    user_id: int,
    current_user: User = Depends(get_current_user),
):
    # 본인 데이터만 조회 가능 (P0 보안 — BACKEND_PR.md TODO #5)
    if cast(int, current_user.id) != user_id:
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    weak_list = get_total_weak_patterns(user_id)

    if not weak_list:
        return {"summary": "아직 충분한 데이터가 쌓이지 않았습니다."}

    prompt = f"""
    사용자의 누적 발음 데이터 분석 결과입니다:
    {weak_list}

    이 데이터를 바탕으로 사용자의 고질적인 발음 습관을 분석하고,
    이를 교정하기 위한 장기적인 훈련 플랜을 한국어로 작성해 주세요.
    """

    response = await gemini_model.generate_content_async(prompt)

    return {
        "weak_phonemes": weak_list,
        "ai_analysis": response.text,
    }