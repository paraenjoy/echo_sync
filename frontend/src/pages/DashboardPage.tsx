/**
 * DashboardPage (/) — PLACEHOLDER
 *
 * ⚠️ 본 파일은 라우터 컴파일을 위한 임시 placeholder다.
 *    Step 5에서 정식 작성 예정.
 *
 * Step 5 정식 구현 시 포함되어야 할 내용 (plan.md 참고):
 *  - GET /cumulative-analysis/{user_id} 호출 → 누적 발음 분석 데이터
 *  - 약점 음소(weak_phonemes) 시각화 (히트맵)
 *  - AI 분석(ai_analysis) 텍스트 표시
 *  - 빠른 진입 카드: YouTube / Interview / History 네비게이션
 *  - useAuthStore에서 nickname 가져와 환영 메시지
 */
import { Link } from "react-router-dom";

export default function DashboardPage() {
  return (
    <main className="min-h-dvh bg-bg text-fg">
      <div className="mx-auto max-w-2xl px-6 pt-24 pb-16">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-subtle mb-4">
          Placeholder
        </p>
        <h1 className="font-display text-5xl leading-[1.05] mb-4">
          대시보드는 <span className="italic text-accent">Step 5</span>에서 완성됩니다
        </h1>
        <p className="text-fg-muted text-lg leading-relaxed mb-10">
          누적 발음 분석 히트맵과 AI 코칭 요약을 보여줄 예정이에요. 지금은 다른
          기능으로 바로 이동해볼 수 있어요.
        </p>

        <nav className="flex flex-wrap gap-3">
          <PlaceholderLink to="/youtube" label="YouTube 연습" />
          <PlaceholderLink to="/interview/setup" label="AI 면접 시작" />
          <PlaceholderLink to="/history" label="히스토리" />
        </nav>
      </div>
    </main>
  );
}

function PlaceholderLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="px-4 py-2 rounded-md border border-border-strong text-sm text-fg hover:border-accent hover:text-accent transition-colors"
    >
      {label}
    </Link>
  );
}
