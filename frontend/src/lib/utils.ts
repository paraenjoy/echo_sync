/**
 * 공통 유틸리티
 * - cn: clsx + tailwind-merge (shadcn/ui 표준)
 * - getScoreTier: 점수를 시각화 티어로 매핑 (히트맵·결과 카드 공용)
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

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
