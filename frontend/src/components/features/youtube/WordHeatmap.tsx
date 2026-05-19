/**
 * WordHeatmap — 단어별 발음 정확도 히트맵
 *
 * UX:
 *  - 한 줄에 단어들이 자연스럽게 흐름 (말하던 그대로의 리듬 유지)
 *  - 각 단어는 정확도(0~100)에 따라 배경 톤이 다름 (R/Y/G)
 *  - 클릭 시 음소(phoneme)별 점수가 아래에 드로어로 펼쳐짐
 *  - 단순히 색만 바꾸지 않고, score < 60 단어에는 underline 마커로 한 번 더 강조
 *    → 컬러블라인드 접근성
 */
import { useState } from "react";
import { cn, getScoreTier, scoreTierClasses } from "@/lib/utils";
import type { WsWord } from "@/types/ws";

interface WordHeatmapProps {
  words: WsWord[];
}

export function WordHeatmap({ words }: WordHeatmapProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (!words || words.length === 0) {
    return (
      <p className="text-sm text-fg-muted italic">
        분석할 단어가 없습니다.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── 단어 흐름 ─────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-x-1.5 gap-y-2 leading-loose">
        {words.map((w, i) => {
          const tier = getScoreTier(w.accuracy);
          const classes = scoreTierClasses[tier];
          const isActive = activeIndex === i;

          return (
            <button
              key={`${w.word}-${i}`}
              type="button"
              onClick={() => setActiveIndex(isActive ? null : i)}
              aria-expanded={isActive}
              aria-label={`${w.word}, 정확도 ${Math.round(w.accuracy)}점`}
              className={cn(
                "group relative px-2 py-1 rounded-md text-base transition-all",
                "font-display font-medium",
                classes.bg,
                tier === "low" && "underline decoration-score-low decoration-2 underline-offset-4",
                isActive && cn("ring-2 ring-offset-2 ring-offset-bg-elevated", classes.ring)
              )}
            >
              <span className={classes.text}>{w.word}</span>
              {/* hover/active 시 점수 배지 */}
              <span
                className={cn(
                  "absolute -top-2 -right-1 text-[10px] font-mono tabular-nums",
                  "bg-bg-elevated border border-border-strong rounded-full px-1.5 py-0.5",
                  "opacity-0 group-hover:opacity-100 transition-opacity",
                  classes.text,
                  isActive && "opacity-100"
                )}
              >
                {Math.round(w.accuracy)}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── 음소 상세 드로어 ──────────────────────────────────── */}
      {activeIndex !== null && words[activeIndex] && (
        <div className="border border-border rounded-lg bg-bg-elevated p-4 animate-fade-up">
          <div className="flex items-baseline justify-between mb-3">
            <h4 className="font-display text-lg">
              <span className={scoreTierClasses[getScoreTier(words[activeIndex].accuracy)].text}>
                {words[activeIndex].word}
              </span>
            </h4>
            <span className="font-mono text-xs text-fg-muted tabular-nums">
              {Math.round(words[activeIndex].accuracy)} / 100
            </span>
          </div>

          {words[activeIndex].phonemes.length === 0 ? (
            <p className="text-xs text-fg-subtle">음소 데이터가 없습니다.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {words[activeIndex].phonemes.map((p, j) => {
                const tier = getScoreTier(p.score);
                const cls = scoreTierClasses[tier];
                return (
                  <div
                    key={j}
                    className={cn(
                      "flex items-baseline gap-1.5 px-2.5 py-1 rounded text-xs",
                      cls.bg
                    )}
                  >
                    <span className={cn("font-mono uppercase", cls.text)}>{p.ph}</span>
                    <span className="font-mono tabular-nums text-fg-muted">
                      {Math.round(p.score)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {words[activeIndex].error_type && (
            <p className="mt-3 text-xs text-fg-muted">
              <span className="text-fg-subtle">오류 유형: </span>
              <span className="font-mono">{words[activeIndex].error_type}</span>
            </p>
          )}
        </div>
      )}

      {/* ── 범례 ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 text-xs text-fg-subtle font-mono">
        <LegendDot color="low"  label="< 60" />
        <LegendDot color="mid"  label="60–89" />
        <LegendDot color="high" label="≥ 90" />
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: "low" | "mid" | "high"; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", `bg-score-${color}`)} />
      {label}
    </span>
  );
}
