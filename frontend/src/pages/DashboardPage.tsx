/**
 * DashboardPage (/) — Step 5 정식 구현
 *
 * 책임:
 *  - 누적 발음 분석 (GET /cumulative-analysis/{user_id}) 시각화
 *      · 정상: weak_phonemes 히트맵 + ai_analysis 텍스트
 *      · 데이터 부족: summary 빈 상태 + 첫 연습 CTA
 *  - 사용자 환영 헤더 (닉네임)
 *  - 주요 기능으로의 빠른 진입 카드 (YouTube / Interview / History)
 *
 * 상태 분리:
 *  - 닉네임은 useAuthStore에서 (클라이언트 상태)
 *  - 누적 분석은 useCumulativeAnalysis에서 (서버 상태)
 *
 * 디자인:
 *  - YoutubePage / AuthPage와 같은 Editorial Warmth 톤
 *  - max-w-3xl centered
 *  - 핵심 단어 italic + accent 강조
 */
import { Link } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { useCumulativeAnalysis } from "@/hooks/queries/useCumulativeAnalysis";
import { ProcessingSkeleton } from "@/components/common/ProcessingSkeleton";
import { PhonemeHeatmap } from "@/components/features/dashboard/PhonemeHeatmap";
import { getErrorMessage } from "@/lib/api";

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const analysisQuery = useCumulativeAnalysis(user?.id ?? null);

  // 닉네임 폴백: nickname → email의 @ 앞부분 → "당신"
  const displayName =
    user?.nickname?.trim() ||
    user?.email?.split("@")[0] ||
    "당신";

  return (
    <main className="min-h-dvh bg-bg text-fg">
      <div className="mx-auto max-w-3xl px-6 pt-20 pb-24">
        {/* ── 헤더 ─────────────────────────────────────────── */}
        <header className="mb-14">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-subtle mb-4">
            Dashboard
          </p>
          <h1 className="font-display text-5xl leading-[1.05] mb-5">
            {displayName}님, 다시 만나서{" "}
            <span className="italic text-accent">반가워요</span>
          </h1>
          <p className="text-fg-muted text-lg leading-relaxed">
            지금까지의 발음 데이터를 정리해두었어요. 약점부터 차근차근
            교정해볼까요?
          </p>
        </header>

        {/* ── 누적 분석 섹션 ────────────────────────────────── */}
        <section className="mb-16">
          <SectionHeader
            eyebrow="Cumulative Analysis"
            title="누적 발음 분석"
          />

          {analysisQuery.isPending && <ProcessingSkeleton />}

          {analysisQuery.isError && (
            <div className="p-4 rounded-md bg-score-low/10 border border-score-low/30 text-sm text-score-low">
              {getErrorMessage(analysisQuery.error)}
            </div>
          )}

          {analysisQuery.isSuccess && (
            <AnalysisContent data={analysisQuery.data} />
          )}
        </section>

        {/* ── 빠른 진입 카드 ───────────────────────────────── */}
        <section>
          <SectionHeader eyebrow="Quick Start" title="바로 시작하기" />
          <nav className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <QuickLink
              to="/youtube"
              eyebrow="YouTube"
              title="영상으로 연습"
              description="자막에서 뽑은 질문으로 회화 훈련"
              icon={<IconYoutube />}
            />
            <QuickLink
              to="/interview/setup"
              eyebrow="Interview"
              title="AI 면접 시작"
              description="이력서·기술 스택 기반 모의 면접"
              icon={<IconInterview />}
            />
            <QuickLink
              to="/history"
              eyebrow="History"
              title="히스토리 보기"
              description="과거 세션과 상세 리포트"
              icon={<IconHistory />}
            />
          </nav>
        </section>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────
// 누적 분석 본문 — 두 응답 형태(정상 vs 데이터 부족) 분기
// ─────────────────────────────────────────────────────────────
function AnalysisContent({
  data,
}: {
  data: import("@/types/history").CumulativeAnalysisResponse;
}) {
  // 데이터 부족 케이스: 백엔드가 summary만 내려보냄
  const isInsufficient =
    !data.weak_phonemes || data.weak_phonemes.length === 0;

  if (isInsufficient) {
    return (
      <div className="rounded-xl border border-border bg-bg-elevated p-8 text-center animate-fade-up">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-subtle mb-3">
          Not enough data yet
        </p>
        <h3 className="font-display text-2xl leading-tight mb-3">
          첫 연습을 마치면 <span className="italic text-accent">여기</span>에
          분석이 쌓여요
        </h3>
        <p className="text-fg-muted text-sm leading-relaxed mb-6 max-w-md mx-auto">
          {data.summary ??
            "아직 분석할 데이터가 충분하지 않아요. 몇 차례 연습하면 약점 음소가 보이기 시작합니다."}
        </p>
        <Link
          to="/youtube"
          className="inline-block px-5 py-2.5 rounded-md bg-accent text-accent-fg text-sm hover:bg-accent-hover transition-colors"
        >
          첫 연습 시작하기
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-up">
      {/* 약점 음소 히트맵 */}
      <div className="border border-border rounded-xl bg-bg-elevated p-6">
        <p className="font-mono text-xs uppercase tracking-wider text-fg-subtle mb-4">
          Weak Phonemes
        </p>
        <PhonemeHeatmap phonemes={data.weak_phonemes!} />
        <p className="mt-5 text-[11px] text-fg-subtle font-mono">
          * 평균 점수 낮은 순으로 정렬했어요. 좌측 강조선이 있는 음소부터
          연습해보세요.
        </p>
      </div>

      {/* AI 누적 분석 */}
      {data.ai_analysis && (
        <div className="border border-border rounded-xl bg-bg-elevated p-6">
          <p className="font-mono text-xs uppercase tracking-wider text-fg-subtle mb-3">
            AI Coaching
          </p>
          <p className="text-sm text-fg leading-relaxed whitespace-pre-line">
            {data.ai_analysis}
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 섹션 헤더 (eyebrow + 제목) — 본 페이지 내부 반복 사용
// ─────────────────────────────────────────────────────────────
function SectionHeader({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="mb-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle mb-1.5">
        {eyebrow}
      </p>
      <h2 className="font-display text-2xl leading-tight">{title}</h2>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 빠른 진입 카드
// ─────────────────────────────────────────────────────────────
interface QuickLinkProps {
  to: string;
  eyebrow: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}

function QuickLink({ to, eyebrow, title, description, icon }: QuickLinkProps) {
  return (
    <Link
      to={to}
      className="
        group flex flex-col gap-3 p-5 rounded-xl
        border border-border bg-bg-elevated
        hover:border-accent/60 hover:bg-bg-subtle
        transition-colors
      "
    >
      <span className="text-fg-subtle group-hover:text-accent transition-colors">
        {icon}
      </span>
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle mb-1">
          {eyebrow}
        </p>
        <h3 className="font-display text-lg leading-tight mb-1.5">{title}</h3>
        <p className="text-xs text-fg-muted leading-relaxed">{description}</p>
      </div>
    </Link>
  );
}

/* ─── 아이콘 (의존성 없이 인라인 SVG, MicButton 패턴과 동일) ─── */

function IconYoutube() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="5" width="19" height="14" rx="3" />
      <polygon points="10,9 16,12 10,15" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconInterview() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12c0 4.4-4 8-9 8-1.3 0-2.5-.2-3.6-.6L4 21l1.4-3.7C4.5 16 4 14.6 4 13c0-4.4 4-8 9-8s8 3.6 8 7z" />
    </svg>
  );
}

function IconHistory() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <polyline points="3 4 3 9 8 9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}