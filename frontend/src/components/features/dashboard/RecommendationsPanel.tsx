/**
 * RecommendationsPanel — 맞춤 학습 추천 (대시보드)
 *
 * 데이터: GET /recommendations (RecommendationsResponse)
 *  - weak_points: 약점 요약(백엔드가 최소 1개 보장)
 *  - weak_words: 낮은 점수 단어 (avg_score는 점수 티어 색으로 — 데이터 전용)
 *  - practice_sentences: 추천 연습 문장 (없을 수 있어 비면 숨김)
 *  - recommendation_strategy: 학습 전략
 *
 * 디자인(DESIGN_SYSTEM.md): 의미 토큰만. 점수 색(score-*)은 단어 점수에만 적용.
 */
import type { RecommendationsResponse } from "@/types/dashboard";

interface RecommendationsPanelProps {
  data: RecommendationsResponse;
}

/** 점수 → 티어 텍스트 색 (DESIGN_SYSTEM 임계: <60 low, 60-89 mid, ≥90 high) */
function scoreColor(score: number): string {
  if (score >= 90) return "score-high";
  if (score >= 60) return "score-mid";
  return "score-low";
}

export function RecommendationsPanel({ data }: RecommendationsPanelProps) {
  const { weak_points, weak_words, practice_sentences, recommendation_strategy } =
    data;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* 약점 */}
      <Card title="약점" eyebrow="Focus">
        <ul className="flex flex-wrap gap-2">
          {weak_points.map((point, i) => (
            <li
              key={i}
              className="rounded-md border border-border bg-bg-subtle px-2.5 py-1 text-sm text-fg-muted"
            >
              {point}
            </li>
          ))}
        </ul>
      </Card>

      {/* 낮은 점수 단어 */}
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

      {/* 추천 연습 문장 — 비면 섹션 숨김 */}
      {practice_sentences.length > 0 && (
        <Card title="추천 연습 문장" eyebrow="Practice">
          <ol className="space-y-2">
            {practice_sentences.map((sentence, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                <span className="font-mono text-xs text-fg-subtle tabular-nums pt-0.5">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-fg-muted">{sentence}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* 학습 전략 */}
      {recommendation_strategy.length > 0 && (
        <Card title="학습 전략" eyebrow="Strategy">
          <ul className="space-y-2">
            {recommendation_strategy.map((tip, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                <span className="mt-2 inline-block h-1 w-1 shrink-0 rounded-full bg-accent" />
                <span className="text-fg-muted">{tip}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
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
    <div className="rounded-xl border border-border bg-bg-elevated p-5 animate-fade-up">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
        {eyebrow}
      </p>
      <h3 className="mb-4 font-display text-lg leading-tight">{title}</h3>
      {children}
    </div>
  );
}
