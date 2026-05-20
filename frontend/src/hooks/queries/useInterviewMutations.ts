/**
 * useInterviewMutations — 면접 도메인 뮤테이션 훅 모음
 *
 * 두 개의 뮤테이션을 한 파일에 묶는 이유:
 *  - 면접 플로우는 start → answer → answer → ... 로 강하게 결합되어 있고
 *  - 같은 도메인 타입(types/interview)을 공유한다.
 *  - useGenerateQuestions와 달리 캐싱이 필요 없어 useQuery로 나눌 이유가 없다.
 *
 * 백엔드 계약 (main.py):
 *  - POST /interview/start-unified
 *      Content-Type: multipart/form-data
 *      fields: position, tech_stack(JSON string), experience_level,
 *              project_summary, interview_mode, file?(PDF)
 *      → { status, session_id, question_id, question }
 *  - POST /interview/answer
 *      Content-Type: application/json
 *      body: { session_id, current_question_id, current_question, user_answer }
 *      → { follow_up, next_question_id, status }
 *
 * 에러 처리:
 *  - axios 인터셉터(api.ts)가 FastAPI 에러를 정규화하므로 onError에서는 getErrorMessage 사용
 *  - start-unified는 200 + { status:"error", message } 케이스가 있어 추가 가드
 */
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  InterviewSetupInput,
  InterviewStartResponse,
  InterviewAnswerRequest,
  InterviewAnswerResponse,
} from "@/types/interview";

// ─────────────────────────────────────────────────────────────
// 뮤테이션 키 (선택적이지만 devtools 식별성을 위해 부여)
// ─────────────────────────────────────────────────────────────
export const interviewMutationKeys = {
  start: ["interview", "start"] as const,
  answer: ["interview", "answer"] as const,
};

// ─────────────────────────────────────────────────────────────
// 1) useStartInterview — 면접 시작 (FormData)
// ─────────────────────────────────────────────────────────────

/**
 * InterviewSetupInput → FormData 변환
 *  - tech_stack은 백엔드에서 json.loads로 파싱하므로 JSON.stringify
 *  - file은 존재할 때만 append (없으면 백엔드가 Optional[UploadFile]로 처리)
 *  - 빈 문자열도 그대로 전송 (백엔드 Form(...) 필수 필드 검증)
 */
function buildSetupFormData(input: InterviewSetupInput): FormData {
  const fd = new FormData();
  fd.append("position", input.position);
  fd.append("tech_stack", JSON.stringify(input.tech_stack));
  fd.append("experience_level", input.experience_level);
  fd.append("project_summary", input.project_summary);
  fd.append("interview_mode", input.interview_mode);
  if (input.file) {
    fd.append("file", input.file);
  }
  return fd;
}

async function startInterview(
  input: InterviewSetupInput
): Promise<InterviewStartResponse> {
  const formData = buildSetupFormData(input);

  // axios는 body가 FormData면 Content-Type을 자동으로 multipart/form-data;
  // boundary=...로 설정한다. 직접 지정하면 boundary가 누락되므로 절대 명시하지 않는다.
  const res = await api.post<InterviewStartResponse>(
    "/interview/start-unified",
    formData
  );

  // 백엔드가 200 + status:"error"로 실패를 알리는 케이스 방어
  if (res.data.status === "error") {
    throw new Error(res.data.message ?? "면접 질문 생성에 실패했습니다.");
  }

  return res.data;
}

/**
 * 면접 셋업 폼 제출용 뮤테이션
 *
 * 사용 예:
 *   const startMutation = useStartInterview();
 *   startMutation.mutate(setupInput, {
 *     onSuccess: (data) => navigate("/interview/room", { state: { ... } }),
 *   });
 */
export function useStartInterview() {
  return useMutation({
    mutationKey: interviewMutationKeys.start,
    mutationFn: startInterview,
  });
}

// ─────────────────────────────────────────────────────────────
// 2) useSubmitAnswer — 답변 제출 → 꼬리질문 수신
// ─────────────────────────────────────────────────────────────

async function submitAnswer(
  req: InterviewAnswerRequest
): Promise<InterviewAnswerResponse> {
  const res = await api.post<InterviewAnswerResponse>(
    "/interview/answer",
    req
  );
  return res.data;
}

/**
 * 답변 제출 뮤테이션
 *  - 음성 모드: useAudioStreamer.result.user_said를 user_answer로 넣어 호출
 *  - 텍스트 모드: textarea 입력을 그대로 user_answer로 넣어 호출
 *
 * onSuccess에서 page-level 채팅 메시지 배열에 follow_up을 추가하고
 * currentQuestion/currentQuestionId를 응답값으로 교체한다.
 */
export function useSubmitAnswer() {
  return useMutation({
    mutationKey: interviewMutationKeys.answer,
    mutationFn: submitAnswer,
  });
}
