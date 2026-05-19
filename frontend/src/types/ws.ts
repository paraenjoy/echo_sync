/**
 * WebSocket 메시지 타입
 * - 백엔드 main.py의 /ws/audio 엔드포인트와 일치
 * - 클라이언트는 PCM(ArrayBuffer) 또는 JSON 컨트롤 메시지를 송신
 * - 서버는 분석 완료 시 JSON 1회 응답
 */

// ---------- 클라이언트 → 서버 컨트롤 메시지 ----------
export interface WsStopMessage {
  type: "stop";
  session_id: number;
  question_id: number;
  question: string;
}

export type WsClientMessage = WsStopMessage;

// ---------- 서버 → 클라이언트 (현재 백엔드가 보내는 최종 결과) ----------
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

export interface WsFinalResult {
  user_said: string;
  score: WsSentenceScore;
  words: WsWord[];
  feedback: string;
  user_tts_url: string | null;
  model_tts_url: string | null;
  saved_log_id: number | null;
}

// ---------- (향후) 서버가 보내야 할 진행 상태 플래그 ----------
// TODO (Backend): Send status flags before final data
//   - {"status": "listening"}  → 음성 수신 시작 즉시
//   - {"status": "processing"} → recognize_once_async 시작 시
//   - {"status": "completed"}  → WsFinalResult와 함께 또는 직전
//   이 플래그를 받으면 프론트에서 스켈레톤/타이핑 효과로 지연을 마스킹
export type WsStatus = "listening" | "processing" | "completed";

export interface WsStatusMessage {
  status: WsStatus;
}

// 서버 메시지 통합 타입 (미래 호환)
export type WsServerMessage = WsFinalResult | WsStatusMessage;

// 메시지 판별 헬퍼
export function isStatusMessage(msg: unknown): msg is WsStatusMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "status" in msg &&
    !("user_said" in msg)
  );
}

export function isFinalResult(msg: unknown): msg is WsFinalResult {
  return typeof msg === "object" && msg !== null && "user_said" in msg;
}
