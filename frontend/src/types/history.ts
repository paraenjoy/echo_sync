/**
 * 히스토리 / 누적 분석 관련 타입
 * - GET /history, GET /cumulative-analysis/{user_id} 응답 미러링
 *
 * 정정 이력 (Step 7):
 *  - 백엔드 main.py의 GET /history 실응답과 대조 결과 누락 필드 3건을 보강:
 *      · HistoryQuestion.question_type
 *      · HistoryLog.audio_url
 *      · HistorySession.interview_report (면접 세션이면 페르소나 리포트 동봉)
 *  - word_logs는 아직 백엔드 미지원이나 BACKEND_PR.md TODO #3로 추가 예정 → 옵셔널 선반영
 */
import type { WsWord } from "@/types/ws";

export interface HistoryQuestion {
  question_id: number;
  order_no: number;
  /** "youtube_generated" | "interview_initial" | "interview_pdf" | "interview_followup" 등 */
  question_type: string;
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
  /** 원본 녹음(STT 대상) 오디오 URL — 백엔드 /history가 반환 중인데 누락되어 있던 필드 */
  audio_url: string | null;
  user_tts_url: string | null;
  model_tts_url: string | null;
  created_at: string;

  /**
   * 단어 단위 정확도 로그.
   * 현재 백엔드 /history는 아직 미포함. BACKEND_PR.md TODO #3 머지 후 채워진다.
   * WsWord와 동일 스키마로 합의되어, 채워지면 <WordHeatmap words={log.word_logs} />로 즉시 재사용.
   */
  word_logs?: WsWord[];
}

/**
 * 면접 세션에 동봉되는 페르소나/점수 리포트.
 * - GET /history 응답의 각 세션 `interview_report` 키 (youtube 세션이면 null)
 * - models.py InterviewReport + main.py /history report_data와 일치
 * - 점수 필드는 calculate_interview_session_score 호출 전이면 null
 */
export interface HistoryInterviewReport {
  report_id: number;
  animal_name: string;
  animal_reason: string;
  animal_image_url: string | null;
  content_improvement: string | null;
  /** 기술 스택 언급 비중 (예: { "React": 40, "FastAPI": 60 }) — 정수 퍼센트 */
  tech_stack_percent: Record<string, number>;

  overall_score: number | null;
  pronunciation_avg: number | null;
  accuracy_avg: number | null;
  fluency_avg: number | null;
  content_score: number | null;
  technical_score: number | null;
  confidence_score: number | null;
  /** 미가공 점수 JSON 문자열 (필요 시 파싱) */
  score_json: string | null;

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
  /** 면접 세션이면 리포트, 그 외(youtube)나 미생성 시 null */
  interview_report: HistoryInterviewReport | null;
}

export interface HistoryResponse {
  history: HistorySession[];
  total: number;       // 전체 세션 수 (BACKEND_PR.md TODO #1 ✅)
  has_more: boolean;   // 다음 페이지 존재 여부
}

// 페이지네이션 파라미터
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
