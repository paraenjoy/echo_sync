/**
 * ProcessingSkeleton — 분석 대기 중 지연 마스킹
 *
 * UX:
 *  - 단순 스피너 대신 "결과 카드 구조"를 미리 그려 인지 부하 감소
 *  - 단계별 진행 메시지 (typing 효과)
 *
 * 단계 동기화 (BACKEND_PR.md TODO #4 ✅):
 *  - `stage` prop이 주어지면 서버 WS 단계(asr→scoring→coaching)로 헤드라인을 정확히 동기화.
 *  - `stage`가 생략되면(예: 질문 생성 대기처럼 WS 단계가 없는 흐름) 기존처럼 시간 기반으로 추정.
 *
 * 사용처:
 *  - /youtube, /interview/room 음성 분석: <ProcessingSkeleton stage={audio.stage} />
 *  - /youtube 질문 생성 대기: <ProcessingSkeleton />   // prop 없음 → 시간 기반 폴백
 */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { WsStage } from "@/types/ws";

interface ProcessingSkeletonProps {
  /**
   * 서버 처리 단계.
   *  - WsStage 지정: 실 단계로 동기화 (시간 추정 미사용)
   *  - null:         단계 흐름이나 아직 첫 status 미수신 → "전송 중"
   *  - 생략(undefined): 단계가 없는 흐름 → 시간 기반 추정 폴백
   */
  stage?: WsStage | null;
}

/** 실 WS 단계 → 헤드라인 */
const STAGE_TEXT: Record<WsStage, string> = {
  asr: "음성을 인식하고 있어요",
  scoring: "발음을 채점하고 있어요",
  coaching: "AI가 코칭 피드백을 작성하고 있어요",
};

/** stage가 없는 흐름용 시간 기반 폴백 (기존 동작 유지) */
const TIMED_STAGES = [
  "음성을 전송하고 있어요",
  "발음을 인식하고 있어요",
  "AI가 코칭 피드백을 작성하고 있어요",
] as const;
const TIMED_DELAYS = [0, 1200, 3000];

export function ProcessingSkeleton({ stage }: ProcessingSkeletonProps = {}) {
  // stage prop 자체가 전달됐는지로 "단계 추적 흐름"을 구분 (null도 추적 흐름)
  const usesRealStage = stage !== undefined;
  const [timedIdx, setTimedIdx] = useState(0);

  useEffect(() => {
    if (usesRealStage) return; // 실 단계 흐름에선 타이머 미사용
    const timers = TIMED_DELAYS.slice(1).map((delay, i) =>
      setTimeout(() => setTimedIdx(i + 1), delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [usesRealStage]);

  const headline = usesRealStage
    ? stage
      ? STAGE_TEXT[stage]
      : "음성을 전송하고 있어요"
    : TIMED_STAGES[timedIdx];

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
          {headline}
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
