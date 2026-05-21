/**
 * useThemeSync — 멀티 탭 간 테마 동기화 훅
 *
 * 동기:
 *  - 사용자가 어떤 탭에서 테마를 토글하면 같은 origin의 다른 탭들도 즉시 따라가야
 *    "어, 새로고침하니까 뜬금없이 라이트가 됐네?"라는 위화감이 없다.
 *  - Zustand persist는 storage 이벤트를 자동 구독하지 않으므로 명시적으로 처리.
 *
 * 동작:
 *  - 'storage' 이벤트(다른 탭에서 localStorage 변경 시 발생)를 듣고
 *    THEME_STORAGE_KEY가 변경된 경우에만 반응.
 *  - 스토어의 setTheme 액션을 거치지 않고 setState + applyThemeToDOM을 직접 호출 →
 *    persist가 동일 값을 또 한 번 쓰는 잠재적 루프를 차단.
 *
 * 마운트 위치:
 *  - App 트리에서 단 한 번 호출 (현재는 App.tsx — Step 5에서 통합 예정)
 *  - StrictMode의 dev-time 이중 호출에 안전하도록 cleanup 보장.
 */
import { useEffect } from "react";
import { THEME_STORAGE_KEY } from "@/lib/constants";
import {
  applyThemeToDOM,
  useThemeStore,
  type Theme,
} from "@/store/themeStore";

export function useThemeSync(): void {
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      // 우리 키가 아니거나, 다른 탭에서 키가 삭제된 경우(newValue=null)는 무시
      if (e.key !== THEME_STORAGE_KEY || !e.newValue) return;

      try {
        const parsed = JSON.parse(e.newValue) as {
          state?: { theme?: unknown };
        };
        const next = parsed?.state?.theme;

        // 런타임 타입 가드 — 외부 입력은 신뢰하지 않는다
        if (next !== "light" && next !== "dark") return;

        const nextTheme = next as Theme;

        // 현재 값과 같으면 불필요한 리렌더 회피
        if (useThemeStore.getState().theme === nextTheme) return;

        // setTheme(액션)이 아닌 setState + applyThemeToDOM 직접 호출:
        //  - 액션은 persist write back을 트리거하므로 storage event 루프 가능성 ↑
        //  - 우리는 이미 다른 탭이 쓴 값을 그대로 반영하는 것이므로 write가 불필요
        useThemeStore.setState({ theme: nextTheme });
        applyThemeToDOM(nextTheme);
      } catch {
        /* 다른 탭의 손상된 데이터를 우리가 떠안지 않도록 무시 */
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);
}