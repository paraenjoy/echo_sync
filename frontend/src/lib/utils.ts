/**
 * 공통 유틸리티
 * - cn: clsx + tailwind-merge (shadcn/ui 표준)
 * - getScoreTier: 점수를 시각화 티어로 매핑 (히트맵·결과 카드 공용)
 * - resolveStaticUrl: 서버 정적 경로를 절대 URL로 변환
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { API_BASE_URL } from "./constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 점수 → 시각화 티어
 * - plan.md 요구사항: Red <60, Yellow 60-89, Green ≥90
 */
export type ScoreTier = "low" | "mid" | "high";

export function getScoreTier(score: number): ScoreTier {
  if (score < 60) return "low";
  if (score < 90) return "mid";
  return "high";
}

/**
 * 티어 → Tailwind 클래스 (텍스트 + 배경 묶음)
 * - 컴포넌트마다 분기를 반복하지 않도록 한 곳에 정의
 */
export const scoreTierClasses: Record<ScoreTier, { text: string; bg: string; ring: string }> = {
  low:  { text: "text-score-low",  bg: "bg-score-low",  ring: "ring-score-low/40" },
  mid:  { text: "text-score-mid",  bg: "bg-score-mid",  ring: "ring-score-mid/40" },
  high: { text: "text-score-high", bg: "bg-score-high", ring: "ring-score-high/40" },
};

/**
 * 서버 정적 경로를 브라우저에서 접근 가능한 절대 URL로 변환.
 *
 * 배경:
 *  - 백엔드는 "/static/audio/{file}.mp3" 같은 상대 경로를 반환한다.
 *  - 프론트엔드와 백엔드가 다른 origin(예: :5173 vs :8000)이면
 *    <audio src="/static/...">는 프론트 origin으로 요청해 404가 된다.
 *  - 이 함수는 상대 경로를 API_BASE_URL 기반의 절대 URL로 변환하여
 *    AudioPlayer, WordReplayPlayer, PersonaCard 등이 올바른 곳에 요청하게 한다.
 *
 * 처리 규칙:
 *  - null/undefined → null
 *  - 이미 절대 URL(http://, https://) → 그대로
 *  - Blob URL(blob:) → 그대로
 *  - 슬래시 시작(/static/...) → API_BASE_URL + path
 *  - 그 외(상대 경로) → API_BASE_URL + "/" + path
 */
export function resolveStaticUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("blob:")) {
    return url;
  }
  const base = API_BASE_URL.replace(/\/$/, "");
  return url.startsWith("/") ? `${base}${url}` : `${base}/${url}`;
}
