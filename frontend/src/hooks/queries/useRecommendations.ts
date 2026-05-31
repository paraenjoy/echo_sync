/**
 * useRecommendations — 맞춤 학습 추천 조회
 *
 * 백엔드: GET /recommendations (learning_features.py, 루트 마운트)
 *   → { message, averages, weak_points, weak_words, practice_sentences, recommendation_strategy }
 *
 * 약점/추천은 자주 바뀌지 않으므로 staleTime을 길게 둔다.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { RecommendationsResponse } from "@/types/dashboard";

export const recommendationsQueryKeys = {
  all: ["recommendations"] as const,
};

export function useRecommendations() {
  return useQuery({
    queryKey: recommendationsQueryKeys.all,
    queryFn: async () => {
      const { data } = await api.get<RecommendationsResponse>("/recommendations");
      return data;
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
}
