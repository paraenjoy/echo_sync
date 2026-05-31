/**
 * useHistorySession — 단일 세션 상세 조회
 *
 * 백엔드 계약 (main.py · BACKEND_PR.md TODO #2 ✅):
 *  - GET /history/{session_id}
 *  - 200 → HistorySession (단일 객체, logs[].word_logs · interview_report 포함)
 *  - 403 본인 소유 아님 / 404 미존재
 *
 * 전략:
 *  - 단일 엔드포인트로 직접 fetch → 딥링크 직접 진입 시에도 전체 목록을 받지 않고 즉시 상세 표시.
 *  - 목록(useHistory) 캐시가 이미 있으면 initialData로 먼저 그려 깜빡임을 없애고,
 *    백그라운드에서 단일 응답으로 최신화한다 (pickSessionFromPages 폴백 — BACKEND_PR.md 합의).
 *
 * 명명/구조: HANDOFF 컨벤션 준수 (named export, xxxQueryKeys 패턴, api 래퍼만 사용).
 */
import {
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  historyQueryKeys,
  pickSessionFromPages,
  HISTORY_PAGE_SIZE,
  type HistoryPage,
} from "@/hooks/queries/useHistory";
import type { HistorySession } from "@/types/history";

/**
 * 단일 상세 쿼리 키.
 * 목록과 동일한 "history" 루트를 공유 → invalidateQueries(["history"]) 한 번으로
 * 목록·상세 캐시가 함께 무효화된다 (새 세션 완료 후 일괄 갱신에 유리).
 */
export const historyDetailQueryKeys = {
  detail: (id: number) => ["history", "detail", id] as const,
};

/**
 * useHistory의 HistoryPage 인터페이스가 모듈 외부로 export되지 않으므로,
 * 동일 형태의 구조적 타입으로 캐시를 읽는다 (pickSessionFromPages 입력과 호환).
 */
type CachedHistory = InfiniteData<HistoryPage>;

export function useHistorySession(sessionId: number) {
  const qc = useQueryClient();
  const isValidId = Number.isFinite(sessionId) && sessionId > 0;

  return useQuery({
    queryKey: historyDetailQueryKeys.detail(sessionId),
    queryFn: async () => {
      const res = await api.get<HistorySession>(`/history/${sessionId}`);
      return res.data;
    },
    enabled: isValidId,

    // 목록 캐시에 이미 해당 세션이 있으면 즉시 렌더 (목록 → 상세 흐름의 무깜빡임)
    initialData: () => {
      if (!isValidId) return undefined;
      const cached = qc.getQueryData<CachedHistory>(
        historyQueryKeys.list(HISTORY_PAGE_SIZE)
      );
      return pickSessionFromPages(cached?.pages, sessionId);
    },

    // initialData가 목록 캐시(staleTime 1분)에서 왔을 수 있으므로,
    // 그 신선도를 그대로 물려주어 오래됐다면 단일 응답으로 곧바로 백그라운드 갱신되게 한다.
    initialDataUpdatedAt: () =>
      qc.getQueryState(historyQueryKeys.list(HISTORY_PAGE_SIZE))?.dataUpdatedAt,

    staleTime: 1000 * 30, // 상세는 목록보다 짧게 — 재진입 시 최신 점수/리포트 반영
    gcTime: 1000 * 60 * 10,
  });
}
