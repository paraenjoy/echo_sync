/**
 * PageHeader — 페이지 상단 공용 네비게이션 (브레드크럼 + 홈 복귀)
 *
 * 배경 (Step 8.3 — feedback.md 1순위 "네비게이션 dead-end 방지"):
 *  - HistoryPage(목록)에는 홈(`/` Dashboard) 복귀 경로가 없었다.
 *  - HistoryDetailPage(상세)의 BackButton은 `/history`로만 돌아가 홈 직접 복귀가 불가했다.
 *  - 각 페이지에 흩어져 있던 nav UI를 이 컴포넌트로 공용화한다.
 *
 * 책임:
 *  - 의미적 브레드크럼(`<nav><ol>`)을 렌더링한다.
 *  - 항상 맨 앞에 홈(`/`) 크럼을 자동 prepend → "홈 복귀" 경로를 구조적으로 보장.
 *    (includeHome={false}로 끌 수 있으나 기본 동작은 항상 홈 노출)
 *  - 링크가 있는 크럼(`to` 지정)은 React Router `<Link>`, 마지막(현재 위치) 크럼은
 *    링크 없는 평문 + `aria-current="page"`.
 *
 * 디자인 (DESIGN_SYSTEM.md):
 *  - eyebrow 톤: font-mono + uppercase tracking, 의미 토큰만 사용(헥스 금지).
 *  - 링크 hover는 기존 BackButton 패턴(`text-fg-muted → hover:text-fg transition-colors`) 계승.
 *    산만한 hover 효과는 추가하지 않는다.
 *  - 진입 시 `animate-fade-up` (페이지 stagger의 첫 요소로 자연스럽게 합류).
 *  - 우상단 고정 ThemeToggle(App.tsx, top-4 right-4)과 좌측 정렬이라 겹치지 않는다.
 *
 * 사용 예:
 *   // HistoryPage (목록) — 홈 / 히스토리(현재)
 *   <PageHeader crumbs={[{ label: "히스토리" }]} />
 *
 *   // HistoryDetailPage (상세) — 홈 / 히스토리(링크) / 세션 상세(현재)
 *   <PageHeader
 *     crumbs={[
 *       { label: "히스토리", to: "/history" },
 *       { label: "세션 상세" },
 *     ]}
 *   />
 */
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/** 브레드크럼 한 칸. `to`가 없으면 현재 위치(링크 없음, aria-current)로 간주한다. */
export interface Crumb {
  label: string;
  /** 클릭 시 이동할 경로. 생략 시 현재 페이지로 처리되어 링크가 비활성. */
  to?: string;
}

export interface PageHeaderProps {
  /** 홈 다음에 이어지는 크럼 목록 (마지막 항목 = 현재 페이지). */
  crumbs: Crumb[];
  /** 홈 크럼 자동 prepend 여부 (기본 true). */
  includeHome?: boolean;
  /** 홈 경로 (기본 "/" = Dashboard). */
  homeTo?: string;
  /** 컨테이너 추가 클래스 (간격 조정 등). */
  className?: string;
}

export function PageHeader({
  crumbs,
  includeHome = true,
  homeTo = "/",
  className,
}: PageHeaderProps) {
  // 홈을 맨 앞에 합친 단일 배열로 정규화한다.
  // 홈 크럼은 아이콘으로 표현하므로 label 대신 isHome 플래그로 구분.
  const trail: Array<Crumb & { isHome?: boolean }> = includeHome
    ? [{ label: "홈", to: homeTo, isHome: true }, ...crumbs]
    : crumbs;

  return (
    <nav
      aria-label="브레드크럼"
      className={cn("animate-fade-up", className)}
    >
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs uppercase tracking-[0.14em]">
        {trail.map((crumb, i) => {
          const isLast = i === trail.length - 1;
          // 링크 조건: to가 있고 + 현재 위치(마지막)가 아님.
          const isLink = !!crumb.to && !isLast;

          return (
            <li key={`${crumb.label}-${i}`} className="flex items-center gap-x-2">
              {i > 0 && (
                <span aria-hidden className="text-fg-subtle select-none">
                  /
                </span>
              )}

              {isLink ? (
                <Link
                  to={crumb.to!}
                  className="inline-flex items-center gap-1.5 text-fg-muted hover:text-fg transition-colors"
                >
                  {crumb.isHome ? (
                    <HomeIcon />
                  ) : (
                    crumb.label
                  )}
                  {crumb.isHome && <span className="sr-only">{crumb.label}</span>}
                </Link>
              ) : (
                // 현재 위치(또는 to 없는 평문). 마지막 크럼은 강조 색(fg)으로 위치를 명확히.
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5",
                    isLast ? "text-fg" : "text-fg-muted"
                  )}
                >
                  {crumb.isHome ? <HomeIcon /> : crumb.label}
                  {crumb.isHome && (
                    <span className="sr-only">{crumb.label}</span>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * 홈 아이콘 — 외부 아이콘 라이브러리 의존 없이 인라인 SVG.
 * currentColor를 사용해 부모의 텍스트 색 토큰(fg-muted/fg)을 그대로 상속한다.
 */
function HomeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="-mt-px"
    >
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
    </svg>
  );
}
