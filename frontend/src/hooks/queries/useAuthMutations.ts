/**
 * useAuthMutations — 인증 도메인 뮤테이션 훅 모음
 *
 * 두 뮤테이션이 강하게 결합되어 있어 한 파일에 묶는다
 * (useInterviewMutations와 동일 패턴):
 *  - useLogin:  POST /login → 토큰 → GET /me로 사용자 정보 동시 획득
 *  - useSignup: POST /signup → 곧장 POST /login → GET /me (자동 로그인까지 한 흐름)
 *
 * 백엔드 계약 (main.py):
 *  - POST /login   → { message, access_token, token_type }
 *  - POST /signup  → { message, user_id, email, nickname }
 *  - GET  /me      → { id, email, nickname, role }
 *
 * /me 호출 시 토큰 전달 전략:
 *  - /me 호출 시점에 토큰은 아직 store에 없으므로(인터셉터가 못 읽음)
 *    Authorization 헤더에 명시적으로 주입한다.
 *  - 이렇게 하면 setAuth가 단 한 번에 token+user를 함께 저장하게 되어
 *    store에 "토큰만 있고 user는 비어있는" 부분 상태가 노출되지 않는다.
 */
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  LoginRequest,
  SignupRequest,
  TokenResponse,
  SignupResponse,
  User,
} from "@/types/auth";

// ─────────────────────────────────────────────────────────────
// 공통 페이로드: 인증 성공 시 페이지가 setAuth에 그대로 넘길 수 있는 형태
// ─────────────────────────────────────────────────────────────
export interface AuthSuccess {
  token: string;
  user: User;
}

// ─────────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────────

/** 발급받은 토큰으로 즉시 /me 호출. 인터셉터를 거치지 않도록 헤더에 직접 주입 */
async function fetchMeWithToken(token: string): Promise<User> {
  const res = await api.get<User>("/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

/** POST /login → 토큰 → /me 일괄 처리 */
async function loginAndFetchMe(input: LoginRequest): Promise<AuthSuccess> {
  const tokenRes = await api.post<TokenResponse>("/login", input);
  const token = tokenRes.data.access_token;
  const user = await fetchMeWithToken(token);
  return { token, user };
}

/** POST /signup → 곧장 로그인 → /me */
async function signupAndLogin(input: SignupRequest): Promise<AuthSuccess> {
  await api.post<SignupResponse>("/signup", input);
  return loginAndFetchMe({ email: input.email, password: input.password });
}

// ─────────────────────────────────────────────────────────────
// 공개 훅
// ─────────────────────────────────────────────────────────────

export const authMutationKeys = {
  login: ["auth", "login"] as const,
  signup: ["auth", "signup"] as const,
};

/**
 * 로그인 뮤테이션
 *
 * 사용 예:
 *   const loginMutation = useLogin();
 *   loginMutation.mutate({ email, password }, {
 *     onSuccess: ({ token, user }) => {
 *       setAuth(token, user);
 *       navigate(from || "/", { replace: true });
 *     },
 *   });
 */
export function useLogin() {
  return useMutation({
    mutationKey: authMutationKeys.login,
    mutationFn: loginAndFetchMe,
  });
}

/**
 * 회원가입 뮤테이션 (성공 시 자동 로그인까지 포함)
 *
 * 사용 예:
 *   const signupMutation = useSignup();
 *   signupMutation.mutate(
 *     { email, password, nickname: nickname || null },
 *     { onSuccess: handleAuthSuccess }
 *   );
 *
 * 주의:
 *  - 가입은 성공했지만 자동 로그인이 실패하는 케이스가 발생하면 mutation 전체가
 *    error로 표시된다. 사용자는 "로그인" 탭에서 같은 자격증명으로 재시도하면 OK.
 */
export function useSignup() {
  return useMutation({
    mutationKey: authMutationKeys.signup,
    mutationFn: signupAndLogin,
  });
}
