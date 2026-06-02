# backend/utils.py — 상단 import에 re 추가
import re
import whisper
import os
import fitz  # PyMuPDF

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