/**
 * 테마 스토어 (Zustand + persist)
 *
 * 책임:
 *  - 'light' | 'dark' 2상태를 클라이언트 상태로 관리
 *  - localStorage에 persist하여 새로고침 시에도 유지
 *  - 액션이 호출되는 즉시 <html data-theme="..."> 속성과
 *    <meta name="theme-color"> 메타 태그에 함께 반영
 *
 * authStore와의 관계:
 *  - 인증 상태와 테마는 완전히 독립적인 클라이언트 상태이므로 분리
 *  - 동일한 패턴(persist + partialize + getState 헬퍼)을 따라 일관성 유지
 *
 * DOM 동기화 책임:
 *  - 액션(setTheme/toggleTheme) 내부에서 applyThemeToDOM을 직접 호출
 *  - 이렇게 하면 sync 훅이 마운트되지 않은 컨텍스트(예: 비동기 콜백,
 *    인터셉터)에서도 setTheme만 호출하면 DOM이 안전하게 갱신됨
 *  - 리하이드레이션 시점에도 onRehydrateStorage에서 한 번 더 적용
 *
 * FOUC(Flash of Unstyled Content) 방지:
 *  - 이 스토어가 React 트리에 마운트되기 전에 index.html의 inline 스크립트가
 *    먼저 동일한 localStorage 키를 읽어 data-theme + theme-color를 선반영함
 *  - 그 후 리하이드레이션 단계에서 다시 한 번 동기화되므로 시점 차이로 인한
 *    깜빡임이 발생하지 않음
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { THEME_STORAGE_KEY } from "@/lib/constants";

export type Theme = "light" | "dark";

/** 기본 테마 — 기존 디자인 시스템 베이스라인이 다크였으므로 다크 유지 */
const DEFAULT_THEME: Theme = "dark";

/**
 * 모바일 브라우저 상단 바(theme-color)에 적용할 색상.
 * - bg 토큰과 정확히 일치 (index.css의 :root / :root[data-theme="light"])
 * - FOUC 방지용 index.html inline 스크립트도 같은 매핑을 하드코딩하므로
 *   값이 바뀌면 index.html도 함께 수정해야 함
 */
const THEME_COLOR_MAP: Record<Theme, string> = {
  dark: "#0F0E0C",
  light: "#FAF7F2",
};

/**
 * DOM(<html>)에 data-theme 속성과 theme-color 메타를 적용하는 순수 헬퍼.
 *
 * - 스토어 액션, 리하이드레이션 콜백, FOUC 방지 inline 스크립트, 멀티탭 sync 훅이
 *   모두 동일한 결과(html data-theme + meta theme-color)에 수렴한다.
 * - SSR 환경에서 document가 없는 경우를 방어 (현재는 Vite CSR이지만
 *   향후 SSR/SSG 전환 가능성 대비).
 */
export function applyThemeToDOM(theme: Theme): void {
  if (typeof document === "undefined") return;

  document.documentElement.setAttribute("data-theme", theme);

  // 모바일 Safari/Chrome address bar 컬러 동기화
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]'
  );
  if (meta) {
    meta.setAttribute("content", THEME_COLOR_MAP[theme]);
  }
}

interface ThemeState {
  theme: Theme;

  // 액션
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: DEFAULT_THEME,

      setTheme: (theme) => {
        // 1) DOM을 먼저 갱신 — UI 반응이 React 리렌더보다 빠름
        applyThemeToDOM(theme);
        // 2) 상태 업데이트 → 구독 중인 컴포넌트(토글 아이콘 등)가 리렌더
        set({ theme });
      },

      toggleTheme: () => {
        const next: Theme = get().theme === "dark" ? "light" : "dark";
        // 단일 진입점인 setTheme을 재사용 — DOM 동기화 로직이 한 곳에 모임
        get().setTheme(next);
      },
    }),
    {
      name: THEME_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // 메서드는 직렬화에서 제외, 상태만 저장
      partialize: (state) => ({
        theme: state.theme,
      }),
      /**
       * 리하이드레이션 직후 DOM 재동기화.
       *
       * 보통은 inline 스크립트가 이미 같은 값을 적용해두었으므로 NO-OP에 가깝지만,
       * 다음 케이스에서 안전망 역할:
       *  - inline 스크립트가 어떤 이유로 실패했을 때
       *  - 다른 탭에서 변경된 값이 storage event를 통해 들어왔을 때
       *  - DevTools에서 localStorage를 수동으로 편집한 직후
       */
      onRehydrateStorage: () => (state) => {
        if (state?.theme) {
          applyThemeToDOM(state.theme);
        }
      },
    }
  )
);

/**
 * React 컴포넌트 외부(예: 유틸 함수, 비동기 콜백)에서 현재 테마를 읽기 위한 헬퍼.
 * - authStore의 getAuthToken과 동일한 패턴
 */
export const getTheme = (): Theme => useThemeStore.getState().theme;