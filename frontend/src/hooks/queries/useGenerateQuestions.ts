/**
 * useGenerateQuestions — YouTube URL → 질문 목록 생성
 *
 * 백엔드 특이사항 (main.py):
 *  - 실패 시에도 HTTP 200 + { error: "..." }로 응답하는 경우가 있음
 *  - 따라서 axios 인터셉터를 통과한 뒤에도 한 번 더 error 필드 체크
 *
 * 캐싱 전략:
 *  - YouTube URL을 키로 캐싱하여 같은 영상에 대한 중복 호출 방지
 *  - LLM 호출 비용이 크므로 staleTime을 길게 유지 (queryClient 기본값 5분)
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { GenerateQuestionsResponse } from "@/types/youtube";

export const youtubeQueryKeys = {
  questions: (url: string) => ["youtube", "questions", url] as const,
};

async function fetchQuestions(url: string): Promise<GenerateQuestionsResponse> {
  const res = await api.get<GenerateQuestionsResponse>("/generate-questions", {
    params: { url },
  });

  // 백엔드가 200 + error 필드로 실패를 알리는 케이스 처리
  if (res.data.error) {
    throw new Error(res.data.error);
  }
  return res.data;
}

/**
 * @param url  YouTube URL (빈 문자열이면 호출 비활성)
 */
export function useGenerateQuestions(url: string) {
  return useQuery({
    queryKey: youtubeQueryKeys.questions(url),
    queryFn: () => fetchQuestions(url),
    enabled: false, // 사용자가 "질문 생성" 버튼을 눌렀을 때만 refetch()로 트리거
    // 1회 트리거 후 결과 유지 (브라우저 뒤로가기/재진입 시 캐시 활용)
    gcTime: 1000 * 60 * 30, // 30분
  });
}
