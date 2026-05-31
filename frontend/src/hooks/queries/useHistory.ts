/**
 * useHistory — 세션 히스토리 무한 스크롤
 *
 * 백엔드 계약 (main.py · BACKEND_PR.md TODO #1 ✅):
 *  - GET /history?limit&offset
 *  - 응답: { history: HistorySession[], total: number, has_more: boolean }
 *  - 서버가 created_at DESC 정렬 + limit/offset 슬라이싱을 보장.
 *
 * 페이지네이션:
 *  - 서버 has_more로 다음 페이지 존재를 판정 (기존 클라이언트 슬라이싱/길이 휴리스틱·정렬 보정 폐기).
 *  - total은 각 페이지에 동봉되어 "전체 N개 세션" 표시 등에 활용 가능
 *    (data.pages[0]?.total).
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { HistoryResponse, HistorySession } from "@/types/history";

export const historyQueryKeys = {
  list: (limit: number) => ["history", "list", { limit }] as const,
};

/** 한 페이지 분량 */
export const HISTORY_PAGE_SIZE = 10;

/**
 * 무한 스크롤 한 페이지의 정규화 형태.
 * useHistorySession이 목록 캐시를 읽을 때 동일 타입을 재사용하므로 export 한다.
 */
export interface HistoryPage {
  sessions: HistorySession[];
  /** 전체 세션 수 (모든 페이지 동일 값) */
  total: number;
  /** 다음 페이지 offset (null이면 더 없음) */
  nextOffset: number | null;
}

async function fetchHistoryPage(
  limit: number,
  offset: number
): Promise<HistoryPage> {
  const res = await api.get<HistoryResponse>("/history", {
    params: { limit, offset },
  });

  const { history, total, has_more } = res.data;

  // 서버가 created_at DESC 정렬 + offset/limit 슬라이싱을 이미 적용 (TODO #1 ✅)
  // → 프론트는 그대로 사용하고, has_more로만 다음 페이지 존재를 판정한다.
  return {
    sessions: history,
    total,
    nextOffset: has_more ? offset + limit : null,
  };
}

/**
 * 무한 스크롤용 히스토리 쿼리 훅
 *
 * 사용 예 (HistoryPage):
 *   const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useHistory();
 *   const sessions = data?.pages.flatMap((p) => p.sessions) ?? [];
 *   const total = data?.pages[0]?.total ?? 0;
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
 * 단일 세션 조회용 셀렉터 (목록 캐시 폴백)
 *  - useHistorySession(id)의 initialData에서 사용 — 목록 캐시에 있으면 깜빡임 없이 즉시 표시.
 *  - 단일 엔드포인트 GET /history/{id}는 useHistorySession이 담당 (BACKEND_PR.md TODO #2 ✅).
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
