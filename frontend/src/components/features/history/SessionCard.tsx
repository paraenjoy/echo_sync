/**
 * SessionCard — 세션 1건 미리보기
 *
 * 표시:
 *  - 좌측 상단: 세션 타입 배지 (YouTube / Interview) + 날짜
 *  - 우측 상단: 평균 정확도 (accuracy_score 평균, tier 색상)
 *  - 본문: 제목 (없으면 source_url 또는 타입별 폴백)
 *  - 하단: 질문 수 · 답변 수 메타라인 + 삭제 버튼(우측)
 *
 * 구조 메모 (Step 10-D2):
 *  - 카드 전체를 button → `div role="button"` 패턴으로 전환했다.
 *    카드 안에 진짜 <button>(삭제)이 들어가면서 button-in-button HTML 위반을
 *    피하기 위함이다. 키보드 접근성(Enter/Space)은 onKeyDown으로 직접 처리,
 *    focus-visible ring과 cursor는 기존 button과 동일한 시각 경험을 유지한다.
 *  - 삭제 버튼은 메타라인 오른쪽에 배치 → 점수 배지(헤더 우측)와 시각 분리.
 *    부모(HistoryPage)에서 onDelete 미주입 시 버튼 자체가 렌더되지 않으므로
 *    상세 페이지나 다른 사용처에서는 부수효과 없이 비활성된다.
 *
 * 디자인:
 *  - hover 시 accent 보더 + 살짝 elevated 톤
 *  - 점수 tier는 ResultSection의 accuracy highlight 컨벤션과 동일
 *  - 삭제 버튼 hover는 score-low 톤(소거/위험 신호)
 */
import { useMemo, type KeyboardEvent, type MouseEvent } from "react";
import { cn, getScoreTier, scoreTierClasses } from "@/lib/utils";
import type { HistorySession } from "@/types/history";

interface SessionCardProps {
  session: HistorySession;
  onSelect: (sessionId: number) => void;
  /**
   * 삭제 버튼 클릭 시 호출 (Step 10-D2 / feedback.md 2순위).
   * 생략하면 삭제 버튼이 렌더되지 않는다.
   * 컨펌 팝업/호출 자체는 호출 측(HistoryPage)이 담당한다.
   */
  onDelete?: (sessionId: number) => void;
  /**
   * 이 카드가 삭제 mutation 진행 중일 때 true.
   * 카드 전체 인터랙션을 잠그고 시각적으로 흐리게 처리한다.
   */
  isDeleting?: boolean;
}

export function SessionCard({
  session,
  onSelect,
  onDelete,
  isDeleting = false,
}: SessionCardProps) {
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
  const typeLabel =
    session.session_type === "youtube" ? "YouTube" : "Interview";

  // ── 카드 활성화 (클릭/Enter/Space) ─────────────────────────
  const handleActivate = () => {
    if (isDeleting) return;
    onSelect(session.session_id);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isDeleting) return;
    // 표준 button 동작과 동일: Enter / Space로 활성화
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(session.session_id);
    }
  };

  // ── 삭제 버튼 핸들러 (카드 활성화로 버블링 방지) ──────────
  const handleDeleteClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (isDeleting || !onDelete) return;
    onDelete(session.session_id);
  };

  return (
    <div
      role="button"
      tabIndex={isDeleting ? -1 : 0}
      onClick={handleActivate}
      onKeyDown={handleKeyDown}
      aria-label={`${typeLabel} 세션, ${formatDate(session.created_at)} ${
        avgAccuracy != null
          ? `· 평균 정확도 ${Math.round(avgAccuracy)}점`
          : ""
      }`}
      aria-disabled={isDeleting || undefined}
      aria-busy={isDeleting || undefined}
      className={cn(
        "group w-full text-left cursor-pointer select-none",
        "border border-border bg-bg-elevated rounded-xl p-5",
        "hover:border-accent/60 hover:bg-bg-subtle",
        "transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        isDeleting && "opacity-60 pointer-events-none"
      )}
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

      {/* ── 메타라인 (좌: Q/A 카운트, 우: 삭제 버튼) ─────── */}
      <div className="flex items-center justify-between gap-4">
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

        {/* 삭제 진입점 — onDelete가 주입된 사용처에서만 렌더 */}
        {onDelete && (
          <button
            type="button"
            onClick={handleDeleteClick}
            disabled={isDeleting}
            aria-label="이 세션 삭제"
            className={cn(
              "inline-flex items-center justify-center h-7 w-7 rounded-md",
              "text-fg-subtle hover:text-score-low hover:bg-score-low/10",
              "transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-score-low/50",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <TrashIcon />
          </button>
        )}
      </div>
    </div>
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
// 휴지통 아이콘 (인라인 SVG)
// ─────────────────────────────────────────────────────────────
function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.5 4h11" />
      <path d="M5.5 4V2.5h5V4" />
      <path d="M4 4l.5 8.5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1L12 4" />
      <path d="M6.5 7v4" />
      <path d="M9.5 7v4" />
    </svg>
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
