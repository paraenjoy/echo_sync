/**
 * AuthPage (/auth) — PLACEHOLDER
 *
 * ⚠️ 본 파일은 라우터 컴파일을 위한 임시 placeholder다.
 *    아직 plan.md의 Execution Steps에 별도 단계로 작성된 적이 없으며,
 *    정식 구현 시 같은 export 시그니처(default export, props 없음)를 유지하면 된다.
 *
 * 정식 구현 시 포함되어야 할 내용:
 *  - 로그인 폼 (POST /login → access_token)
 *  - 회원가입 폼 (POST /signup)
 *  - useAuthStore.setAuth로 토큰/사용자 저장
 *  - location.state.from을 읽어 로그인 성공 후 원래 가려던 경로로 navigate(from, { replace: true })
 *  - Editorial 톤의 좌/우 split 또는 탭 형태
 *
 * 개발 중 임시 우회 (정식 AuthPage가 없는 동안):
 *  - 백엔드 /login으로 토큰 발급 후 DevTools console에서 직접 주입:
 *      localStorage.setItem('sync-auth', JSON.stringify({
 *        state: { token: '<ACCESS_TOKEN>', user: { id: 1, email: '...', nickname: null, role: 'user' } },
 *        version: 0
 *      }));
 *    (스토리지 키 이름은 lib/constants.ts의 AUTH_STORAGE_KEY 확인)
 */
export default function AuthPage() {
  return (
    <main className="min-h-dvh bg-bg text-fg grid place-items-center px-6">
      <div className="max-w-md w-full text-center">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-subtle mb-4">
          Placeholder
        </p>
        <h1 className="font-display text-4xl leading-tight mb-4">
          로그인 페이지는 <span className="italic text-accent">곧 준비</span>됩니다
        </h1>
        <p className="text-fg-muted leading-relaxed">
          개발 중에는 백엔드 <code className="font-mono text-xs bg-bg-elevated rounded-sm px-1.5 py-0.5">/login</code>으로
          토큰을 발급받아 localStorage에 직접 저장해 주세요.
        </p>
      </div>
    </main>
  );
}
