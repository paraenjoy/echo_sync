/**
 * HistoryPage (/history) — Step 5 정식 구현
 *
 * 책임:
 *  - useHistory(useInfiniteQuery)로 세션 목록 페이지네이션
 *  - IntersectionObserver로 마지막 카드 가시화 시 fetchNextPage 호출
 *  - 카드 클릭 → /history/:id (5.4에서 라우트 추가 예정)
 *
 * 무한 스크롤 패턴:
 *  - callback ref 방식으로 "마지막 카드"에 직접 observer를 부착한다.
 *    (별도 sentinel div를 두는 방식보다, 실제 카드가 보이면 자연스럽게 트리거되어 UX 매끄러움)
 *  - hasNextPage && !isFetchingNextPage 가드로 중복 호출 차단
 *
 * 상태:
 *  - 빈 목록 (첫 진입 사용자) → 안내 + 첫 연습 CTA
 *  - 로딩(initial) → 스켈레톤 카드
 *  - 추가 로딩(scroll) → 하단 로더
 *  - 에러 → 인라인 박스 + 재시도 버튼
 */
import { useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useHistory } from "@/hooks/queries/useHistory";
import { SessionCard } from "@/components/features/history/SessionCard";
import { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function HistoryPage() {
  const navigate = useNavigate();
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    isError,
    error,
    refetch,
    isRefetching,
  } = useHistory();

  // 모든 페이지의 세션을 평탄화
  const sessions = data?.pages.flatMap((p) => p.sessions) ?? [];

  // ── IntersectionObserver: 마지막 카드 가시화 → 다음 페이지 ─
  // callback ref 형태로 작성해 리스트가 갱신될 때마다 자동으로 재부착된다.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const lastCardRef = useCallback(
    (node: HTMLLIElement | null) => {
      if (isFetchingNextPage) return;
      if (observerRef.current) observerRef.current.disconnect();
      if (!node) return;

      observerRef.current = new IntersectionObserver(
        (entries) => {
          const [entry] = entries;
          if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
          }
        },
        // 마지막 카드의 25%만 보여도 prefetch 시작 (스크롤 멈춤 방지)
        { rootMargin: "0px 0px 25% 0px" }
      );
      observerRef.current.observe(node);
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage]
  );

  // ── 카드 선택 → 상세 페이지 ────────────────────────────────
  // TODO (5.4): /history/:id 라우트가 추가되면 그대로 동작한다.
  //  - 캐시 활용을 위해 state로 session을 함께 넘기는 방식도 고려 가능
  const handleSelect = (sessionId: number) => {
    navigate(`/history/${sessionId}`);
  };

  return (
    <main className="min-h-dvh bg-bg text-fg">
      <div className="mx-auto max-w-3xl px-6 pt-20 pb-24">
        {/* ── 헤더 ─────────────────────────────────────────── */}
        <header className="mb-12 flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-subtle mb-4">
              History
            </p>
            <h1 className="font-display text-5xl leading-[1.05] mb-4">
              지금까지의 <span className="italic text-accent">연습들</span>
            </h1>
            <p className="text-fg-muted text-lg leading-relaxed">
              과거 세션을 다시 열어보고, 점수 변화를 확인해보세요.
            </p>
          </div>
        </header>

        {/* ── 본문 분기 ────────────────────────────────────── */}
        {isPending ? (
          <SessionListSkeleton />
        ) : isError ? (
          <ErrorBlock
            message={getErrorMessage(error)}
            onRetry={() => refetch()}
            retrying={isRefetching}
          />
        ) : sessions.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <ul className="space-y-3">
              {sessions.map((s, idx) => {
                const isLast = idx === sessions.length - 1;
                return (
                  <li
                    key={s.session_id}
                    ref={isLast ? lastCardRef : undefined}
                  >
                    <SessionCard session={s} onSelect={handleSelect} />
                  </li>
                );
              })}
            </ul>

            {/* ── 페이지네이션 푸터 ───────────────────────── */}
            <div className="mt-6 grid place-items-center min-h-[60px]">
              {isFetchingNextPage ? (
                <NextPageLoader />
              ) : hasNextPage ? (
                // observer가 작동하지 않는 환경(키보드 사용, 짧은 리스트 등)을 위한 fallback 버튼
                <button
                  type="button"
                  onClick={() => fetchNextPage()}
                  className="text-xs font-mono uppercase tracking-wider text-fg-subtle hover:text-accent transition-colors"
                >
                  더 불러오기
                </button>
              ) : (
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-fg-subtle">
                  · 끝 ·
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────
// 초기 로딩 스켈레톤 — 카드 4개 분량
// ─────────────────────────────────────────────────────────────
function SessionListSkeleton() {
  return (
    <ul className="space-y-3" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <li
          key={i}
          className="border border-border rounded-xl bg-bg-elevated p-5 space-y-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-5 w-20 rounded-sm animate-shimmer" />
              <div className="h-3 w-28 rounded-sm animate-shimmer" />
            </div>
            <div className="space-y-1.5">
              <div className="h-2 w-12 rounded-sm animate-shimmer" />
              <div className="h-6 w-16 rounded-md animate-shimmer" />
            </div>
          </div>
          <div className="h-5 w-3/4 rounded-sm animate-shimmer" />
          <div className="flex gap-4">
            <div className="h-3 w-12 rounded-sm animate-shimmer" />
            <div className="h-3 w-12 rounded-sm animate-shimmer" />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────
// 다음 페이지 로딩 인디케이터 (인라인, 작게)
// ─────────────────────────────────────────────────────────────
function NextPageLoader() {
  return (
    <div className="flex items-center gap-2.5 text-fg-subtle">
      <span className="inline-block h-3 w-3 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
      <span className="text-[11px] font-mono uppercase tracking-wider">
        Loading more
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 빈 상태 — 첫 진입 사용자용
// ─────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="rounded-xl border border-border bg-bg-elevated p-10 text-center animate-fade-up">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-subtle mb-3">
        Empty
      </p>
      <h3 className="font-display text-2xl leading-tight mb-3">
        아직 <span className="italic text-accent">기록</span>이 없어요
      </h3>
      <p className="text-fg-muted text-sm leading-relaxed mb-7 max-w-md mx-auto">
        첫 연습을 마치면 이곳에 세션이 차곡차곡 쌓여요. 영상으로 시작해볼까요?
      </p>
      <div className="flex justify-center gap-3 flex-wrap">
        <Link
          to="/youtube"
          className="px-5 py-2.5 rounded-md bg-accent text-accent-fg text-sm hover:bg-accent-hover transition-colors"
        >
          YouTube 연습 시작
        </Link>
        <Link
          to="/interview/setup"
          className="px-5 py-2.5 rounded-md border border-border-strong text-fg text-sm hover:border-accent hover:text-accent transition-colors"
        >
          AI 면접 시작
        </Link>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 에러 블록 (인라인 + 재시도)
// ─────────────────────────────────────────────────────────────
function ErrorBlock({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div className="p-5 rounded-xl bg-score-low/10 border border-score-low/30 animate-fade-up">
      <p className="font-mono text-[10px] uppercase tracking-wider text-score-low mb-2">
        Error
      </p>
      <p className="text-sm text-fg mb-4 leading-relaxed">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className={cn(
          "text-xs font-mono uppercase tracking-wider",
          "text-fg-muted hover:text-fg transition-colors",
          "disabled:opacity-50 disabled:cursor-not-allowed"
        )}
      >
        {retrying ? "다시 불러오는 중…" : "재시도"}
      </button>
    </div>
  );
}