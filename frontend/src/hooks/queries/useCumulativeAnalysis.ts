/**
 * useCumulativeAnalysis — 누적 발음 분석 (Dashboard)
 *
 * 백엔드 계약 (main.py):
 *  - GET /cumulative-analysis/{user_id}
 *  - 데이터 부족 시:  { summary: "아직 충분한 데이터가 쌓이지 않았습니다." }
 *  - 그 외:           { weak_phonemes: WeakPhoneme[], ai_analysis: string }
 *  - 두 형태 모두 200으로 내려오므로 HTTP 에러가 아닌 "필드 존재 여부"로 분기한다.
 *
 * 캐싱 전략:
 *  - LLM 호출(Gemini)이 발생하는 무거운 엔드포인트
 *  - 누적 데이터는 세션을 마칠 때마다 갱신되므로 staleTime은 보수적으로 5분 유지
 *    (queryClient 기본값 사용 — 명시적으로 다시 fetch하려면 invalidate)
 *  - 페이지 진입 즉시 자동 fetch (enabled: !!userId)
 *
 * userId 전달:
 *  - authStore에서 user.id를 호출 측이 읽어 전달한다
 *    (훅 내부에서 store를 직접 읽으면 SSR/테스트가 까다로워지고
 *     의존성이 불투명해지므로 컨벤션상 인자로 받는다 — useGenerateQuestions와 동일)
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CumulativeAnalysisResponse } from "@/types/history";

export const cumulativeAnalysisQueryKeys = {
  byUser: (userId: number | null) =>
    ["cumulative-analysis", userId] as const,
};

async function fetchCumulativeAnalysis(
  userId: number
): Promise<CumulativeAnalysisResponse> {
  const res = await api.get<CumulativeAnalysisResponse>(
    `/cumulative-analysis/${userId}`
  );
  return res.data;
}

/**
 * @param userId  authStore.user?.id (null이면 호출 비활성)
 *
 * 반환 데이터의 두 가지 형태:
 *  - `data.weak_phonemes` 존재  → 정상 분석 결과
 *  - `data.summary` 존재         → 데이터 부족 안내 (Dashboard에서 별도 빈 상태 UI)
 *
 * 페이지 컴포넌트(DashboardPage)에서 위 두 케이스를 분기하여 렌더한다.
 */
export function useCumulativeAnalysis(userId: number | null) {
  return useQuery({
    queryKey: cumulativeAnalysisQueryKeys.byUser(userId),
    queryFn: () => fetchCumulativeAnalysis(userId as number),
    enabled: userId !== null,
    // 누적 분석은 사용자가 새 세션을 마치고 돌아왔을 때만 의미 있게 바뀐다.
    // 같은 세션 내 라우트 이동 시 불필요한 LLM 호출을 막기 위해 staleTime을 길게 잡는다.
    staleTime: 1000 * 60 * 5, // 5분
    gcTime: 1000 * 60 * 30,   // 30분
  });
}