# backend/utils.py
import os
import re
import shutil
import tempfile

import whisper
import yt_dlp
from pypdf import PdfReader


# ─────────────────────────────────────────────────────────────
# ffmpeg 경로 보장 (Mac에서 YouTube 질문 생성이 안 되던 근본 원인 해결)
#
# Whisper의 transcribe()는 내부적으로 `ffmpeg` CLI를 subprocess로 호출한다.
#   (openai-whisper/audio.py → run(["ffmpeg", ...]) — "Requires the ffmpeg CLI in PATH")
# 즉, 백엔드를 실행한 프로세스의 PATH에서 정확히 `ffmpeg` 이름이 해석돼야 한다.
#
#  - Windows: winget/choco 설치분이 시스템 PATH에 잡혀 그대로 동작 → 정상.
#  - macOS: 두 가지 함정으로 실패 →
#       (1) ffmpeg 미설치
#       (2) 설치돼 있어도 Apple Silicon Homebrew는 /opt/homebrew/bin 에 까는데,
#           IDE/GUI로 띄운 백엔드 프로세스의 PATH엔 이 경로가 빠져 있는 경우가 많다.
#           ("brew install ffmpeg 했는데 백엔드만 못 찾음")
#
# 어느 경우든 whisper는 FileNotFoundError를 던지고, 그게 아래 함수의
# except Exception 에서 빈 문자열로 흡수되어 "유튜브 분석 실패"로만 보였다.
# (OS마다 재현이 갈리던 원인)
#
# 해결: 모듈 로드 시 ffmpeg를 능동적으로 찾아 PATH에 보장한다.
#   1) 이미 PATH에서 해석되면 그대로 사용
#   2) macOS/Linux 표준 설치 경로(/opt/homebrew/bin 등)를 PATH에 보강 후 재확인
#   3) 그래도 없으면 pip로 함께 설치되는 imageio-ffmpeg 의 번들 바이너리를
#      `ffmpeg` 이름으로 노출 (OS·아키텍처 무관, 추가 수동 설치 불필요)
# ─────────────────────────────────────────────────────────────

# ffmpeg 사용 가능 여부 — 모듈 로드 시 1회 판정하여 캐싱
FFMPEG_AVAILABLE: bool = False


def _ensure_ffmpeg_on_path() -> bool:
    """프로세스 PATH에서 `ffmpeg`가 해석되도록 보장. 최종 가용 여부를 반환."""
    # 1) 이미 찾을 수 있으면 끝
    if shutil.which("ffmpeg"):
        return True

    # 2) macOS(Apple Silicon/Intel)·Linux 표준 설치 경로를 PATH에 보강
    candidate_dirs = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
    current_path = os.environ.get("PATH", "")
    path_parts = current_path.split(os.pathsep)
    for d in candidate_dirs:
        if os.path.isdir(d) and d not in path_parts:
            current_path = d + os.pathsep + current_path
            os.environ["PATH"] = current_path
            path_parts = current_path.split(os.pathsep)
    if shutil.which("ffmpeg"):
        return True

    # 3) 번들 바이너리(imageio-ffmpeg) 폴백 — 수동 설치 없이 OS 무관 동작
    try:
        import imageio_ffmpeg

        exe = imageio_ffmpeg.get_ffmpeg_exe()  # 플랫폼별 정적 바이너리의 절대 경로
        bin_dir = os.path.dirname(exe)

        # imageio-ffmpeg의 바이너리 이름은 "ffmpeg-<os>-<arch>-<ver>" 형태라
        # whisper가 부르는 정확한 이름("ffmpeg"/"ffmpeg.exe")으로 별칭을 만들어 둔다.
        alias_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
        alias_path = os.path.join(bin_dir, alias_name)
        if not os.path.exists(alias_path):
            try:
                os.symlink(exe, alias_path)
            except (OSError, NotImplementedError):
                # 심볼릭 링크 불가 환경(권한·파일시스템 등) → 복사 폴백
                shutil.copy2(exe, alias_path)

        if bin_dir not in os.environ.get("PATH", "").split(os.pathsep):
            os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")

        return shutil.which("ffmpeg") is not None
    except Exception as e:
        print(f"⚠️ 번들 ffmpeg(imageio-ffmpeg) 준비 실패: {e}")
        return False


FFMPEG_AVAILABLE = _ensure_ffmpeg_on_path()
if not FFMPEG_AVAILABLE:
    print(
        "❌ ffmpeg를 찾을 수 없습니다 — YouTube 전사(STT)가 동작하지 않습니다.\n"
        "   설치: macOS  `brew install ffmpeg`\n"
        "         Windows `winget install ffmpeg`\n"
        "         Linux   `sudo apt install ffmpeg`\n"
        "   또는 requirements.txt 의 imageio-ffmpeg 설치 여부를 확인하세요."
    )


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

    실패(빈 URL / ffmpeg 부재 / 다운로드 실패 / 전사 예외) 시 빈 문자열을 반환하여
    호출부(main.py)가 일관되게 '유튜브 분석 실패'로 처리하도록 한다.

    주의: Whisper의 transcribe는 내부적으로 ffmpeg로 오디오를 디코딩하므로
    실행 환경에 ffmpeg가 PATH에 등록돼 있어야 한다. (모듈 로드 시
    _ensure_ffmpeg_on_path()로 자동 보장 — Mac 등에서 미설치/PATH 누락 대응)
    """
    if not url:
        return ""

    # ffmpeg가 끝내 없으면 여기서 명확히 끊어 준다.
    # (그러지 않으면 whisper가 던지는 FileNotFoundError가 아래 except에서
    #  generic '전사 에러'로 뭉뚱그려져 원인 파악이 어려워진다.)
    if not (FFMPEG_AVAILABLE or shutil.which("ffmpeg")):
        print(
            "❌ ffmpeg 미탑재로 YouTube 전사를 건너뜁니다 — 서버 환경 점검 필요 "
            "(macOS: `brew install ffmpeg`)."
        )
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

    except FileNotFoundError as e:
        # ffmpeg가 PATH에서 사라진 경우 등 — 정확한 원인을 남긴다.
        print(
            f"❌ 실행 파일을 찾을 수 없습니다(ffmpeg 추정): {e} "
            "— macOS는 `brew install ffmpeg` 후 백엔드 재시작을 확인하세요."
        )
        return ""
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

    pypdf(BSD-3-Clause)를 사용 — 프로젝트 MIT 라이선스와 호환.
    기존 PyMuPDF(AGPL-3.0)에서 교체됨.
    """
    try:
        reader = PdfReader(file_path)
        text = "".join([page.extract_text() or "" for page in reader.pages])

        if not text.strip():
            print("⚠️ PDF에서 추출된 텍스트가 없습니다.")

        # 마스킹은 추출 직후 한 곳에서만 적용 — 호출자가 따로 신경 쓸 필요 없음
        return mask_pii(text.strip())
    except Exception as e:
        print(f"❌ PDF 추출 중 에러 발생: {e}")
        return ""
