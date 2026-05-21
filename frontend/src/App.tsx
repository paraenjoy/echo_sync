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
 *  - catch-all:  → /  (간단한 fallback, 별도 404 페이지는 생략)
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
  return (
    <Suspense fallback={<RouteFallback />}>
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
