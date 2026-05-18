import os
import json
import asyncio
import re
import shutil
import traceback

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, File, UploadFile, Form, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, cast, Any
from sqlmodel import Session, select

import azure.cognitiveservices.speech as speechsdk
import google.generativeai as genai

from utils import get_transcript_via_whisper, extract_text_from_pdf
from analyzer import get_total_weak_patterns
from interview_manager import InterviewManager

from database import get_session, init_db, engine
from models import User, StudySession, Question, SpeakingLog, WordLog
from schemas import SignupRequest, LoginRequest, TokenResponse, MeResponse
from security import hash_password, verify_password, create_access_token, decode_access_token
from deps import get_current_user


load_dotenv()
AZURE_KEY = os.getenv("AZURE_SPEECH_KEY")
AZURE_REGION = os.getenv("AZURE_SPEECH_REGION")
GEMINI_KEY = os.getenv("GEMINI_API_KEY")

genai.configure(api_key=GEMINI_KEY)
gemini_model = genai.GenerativeModel("models/gemini-3.1-flash-lite-preview")
interview_manager = InterviewManager(gemini_model)

app = FastAPI(title="Sync Capstone API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if not os.path.exists("static/audio"):
    os.makedirs("static/audio")
if not os.path.exists("static"):
    os.makedirs("static")

app.mount("/static", StaticFiles(directory="static"), name="static")

init_db()


class InterviewSetup(BaseModel):
    position: str
    tech_stack: List[str]
    experience_level: str
    project_summary: str
    interview_mode: str


class AnswerRequest(BaseModel):
    session_id: int
    current_question_id: int
    current_question: str
    user_answer: str


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

        parsed.append({
            "order_no": idx,
            "question_text": question_text,
            "question_ko": question_ko,
            "model_answer": model_answer
        })

    return parsed


def extract_model_answer(feedback: str) -> str:
    model_match = re.search(r"Model Answer[^\w]*([a-zA-Z].+?)(?=\n|$)", feedback, re.IGNORECASE)
    if not model_match:
        return ""
    return model_match.group(1).replace('"', "").strip()


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

    user_id = cast(int, user.id)
    user_email = cast(str, user.email)

    access_token = create_access_token(user_id, user_email)

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


def process_pronunciation_result(result_obj):
    actual_result = getattr(result_obj, "result", result_obj)
    pron_result = speechsdk.PronunciationAssessmentResult(actual_result)

    word_details = []
    for word in pron_result.words:
        phonemes = [{"ph": ph.phoneme, "score": ph.accuracy_score} for ph in word.phonemes]
        word_details.append({
            "word": word.word,
            "accuracy": word.accuracy_score,
            "error_type": getattr(word, "error_type", None),
            "phonemes": phonemes
        })

    return {
        "sentence": {
            "text": actual_result.text,
            "accuracy": pron_result.accuracy_score,
            "pronunciation": pron_result.pronunciation_score,
            "fluency": pron_result.fluency_score
        },
        "words": word_details
    }


async def get_ai_coaching(final_data, current_question):
    prompt = f"""
    당신은 1:1 영어 회화 튜터입니다. 사용자의 답변 내용을 분석해 주세요.

    [상황]
    - 선생님의 질문: {current_question}
    - 학생의 답변: {final_data['sentence']['text']}
    - 발음 데이터: {final_data['words']}

    [분석 요청]
    1. 대답 적절성: 학생이 질문의 의도에 맞는 대답을 했는지 한국어로 다정하게 평가해 주세요.
    2. 발음 코칭: 음소(phonemes) 점수가 낮은 단어를 콕 집어 발음 팁(입모양 등)을 주세요.
    3. 모범 답안: 'Model Answer: [문장]' 형식으로 더 자연스러운 원어민 표현을 제안해 주세요.
    """
    try:
        response = await gemini_model.generate_content_async(prompt)
        return response.text
    except Exception as e:
        return f"코칭 생성 실패: {str(e)}"


async def generate_native_audio(text, file_name):
    if not text or len(text.strip()) < 2:
        return None

    speech_config = speechsdk.SpeechConfig(subscription=AZURE_KEY, region=AZURE_REGION)
    speech_config.speech_synthesis_voice_name = "en-US-JennyNeural"

    audio_path = f"static/audio/{file_name}.mp3"
    audio_config = speechsdk.audio.AudioOutputConfig(filename=audio_path)
    synthesizer = speechsdk.SpeechSynthesizer(
        speech_config=speech_config,
        audio_config=audio_config
    )

    result = synthesizer.speak_text_async(text).get()
    result = cast(Any, result)

    return f"/static/audio/{file_name}.mp3" if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted else None


@app.get("/")
def root():
    return {"message": "Sync Capstone API is running"}


@app.get("/all-test")
async def get_all_test_page():
    return FileResponse("static/all_in_one_test.html")


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
        1. 인사말 없이 오직 아래 형식으로만 3줄을 출력해.
        2. 형식: 질문? | (한국어 해석) | [모범 답안: 영어 문장]
        3. 각 질문은 반드시 한 줄에 하나씩 작성해.

        스크립트: {transcript[:2500]}
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
            metadata_json=json.dumps({"question_count": len(parsed_questions)}, ensure_ascii=False),
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
            "questions": saved_questions
        }
    except Exception as e:
        return {"error": str(e)}


@app.websocket("/ws/audio")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    recognizer = None
    current_question = "General Conversation"

    db = Session(engine)
    current_user = None
    current_session_id = None
    current_question_id = None

    try:
        token = websocket.query_params.get("token")
        if token:
            try:
                payload = decode_access_token(token)
                user_id = int(payload["sub"])
                current_user = db.exec(select(User).where(User.id == user_id)).first()
            except Exception:
                current_user = None

        session_param = websocket.query_params.get("session_id")
        question_param = websocket.query_params.get("question_id")
        if session_param:
            current_session_id = int(session_param)
        if question_param:
            current_question_id = int(question_param)

        speech_config = speechsdk.SpeechConfig(subscription=AZURE_KEY, region=AZURE_REGION)
        stream_format = speechsdk.audio.AudioStreamFormat(samples_per_second=16000, bits_per_sample=16, channels=1)
        push_stream = speechsdk.audio.PushAudioInputStream(stream_format)
        audio_config = speechsdk.audio.AudioConfig(stream=push_stream)

        pron_config = speechsdk.PronunciationAssessmentConfig(
            reference_text="",
            grading_system=speechsdk.PronunciationAssessmentGradingSystem.HundredMark,
            granularity=speechsdk.PronunciationAssessmentGranularity.Phoneme
        )

        recognizer = speechsdk.SpeechRecognizer(speech_config=speech_config, audio_config=audio_config)
        pron_config.apply_to(recognizer)

        while True:
            message = await websocket.receive()
            if "text" in message:
                data = json.loads(message["text"])
                if data.get("type") == "stop":
                    current_question = data.get("question", current_question)
                    if data.get("session_id") is not None:
                        current_session_id = int(data["session_id"])
                    if data.get("question_id") is not None:
                        current_question_id = int(data["question_id"])
                    break
            elif "bytes" in message:
                push_stream.write(message["bytes"])

        push_stream.close()
        result = recognizer.recognize_once_async().get()
        result = cast(Any, result)

        if result.reason == speechsdk.ResultReason.RecognizedSpeech:
            final_data = process_pronunciation_result(result)
            feedback = await get_ai_coaching(final_data, current_question)

            user_tts = await generate_native_audio(result.text, f"u_{result.result_id}")
            model_text = extract_model_answer(feedback)
            model_tts = await generate_native_audio(model_text, f"m_{result.result_id}")

            saved_log_id = None

            if current_user and current_session_id:
                reference_text = current_question
                if current_question_id:
                    q_obj = db.exec(select(Question).where(Question.id == current_question_id)).first()
                    if q_obj and q_obj.model_answer:
                        reference_text = q_obj.model_answer
                    elif q_obj:
                        reference_text = q_obj.question_text

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
                    user_tts_url=user_tts,
                    model_tts_url=model_tts,
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
                        phoneme_data=json.dumps(word["phonemes"], ensure_ascii=False),
                    )
                    db.add(word_log)

                db.commit()

            await websocket.send_text(json.dumps({
                "user_said": result.text,
                "score": final_data["sentence"],
                "words": final_data["words"],
                "feedback": feedback,
                "user_tts_url": user_tts,
                "model_tts_url": model_tts,
                "saved_log_id": saved_log_id
            }))
    except Exception:
        traceback.print_exc()
    finally:
        if recognizer:
            del recognizer
        db.close()


@app.get("/cumulative-analysis/{user_id}")
async def get_cumulative_report(user_id: int):
    weak_list = get_total_weak_patterns(user_id)
    if not weak_list:
        return {"summary": "아직 충분한 데이터가 쌓이지 않았습니다."}

    prompt = f"""
    사용자의 누적 발음 데이터 분석 결과입니다: {weak_list}
    이 데이터를 바탕으로 사용자의 고질적인 발음 습관을 분석하고, 이를 교정하기 위한 장기적인 훈련 플랜을 한국어로 작성해줘.
    """
    response = await gemini_model.generate_content_async(prompt)
    return {
        "weak_phonemes": weak_list,
        "ai_analysis": response.text
    }


@app.post("/interview/setup")
async def setup_interview(setup: InterviewSetup):
    first_question = await interview_manager.generate_initial_question(setup.dict())
    return {"status": "success", "question": first_question}


@app.post("/interview/start")
async def start_interview(
    data: dict,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    mode = data.get("mode")
    self_intro = data.get("self_intro")
    user_selection = data.get("user_selection")

    if mode == "ai":
        if self_intro:
            position = data.get("position", "Software Engineer")
            question_text = await interview_manager.generate_question_from_pdf(self_intro, position)
        elif user_selection:
            question_text = await interview_manager.generate_initial_question(user_selection)
        else:
            return {"error": "정보가 없습니다."}
    else:
        question_text = data.get("manual_question", "Please introduce yourself.")

    study_session = StudySession(
        user_id=cast(int, current_user.id),
        session_type="interview",
        title="Interview Practice",
        source_text=self_intro,
        metadata_json=json.dumps(data, ensure_ascii=False),
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
        "session_id": study_session.id,
        "question_id": question.id,
        "question": question_text
    }


@app.post("/interview/start-unified")
async def start_unified_interview(
    position: str = Form(...),
    tech_stack: str = Form(...),
    experience_level: str = Form(...),
    project_summary: str = Form(...),
    interview_mode: str = Form(...),
    file: Optional[UploadFile] = File(None),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    pdf_text = ""

    if file:
        upload_dir = "temp_uploads"
        os.makedirs(upload_dir, exist_ok=True)
        safe_filename = file.filename or "uploaded_file.pdf"
        file_path = os.path.join(upload_dir, safe_filename)

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
        "interview_mode": interview_mode
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
        "question": question_text
    }


@app.post("/interview/answer")
async def process_answer(
    req: AnswerRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    follow_up = await interview_manager.generate_follow_up(req.current_question, req.user_answer)

    all_questions = session.exec(
        select(Question).where(Question.session_id == req.session_id)
    ).all()
    next_order = len(all_questions) + 1

    next_question = Question(
        session_id=req.session_id,
        order_no=next_order,
        question_type="interview_followup",
        question_text=follow_up,
    )
    session.add(next_question)
    session.commit()
    session.refresh(next_question)

    return {
        "follow_up": follow_up,
        "next_question_id": next_question.id,
        "status": "continue"
    }


@app.post("/interview/upload-pdf")
async def upload_pdf_interview(
    position: str = Form(...),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    upload_dir = "temp_uploads"
    os.makedirs(upload_dir, exist_ok=True)
    safe_filename = file.filename or "uploaded_file.pdf"
    file_path = os.path.join(upload_dir, safe_filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        pdf_text = extract_text_from_pdf(file_path)
        question_text = await interview_manager.generate_question_from_pdf(pdf_text, position)

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
            "extracted_text_preview": pdf_text[:200] + "..."
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)


@app.get("/history")
def get_history(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    sessions = session.exec(
        select(StudySession).where(StudySession.user_id == cast(int, current_user.id))
    ).all()

    result = []
    for s in sessions:
        questions = session.exec(
            select(Question).where(Question.session_id == cast(int, s.id))
        ).all()

        logs = session.exec(
            select(SpeakingLog).where(SpeakingLog.session_id == cast(int, s.id))
        ).all()

        result.append({
            "session_id": s.id,
            "session_type": s.session_type,
            "title": s.title,
            "source_url": s.source_url,
            "created_at": str(s.created_at),
            "questions": [
                {
                    "question_id": q.id,
                    "order_no": q.order_no,
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
                    "user_tts_url": log.user_tts_url,
                    "model_tts_url": log.model_tts_url,
                    "created_at": str(log.created_at),
                }
                for log in logs
            ]
        })

    return {"history": result}