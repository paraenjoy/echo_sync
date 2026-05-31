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
}

// ---------- 서버 → 클라이언트: 처리 단계 ----------
/** 서버 처리 단계 (BACKEND_PR.md TODO #4) */
export type WsStage = "asr" | "scoring" | "coaching";

/** { "type": "status", "stage": "asr" | "scoring" | "coaching" } */
export interface WsStatusMessage {
  type: "status";
  stage: WsStage;
}

// 서버 메시지 통합 타입
export type WsServerMessage = WsStatusMessage | WsFinalResult;

// ---------- 메시지 판별 헬퍼 ----------
export function isStatusMessage(msg: unknown): msg is WsStatusMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as Record<string, unknown>).type === "status" &&
    "stage" in msg
  );
}

export function isFinalResult(msg: unknown): msg is WsFinalResult {
  return typeof msg === "object" && msg !== null && "user_said" in msg;
}
