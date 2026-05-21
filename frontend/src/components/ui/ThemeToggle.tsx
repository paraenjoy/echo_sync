/**
 * ThemeToggle — 라이트/다크 테마 토글 버튼 (shadcn/ui 스타일)
 *
 * 설계:
 *  - 도메인 무관 베이스 UI이므로 components/ui/에 위치 (Button, Select와 동일 레이어)
 *  - useThemeStore를 직접 구독 — 외부에서 상태/콜백을 주입할 필요 없는 self-contained
 *  - 아이콘은 "현재 상태"를 표시 (shadcn/ui 컨벤션):
 *      · 다크 모드 → 달  (Moon)
 *      · 라이트 모드 → 해 (Sun)
 *    "다음에 무엇으로 바뀌는지"는 aria-label과 title tooltip이 담당.
 *  - 두 SVG가 같은 자리에 절대 위치로 겹쳐 있고 opacity/rotate/scale을 보간 →
 *    "회전하며 바뀌는" 미세한 모션이 Editorial 톤과 어울린다.
 *
 * 접근성:
 *  - role="switch" + aria-checked → 스크린리더에 토글 상태 전달
 *  - aria-label은 "다음 동작"을 서술 (예: 다크 모드 중일 때는 "라이트 모드로 전환")
 *  - index.css의 전역 :focus-visible 규칙이 accent ring 자동 적용
 *
 * Props 시그니처:
 *  - Button.tsx와 정확히 동일한 패턴 — 베이스 button 속성을 그대로 확장
 *  - {...props}는 ref 바로 다음에 spread하여, type/onClick/role 등 우리가 명시한
 *    속성이 항상 최종값을 가진다 (JSX는 뒤에 오는 prop이 이긴다)
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/store/themeStore";

export interface ThemeToggleProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

export const ThemeToggle = React.forwardRef<HTMLButtonElement, ThemeToggleProps>(
  ({ className, ...props }, ref) => {
    // 스토어 셀렉터 분리 — 다른 상태 변화에 불필요하게 리렌더되지 않게
    const theme = useThemeStore((s) => s.theme);
    const toggleTheme = useThemeStore((s) => s.toggleTheme);

    const isDark = theme === "dark";

    // aria-label / title은 "다음 동작"을 서술 → 사용자에게 클릭 결과를 미리 알려줌
    const nextLabel = isDark ? "라이트 모드로 전환" : "다크 모드로 전환";

    return (
      <button
        ref={ref}
        {...props}
        type="button"
        role="switch"
        aria-checked={isDark}
        aria-label={nextLabel}
        title={nextLabel}
        onClick={toggleTheme}
        className={cn(
          // 레이아웃: 아이콘 2개가 absolute로 겹치므로 relative 컨테이너 필요
          "relative inline-flex items-center justify-center",
          "h-10 w-10 rounded-md",
          // 디자인 토큰: Button의 secondary variant와 같은 결
          "bg-bg-elevated text-fg border border-border",
          "hover:bg-bg-subtle hover:border-border-strong hover:text-accent",
          "transition-colors",
          // 비활성/포커스는 전역 규칙이 처리
          "disabled:cursor-not-allowed disabled:opacity-60",
          className
        )}
      >
        {/* Sun — 라이트 모드일 때 visible */}
        <IconSun
          className={cn(
            "absolute transition-all duration-300 ease-out",
            isDark
              ? "opacity-0 -rotate-90 scale-50"
              : "opacity-100 rotate-0 scale-100"
          )}
        />

        {/* Moon — 다크 모드일 때 visible */}
        <IconMoon
          className={cn(
            "absolute transition-all duration-300 ease-out",
            isDark
              ? "opacity-100 rotate-0 scale-100"
              : "opacity-0 rotate-90 scale-50"
          )}
        />
      </button>
    );
  }
);
ThemeToggle.displayName = "ThemeToggle";

/* ─── 아이콘 (의존성 없이 인라인 SVG, MicButton/Select 패턴과 동일) ─── */

function IconSun({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </svg>
  );
}

function IconMoon({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}