/**
 * 인증 스토어 (Zustand + persist)
 *
 * 책임:
 *  - JWT 토큰과 사용자 정보를 클라이언트 상태로 관리
 *  - localStorage에 persist하여 새로고침 시 세션 유지
 *  - 토큰 만료(exp) 자동 감지
 *
 * 서버 데이터(예: /me 응답)는 React Query가 캐싱하고,
 * 이 스토어는 "로그인 여부 + 토큰"이라는 클라이언트 상태에만 집중한다.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { AUTH_STORAGE_KEY } from "@/lib/constants";
import type { User, JwtPayload } from "@/types/auth";

interface AuthState {
  token: string | null;
  user: User | null;

  // 액션
  setAuth: (token: string, user: User) => void;
  setUser: (user: User) => void;
  clearAuth: () => void;

  // 셀렉터
  isAuthenticated: () => boolean;
}

/**
 * JWT 토큰의 페이로드를 디코딩 (서명 검증은 서버에서 수행)
 * - 만료 체크 목적으로만 사용
 */
function decodeJwt(token: string): JwtPayload | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    // base64url → base64
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64);
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * 토큰이 만료되었는지 확인
 */
function isTokenExpired(token: string): boolean {
  const payload = decodeJwt(token);
  if (!payload) return true;
  // exp는 초 단위, Date.now()는 밀리초
  return payload.exp * 1000 < Date.now();
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,

      setAuth: (token, user) => set({ token, user }),

      setUser: (user) => set({ user }),

      clearAuth: () => set({ token: null, user: null }),

      isAuthenticated: () => {
        const { token } = get();
        if (!token) return false;
        // 만료 시 자동 정리
        if (isTokenExpired(token)) {
          // setState를 set 콜백 바깥에서 호출하면 무한 루프 위험 → 다음 tick으로
          queueMicrotask(() => set({ token: null, user: null }));
          return false;
        }
        return true;
      },
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // 메서드는 직렬화에서 제외하고 상태만 저장
      partialize: (state) => ({
        token: state.token,
        user: state.user,
      }),
    }
  )
);

/**
 * React 컴포넌트 외부(예: Axios 인터셉터)에서 토큰을 읽기 위한 헬퍼
 * - 훅을 호출할 수 없는 컨텍스트에서 사용
 */
export const getAuthToken = (): string | null => useAuthStore.getState().token;

export const clearAuthState = (): void => useAuthStore.getState().clearAuth();
