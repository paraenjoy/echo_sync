/**
 * useGoal / useUpsertGoal — 학습 목표 조회·저장
 *
 * 백엔드 (learning_features.py, 라우터 루트 마운트):
 *  - GET  /goals               → { message, goal: GoalView | null }
 *  - POST /goals (GoalRequest)  → { message, goal: GoalView }
 *
 * 조회(query)와 저장(mutation)이 동일 리소스라 한 파일에 묶었다.
 * (HANDOFF의 "단일 query 훅 별도 파일" 규칙의 취지를 해치지 않으면서,
 *  상호 무효화가 필요한 read/write 쌍을 리소스 단위로 응집)
 * 저장 성공 시 목표 캐시를 응답으로 즉시 갱신하고, goal_progress가 바뀌는
 * 대시보드는 무효화하여 재계산한다.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { dashboardQueryKeys } from "@/hooks/queries/useDashboard";
import type { GoalRequest, GoalView } from "@/types/dashboard";

interface GoalResponse {
  message: string;
  goal: GoalView | null;
}

export const goalQueryKeys = {
  current: ["goal"] as const,
};

/** 현재 목표 조회 — 없으면 null */
export function useGoal() {
  return useQuery({
    queryKey: goalQueryKeys.current,
    queryFn: async () => {
      const { data } = await api.get<GoalResponse>("/goals");
      return data.goal; // GoalView | null
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
}

/** 목표 생성/수정 (upsert) */
export function useUpsertGoal() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (body: GoalRequest) => {
      const { data } = await api.post<GoalResponse>("/goals", body);
      return data.goal; // GoalView (POST는 항상 goal 반환)
    },
    onSuccess: (goal) => {
      // 응답 목표로 캐시 즉시 갱신 (재조회 깜빡임 방지)
      qc.setQueryData(goalQueryKeys.current, goal);
      // goal_progress가 변하므로 대시보드는 무효화 → 재계산
      qc.invalidateQueries({ queryKey: dashboardQueryKeys.all });
    },
  });
}
