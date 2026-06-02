/**
 * useDeleteHistorySession — 히스토리 세션 삭제
 *
 * 백엔드 계약 (main.py · BACKEND_PR.md TODO #6 ✅):
 *  - DELETE /history/{session_id}
 *  - 200 → { message: string; session_id: number }
 *  - 403 본인 소유 아님 / 404 미존재
 *  - 답변(SpeakingLog)·페르소나 리포트(InterviewReport) 보유 여부와 무관하게
 *    삭제됨. 우발 삭제 방어는 호출 측의 컨펌 모달이 담당한다.
 *
 * 캐시 무효화 범위:
 *  - ["history"]              : 목록(useHistory) + 상세(useHistorySession) 모두
 *  - ["dashboard"]            : totals/averages/recent_scores 영향 → 갱신
 *  - ["cumulative-analysis"]  : weak_phonemes/ai_analysis 영향 → 갱신
 *
 *  invalidate만 사용(낙관적 업데이트 미적용) — mutation pending 동안 호출 측이
 *  카드 단위로 시각적 비활성을 표시하면 충분히 매끄럽고, 실패 롤백 코드가
 *  필요 없어 단순성이 더 큰 이점.
 *
 * 명명/구조: HANDOFF 컨벤션 준수 (named export, xxxQueryKeys 패턴, api 래퍼만 사용).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface DeleteHistoryResponse {
  message: string;
  session_id: number;
}

export const deleteHistorySessionKeys = {
  /** mutation 진행 식별용 키. devtools에서 단건 추적이 쉬워진다. */
  mutation: ["history", "delete"] as const,
};

export function useDeleteHistorySession() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: deleteHistorySessionKeys.mutation,
    mutationFn: async (sessionId: number) => {
      const res = await api.delete<DeleteHistoryResponse>(
        `/history/${sessionId}`
      );
      return res.data;
    },
    onSuccess: () => {
      // 영향 받는 모든 캐시 일괄 무효화
      qc.invalidateQueries({ queryKey: ["history"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["cumulative-analysis"] });
    },
  });
}
