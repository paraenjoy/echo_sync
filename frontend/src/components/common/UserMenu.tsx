/**
 * UserMenu — 헤더 우측 사용자 메뉴 드롭다운 (Step 8.4)
 *
 * 배경 (feedback.md 1순위 "로그아웃 기능 부재"):
 *  - 로그인 후 로그아웃 동선이 전혀 없어 세션을 끊을 방법이 없었다.
 *  - Dashboard(/) 헤더에 배치해 사용자 식별 + 로그아웃 진입점을 제공한다.
 *
 * 책임:
 *  - 아바타(닉네임/이메일 첫 글자) 트리거 → 드롭다운 토글
 *  - 드롭다운에 현재 사용자 식별(닉네임/이메일) + 로그아웃 항목
 *  - 로그아웃: authStore.clearAuth() → navigate("/auth", { replace: true })
 *    · clearAuth로 토큰을 비우면 ProtectedRoute가 어차피 /auth로 보내지만,
 *      즉각적인 SPA 전환을 위해 navigate도 명시한다.
 *
 * 상태 분리 (HANDOFF):
 *  - 사용자/토큰은 Zustand(authStore)에서 직접 구독. React Query는 관여하지 않는다.
 *
 * 디자인 (DESIGN_SYSTEM):
 *  - 의미 토큰만 사용. 아바타는 원형 요소이므로 rounded-full 예외 허용.
 *  - 외부 아이콘 라이브러리 없이 인라인 SVG(currentColor).
 *  - 드롭다운은 right-0 정렬(좁은 화면에서 오른쪽 오버플로 방지).
 *
 * 접근성:
 *  - 트리거: aria-haspopup="menu" + aria-expanded
 *  - 패널: role="menu", 항목 role="menuitem"
 *  - 바깥 클릭(mousedown) / Escape 로 닫힘
 *
 * 배치 주의 (배선 단계):
 *  - 전역 ThemeToggle이 fixed top-4 right-4(z-50)에 떠 있으므로,
 *    좁은 화면에서 겹치지 않도록 부모에서 우측 여백을 확보해 배치한다(8.2 교훈).
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { cn } from "@/lib/utils";

export interface UserMenuProps {
  /** 컨테이너 추가 클래스 (배치 조정용). */
  className?: string;
}

export function UserMenu({ className }: UserMenuProps) {
  const navigate = useNavigate();
  // 클라이언트 상태만 구독 — user 변화 시에만 재렌더
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 표시명: Dashboard와 동일 폴백 규칙
  const displayName =
    user?.nickname?.trim() || user?.email?.split("@")[0] || "사용자";
  const initial = displayName.charAt(0).toUpperCase();

  // ── 바깥 클릭 / Escape 로 닫기 ─────────────────────────────
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // ── 로그아웃 ───────────────────────────────────────────────
  const handleLogout = () => {
    setOpen(false);
    clearAuth(); // 토큰/사용자 클리어 (persist도 함께 비워짐)
    navigate("/auth", { replace: true });
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* 트리거: 아바타 + 이름 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="사용자 메뉴 열기"
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border border-border bg-bg-elevated",
          "pl-1.5 pr-2.5 py-1.5 text-sm text-fg",
          "hover:border-border-strong transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        )}
      >
        <span
          aria-hidden
          className="grid h-7 w-7 place-items-center rounded-full bg-bg-subtle text-xs font-mono text-fg"
        >
          {initial}
        </span>
        <span className="max-w-[10rem] truncate font-mono text-xs tracking-wide">
          {displayName}
        </span>
        <ChevronIcon open={open} />
      </button>

      {/* 드롭다운 패널 */}
      {open && (
        <div
          role="menu"
          aria-label="사용자 메뉴"
          className={cn(
            "absolute right-0 mt-2 w-56 z-50 origin-top-right",
            "rounded-lg border border-border bg-bg-elevated shadow-lg",
            "p-1.5 animate-fade-up"
          )}
        >
          {/* 사용자 식별 헤더 */}
          <div className="px-2.5 py-2">
            <p className="text-sm text-fg truncate">{displayName}</p>
            {user?.email && (
              <p className="font-mono text-[11px] text-fg-subtle truncate">
                {user.email}
              </p>
            )}
          </div>

          <div className="my-1 h-px bg-border" role="separator" />

          {/* 로그아웃 */}
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm",
              "text-fg hover:bg-bg-subtle transition-colors",
              "focus:outline-none focus-visible:bg-bg-subtle"
            )}
          >
            <LogoutIcon />
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}

/** 트리거 우측 셰브론 — 열림 상태에 따라 회전 */
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn(
        "text-fg-subtle transition-transform",
        open && "rotate-180"
      )}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** 로그아웃 아이콘 (문 + 화살표) */
function LogoutIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="text-fg-muted"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}
