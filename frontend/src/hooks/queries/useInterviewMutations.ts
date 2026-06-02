/**
 * useInterviewMutations — 면접 도메인 뮤테이션 훅 모음
 *
 * 두 개의 뮤테이션을 한 파일에 묶는 이유:
 *  - 면접 플로우는 start → (음성 답변은 /ws/audio가 꼬리질문까지 반환) → finalize 로
 *    이어지며, 같은 도메인 타입(types/interview)을 공유한다.
 *  - useGenerateQuestions와 달리 캐싱이 필요 없어 useQuery로 나눌 이유가 없다.
 *
 * 백엔드 계약 (main.py):
 *  - POST /interview/start-unified
 *      Content-Type: multipart/form-data
 *      fields: position, tech_stack(JSON string), experience_level,
 *              project_summary, interview_mode, file?(PDF)
 *      → { status, session_id, question_id, question }
 * 
 *  - 꼬리질문은 REST가 아닌 /ws/audio final(next_question/next_question_id)로 수신한다.
 *  - POST /interview/finalize (FormData: session_id) → PersonaReportResponse
 *
 * 에러 처리:
 *  - axios 인터셉터(api.ts)가 FastAPI 에러를 정규화하므로 onError에서는 getErrorMessage 사용
 *  - start-unified는 200 + { status:"error", message } 케이스가 있어 추가 가드
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  InterviewSetupInput,
  InterviewStartResponse,
  PersonaReportResponse,
} from "@/types/interview";

// ─────────────────────────────────────────────────────────────
// 뮤테이션 키 (선택적이지만 devtools 식별성을 위해 부여)
// ─────────────────────────────────────────────────────────────
export const interviewMutationKeys = {
  start: ["interview", "start"] as const,
  finalize: ["interview", "finalize"] as const,
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
  fd.append("max_questions", String(input.max_questions)); // 신규 (Step 10-C1)
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
// 2) useFinalizeInterview — 면접 종료 → 동물 페르소나 리포트 생성 (FormData)
// ─────────────────────────────────────────────────────────────

/**
 * POST /interview/finalize (FormData: session_id) — 동물 페르소나 리포트 생성 (무거운 AI 호출)
 *
 * - Gemini 동물 페르소나 분석 + 이미지 생성 + 총평/스택 비중 산출 → 수 초 소요.
 *   페이지에서 ProcessingSkeleton 오버레이로 마스킹할 것.
 *
 * 200 + status:"error" 응답 처리:
 *  - 답변 데이터 부족 시 백엔드는 throw 하지 않고 200으로 status:"error" + animal_reason
 *    (사유 문자열)을 돌려준다.
 *  - 여기서 throw 하지 않고 그대로 반환 → 페이지의 onSuccess에서 `data.status === "error"`
 *    를 검사해 animal_reason을 그대로 노출. (useStartInterview는 onError로 빼는 게 자연스러워
 *    다르게 처리한 것 — 비대칭은 의도된 것)
 *
 * 캐시 무효화:
 *  - 성공 시 ["history"] 루트 무효화 → useHistory 목록·useHistorySession 상세가 함께 재요청.
 *    새 리포트(interview_report)가 히스토리 상세 진입 즉시 반영되도록 보장.
 *
 * 사용 예:
 *   const finalize = useFinalizeInterview();
 *   finalize.mutate(sessionId, {
 *     onSuccess: (data) => {
 *       if (data.status === "error" || !data.session_id) return; // animal_reason 노출
 *       navigate(`/history/${sessionId}`);
 *     },
 *   });
 */
export function useFinalizeInterview() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: interviewMutationKeys.finalize,
    mutationFn: async (sessionId: number) => {
      const form = new FormData();
      // FastAPI Form(int)은 문자열도 캐스팅하지만 명시적으로 String() 변환.
      form.append("session_id", String(sessionId));

      // FormData 전송 — Content-Type 명시 금지(axios 자동 boundary).
      const { data } = await api.post<PersonaReportResponse>(
        "/interview/finalize",
        form
      );
      return data;
    },
    // 새 리포트가 히스토리 목록·상세에 즉시 보이도록 무효화
    // (historyQueryKeys.list / historyDetailQueryKeys.detail 둘 다 "history" 루트를 공유)
    onSuccess: () => qc.invalidateQueries({ queryKey: ["history"] }),
  });
}
