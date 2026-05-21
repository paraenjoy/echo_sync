/**
 * SessionCard — 세션 1건 미리보기
 *
 * 표시:
 *  - 좌측: 세션 타입 배지 (YouTube / Interview) + 날짜
 *  - 중앙: 제목 (없으면 source_url 또는 타입별 폴백)
 *  - 우측: 평균 정확도 (accuracy_score 평균, tier 색상)
 *  - 하단: 질문 수 · 답변 수 메타라인
 *
 * 디자인:
 *  - 클릭 가능한 button (라우팅은 부모가 onSelect로 처리)
 *  - hover 시 accent 보더 + 살짝 elevated 톤
 *  - 점수 tier는 ResultSection의 accuracy highlight 컨벤션과 동일
 */
import { useMemo } from "react";
import { cn, getScoreTier, scoreTierClasses } from "@/lib/utils";
import type { HistorySession } from "@/types/history";

interface SessionCardProps {
  session: HistorySession;
  onSelect: (sessionId: number) => void;
}

export function SessionCard({ session, onSelect }: SessionCardProps) {
  // ── 평균 정확도 (logs가 비어있으면 null) ──────────────────
  const avgAccuracy = useMemo(() => {
    if (session.logs.length === 0) return null;
    const sum = session.logs.reduce((acc, l) => acc + l.accuracy_score, 0);
    return sum / session.logs.length;
  }, [session.logs]);

  const tier = avgAccuracy != null ? getScoreTier(avgAccuracy) : null;
  const tierCls = tier ? scoreTierClasses[tier] : null;

  // ── 표시 제목 결정 ────────────────────────────────────────
  const displayTitle = resolveTitle(session);
  const typeLabel = session.session_type === "youtube" ? "YouTube" : "Interview";

  return (
    <button
      type="button"
      onClick={() => onSelect(session.session_id)}
      className={cn(
        "group w-full text-left",
        "border border-border bg-bg-elevated rounded-xl p-5",
        "hover:border-accent/60 hover:bg-bg-subtle",
        "transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      )}
      aria-label={`${typeLabel} 세션, ${formatDate(session.created_at)} ${
        avgAccuracy != null ? `· 평균 정확도 ${Math.round(avgAccuracy)}점` : ""
      }`}
    >
      {/* ── 헤더 라인: 타입 배지 + 날짜 + 점수 ───────────── */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <TypeBadge type={session.session_type} />
          <span className="font-mono text-[11px] uppercase tracking-wider text-fg-subtle tabular-nums">
            {formatDate(session.created_at)}
          </span>
        </div>

        {avgAccuracy != null && tierCls ? (
          <div className="shrink-0 text-right">
            <p className="font-mono text-[9px] uppercase tracking-wider text-fg-subtle mb-0.5">
              Accuracy
            </p>
            <p
              className={cn(
                "font-display tabular-nums text-2xl leading-none",
                tierCls.text
              )}
            >
              {Math.round(avgAccuracy)}
              <span className="text-[10px] text-fg-subtle font-mono ml-0.5">
                /100
              </span>
            </p>
          </div>
        ) : (
          <p className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-fg-subtle">
            no answer
          </p>
        )}
      </div>

      {/* ── 본문: 제목 ─────────────────────────────────── */}
      <h3 className="font-display text-lg leading-snug text-fg group-hover:text-accent transition-colors mb-3 line-clamp-2">
        {displayTitle}
      </h3>

      {/* ── 메타라인 ──────────────────────────────────── */}
      <div className="flex items-center gap-4 text-[11px] font-mono uppercase tracking-wider text-fg-subtle">
        <span>
          Q{" "}
          <span className="tabular-nums text-fg-muted">
            {session.questions.length}
          </span>
        </span>
        <span>
          A{" "}
          <span className="tabular-nums text-fg-muted">
            {session.logs.length}
          </span>
        </span>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// 타입 배지
// ─────────────────────────────────────────────────────────────
function TypeBadge({ type }: { type: HistorySession["session_type"] }) {
  const isYoutube = type === "youtube";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm",
        "font-mono text-[10px] uppercase tracking-wider",
        isYoutube
          ? "bg-accent/15 text-accent border border-accent/30"
          : "bg-bg-subtle text-fg-muted border border-border-strong"
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          isYoutube ? "bg-accent" : "bg-fg-muted"
        )}
      />
      {isYoutube ? "YouTube" : "Interview"}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// 제목 폴백 결정
// ─────────────────────────────────────────────────────────────
function resolveTitle(s: HistorySession): string {
  if (s.title && s.title.trim()) return s.title;

  // YouTube면 source_url에서 호스트 일부라도 보여주기
  if (s.session_type === "youtube" && s.source_url) {
    try {
      const u = new URL(s.source_url);
      return `YouTube · ${u.hostname.replace(/^www\./, "")}`;
    } catch {
      return "YouTube 연습";
    }
  }

  return s.session_type === "youtube" ? "YouTube 연습" : "AI 면접";
}

// ─────────────────────────────────────────────────────────────
// 날짜 포맷터 (같은 해 → 월/일/시각, 다른 해 → YYYY.MM.DD)
// ─────────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();

  if (sameYear) {
    return new Intl.DateTimeFormat("ko-KR", {
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(d)
    .replace(/\.\s?/g, ".")
    .replace(/\.$/, "");
}