/**
 * useHistory — 세션 히스토리 무한 스크롤
 *
 * 백엔드 계약 (main.py):
 *  - GET /history
 *  - 현재 응답: { history: HistorySession[] }  (전체 목록을 한 번에 반환)
 *
 * 페이지네이션 전략 (Forward-compatible):
 *  - 백엔드가 limit/offset을 아직 지원하지 않지만, 프론트는 미리 useInfiniteQuery로 작성한다.
 *  - 현재 동작: 백엔드가 params를 무시하고 전체를 반환 → 첫 페이지에서 모두 수신,
 *              hasNextPage가 false가 되어 자연스럽게 1페이지로 종료.
 *  - 백엔드가 limit/offset을 지원하기 시작하면, 이 코드는 수정 없이 정상 페이지네이션으로 동작.
 *
 * // TODO (Backend): Add limit/offset to GET /history
 *   - 응답에 total/has_more 같은 메타가 있으면 더 깔끔해지지만,
 *     배열 길이 < limit 휴리스틱만으로도 충분히 동작한다.
 *
 * 정렬:
 *  - 백엔드가 created_at 정렬을 보장하지 않으므로 프론트에서 최신순 정렬 보정
 *    (Dashboard로의 빠른 이탈 흐름에서 "최근 세션 먼저" UX가 자연스럽다)
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { HistoryResponse, HistorySession } from "@/types/history";

export const historyQueryKeys = {
  list: (limit: number) => ["history", "list", { limit }] as const,
};

/** 한 페이지 분량 */
export const HISTORY_PAGE_SIZE = 10;

interface HistoryPage {
  sessions: HistorySession[];
  /** 다음 페이지 offset (null이면 더 없음) */
  nextOffset: number | null;
}

async function fetchHistoryPage(
  limit: number,
  offset: number
): Promise<HistoryPage> {
  // TODO (Backend): Add limit/offset to GET /history
  // 현재 백엔드는 params를 무시하고 전체를 반환한다.
  // 백엔드 지원 시 자동으로 정상 페이지네이션이 동작하도록 params를 미리 전송한다.
  const res = await api.get<HistoryResponse>("/history", {
    params: { limit, offset },
  });

  // 최신순 정렬 보정 (백엔드가 ORDER BY를 보장하지 않음)
  const sorted = [...res.data.history].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  // 백엔드가 limit/offset 미지원인 동안에는 클라이언트에서 슬라이싱한다.
  // 지원 시작 시: 백엔드가 이미 잘라 보내므로 slice가 idempotent하게 동작.
  const pageSlice = sorted.slice(offset, offset + limit);

  // 다음 페이지 존재 여부: 받은 페이지가 limit과 같다면 더 있을 가능성
  const hasMore = pageSlice.length === limit;

  return {
    sessions: pageSlice,
    nextOffset: hasMore ? offset + limit : null,
  };
}

/**
 * 무한 스크롤용 히스토리 쿼리 훅
 *
 * 사용 예 (HistoryPage):
 *   const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useHistory();
 *   const sessions = data?.pages.flatMap((p) => p.sessions) ?? [];
 *
 * IntersectionObserver로 마지막 카드 진입 시 fetchNextPage() 호출.
 */
export function useHistory(limit: number = HISTORY_PAGE_SIZE) {
  return useInfiniteQuery({
    queryKey: historyQueryKeys.list(limit),
    queryFn: ({ pageParam }) => fetchHistoryPage(limit, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    // 새 세션 완료 후 돌아왔을 때 최신 목록을 보이기 위해
    // 누적 분석보다 짧은 staleTime 사용
    staleTime: 1000 * 60, // 1분
    gcTime: 1000 * 60 * 10,
  });
}

/**
 * 단일 세션 조회용 셀렉터
 *  - 5.4의 세션 상세 리포트(`/history/:id`)에서 사용
 *  - 별도 엔드포인트(`GET /history/{id}`)가 없으므로 캐시된 페이지에서 찾는다.
 *  - 캐시 미스 시 (딥링크 직접 진입 등) HistoryPage 데이터를 다시 받아 탐색하는 방식으로
 *    상세 페이지에서 처리할 예정.
 *
 * // TODO (Backend): GET /history/{session_id} 엔드포인트 추가 검토
 *   딥링크 직접 진입 UX를 더 빠르게 하려면 단일 세션 조회가 필요.
 */
export function pickSessionFromPages(
  pages: HistoryPage[] | undefined,
  sessionId: number
): HistorySession | undefined {
  if (!pages) return undefined;
  for (const page of pages) {
    const found = page.sessions.find((s) => s.session_id === sessionId);
    if (found) return found;
  }
  return undefined;
}