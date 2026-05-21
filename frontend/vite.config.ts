import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

// Vite 설정
// - "@/..." → "src/..." 경로 별칭 (tsconfig와 일치)
// - PWA 플러그인 (manifest는 Step 6에서 채워짐, 우선 자동생성으로 두기)
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Step 6에서 상세화 예정
      manifest: {
        name: "EchoSync",
        short_name: "EchoSync",
        theme_color: "#0F0E0C",
        background_color: "#0F0E0C",
        display: "standalone",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: true, // 모바일 디바이스에서 같은 네트워크로 접속 가능 (PWA 테스트용)
  },
});