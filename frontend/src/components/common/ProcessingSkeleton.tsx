/**
 * ProcessingSkeleton — 분석/생성 대기 중 지연 마스킹
 *
 * UX:
 *  - 단순 스피너 대신 "결과 카드 구조"를 미리 그려 인지 부하 감소
 *  - 단계별 진행 메시지 (typing 효과)
 *
 * ── variant: "speech" (default) ────────────────────────────
 *  음성 분석 흐름(asr → scoring → coaching) 마스킹.
 *  - `stage` prop이 주어지면 서버 WS 단계로 헤드라인을 정확히 동기화.
 *  - `stage`가 생략되면(WS 단계가 없는 흐름) 기존처럼 시간 기반으로 추정.
 *  사용처: /youtube 답변 분석, /interview/room 답변 분석.
 *
 * ── variant: "question-generation" (Step 10-A) ─────────────
 *  YouTube 질문 생성 ~1분 대기 마스킹.
 *  - 백엔드가 단계 이벤트를 주지 않으므로 **시간 기반**으로 단계가 흐른다.
 *  - 결과 자리도 점수 카드가 아니라 "질문 카드 3건" 형태로 채워 곧 나타날
 *    결과의 모양을 미리 노출 → 인지 부하 감소.
 *  - 1분 대기 동선 보호를 위해 회전형 영어 스피킹 팁을 함께 노출.
 *  사용처: /youtube 질문 생성 대기.
 *
 * 디자인 토큰만 소비 (DESIGN_SYSTEM.md):
 *  --bg-elevated / --border / --fg / --fg-muted / --fg-subtle / --accent
 */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { WsStage } from "@/types/ws";

// ─────────────────────────────────────────────────────────────
// 공개 타입
// ─────────────────────────────────────────────────────────────
export type ProcessingVariant = "speech" | "question-generation";

interface ProcessingSkeletonProps {
  /**
   * 서버 처리 단계 (variant === "speech" 전용).
   *  - WsStage 지정: 실 단계로 동기화 (시간 추정 미사용)
   *  - null:         단계 흐름이나 아직 첫 status 미수신 → "전송 중"
   *  - 생략(undefined): 단계가 없는 흐름 → 시간 기반 추정 폴백
   *
   * variant === "question-generation"에서는 stage가 무시된다(백엔드 단계 신호 없음).
   */
  stage?: WsStage | null;

  /** 스켈레톤 모드. 기본 "speech"로 기존 호출부와 100% 호환. */
  variant?: ProcessingVariant;
}

// ─────────────────────────────────────────────────────────────
// variant === "speech" — 음성 분석 단계 텍스트
// ─────────────────────────────────────────────────────────────
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
const TIMED_DELAYS_MS = [0, 1200, 3000];

// ─────────────────────────────────────────────────────────────
// variant === "question-generation" — 질문 생성 단계 텍스트
// ─────────────────────────────────────────────────────────────
/**
 * 백엔드 generate-questions 평균 응답이 ~1분이라는 가정 하에 단계 전환 시각을
 * 사용자 체감 흐름에 맞춰 분배. 실제 응답이 더 빨리 끝나면 부모가 언마운트하므로
 * 마지막 단계까지 도달하지 않아도 무방하다.
 */
const QGEN_STAGES = [
  "유튜브 자막을 분석하고 있어요",
  "맞춤 회화 질문을 만들고 있어요",
  "모범 답안을 작성하고 있어요",
] as const;
const QGEN_DELAYS_MS = [0, 14_000, 36_000];

/**
 * 회전형 영어 스피킹 팁.
 * - 1분 대기 동안 6~7개 가량 노출되도록 8초 간격 회전(아래 TIP_ROTATE_MS).
 * - 짧고 즉시 따라할 수 있는 표현 위주. 캐주얼/면접/일상을 섞어 다양성 확보.
 */
const SPEAKING_TIPS: ReadonlyArray<{ en: string; ko: string }> = [
  {
    en: "I think...",
    ko: "의견을 자연스럽게 시작할 때 가장 자주 쓰는 표현이에요.",
  },
  {
    en: "What I mean is...",
    ko: "방금 한 말을 풀어 설명할 때 시간을 벌어주는 한 마디.",
  },
  {
    en: "From my experience,",
    ko: "추상적 의견 대신 개인 경험으로 시작하면 답변이 깊어져요.",
  },
  {
    en: "It depends on...",
    ko: "맥락이 필요한 질문에 만능 디딤돌이 되는 표현이에요.",
  },
  {
    en: "To be fair,",
    ko: "한쪽 입장만 강요하기 부담스러울 때 균형을 잡아주는 표현.",
  },
  {
    en: "Let me think for a second.",
    ko: "침묵 대신 자연스럽게 생각 시간을 확보하는 영어식 표현.",
  },
  {
    en: "The main point is...",
    ko: "장황해질 때 결론을 다시 끌어와 핵심을 강조해주세요.",
  },
];
const TIP_ROTATE_MS = 8_000;

// ─────────────────────────────────────────────────────────────
// 본체
// ─────────────────────────────────────────────────────────────
export function ProcessingSkeleton({
  stage,
  variant = "speech",
}: ProcessingSkeletonProps = {}) {
  if (variant === "question-generation") {
    return <QuestionGenerationSkeleton />;
  }
  return <SpeechSkeleton stage={stage} />;
}

// ─────────────────────────────────────────────────────────────
// 음성 분석 스켈레톤 (기존 동작 100% 유지)
// ─────────────────────────────────────────────────────────────
function SpeechSkeleton({ stage }: { stage?: WsStage | null }) {
  // stage prop 자체가 전달됐는지로 "단계 추적 흐름"을 구분 (null도 추적 흐름)
  const usesRealStage = stage !== undefined;
  const [timedIdx, setTimedIdx] = useState(0);

  useEffect(() => {
    if (usesRealStage) return; // 실 단계 흐름에선 타이머 미사용
    const timers = TIMED_DELAYS_MS.slice(1).map((delay, i) =>
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
      <StageHeadline text={headline} />

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

// ─────────────────────────────────────────────────────────────
// 질문 생성 스켈레톤 (Step 10-A)
// ─────────────────────────────────────────────────────────────
function QuestionGenerationSkeleton() {
  // 단계 진행 (시간 기반)
  const [stageIdx, setStageIdx] = useState(0);
  useEffect(() => {
    const timers = QGEN_DELAYS_MS.slice(1).map((delay, i) =>
      setTimeout(() => setStageIdx(i + 1), delay)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  // 스피킹 팁 회전
  const [tipIdx, setTipIdx] = useState(0);
  useEffect(() => {
    const t = window.setInterval(
      () => setTipIdx((i) => (i + 1) % SPEAKING_TIPS.length),
      TIP_ROTATE_MS
    );
    return () => window.clearInterval(t);
  }, []);

  const headline = QGEN_STAGES[stageIdx];
  const tip = SPEAKING_TIPS[tipIdx];

  return (
    <section
      aria-busy="true"
      aria-live="polite"
      className="space-y-5 animate-fade-up"
    >
      {/* ── 단계 안내 + 스피킹 팁 카드 ─────────────────────────── */}
      <div className="border border-border rounded-xl bg-bg-elevated p-6 space-y-5">
        <StageHeadline text={headline} />

        {/* 단계 진행 게이지 — 3단계 점 표시 (현재/완료/대기) */}
        <StageProgress current={stageIdx} total={QGEN_STAGES.length} />

        {/* 스피킹 팁 — 회전 노출. 1분 대기 동선 보호 */}
        <div className="pt-2 border-t border-border">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle mb-2">
            Speaking tip
          </p>
          {/* key를 tipIdx로 두어 페이드업 애니메이션이 회전마다 재생되도록 한다 */}
          <div key={tipIdx} className="animate-fade-up">
            <p className="font-display text-lg leading-snug text-fg">
              <span className="text-accent">“</span>
              {tip.en}
              <span className="text-accent">”</span>
            </p>
            <p className="mt-1 text-sm text-fg-muted leading-relaxed">
              {tip.ko}
            </p>
          </div>
        </div>
      </div>

      {/* ── 곧 나타날 질문 카드의 미리보기 (3건) ───────────────── */}
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="border border-border rounded-xl bg-bg-elevated p-5 space-y-3"
          >
            {/* eyebrow 자리 */}
            <div className="h-2.5 w-20 rounded-sm animate-shimmer" />
            {/* 영어 질문 큰 라인 */}
            <div className="h-6 w-5/6 rounded-md animate-shimmer" />
            {/* 한국어 부제 작은 라인 */}
            <div className="h-3 w-3/5 rounded-sm animate-shimmer" />
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// 공용: 단계 헤드라인 (ping dot + 타이핑 점)
// ─────────────────────────────────────────────────────────────
function StageHeadline({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-75 animate-ping" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent" />
      </span>
      <p className="font-display text-lg tracking-tight">
        {text}
        <TypingDots />
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 공용: 점점점 타이핑 효과 (3개 점이 순차로 페이드)
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// 단계 진행 점 표시 (question-generation 전용)
//  - 현재 단계: accent solid
//  - 이전 단계(완료): accent 0.5 opacity
//  - 이후 단계(대기): border-strong
// ─────────────────────────────────────────────────────────────
function StageProgress({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      {Array.from({ length: total }).map((_, i) => {
        const state =
          i < current ? "done" : i === current ? "active" : "pending";
        return (
          <span
            key={i}
            className={cn(
              "h-1 rounded-full transition-colors",
              // active는 길게 강조, 나머지는 동일 길이
              state === "active" ? "w-8" : "w-4",
              state === "active" && "bg-accent",
              state === "done" && "bg-accent/50",
              state === "pending" && "bg-border-strong"
            )}
          />
        );
      })}
    </div>
  );
}
