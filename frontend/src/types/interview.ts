/**
 * 면접 연습 관련 타입
 * - 백엔드 main.py의 /interview/start-unified (FormData) / /interview/finalize와 미러링.
 *   (POST /interview/answer는 백엔드에 존재하지 않음 — 꼬리질문은 /ws/audio final의
 *    next_question 으로 수신. types/ws.ts의 WsFinalResult 참조.)
 *
 * 정정 이력 (Step 7):
 *  - 페르소나 리포트 생성 엔드포인트(POST /interview/finalize, FormData: session_id)의
 *    응답 타입(PersonaReportResponse, PersonaInterviewItem) 신설.
 *  - Implementation.md의 가상 타입(persona_name/description/image_url/tech_stack_ratio/
 *    overall_summary, is_retry, previous_score)은 실 스키마와 불일치하여 폐기.
 *    실제 키는 animal_name/animal_reason/animal_image_url/tech_stack_percent/content_improvement.
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

// ─────────────────────────────────────────────────────────────
// 페르소나 리포트 (POST /interview/finalize, FormData: session_id)
// 면접 종료 시 1회 호출 → 동물 페르소나 분석 + 이미지 + 전체 총평 생성
// ─────────────────────────────────────────────────────────────

/** finalize 응답의 질문별 상세 항목 (interview_history[]) */
export interface PersonaInterviewItem {
  question: string;
  transcription: string;
  pronunciation_guide: string;
  user_audio_url: string | null;
  accuracy_score: number | null;
  pronunciation_score: number | null;
  fluency_score: number | null;
  feedback: string | null;
}

/**
 * POST /interview/finalize 응답.
 * - status "error"이거나 interview_history가 없으면 실패로 간주(데이터 부족 등).
 * - 성공 시 animal_* / content_improvement / tech_stack_percent / interview_history 채워짐.
 */
export interface PersonaReportResponse {
  status: "success" | "error";
  report_id?: number;
  session_id?: number;
  animal_name?: string;
  animal_image_url?: string | null;
  animal_reason: string; // 실패 시에도 사유 문자열로 채워짐
  content_improvement?: string;
  tech_stack_percent?: Record<string, number>;
  interview_history?: PersonaInterviewItem[];
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
