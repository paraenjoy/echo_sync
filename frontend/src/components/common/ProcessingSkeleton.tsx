/**
 * ProcessingSkeleton — 분석 대기 중 지연 마스킹
 *
 * UX:
 *  - 단순 스피너 대신 "결과 카드 구조"를 미리 그려 인지 부하 감소
 *  - 단계별 진행 메시지 (typing 효과로 자연스럽게)
 *  - 백엔드가 status flag를 안 보내도 시간 경과로 자동 전환
 *
 * 사용처:
 *  - /youtube, /interview/room — useAudioStreamer.status === "processing" 시 노출
 *
 * TODO (Backend): Send status flags before final data
 *   - "processing" 플래그 도착 시 stage를 더 정확히 동기화
 *     (현재는 시간 기반 추정으로 가까이 흉내)
 */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const STAGES = [
  { at: 0,    text: "음성을 전송하고 있어요" },
  { at: 1200, text: "발음을 인식하고 있어요" },
  { at: 3000, text: "AI가 코칭 피드백을 작성하고 있어요" },
] as const;

export function ProcessingSkeleton() {
  const [stageIdx, setStageIdx] = useState(0);

  useEffect(() => {
    const timers = STAGES.slice(1).map((stage, i) =>
      setTimeout(() => setStageIdx(i + 1), stage.at)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <section
      aria-busy="true"
      aria-live="polite"
      className="border border-border rounded-xl bg-bg-elevated p-6 space-y-5 animate-fade-up"
    >
      {/* ── 단계 안내 ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-75 animate-ping" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent" />
        </span>
        <p className="font-display text-lg tracking-tight">
          {STAGES[stageIdx].text}
          <TypingDots />
        </p>
      </div>

      {/* ── 점수 카드 자리 ──────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 w-16 rounded-sm animate-shimmer" />
            <div className="h-10 w-full rounded-md animate-shimmer" />
          </div>
        ))}
      </div>

      {/* ── 단어 영역 자리 ──────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="h-3 w-20 rounded-sm animate-shimmer" />
        <div className="flex flex-wrap gap-2">
          {[40, 64, 32, 80, 52, 44, 60, 36, 56, 48].map((w, i) => (
            <div
              key={i}
              className="h-7 rounded-md animate-shimmer"
              style={{ width: `${w}px` }}
            />
          ))}
        </div>
      </div>

      {/* ── 피드백 영역 자리 ────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="h-3 w-16 rounded-sm animate-shimmer" />
        <div className="h-3 w-full rounded-sm animate-shimmer" />
        <div className="h-3 w-4/5 rounded-sm animate-shimmer" />
      </div>
    </section>
  );
}

/** 점점점 타이핑 효과 (3개 점이 순차로 페이드) */
function TypingDots() {
  return (
    <span className="inline-flex ml-1 gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            "inline-block w-1 h-1 rounded-full bg-accent",
            "animate-pulse"
          )}
          style={{
            animationDelay: `${i * 180}ms`,
            animationDuration: "1.2s",
          }}
        />
      ))}
    </span>
  );
}
