/**
 * RecommendationsPanel — 맞춤 학습 추천 (대시보드)
 *
 * 데이터: GET /recommendations (RecommendationsResponse)
 *  - weak_words: 낮은 점수 단어 (avg_score는 점수 티어 색으로 — 데이터 전용)
 *  - practice_sentences: 추천 연습 문장 (최대 4개만 노출)
 *
 * 레이아웃:
 *  - 좌: 낮은 점수 단어 / 우: 추천 연습 문장 (md 이상 2열)
 *  - 두 카드는 같은 행에서 grid stretch + h-full로 높이를 통일한다.
 *
 * 참고:
 *  - 백엔드는 weak_points·recommendation_strategy도 함께 보내지만(타입에는 유지),
 *    피드백에 따라 "약점"·"학습 전략" 카드는 더 이상 렌더링하지 않는다.
 *
 * 디자인(DESIGN_SYSTEM.md): 의미 토큰만. 점수 색(score-*)은 단어 점수에만 적용.
 */
import type { RecommendationsResponse } from "@/types/dashboard";

interface RecommendationsPanelProps {
  data: RecommendationsResponse;
}

/** 추천 연습 문장 최대 노출 개수 */
const MAX_PRACTICE_SENTENCES = 4;

/** 점수 → 티어 텍스트 색 (DESIGN_SYSTEM 임계: <60 low, 60-89 mid, ≥90 high) */
function scoreColor(score: number): string {
  if (score >= 90) return "score-high";
  if (score >= 60) return "score-mid";
  return "score-low";
}

export function RecommendationsPanel({ data }: RecommendationsPanelProps) {
  const { weak_words, practice_sentences } = data;

  // 최대 4개로 제한
  const sentences = practice_sentences.slice(0, MAX_PRACTICE_SENTENCES);

  return (
    // items-stretch(기본) + 카드 h-full로 좌/우 카드 높이를 통일
    <div className="grid items-stretch gap-4 md:grid-cols-2">
      {/* 좌 — 낮은 점수 단어 */}
      <Card title="낮은 점수 단어" eyebrow="Weak words">
        {weak_words.length > 0 ? (
          <ul className="space-y-1.5">
            {weak_words.map((w) => (
              <li
                key={w.word}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span className="font-mono text-fg">{w.word}</span>
                <span className="flex items-baseline gap-2">
                  <span
                    className={`font-mono tabular-nums ${scoreColor(w.avg_score)}`}
                  >
                    {Math.round(w.avg_score)}
                  </span>
                  <span className="font-mono text-[11px] text-fg-subtle tabular-nums">
                    ×{w.count}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-subtle">아직 낮은 점수 단어가 없어요.</p>
        )}
      </Card>

      {/* 우 — 추천 연습 문장 (최대 4개) */}
      <Card title="추천 연습 문장" eyebrow="Practice">
        {sentences.length > 0 ? (
          <ol className="space-y-2">
            {sentences.map((sentence, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                <span className="font-mono text-xs text-fg-subtle tabular-nums pt-0.5">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-fg-muted">{sentence}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-fg-subtle">추천할 연습 문장이 아직 없어요.</p>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function Card({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full rounded-xl border border-border bg-bg-elevated p-5 animate-fade-up">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
        {eyebrow}
      </p>
      <h3 className="mb-4 font-display text-lg leading-tight">{title}</h3>
      {children}
    </div>
  );
}
