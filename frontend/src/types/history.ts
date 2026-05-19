/**
 * 히스토리 / 누적 분석 관련 타입
 * - GET /history, GET /cumulative-analysis/{user_id} 응답 미러링
 */

export interface HistoryQuestion {
  question_id: number;
  order_no: number;
  question_text: string;
  question_ko: string | null;
  model_answer: string | null;
}

export interface HistoryLog {
  log_id: number;
  question_id: number | null;
  reference_text: string;
  recognized_text: string | null;
  accuracy_score: number;
  pronunciation_score: number;
  fluency_score: number;
  coaching_message: string | null;
  user_tts_url: string | null;
  model_tts_url: string | null;
  created_at: string;
}

export interface HistorySession {
  session_id: number;
  session_type: "youtube" | "interview";
  title: string | null;
  source_url: string | null;
  created_at: string;
  questions: HistoryQuestion[];
  logs: HistoryLog[];
}

export interface HistoryResponse {
  history: HistorySession[];
}

// 페이지네이션 파라미터
// TODO (Backend): Add limit/offset to GET /history
// 현재 백엔드는 전체 목록을 반환하므로, 프론트에서 클라이언트 측 슬라이싱으로 임시 대응
export interface HistoryParams {
  limit?: number;
  offset?: number;
}

// 누적 분석 (Dashboard)
export interface WeakPhoneme {
  phoneme: string;
  avg_score: number;
  fail_rate: number;
  total_count: number;
}

export interface CumulativeAnalysisResponse {
  weak_phonemes?: WeakPhoneme[];
  ai_analysis?: string;
  summary?: string; // 데이터 부족 시 백엔드가 summary만 반환
}
