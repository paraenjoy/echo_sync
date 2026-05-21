/**
 * 환경 변수 중앙 관리
 * - Vite는 import.meta.env로 환경 변수를 노출 (VITE_ 접두사 필수)
 * - .env.example을 참고해 .env.local에 실제 값 입력
 */

// HTTP API 베이스 URL (예: http://127.0.0.1:8000)
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

// WebSocket 베이스 URL (HTTPS 환경에서는 wss:// 자동 전환)
// API_BASE_URL의 프로토콜을 기반으로 ws/wss를 자동 선택
const apiUrl = new URL(API_BASE_URL);
const wsProtocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
export const WS_BASE_URL = `${wsProtocol}//${apiUrl.host}`;

// ─── 로컬스토리지 키 (Zustand persist용) ──────────────────────
// 기존 인증용 키와 동일한 "sync-xxx-storage" 네이밍 컨벤션을 따른다.
// FOUC 방지용 inline 스크립트(index.html)도 이 키를 직접 참조하므로
// 값을 바꾸면 반드시 index.html도 함께 수정해야 한다.
export const AUTH_STORAGE_KEY = "sync-auth-storage";
export const THEME_STORAGE_KEY = "sync-theme-storage";

// 오디오 스트리밍 설정 (백엔드 Azure SDK 요구사항과 일치)
export const AUDIO_CONFIG = {
  SAMPLE_RATE: 16000,
  BITS_PER_SAMPLE: 16,
  CHANNELS: 1,
  BUFFER_SIZE: 2048, // ScriptProcessor 버퍼 사이즈
} as const;

// React Query 기본 설정
export const QUERY_CONFIG = {
  STALE_TIME: 1000 * 60 * 5, // 5분
  GC_TIME: 1000 * 60 * 10, // 10분 (구 cacheTime)
  RETRY_COUNT: 1,
} as const;

// 페이지네이션 기본값 (히스토리)
export const PAGINATION = {
  DEFAULT_LIMIT: 10,
  DEFAULT_OFFSET: 0,
} as const;