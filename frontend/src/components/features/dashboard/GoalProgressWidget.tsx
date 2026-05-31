/**
 * GoalProgressWidget — 학습 목표 달성률
 *
 * 데이터: GET /dashboard 의 goal(GoalView) + goal_progress(GoalProgress)
 *  - 목표 미설정 시 둘 다 null → 빈 상태(설정 유도) 렌더
 *  - 주간 연습: weekly_practice_done / weekly_practice_target 진행 막대
 *  - 발음: current_pronunciation_avg vs target_pronunciation_score, gap
 *
 * 디자인(DESIGN_SYSTEM.md): 의미 토큰만 사용. 점수 색(score-*)은 데이터(달성/잔여)에만,
 * 브랜드 accent와 분리. 수치는 font-mono + tabular-nums. rounded-xl 한계 준수.
 *
 * 단순 막대/수치이므로 Recharts 불필요 (추세 라인·스택 파이는 별도 위젯).
 */
import type { GoalView, GoalProgress } from "@/types/dashboard";

interface GoalProgressWidgetProps {
  goal: GoalView | null;
  progress: GoalProgress | null;
  /** "목표 설정/수정" 진입점 (모달 등). 주어질 때만 버튼 렌더 */
  onEdit?: () => void;
}

const fmt = (v: number | null | undefined) =>
  v === null || v === undefined ? "–" : Math.round(v).toString();

export function GoalProgressWidget({
  goal,
  progress,
  onEdit,
}: GoalProgressWidgetProps) {
  // ── 빈 상태: 목표 미설정 ──────────────────────────────────
  if (!goal || !progress) {
    return (
      <div className="rounded-xl border border-border bg-bg-elevated p-8 text-center animate-fade-up">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-subtle mb-3">
          No goal set
        </p>
        <h3 className="font-display text-2xl leading-tight mb-3">
          목표를 정하면 <span className="text-accent">달성률</span>을 추적해요
        </h3>
        <p className="text-fg-muted text-sm leading-relaxed mb-6 max-w-md mx-auto">
          주간 연습 횟수와 목표 발음 점수를 설정하면, 여기서 진행 상황을 한눈에
          확인할 수 있어요.
        </p>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
          >
            목표 설정하기
          </button>
        )}
      </div>
    );
  }

  const weeklyTarget = progress.weekly_practice_target;
  const weeklyDone = progress.weekly_practice_done;
  const weeklyPct =
    weeklyTarget && weeklyTarget > 0
      ? Math.min(100, Math.round((weeklyDone / weeklyTarget) * 100))
      : null;
  const weeklyMet = weeklyTarget !== null && weeklyDone >= weeklyTarget;

  const target = goal.target_pronunciation_score;
  const current = progress.current_pronunciation_avg;
  const gap = progress.pronunciation_gap; // target - current (null이면 목표 미설정)
  const pronMet = gap !== null && gap <= 0;

  return (
    <div className="rounded-xl border border-border bg-bg-elevated p-6 animate-fade-up">
      {/* 헤더 + 편집 진입점 */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle mb-1">
            This week
          </p>
          <h3 className="font-display text-xl leading-tight">목표 달성 현황</h3>
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 text-xs text-fg-subtle transition-colors hover:text-accent"
          >
            목표 수정
          </button>
        )}
      </div>

      {/* ── 주간 연습 진행 ─────────────────────────────────── */}
      <div className="mb-6">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm text-fg-muted">주간 연습</span>
          <span className="font-mono text-sm tabular-nums">
            <span className={weeklyMet ? "score-high" : "text-fg"}>
              {weeklyDone}
            </span>
            <span className="text-fg-subtle">
              {" / "}
              {weeklyTarget ?? "–"}회
            </span>
          </span>
        </div>

        {weeklyPct !== null ? (
          <div
            className="h-2 w-full overflow-hidden rounded-sm bg-bg-subtle"
            role="progressbar"
            aria-valuenow={weeklyPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="주간 연습 달성률"
          >
            <div
              className={`h-full rounded-sm transition-[width] duration-500 ${
                weeklyMet ? "bg-score-high" : "bg-accent"
              }`}
              style={{ width: `${weeklyPct}%` }}
            />
          </div>
        ) : (
          <p className="text-xs text-fg-subtle">
            주간 연습 목표가 설정되지 않았어요.
          </p>
        )}

        {weeklyTarget !== null && !weeklyMet && (
          <p className="mt-2 text-xs text-fg-subtle">
            목표까지 {progress.weekly_practice_remaining ?? 0}회 남았어요.
          </p>
        )}
      </div>

      {/* ── 발음 목표 ──────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4 border-t border-border pt-5">
        <Metric label="현재 발음" value={fmt(current)} />
        <Metric label="목표 발음" value={fmt(target)} />
        <Metric
          label={pronMet ? "달성" : "남은 격차"}
          value={
            gap === null ? "–" : pronMet ? `+${fmt(Math.abs(gap))}` : fmt(gap)
          }
          tone={gap === null ? "muted" : pronMet ? "high" : "neutral"}
        />
      </div>

      {/* ── 목표 직무 / 스택 ───────────────────────────────── */}
      {(goal.target_position || goal.target_tech_stack.length > 0) && (
        <div className="mt-5 border-t border-border pt-5">
          {goal.target_position && (
            <p className="mb-2 text-sm text-fg-muted">
              목표 직무{" "}
              <span className="text-fg">{goal.target_position}</span>
            </p>
          )}
          {goal.target_tech_stack.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {goal.target_tech_stack.map((tech) => (
                <span
                  key={tech}
                  className="rounded-md bg-bg-subtle px-2 py-0.5 font-mono text-[11px] text-fg-muted"
                >
                  {tech}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "high" | "muted";
}) {
  const valueCls =
    tone === "high" ? "score-high" : tone === "muted" ? "text-fg-subtle" : "text-fg";
  return (
    <div>
      <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
        {label}
      </p>
      <p className={`font-mono text-2xl tabular-nums ${valueCls}`}>{value}</p>
    </div>
  );
}
