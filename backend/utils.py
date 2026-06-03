# backend/utils.py
import os
import re
import tempfile

import whisper
import yt_dlp
import fitz  # PyMuPDF


# ─────────────────────────────────────────────────────────────
# YouTube 스크립트 추출 — yt-dlp로 오디오 다운로드 후 Whisper로 STT
# main.py /generate-questions 에서 호출.
#  - 호출부 계약: 반환값이 falsy(빈 문자열)면 "유튜브 분석 실패"로 처리한다.
#  - 단어별 재생 타임스탬프(TODO #9)와는 무관한 경로다.
#    (그쪽은 Azure word_boundary로 처리 — Whisper 재분석 아님)
# ─────────────────────────────────────────────────────────────

# Whisper 모델은 로드 비용이 크므로 모듈 레벨에서 1회만 로드(지연 초기화).
# 매 요청마다 load_model 하면 수 초~수십 초가 낭비된다.
_WHISPER_MODEL = None


def _get_whisper_model():
    """Whisper 모델 지연 초기화 + 프로세스 단위 캐싱."""
    global _WHISPER_MODEL
    if _WHISPER_MODEL is None:
        # base: 속도/정확도 균형. 환경변수 WHISPER_MODEL 로 교체 가능
        # (tiny/base/small/medium/large).
        model_name = os.getenv("WHISPER_MODEL", "base")
        _WHISPER_MODEL = whisper.load_model(model_name)
    return _WHISPER_MODEL


def get_transcript_via_whisper(url: str) -> str:
    """
    YouTube URL의 오디오를 yt-dlp로 내려받아 Whisper로 전사한 텍스트를 반환.

    실패(빈 URL / 다운로드 실패 / 전사 예외) 시 빈 문자열을 반환하여
    호출부(main.py)가 일관되게 '유튜브 분석 실패'로 처리하도록 한다.

    주의: Whisper의 transcribe는 내부적으로 ffmpeg로 오디오를 디코딩하므로
    실행 환경에 ffmpeg가 설치되어 PATH에 등록돼 있어야 한다.
    """
    if not url:
        return ""

    # 임시 작업 디렉토리 — 함수 종료 시 finally에서 정리
    tmp_dir = tempfile.mkdtemp(prefix="yt_audio_")
    # 실제 컨테이너 포맷(webm/m4a 등)에 맞춰 yt-dlp가 확장자를 채운다.
    out_template = os.path.join(tmp_dir, "audio.%(ext)s")

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": out_template,
        "noplaylist": True,   # 재생목록 URL이라도 단일 영상만
        "quiet": True,
        "no_warnings": True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            downloaded_path = ydl.prepare_filename(info)

        if not downloaded_path or not os.path.exists(downloaded_path):
            print(f"⚠️ 오디오 다운로드 실패: {url}")
            return ""

        model = _get_whisper_model()
        result = model.transcribe(downloaded_path)
        return str(result.get("text", "")).strip()

    except Exception as e:
        print(f"❌ Whisper 전사 중 에러 발생: {e}")
        return ""

    finally:
        # 임시 오디오/디렉토리 정리 (실패해도 본 흐름에 영향 없음)
        try:
            for name in os.listdir(tmp_dir):
                os.remove(os.path.join(tmp_dir, name))
            os.rmdir(tmp_dir)
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────
# PII 마스킹 — 이력서 텍스트가 LLM(GPT)으로 가기 전에 적용
# feedback.md Q5: 정규식 기반 익명화. 이메일/전화/주민번호 우선.
# 직무·기술스택 등 평가에 필요한 신호는 보존하기 위해 이름은
# 보수적으로 처리(라벨 패턴 "이름 : 홍길동"만 마스킹).
# ─────────────────────────────────────────────────────────────

# 이메일
_RE_EMAIL = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
# 휴대전화 (010-1234-5678 / 010 1234 5678 / 01012345678 / +82-10-...)
_RE_PHONE = re.compile(
    r"(?:\+?82[-\s]?)?(0?1[016789])[-\s]?(\d{3,4})[-\s]?(\d{4})"
)
# 일반 전화 (02-123-4567 / 031-123-4567)
_RE_LANDLINE = re.compile(r"\b0\d{1,2}[-\s]\d{3,4}[-\s]\d{4}\b")
# 주민등록번호 (901231-1234567)
_RE_RRN = re.compile(r"\b\d{6}[-\s]?[1-4]\d{6}\b")
# "이름 : XXX" 또는 "성명 : XXX" 라벨 뒤 한글 이름 (2~4자)
_RE_NAMED = re.compile(r"(이름|성명|Name)\s*[:：]\s*([가-힣]{2,4}|[A-Za-z][A-Za-z\s]{1,30})")
# 주소의 가장 흔한 시작 토큰 — 보수적으로 라벨 패턴만
_RE_ADDR = re.compile(r"(주소|Address)\s*[:：][^\n]{0,80}")


def mask_pii(text: str) -> str:
    """
    이력서 등 사용자 제출 텍스트의 민감 정보를 마스킹.
    LLM(외부 API) 전송 직전에 호출한다.
    """
    if not text:
        return text

    masked = _RE_EMAIL.sub("[EMAIL]", text)
    masked = _RE_PHONE.sub("[PHONE]", masked)
    masked = _RE_LANDLINE.sub("[PHONE]", masked)
    masked = _RE_RRN.sub("[RRN]", masked)
    masked = _RE_NAMED.sub(r"\1: [NAME]", masked)
    masked = _RE_ADDR.sub(r"\1: [ADDRESS]", masked)

    return masked


def extract_text_from_pdf(file_path):
    """
    PDF 파일에서 텍스트를 추출함.
    추출 직후 mask_pii로 민감 정보를 익명화하여 반환한다.
    (feedback.md Q5 — 이력서 개인정보 보호)
    """
    try:
        doc = fitz.open(file_path)
        text = "".join([page.get_text() for page in doc])
        doc.close()

        if not text.strip():
            print("⚠️ PDF에서 추출된 텍스트가 없습니다.")

        # 마스킹은 추출 직후 한 곳에서만 적용 — 호출자가 따로 신경 쓸 필요 없음
        return mask_pii(text.strip())
    except Exception as e:
        print(f"❌ PDF 추출 중 에러 발생: {e}")
        return ""
