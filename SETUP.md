# sync. — Local Setup Guide

AI Speaking Tutor 프로젝트를 로컬에서 처음 실행하는 분을 위한 완전한 가이드입니다.

---

## 1. 사전 설치 프로그램

| 프로그램 | 버전 | 확인 명령 |
|---|---|---|
| Git | latest | `git --version` |
| Node.js | ≥ 20 LTS | `node -v` |
| Python | 3.10 ~ 3.12 (3.13 비권장) | `python --version` |
| Docker Desktop | latest | `docker --version` |
| FFmpeg + FFprobe | latest | `ffmpeg -version` |

### FFmpeg 설치
```bash
# Windows
winget install ffmpeg

# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt update && sudo apt install ffmpeg
```

설치 후 새 터미널 창에서 `ffmpeg -version`, `ffprobe -version`이 모두 동작해야 합니다.

---

## 2. 저장소 클론

```bash
git clone <repo-url> sync-project
cd sync-project
```

폴더 구조:
```
sync-project/
├── backend/   # FastAPI + PostgreSQL
├── frontend/  # React + Vite + TypeScript
└── SETUP.md   # 이 문서
```

---

## 3. 환경 변수 파일 생성

저장소에는 `.env` 파일이 포함되어 있지 않습니다 (`.gitignore`). 두 개의 파일을 직접 만들어야 합니다.

### 3-1. `backend/.env`

```ini
# Azure Speech Service
# https://portal.azure.com → Speech Services → 키 및 엔드포인트
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=koreacentral

# Google Gemini API
# https://aistudio.google.com/apikey
GEMINI_API_KEY=

# PostgreSQL (docker-compose.yml 기본값과 일치)
DATABASE_URL=postgresql://sync:sync123@localhost:5432/speaking

# JWT 시크릿 (반드시 본인만의 랜덤값으로!)
# 생성: python -c "import secrets; print(secrets.token_urlsafe(32))"
JWT_SECRET=
```

### 3-2. `frontend/.env.local`

```ini
VITE_API_BASE_URL=http://127.0.0.1:8000
```

---

## 4. 백엔드 실행

```bash
cd backend

# 가상환경 생성
python -m venv venv

# 가상환경 활성화
# Windows (PowerShell)
.\venv\Scripts\Activate.ps1
# macOS / Linux
source venv/bin/activate

# 의존성 설치 (Whisper 등으로 수 분 소요)
python -m pip install --upgrade pip
pip install -r requirements.txt

# PostgreSQL 시작 (백그라운드)
docker compose up -d

# 서버 실행
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

확인: <http://localhost:8000/docs> 에 Swagger UI가 표시되면 성공.

---

## 5. 프론트엔드 실행

새 터미널을 열고:

```bash
cd frontend

# 의존성 설치
npm install

# 개발 서버 실행
npm run dev
```

확인: <http://localhost:5173> 에 화면이 표시되면 성공.

---

## 6. 종료 방법

```bash
# 프론트엔드 / 백엔드: Ctrl+C로 각 터미널 종료

# PostgreSQL 컨테이너 중지 (데이터는 유지)
cd backend
docker compose stop

# PostgreSQL 완전 제거 (데이터까지 삭제)
docker compose down -v
```

---

## 7. 자주 발생하는 문제

| 증상 | 원인 / 해결 |
|---|---|
| `psycopg2-binary` 설치 실패 | macOS에서 빈번. `pip install psycopg2-binary --no-cache-dir` 또는 `brew install postgresql` 선행 |
| `pip install openai-whisper` 매우 느림 | PyTorch가 함께 설치되며 ~2GB. 인내. 동시에 디스크 여유 확인 |
| `uvicorn` 시작 시 Azure 인증 에러 | `.env`의 `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION` 오타 확인 |
| `docker compose up` 시 5432 포트 충돌 | 로컬에 다른 PostgreSQL이 실행 중. `lsof -i :5432` (macOS/Linux) / `netstat -ano | findstr :5432` (Windows)로 확인 후 종료 |
| 프론트엔드에서 `Network Error` | 백엔드가 켜져 있는지, `frontend/.env.local`의 `VITE_API_BASE_URL`이 백엔드 포트와 일치하는지 확인 |
| `npm install` 시 peer dependency 경고 | 대부분 무시 가능. 에러(ERR)가 아니면 진행 |
| 마이크 권한 거부됨 | 브라우저는 `localhost`와 `https://`에서만 마이크 허용. `127.0.0.1`도 OK. IP 주소(`192.168.x.x`)로 접속 시 HTTPS 필요 |
| 모바일에서 `npm run dev` 접속 안 됨 | 같은 Wi-Fi인지 확인 + 방화벽 허용. `vite.config.ts`의 `server.host: true` 옵션이 켜져 있어야 함 |

---

## 8. 실행 순서 요약 (재실행 시)

매번 실행할 때:

```bash
# 터미널 1: 백엔드
cd backend
source venv/bin/activate         # 또는 Windows의 .\venv\Scripts\Activate.ps1
docker compose start             # 또는 up -d (이미 컨테이너가 있으면 start만)
uvicorn main:app --reload

# 터미널 2: 프론트엔드
cd frontend
npm run dev
```
