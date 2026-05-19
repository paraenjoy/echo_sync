/**
 * 면접 연습 관련 타입
 * - 백엔드 main.py의 /interview/start-unified (FormData) 및 /interview/answer와 미러링
 */

// 면접 셋업 입력 (FormData로 전송)
export interface InterviewSetupInput {
  position: string;
  tech_stack: string[]; // JSON.stringify 후 전송
  experience_level: string;
  project_summary: string;
  interview_mode: string;
  file?: File | null; // PDF 자기소개서 (선택)
}

// 셋업 응답 (start-unified)
export interface InterviewStartResponse {
  status: "success" | "error";
  session_id: number;
  question_id: number;
  question: string;
  message?: string; // 에러 시
}

// 꼬리질문 요청 (POST /interview/answer)
export interface InterviewAnswerRequest {
  session_id: number;
  current_question_id: number;
  current_question: string;
  user_answer: string;
}

// 꼬리질문 응답
export interface InterviewAnswerResponse {
  follow_up: string;
  next_question_id: number;
  status: "continue" | "end";
}

// 셀렉트 박스 옵션용 상수 (all_in_one_test.html과 일치)
export const POSITION_OPTIONS = ["Frontend", "Backend", "Embedded/IoT"] as const;
export type Position = (typeof POSITION_OPTIONS)[number];

export const TECH_STACK_MAP: Record<Position, string[]> = {
  Frontend: ["React", "Vue", "TypeScript", "Next.js", "Tailwind CSS", "Redux"],
  Backend: ["FastAPI", "Spring Boot", "Node.js", "PostgreSQL", "Redis", "Django"],
  "Embedded/IoT": ["C/C++", "FreeRTOS", "MQTT", "ESP32", "Raspberry Pi", "Arduino"],
};

export const EXPERIENCE_LEVELS = [
  { value: "Junior (Entry-level)", label: "신입/인턴" },
  { value: "Junior (1-3 years)", label: "주니어" },
  { value: "Senior (5+ years)", label: "시니어" },
] as const;

export const INTERVIEW_MODES = [
  { value: "Friendly and Supportive", label: "친절한 멘토형" },
  { value: "Sharp and Analytical", label: "날카로운 분석형" },
  { value: "Aggressive Stress Interview", label: "압박 면접형" },
] as const;
