# EchoSync. — AI Speaking Tutor

> YouTube 기반 영어 스피킹 연습과 AI 기술 면접 시뮬레이션을 한 곳에서.

---

## 프로젝트 소개

**EchoSync.** 는 영어 스피킹 능력 향상을 목표로 하는 풀스택 웹 애플리케이션입니다.

- **YouTube Speaking Practice** — YouTube 영상의 자막을 따라 읽고, Azure Speech SDK가 발음·정확도·유창성을 실시간 채점합니다.
- **AI Mock Interview** — 자기소개서(PDF)와 기술 스택을 기반으로 Gemini가 맞춤 기술 면접 질문을 생성하고, 음성 답변을 채점·피드백합니다. 면접 종료 시 동물 페르소나 분석 리포트를 제공합니다.
- **Dashboard & Analytics** — 누적 학습 데이터를 기반으로 목표 설정, 점수 추이, 약점 단어, 추천 학습 방향을 제시합니다.

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, Zustand, TanStack React Query v5, React Router v6, Axios |
| **Backend** | Python, FastAPI, SQLModel / SQLAlchemy, PostgreSQL 16 |
| **AI / Speech** | Azure Cognitive Services Speech SDK, Google Gemini API, OpenAI Whisper (로컬), Pollinations (이미지 생성) |
| **Infra** | Docker Compose (PostgreSQL), FFmpeg |

---

## 폴더 구조

```
echo_sync/
├── backend/           # FastAPI 서버 + WebSocket + AI 파이프라인
│   ├── main.py        # 앱 엔트리포인트 + 라우터
│   ├── models.py      # SQLModel ORM
│   ├── learning_features.py  # 대시보드·추천·목표 API
│   ├── interview_manager.py  # 면접 세션 관리
│   ├── docker-compose.yml    # PostgreSQL 컨테이너
│   └── requirements.txt
├── frontend/          # React + Vite SPA
│   └── src/
│       ├── pages/     # 페이지 컴포넌트
│       ├── components/# 공유 UI 컴포넌트
│       ├── hooks/     # 커스텀 훅 (useAudioStreamer 등)
│       ├── stores/    # Zustand 스토어
│       ├── lib/       # Axios 인스턴스, 상수, 유틸
│       └── types/     # TypeScript 타입 정의
├── LICENSE
└── README.md          # 이 문서
```

---

## 사전 설치 프로그램

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

# Ubuntu / Debian
sudo apt update && sudo apt install ffmpeg
```

설치 후 새 터미널에서 `ffmpeg -version`, `ffprobe -version`이 모두 동작해야 합니다.

---

## 빠른 시작

### 1. 저장소 클론

```bash
git clone https://github.com/paraenjoy/echo_sync
cd echo_sync
```

### 2. 환경 변수 설정

저장소에는 `.env` 파일이 포함되어 있지 않습니다 (`.gitignore`).

**백엔드** — `backend/.env.example`을 복사한 뒤 키를 채웁니다:

```bash
cd backend
cp .env.example .env
# .env를 열어 각 API 키와 JWT_SECRET을 입력
```

**프론트엔드** — `frontend/.env.example`을 복사합니다:

```bash
cd frontend
cp .env.example .env.local
# 기본값(http://127.0.0.1:8000)이면 수정 불필요
```

> 각 키의 발급처와 설명은 `backend/.env.example` 파일 내 주석을 참고하세요.

### 3. 백엔드 실행

```bash
cd backend

# 가상환경 생성 및 활성화
python -m venv venv

# Windows (PowerShell)
.\venv\Scripts\Activate.ps1
# macOS / Linux
source venv/bin/activate

# 의존성 설치 (Whisper + PyTorch로 수 분 소요, ~2GB)
python -m pip install --upgrade pip
pip install -r requirements.txt

# PostgreSQL 시작 (Docker)
docker compose up -d

# 서버 실행
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

http://localhost:8000/docs 에서 Swagger UI가 표시되면 성공입니다.

### 4. 프론트엔드 실행

새 터미널을 열고:

```bash
cd frontend

npm install
npm run dev
```

http://localhost:5173 에 화면이 표시되면 성공입니다.

---

## 재실행 요약

매번 실행할 때:

```bash
# 터미널 1 — 백엔드
cd backend
source venv/bin/activate          # Windows: .\venv\Scripts\Activate.ps1
docker compose start              # 컨테이너가 이미 있으면 start, 없으면 up -d
uvicorn main:app --reload

# 터미널 2 — 프론트엔드
cd frontend
npm run dev
```

---

## 종료 방법

```bash
# 프론트엔드 / 백엔드: 각 터미널에서 Ctrl+C

# PostgreSQL 컨테이너 중지 (데이터 유지)
cd backend
docker compose stop

# PostgreSQL 완전 제거 (데이터까지 삭제)
docker compose down -v
```

---

## 환경 변수 키 발급 가이드

| 변수 | 발급처 | 비고 |
|---|---|---|
| `AZURE_SPEECH_KEY` | [Azure Portal](https://portal.azure.com) → Speech Services → 키 및 엔드포인트 | 음성 인식(STT) + 음성 합성(TTS) |
| `AZURE_SPEECH_REGION` | 위와 동일 | 리소스 생성 시 선택한 지역 (예: `koreacentral`) |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) | 면접 질문 생성 + 페르소나 분석 |
| `POLLINATIONS_API_KEY` | [Pollinations](https://pollinations.ai) | 동물 페르소나 이미지 생성 (선택) |
| `JWT_SECRET` | 직접 생성 | `python -c "import secrets; print(secrets.token_urlsafe(32))"` |

---

## 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| `psycopg2-binary` 설치 실패 | macOS에서 빈번. `pip install psycopg2-binary --no-cache-dir` 또는 `brew install postgresql` 선행 |
| `pip install openai-whisper` 매우 느림 | PyTorch가 함께 설치되며 ~2GB. 디스크 여유 확인 후 기다리기 |
| `uvicorn` 시작 시 Azure 인증 에러 | `.env`의 `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` 값 확인. `curl` 토큰 테스트 권장 |
| `docker compose up` 시 5432 포트 충돌 | 로컬에 다른 PostgreSQL 실행 중. `lsof -i :5432` (macOS/Linux) 또는 `netstat -ano \| findstr :5432` (Windows) |
| 프론트엔드 `Network Error` | 백엔드가 실행 중인지, `frontend/.env.local`의 `VITE_API_BASE_URL`이 백엔드 포트와 일치하는지 확인 |
| `npm install` 시 peer dependency 경고 | 대부분 무시 가능. ERR가 아니면 진행 |
| 마이크 권한 거부 | 브라우저는 `localhost` 또는 `https://`에서만 마이크 허용. `127.0.0.1`도 OK. IP(`192.168.x.x`) 접속 시 HTTPS 필요 |
| 모바일에서 dev 서버 접속 불가 | 같은 Wi-Fi 확인 + 방화벽 허용. `vite.config.ts`의 `server.host: true` 필요 |
| Gemini 503 / 429 에러 | API 일일 할당량 초과. 잠시 후 재시도하거나 결제 설정 확인 |
