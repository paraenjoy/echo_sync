/**
 * WebSocket 메시지 타입
 * - 백엔드 main.py의 /ws/audio 엔드포인트와 일치
 * - 클라이언트는 PCM(ArrayBuffer) 또는 JSON 컨트롤 메시지를 송신
 * - 서버는 처리 단계마다 status 메시지를, 완료 시 final 메시지를 송신
 *   (BACKEND_PR.md TODO #4 ✅, 옵션 B):
 *     ← { "type": "status", "stage": "asr" }       // STT 직전
 *     ← { "type": "status", "stage": "scoring" }   // 발음 채점 직전
 *     ← { "type": "status", "stage": "coaching" }  // LLM 코칭 직전
 *     ← { "type": "final",  "user_said": "...", ... }
 */

// ---------- 클라이언트 → 서버 컨트롤 메시지 ----------
export interface WsStopMessage {
  type: "stop";
  session_id: number;
  question_id: number;
  question: string;
}

export type WsClientMessage = WsStopMessage;

// ---------- 서버 → 클라이언트: 최종 결과 ----------
export interface WsPhoneme {
  ph: string;
  score: number;
}

export interface WsWord {
  word: string;
  accuracy: number;
  error_type: string | null;
  phonemes: WsPhoneme[];
  /** user_tts_url 내에서 이 단어의 재생 구간(초). 매칭 실패/하위호환 시 null. (Step 11-D) */
  start?: number | null;
  end?: number | null;
}

export interface WsSentenceScore {
  text: string;
  accuracy: number;
  pronunciation: number;
  fluency: number;
}

/**
 * 최종 분석 결과.
 * - 백엔드가 `type: "final"`로 래핑하지만, 판별은 `user_said` 존재 여부로 한다(하위호환).
 * - 면접 세션(session_type === "interview")이면 final 메시지에 다음 꼬리질문이
 *   next_question / next_question_id로 동봉된다(main.py /ws/audio).
 *   면접 진행은 이 필드로만 이뤄지며, 별도 REST(POST /interview/answer)는 존재하지 않는다.
 *   YouTube 세션이면 두 필드는 null.
 */
export interface WsFinalResult {
  type?: "final";
  user_said: string;
  score: WsSentenceScore;
  words: WsWord[];
  feedback: string;
  user_tts_url: string | null;
  model_tts_url: string | null;
  saved_log_id: number | null;
  /** 세션 종류. "interview"면 아래 꼬리질문 필드가 채워진다 */
  session_type?: string;
  /** 면접 한정: 다음 꼬리질문 텍스트 (YouTube면 null) */
  next_question?: string | null;
  /** 면접 한정: 다음 꼬리질문 ID (YouTube면 null) */
  next_question_id?: number | null;
}

// ---------- 서버 → 클라이언트: 처리 단계 ----------
/** 서버 처리 단계 (BACKEND_PR.md TODO #4) */
export type WsStage = "asr" | "scoring" | "coaching";

/** { "type": "status", "stage": "asr" | "scoring" | "coaching" } */
export interface WsStatusMessage {
  type: "status";
  stage: WsStage;
}

// ---------- 서버 → 클라이언트: 처리 에러 ----------
/**
 * 백엔드 main.py /ws/audio가 STT 인식 실패(NoMatch)나 내부 예외 시
 * { "error": "..." } 형태로 1회 송신한 뒤 소켓을 닫는다.
 * status/final과 달리 `type` 태그가 없는 레거시 형태이므로 `error` 키로 판별한다.
 */
export interface WsErrorMessage {
  error: string;
}

// 서버 메시지 통합 타입
export type WsServerMessage = WsStatusMessage | WsFinalResult | WsErrorMessage;

// ---------- 메시지 판별 헬퍼 ----------
export function isStatusMessage(msg: unknown): msg is WsStatusMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    typeof (msg as Record<string, unknown>).error === "string"
  );
}

export function isFinalResult(msg: unknown): msg is WsFinalResult {
  return typeof msg === "object" && msg !== null && "user_said" in msg;
}
