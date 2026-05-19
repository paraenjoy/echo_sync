/**
 * React Query 클라이언트 설정
 *
 * 정책:
 *  - 401(인증 실패) 또는 4xx 클라이언트 에러는 재시도하지 않음
 *  - 네트워크/5xx 에러는 1회만 재시도 (LLM API가 일시 실패할 수 있음)
 *  - YouTube 분석/면접 질문은 비용이 크므로 staleTime을 길게 가져감
 */
import { QueryClient } from "@tanstack/react-query";
import { QUERY_CONFIG } from "./constants";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_CONFIG.STALE_TIME,
      gcTime: QUERY_CONFIG.GC_TIME,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // api.ts 인터셉터가 status를 Error에 부착
        const status = (error as Error & { status?: number })?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < QUERY_CONFIG.RETRY_COUNT;
      },
    },
    mutations: {
      // 뮤테이션은 사이드 이펙트이므로 자동 재시도하지 않는 것이 안전
      retry: false,
    },
  },
});
