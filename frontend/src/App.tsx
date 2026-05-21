/**
 * App — 라우트 트리
 *
 * 구조:
 *  - 공개 라우트:  /auth
 *  - 보호 라우트 (ProtectedRoute가 가드):
 *      /                    Dashboard
 *      /youtube             YouTube Speaking Practice
 *      /interview/setup     Interview Setup
 *      /interview/room      Interview Room
 *      /history             Session History
 *      /history/:id         History Detail
 *  - catch-all:  → /  (간단한 fallback, 별도 404 페이지는 생략)
 *
 * 전역 UI (Routes와 같은 레벨):
 *  - ThemeToggle을 fixed 배치 → 모든 라우트(/auth 포함)에서 동일한 위치에 노출.
 *    페이지 컴포넌트 어디에도 토글 코드가 들어가지 않는다.
 *  - useThemeSync: 멀티 탭 동기화. App 트리에서 단 한 번 호출 (StrictMode의
 *    dev-time 이중 호출은 useEffect cleanup으로 안전).
 *
 * 코드 스플리팅:
 *  - AuthPage는 eager: 비로그인 진입 시 첫 화면이라 즉시 로드
 *  - 나머지는 lazy: 음성/PDF 등 무거운 의존성을 라우트별 청크로 분리해 초기 번들 경량화
 *  - Suspense fallback은 Editorial 톤의 미니멀한 로딩 표시
 *
 * Provider 트리는 main.tsx에서 구성된다 (QueryClient, BrowserRouter, StrictMode).
 */
import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/common/ProtectedRoute";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useThemeSync } from "@/hooks/useThemeSync";

// ── 공개 라우트 (eager) ────────────────────────────────────
import AuthPage from "@/pages/AuthPage";

// ── 보호 라우트 (lazy) ─────────────────────────────────────
// 라우트별 청크로 분리되어 초기 번들에서 제외된다
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const YoutubePage = lazy(() => import("@/pages/YoutubePage"));
const InterviewSetupPage = lazy(() => import("@/pages/InterviewSetupPage"));
const InterviewRoomPage = lazy(() => import("@/pages/InterviewRoomPage"));
const HistoryPage = lazy(() => import("@/pages/HistoryPage"));
const HistoryDetailPage = lazy(() => import("@/pages/HistoryDetailPage"));

export default function App() {
  // 멀티 탭 동기화 — 다른 탭에서 테마가 토글되면 이 탭도 따라간다.
  // 어차피 단 하나의 App 인스턴스에서만 호출되므로 전역 effect로 안전.
  useThemeSync();

  return (
    <Suspense fallback={<RouteFallback />}>
      {/*
        모든 페이지 위에 떠 있는 테마 토글.
        - Routes 바깥에 두어 라우트 전환 시에도 사라지지 않음
        - /auth(비로그인)에서도 동일하게 노출됨 (ProtectedRoute 영향 받지 않음)
        - z-50으로 일반 컨텐츠 위, 모달(z-50과 같지만 모달 진입 시 backdrop이
          위를 덮으므로 시각적으로 가려짐) 아래 정도의 우선순위 유지
      */}
      <ThemeToggle
      className="fixed top-4 right-4 z-50 shadow-sm"
      style={{ top: "max(1rem, env(safe-area-inset-top))" }}
      />

      <Routes>
        {/* 공개 */}
        <Route path="/auth" element={<AuthPage />} />

        {/* 보호 */}
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/youtube" element={<YoutubePage />} />
          <Route path="/interview/setup" element={<InterviewSetupPage />} />
          <Route path="/interview/room" element={<InterviewRoomPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/history/:id" element={<HistoryDetailPage />} />
        </Route>

        {/* fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

/**
 * 라우트 청크 로딩 중 표시되는 fallback.
 * - 페이지 전환 시에만 잠깐 보이므로 화려한 스피너 대신 미니멀 텍스트
 * - Editorial 톤 유지를 위해 font-mono + tracking 활용
 */
function RouteFallback() {
  return (
    <div className="min-h-dvh bg-bg text-fg grid place-items-center">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-subtle">
        Loading…
      </p>
    </div>
  );
}