/**
 * YouTube 스피킹 연습 관련 타입
 * - 백엔드 main.py의 GET /generate-questions 응답과 미러링
 */

export interface YoutubeQuestion {
  id: number;
  order_no: number;
  question_text: string;
  question_ko: string | null;
  model_answer: string | null;
}

export interface GenerateQuestionsResponse {
  session_id: number;
  questions_text: string;
  questions: YoutubeQuestion[];
  // 에러 시 응답 (백엔드가 200 + error 필드로 반환)
  error?: string;
}

export interface GenerateQuestionsParams {
  url: string;
}
