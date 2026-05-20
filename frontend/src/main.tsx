/**
 * main.tsx — 앱 엔트리포인트
 *
 * Provider 트리 (바깥 → 안):
 *  1. StrictMode
 *       - dev 시 useEffect를 2회 호출하여 cleanup 누락을 감지한다.
 *       - useAudioStreamer는 이미 isMountedRef + cleanup으로 대응되어 있음.
 *  2. QueryClientProvider (React Query)
 *       - lib/queryClient에서 생성된 단일 인스턴스를 주입
 *       - 401/4xx 재시도 정책 등 정책이 이미 박혀 있음
 *  3. BrowserRouter (react-router-dom)
 *       - History API 기반 클라이언트 라우팅
 *       - HashRouter는 PWA의 manifest start_url과 충돌할 수 있어 BrowserRouter 사용
 *
 * PWA:
 *  - vite-plugin-pwa(vite.config.ts)가 service worker를 자동 등록한다.
 *  - 별도 등록 코드는 불필요.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import App from "./App";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found in index.html");
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
