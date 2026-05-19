/**
 * 인증 관련 타입
 * - 백엔드 schemas.py의 SignupRequest, LoginRequest, TokenResponse, MeResponse와 미러링
 */

export interface SignupRequest {
  email: string;
  password: string;
  nickname?: string | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupResponse {
  message: string;
  user_id: number;
  email: string;
  nickname: string | null;
}

export interface TokenResponse {
  message: string;
  access_token: string;
  token_type: string; // "bearer"
}

export interface User {
  id: number;
  email: string;
  nickname: string | null;
  role: string; // "user" | "admin"
}

// JWT 디코딩 페이로드 (백엔드 security.py 기준)
export interface JwtPayload {
  sub: string; // user_id (문자열)
  email: string;
  exp: number;
}
