/**
 * Axios 클라이언트 (인터셉터 포함)
 *
 * 기능:
 *  1) 요청 인터셉터: Zustand 스토어에서 JWT 토큰을 읽어 Authorization 헤더에 주입
 *  2) 응답 인터셉터:
 *      - 401: 토큰 만료/무효 → 스토어 클리어 후 /auth로 리다이렉트
 *      - FastAPI 표준 에러({detail: "..."}) → Error.message로 정규화
 *  3) FormData 전송 시 Content-Type을 자동 처리 (axios가 boundary 포함해서 설정)
 */
import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";
import { API_BASE_URL } from "./constants";
import { getAuthToken, clearAuthState } from "@/store/authStore";

// FastAPI 표준 에러 응답 형태
interface FastApiError {
  detail?: string | { msg: string; type: string }[];
}

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 300_000, // 60_000(60초)에서 300_000(5분)으로 변경
  headers: {
    "Content-Type": "application/json",
  },
});

// ---------- 요청 인터셉터 ----------
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAuthToken();
  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }

  // FormData를 보낼 때는 Content-Type을 axios가 boundary 포함해 자동 설정하도록 위임
  if (config.data instanceof FormData) {
    config.headers.delete("Content-Type");
  }

  return config;
});

// ---------- 응답 인터셉터 ----------
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<FastApiError>) => {
    // 1) 인증 만료/무효 처리
    if (error.response?.status === 401) {
      clearAuthState();
      // 라우터 외부에서 호출되므로 location으로 강제 이동
      // ProtectedRoute의 리다이렉트와 중복돼도 무해
      if (
        typeof window !== "undefined" &&
        !window.location.pathname.startsWith("/auth")
      ) {
        window.location.href = "/auth";
      }
    }

    // 2) FastAPI 에러 메시지 정규화
    const detail = error.response?.data?.detail;
    let message = error.message;

    if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail)) {
      // Pydantic ValidationError 배열
      message = detail.map((d) => d.msg).join(", ");
    }

    // Error 객체의 message를 덮어써서 React Query/UI에서 사용하기 쉽게
    const normalized = new Error(message) as Error & {
      status?: number;
      original?: AxiosError;
    };
    normalized.status = error.response?.status;
    normalized.original = error;

    return Promise.reject(normalized);
  }
);

/**
 * (편의) 정규화된 에러를 안전하게 문자열로 추출
 * - React Query의 error 객체에 사용
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "알 수 없는 오류가 발생했습니다.";
}
