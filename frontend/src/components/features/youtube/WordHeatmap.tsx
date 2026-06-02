/**
 * WordHeatmap — 단어별 발음 정확도 히트맵
 *
 * UX:
 *  - 단어들이 한 줄에 자연스럽게 흐름 (말한 그대로의 리듬 유지)
 *  - 각 단어는 정확도(0~100)에 따라 배경 톤이 다름 (R/Y/G)
 *  - score < 60 단어는 underline 마커로 한 번 더 강조 (색맹 접근성)
 *  - 클릭 시: 음소별 점수 드로어 펼침 + onWordSelect로 부모에 선택 통지(재생 연동)
 *
 * Step 11 변경:
 *  - D4: onWordSelect 콜백 추가 — WordReplayPlayer 단어 재생 연동.
 *  - E2: 점수 배지를 단어 박스 "안쪽"으로 이동 — UserVoiceBubble처럼
 *        overflow-hidden이 걸린 카드 안에서도 잘리지 않도록 수정
 *        (기존 absolute -top-2가 카드 밖으로 나가 잘리던 인터뷰 호버 버그 해결).
 *  - E2: 음소 개념 안내 + 음소 칩 title 툴팁 추가 — 기호만으로는 의미를
 *        알기 어려운 사용자를 위한 보조 설명.
 */
import { useState } from "react";
import { cn, getScoreTier, scoreTierClasses } from "@/lib/utils";
import type { WsWord, WsPhoneme } from "@/types/ws";

interface WordHeatmapProps {
  words: WsWord[];
  /**
   * 단어 선택 변화 콜백 (Step 11-D — 발음 재생 연동).
   *  - 단어 클릭 시 (word, index), 같은 단어 재클릭(드로어 토글 닫힘) 시 (null, null).
   *  - 미지정 시 음소 드로어 토글만 동작 (하위호환 — 콜백 없는 사용처 무영향).
   */
  onWordSelect?: (word: WsWord | null, index: number | null) => void;
}

export function WordHeatmap({ words, onWordSelect }: WordHeatmapProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (!words || words.length === 0) {
    return <p className="text-sm text-fg-muted">분석할 단어가 없어요.</p>;
  }

  const active = activeIndex !== null ? words[activeIndex] : null;

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
              onClick={() => {
                const next = isActive ? null : i;
                setActiveIndex(next);
                // 음소 드로어 토글과 동일한 선택 상태를 부모에 통지 → 재생 연동
                onWordSelect?.(next === null ? null : w, next);
              }}
              aria-expanded={isActive}
              aria-label={`${w.word}, 정확도 ${Math.round(w.accuracy)}점`}
              className={cn(
                "group relative pl-2 pr-7 py-1 rounded-md text-base transition-all",
                "font-display font-medium",
                classes.bg,
                tier === "low" &&
                  "underline decoration-score-low decoration-2 underline-offset-4",
                isActive &&
                  cn("ring-2 ring-offset-2 ring-offset-bg-elevated", classes.ring)
              )}
            >
              <span className={classes.text}>{w.word}</span>

              {/* 점수 — 박스 "내부" 우측에 배치 (E2 핵심 수정).
                  기존 -top-2/-right-1 음수 offset은 overflow-hidden 카드(UserVoiceBubble)
                  밖으로 나가 잘렸다. pr-7로 단어 텍스트와 분리된 공간을 항상 확보하므로
                  짧은 단어("I","a")에서도 겹치지 않고, 박스 안이라 어디서도 안 잘린다. */}
              <span
                className={cn(
                  "absolute right-1 top-1/2 -translate-y-1/2 text-[10px] font-mono tabular-nums",
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
      {active && (
        <div className="border border-border rounded-lg bg-bg-elevated p-4 animate-fade-up">
          <div className="flex items-baseline justify-between mb-1">
            <h4 className="font-display text-lg">
              <span
                className={
                  scoreTierClasses[getScoreTier(active.accuracy)].text
                }
              >
                {active.word}
              </span>
            </h4>
            <span className="font-mono text-xs text-fg-muted tabular-nums">
              {Math.round(active.accuracy)} / 100
            </span>
          </div>

          {/* 음소 개념 안내 (E2 — 음소가 뭔지 모르는 사용자 배려) */}
          <p className="text-[11px] text-fg-subtle mb-3 leading-relaxed">
            음소는 발음의 최소 단위예요. 점수가 낮은 기호일수록 그 소리를 집중해서
            연습해보세요. 기호에 마우스를 올리면 정확도를 볼 수 있어요.
          </p>

          {active.phonemes.length === 0 ? (
            <p className="text-sm text-fg-muted">
              이 단어는 음소별 분석이 제공되지 않았어요.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {active.phonemes.map((ph, pi) => (
                <PhonemeChip key={`${ph.ph}-${pi}`} phoneme={ph} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PhonemeChip — 음소 기호 + 점수 (E2: title 툴팁 추가)
//
// 음소 기호(Azure 발음 평가 표기)만으로는 일반 사용자가 의미를 알기 어렵다.
// 네이티브 title 툴팁으로 정확도와 연습 권장 여부를 호버 시 안내한다.
// (IPA→한글 근사 매핑은 백엔드 음소 표기 형식 확정 후 별도 도입 — 현재는
//  점수 기반 안내로 우선 충족. 검증 안 된 매핑으로 틀린 발음 정보를 주지 않는다.)
// ─────────────────────────────────────────────────────────────
function PhonemeChip({ phoneme }: { phoneme: WsPhoneme }) {
  const tier = getScoreTier(phoneme.score);
  const cls = scoreTierClasses[tier];
  const score = Math.round(phoneme.score);

  return (
    <span
      title={
        tier === "low"
          ? `정확도 ${score}점 · 더 연습해보세요`
          : `정확도 ${score}점`
      }
      className={cn(
        "inline-flex items-baseline gap-1 rounded-md border border-border px-2 py-1",
        "font-mono text-sm cursor-help",
        // low tier는 좌측 보더로 한 번 더 강조 (색맹 접근성 — PhonemeHeatmap과 일관)
        tier === "low" && "border-l-2 border-l-score-low"
      )}
    >
      <span className={cn("uppercase tracking-wide", cls.text)}>
        {phoneme.ph}
      </span>
      <span className="text-[10px] tabular-nums text-fg-subtle">{score}</span>
    </span>
  );
}
