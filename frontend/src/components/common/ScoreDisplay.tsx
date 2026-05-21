/**
 * ScoreDisplay — 점수 셀 공용 컴포넌트
 *
 * 추출 배경:
 *  - YoutubePage(ScoreCell), InterviewRoomPage(ScoreInline),
 *    HistoryDetailPage(ScoreCell + ScoreInline)에서 동일 패턴이 4회 반복됨
 *  - HANDOFF 자산 추출 정책의 "3곳 이상 사용" 기준 도달 → 통합
 *
 * 책임 분리:
 *  - 본 컴포넌트는 "라벨 + 점수 값 + /100 단위" 의 순수 텍스트만 담당
 *  - 외곽 박스/배경/보더는 호출자가 결정 (한 곳에 시각 결정이 갇히지 않게)
 *
 * 사용 가이드:
 *  - size="lg"  : 메인 지표 강조 (한 카드에 1개 정도)
 *  - size="md"  : 표준 (기본값, 세션 결과 카드의 보조 지표)
 *  - size="sm"  : 인라인 컴팩트 (Voice Bubble, 답변 카드 등 좁은 공간)
 *
 * 색상:
 *  - 값 텍스트 색은 점수 tier에 따라 R/Y/G (getScoreTier + scoreTierClasses)
 *  - 라벨/단위는 모든 사이즈에서 fg-subtle 통일
 */
import { cn, getScoreTier, scoreTierClasses } from "@/lib/utils";

export type ScoreDisplaySize = "sm" | "md" | "lg";

interface ScoreDisplayProps {
  label: string;
  value: number;
  size?: ScoreDisplaySize;
  /** 추가 wrapper 클래스 (외부에서 정렬 등 조정용) */
  className?: string;
}

// ─────────────────────────────────────────────────────────────
// 사이즈별 스타일 토큰
// 타입 별칭을 먼저 선언해 Record 제네릭을 한 줄로 유지한다.
// (멀티라인 Record<\n  ScoreDisplaySize,\n  {...}\n>는 .tsx 파서가
//  JSX로 오인할 수 있어 에러가 발생하므로 이 패턴을 사용한다.)
// ─────────────────────────────────────────────────────────────
type TokenSet = { label: string; value: string; unit: string };

const SIZE_TOKENS: Record<ScoreDisplaySize, TokenSet> = {
  sm: {
    label: "text-[9px] mb-0.5",
    value: "text-xl",
    unit: "text-[10px] ml-0.5",
  },
  md: {
    label: "text-[10px] mb-1.5",
    value: "text-3xl",
    unit: "text-[11px] ml-1",
  },
  lg: {
    label: "text-xs mb-1.5",
    value: "text-5xl",
    unit: "text-base ml-1",
  },
};

export function ScoreDisplay({
  label,
  value,
  size = "md",
  className,
}: ScoreDisplayProps) {
  const tier = getScoreTier(value);
  const tierCls = scoreTierClasses[tier];
  const tokens = SIZE_TOKENS[size];

  return (
    <div className={className}>
      <p
        className={cn(
          "font-mono uppercase tracking-wider text-fg-subtle",
          tokens.label
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "font-display tabular-nums leading-none",
          tokens.value,
          tierCls.text
        )}
      >
        {Math.round(value)}
        <span className={cn("font-mono text-fg-subtle", tokens.unit)}>
          /100
        </span>
      </p>
    </div>
  );
}