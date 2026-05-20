/**
 * ProtectedRoute — 인증 필요 라우트 가드
 *
 * 동작:
 *  - useAuthStore의 token을 셀렉터로 구독 (변화 시 재렌더)
 *  - getState().isAuthenticated()로 만료 검증 (authStore가 자동 cleanup)
 *  - 비인증 시 /auth로 redirect (현재 경로는 location.state.from으로 보존)
 *  - 인증 시 자식 라우트 렌더링 (Outlet)
 *
 * 사용 (App.tsx):
 *   <Route element={<ProtectedRoute />}>
 *     <Route path="/" element={<DashboardPage />} />
 *     <Route path="/youtube" element={<YoutubePage />} />
 *     ...
 *   </Route>
 *
 * 추후 AuthPage가 정식 구현되면 location.state.from을 읽어
 * 로그인 성공 직후 그 경로로 navigate(from, { replace: true }) 처리한다.
 */
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";

export function ProtectedRoute() {
  const location = useLocation();

  // token만 직접 구독 — 다른 상태(user 등) 변화에 불필요하게 재렌더되지 않게
  const token = useAuthStore((s) => s.token);

  // getState()는 매 렌더마다 최신 store를 읽고, isAuthenticated가
  // 내부에서 만료된 토큰을 queueMicrotask로 자동 클리어한다.
  const isAuthValid = token
    ? useAuthStore.getState().isAuthenticated()
    : false;

  if (!isAuthValid) {
    return (
      <Navigate
        to="/auth"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  return <Outlet />;
}
