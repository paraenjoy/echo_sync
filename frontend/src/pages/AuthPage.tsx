/**
 * AuthPage (/auth) — 정식 구현
 *
 * 책임:
 *  - 로그인 / 회원가입 단일 페이지 (탭 전환)
 *  - 로그인 성공 → setAuth → location.state.from으로 navigate (없으면 /)
 *  - 회원가입 성공 → 자동 로그인 → 같은 흐름
 *  - 이미 인증된 사용자가 진입하면 즉시 /로 redirect
 *
 * 디자인:
 *  - Setup 페이지와 동일한 Editorial Warmth 톤
 *  - 단일 컬럼 centered, max-w-md
 *  - 모드 토글은 InterviewRoom의 ModeToggle 패턴과 일관
 *
 * 검증:
 *  - 이메일 형식 (간단한 정규식)
 *  - 비밀번호 최소 6자
 *  - 회원가입 시 비밀번호 확인 일치
 *  - 클라이언트 검증을 통과해도 서버가 거절할 수 있으므로 mutation 에러는 인라인 표시
 */
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/store/authStore";
import {
  useLogin,
  useSignup,
  type AuthSuccess,
} from "@/hooks/queries/useAuthMutations";
import { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

type AuthMode = "login" | "signup";

const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const MIN_PASSWORD_LENGTH = 6;
const MAX_NICKNAME_LENGTH = 30;

export default function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // ── 이미 인증된 사용자 redirect ────────────────────────────
  // /auth로 직접 진입한 로그인 상태 사용자를 즉시 홈으로 돌려보낸다.
  // (ProtectedRoute의 반대 방향 가드)
  useEffect(() => {
    if (useAuthStore.getState().isAuthenticated()) {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  // ── 훅 ────────────────────────────────────────────────────
  const setAuth = useAuthStore((s) => s.setAuth);
  const loginMutation = useLogin();
  const signupMutation = useSignup();

  // ── 폼 상태 ────────────────────────────────────────────────
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [nickname, setNickname] = useState("");

  // 현재 활성 mutation (모드에 따라)
  const activeMutation = mode === "login" ? loginMutation : signupMutation;
  const isPending = activeMutation.isPending;

  // ── 검증 ──────────────────────────────────────────────────
  const emailValid = isValidEmail(email);
  const passwordValid = password.length >= MIN_PASSWORD_LENGTH;
  const passwordsMatch = mode === "login" || password === passwordConfirm;
  const canSubmit =
    emailValid && passwordValid && passwordsMatch && !isPending;

  // ── 모드 전환 ──────────────────────────────────────────────
  const handleModeChange = (next: AuthMode) => {
    if (next === mode) return;
    setMode(next);
    // 모드 간 잔존 상태 정리
    setPasswordConfirm("");
    setNickname("");
    loginMutation.reset();
    signupMutation.reset();
  };

  // ── 인증 성공 콜백 (로그인/회원가입 공통) ──────────────────
  const handleAuthSuccess = ({ token, user }: AuthSuccess) => {
    setAuth(token, user);
    // ProtectedRoute가 redirect 시 location.state.from에 원래 경로를 넣어두었다면
    // 로그인 후 그 경로로 복귀 (없으면 홈)
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from || "/", { replace: true });
  };

  // ── 제출 ──────────────────────────────────────────────────
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    if (mode === "login") {
      loginMutation.mutate(
        { email, password },
        { onSuccess: handleAuthSuccess }
      );
    } else {
      signupMutation.mutate(
        {
          email,
          password,
          nickname: nickname.trim() || null,
        },
        { onSuccess: handleAuthSuccess }
      );
    }
  };

  // ── 카피라이팅 (모드별) ─────────────────────────────────────
  // italic 제거 — 기울어진 폰트 사용 안 함, text-accent로만 강조
  const heading =
    mode === "login" ? (
      <>
        AI 스피킹 튜터 <span className="text-accent">EchoSync</span>
      </>
    ) : (
      <>
        오늘부터 <span className="text-accent">함께해요</span>
      </>
    );

  const subheading =
    mode === "login"
      ? "로그인하고 발음 연습과 AI 면접을 이어가세요."
      : "이메일과 비밀번호만 있으면 됩니다.";

  const submitLabel = isPending
    ? mode === "login"
      ? "로그인 중..."
      : "가입 중..."
    : mode === "login"
      ? "로그인"
      : "가입하기";

  return (
    <main className="min-h-dvh bg-bg text-fg grid place-items-center px-6 py-12">
      <div className="w-full max-w-md">
        {/* ── 헤더 ──────────────────────────────────────────── */}
        {/* eyebrow "Sync" 제거 */}
        <div className="text-center mb-10">
          <h1 className="font-display text-4xl leading-[1.1] mb-3">
            {heading}
          </h1>
          <p className="text-fg-muted leading-relaxed">{subheading}</p>
        </div>

        {/* ── 모드 토글 ──────────────────────────────────────── */}
        <div className="flex justify-center mb-8">
          <AuthModeToggle mode={mode} onChange={handleModeChange} />
        </div>

        {/* ── 폼 ────────────────────────────────────────────── */}
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <Field label="이메일">
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              disabled={isPending}
            />
          </Field>

          <Field label="비밀번호" hint={`${MIN_PASSWORD_LENGTH}자 이상`}>
            <Input
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isPending}
              minLength={MIN_PASSWORD_LENGTH}
            />
          </Field>

          {mode === "signup" && (
            <>
              <Field
                label="비밀번호 확인"
                error={
                  passwordConfirm && password !== passwordConfirm
                    ? "비밀번호가 일치하지 않아요"
                    : undefined
                }
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  required
                  disabled={isPending}
                />
              </Field>

              <Field
                label="닉네임"
                hint="선택 — 비워두면 이메일이 표시돼요"
              >
                <Input
                  type="text"
                  autoComplete="nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="홍길동"
                  maxLength={MAX_NICKNAME_LENGTH}
                  disabled={isPending}
                />
              </Field>
            </>
          )}

          {/* 서버 에러 (FastAPI detail → 정규화된 메시지) */}
          {activeMutation.isError && (
            <p
              role="alert"
              className="text-sm text-score-low bg-score-low/10 border border-score-low/40 rounded-md px-4 py-3 animate-fade-up"
            >
              {getErrorMessage(activeMutation.error)}
            </p>
          )}

          {/* 제출 */}
          <Button
            type="submit"
            size="lg"
            className="w-full h-12"
            disabled={!canSubmit}
          >
            {submitLabel}
          </Button>
        </form>

        {/* ── 푸터 ─ 모드 전환 힌트 ──────────────────────────── */}
        <p className="mt-6 text-xs text-fg-subtle text-center font-mono">
          {mode === "login" ? "처음이신가요? " : "이미 계정이 있으신가요? "}
          <button
            type="button"
            onClick={() =>
              handleModeChange(mode === "login" ? "signup" : "login")
            }
            className="text-accent hover:underline underline-offset-4"
          >
            {mode === "login" ? "회원가입" : "로그인"}
          </button>
        </p>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────
// Field — 라벨 + 힌트 + 에러 + 슬롯
// ─────────────────────────────────────────────────────────────
function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block mb-1.5">
        <span className="font-mono text-xs uppercase tracking-wider text-fg-subtle">
          {label}
        </span>
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-score-low">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-fg-muted/80">{hint}</p>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// AuthModeToggle — 로그인 / 회원가입 segmented control
// ─────────────────────────────────────────────────────────────
function AuthModeToggle({
  mode,
  onChange,
}: {
  mode: AuthMode;
  onChange: (m: AuthMode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="인증 모드"
      className="inline-flex p-1 rounded-md bg-bg-elevated border border-border"
    >
      <AuthModeButton
        active={mode === "login"}
        onClick={() => onChange("login")}
        label="로그인"
      />
      <AuthModeButton
        active={mode === "signup"}
        onClick={() => onChange("signup")}
        label="회원가입"
      />
    </div>
  );
}

function AuthModeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors",
        active ? "bg-bg-subtle text-fg" : "text-fg-subtle hover:text-fg"
      )}
    >
      {label}
    </button>
  );
}