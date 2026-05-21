/**
 * PhonemeHeatmap — 누적 약점 음소 히트맵
 *
 * UX 목표:
 *  - "어떤 음소가 약한가"를 한눈에 파악 (avg_score 기준 R/Y/G)
 *  - 단순 색만 쓰지 않고 카드 + 메타데이터(시도수, 실패율)를 함께 표시
 *  - 가장 약한 음소를 먼저 보여주는 "교정 우선순위" UX
 *
 * WordHeatmap과의 차이:
 *  - WordHeatmap: 한 발화의 단어 흐름 (리듬 보존, inline)
 *  - PhonemeHeatmap: 누적 통계 카드 그리드 (정렬 + 메타데이터 강조)
 *  - 책임이 명확히 달라 재사용 대신 분리한다.
 *
 * 접근성:
 *  - 색만으로 정보를 전달하지 않도록 점수 숫자를 항상 같이 노출
 *  - 가장 약한 음소(low tier)에는 좌측 보더 강조로 한 번 더 시그널
 */
import { useMemo } from "react";
import { cn, getScoreTier, scoreTierClasses } from "@/lib/utils";
import type { WeakPhoneme } from "@/types/history";

interface PhonemeHeatmapProps {
  phonemes: WeakPhoneme[];
  /** 표시 개수 제한 (기본 12개). null이면 전체 */
  limit?: number | null;
}

export function PhonemeHeatmap({ phonemes, limit = 12 }: PhonemeHeatmapProps) {
  // 가장 약한 음소부터 보여준다 (avg_score 오름차순)
  // 동일 점수면 시도 횟수가 많은 쪽이 더 신뢰도 높으므로 우선 노출
  const sorted = useMemo(() => {
    const arr = [...phonemes].sort((a, b) => {
      if (a.avg_score !== b.avg_score) return a.avg_score - b.avg_score;
      return b.total_count - a.total_count;
    });
    return limit != null ? arr.slice(0, limit) : arr;
  }, [phonemes, limit]);

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-fg-muted italic">
        아직 분석할 음소 데이터가 없어요.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
      {sorted.map((p) => (
        <PhonemeCard key={p.phoneme} item={p} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 음소 카드 한 칸
// ─────────────────────────────────────────────────────────────
function PhonemeCard({ item }: { item: WeakPhoneme }) {
  const tier = getScoreTier(item.avg_score);
  const cls = scoreTierClasses[tier];

  // 실패율은 0~1 가정. 백엔드가 0~100으로 보내는 케이스도 방어
  const failPct =
    item.fail_rate > 1
      ? Math.round(item.fail_rate)
      : Math.round(item.fail_rate * 100);

  return (
    <div
      className={cn(
        "relative rounded-lg border border-border bg-bg-elevated p-3",
        "transition-colors hover:border-border-strong",
        // low tier는 좌측 보더로 한 번 더 강조 (색맹 접근성 보조)
        tier === "low" && "border-l-2 border-l-score-low"
      )}
      // 호버 시 추가 컨텍스트 (네이티브 툴팁)
      title={`총 ${item.total_count}회 시도 · 실패율 ${failPct}%`}
    >
      {/* 음소 기호 + 점수 */}
      <div className="flex items-baseline justify-between mb-2">
        <span
          className={cn(
            "font-mono text-xl uppercase tracking-wide",
            cls.text
          )}
        >
          {item.phoneme}
        </span>
        <span
          className={cn(
            "font-display tabular-nums text-lg leading-none",
            cls.text
          )}
        >
          {Math.round(item.avg_score)}
          <span className="text-[10px] text-fg-subtle font-mono ml-0.5">
            /100
          </span>
        </span>
      </div>

      {/* 메타데이터: 시도수 · 실패율 */}
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-fg-subtle">
        <span>
          n=<span className="tabular-nums text-fg-muted">{item.total_count}</span>
        </span>
        <span>
          fail{" "}
          <span className="tabular-nums text-fg-muted">{failPct}%</span>
        </span>
      </div>
    </div>
  );
}