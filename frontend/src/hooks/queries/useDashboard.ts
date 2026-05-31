/**
 * useDashboard — 학습 분석 대시보드 조회
 *
 * 백엔드: GET /dashboard (learning_features.py, 라우터 루트 마운트)
 *   → DashboardResponse { user, totals, averages, recent_scores,
 *                          weak_words, latest_persona, goal, goal_progress, trend }
 *
 * 명명/구조: HANDOFF 컨벤션 (named export, xxxQueryKeys, api 래퍼만 사용).
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DashboardResponse } from "@/types/dashboard";

export const dashboardQueryKeys = {
  all: ["dashboard"] as const,
};

export function useDashboard() {
  return useQuery({
    queryKey: dashboardQueryKeys.all,
    queryFn: async () => {
      const { data } = await api.get<DashboardResponse>("/dashboard");
      return data;
    },
    // 세션/목표 변경 후 재진입 시 최신 통계를 보이도록 1분
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 10,
  });
}
