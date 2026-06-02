/**
 * DashboardPage (/)
 *
 * 책임:
 *  - 학습 분석 대시보드 (GET /dashboard): 목표 달성률 · 최신 페르소나 · 점수 추이
 *  - 맞춤 학습 추천 (GET /recommendations)
 *  - 누적 발음 분석 (GET /cumulative-analysis/{user_id}): weak_phonemes 히트맵 + ai_analysis
 *  - 사용자 환영 헤더 + 주요 기능 빠른 진입 카드 (YouTube / Interview / History)
 *
 * 상태 분리(HANDOFF): 사용자/토큰은 Zustand(authStore), 서버 데이터는 React Query.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { useCumulativeAnalysis } from "@/hooks/queries/useCumulativeAnalysis";
import { useDashboard } from "@/hooks/queries/useDashboard";
import { useRecommendations } from "@/hooks/queries/useRecommendations";
import { ProcessingSkeleton } from "@/components/common/ProcessingSkeleton";
import { UserMenu } from "@/components/common/UserMenu";
import { PhonemeHeatmap } from "@/components/features/dashboard/PhonemeHeatmap";
import { GoalProgressWidget } from "@/components/features/dashboard/GoalProgressWidget";
import { GoalSettingModal } from "@/components/features/dashboard/GoalSettingModal";
import { PersonaCard } from "@/components/features/dashboard/PersonaCard";
import { ScoreTrendChart } from "@/components/features/dashboard/ScoreTrendChart";
import { RecommendationsPanel } from "@/components/features/dashboard/RecommendationsPanel";
import { getErrorMessage } from "@/lib/api";
import { AICoachingCard } from "@/components/features/dashboard/AICoachingCard";

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const analysisQuery = useCumulativeAnalysis(user?.id ?? null);
  const dashboardQuery = useDashboard();
  const recommendationsQuery = useRecommendations();

  const [goalModalOpen, setGoalModalOpen] = useState(false);

  const displayName =
    user?.nickname?.trim() ||
    user?.email?.split("@")[0] ||
    "당신";

  return (
    <main className="min-h-dvh bg-bg text-fg">
      <div className="mx-auto max-w-3xl px-6 pt-20 pb-24">
        {/* 상단 사용자 메뉴 (로그아웃 진입점) — 전역 ThemeToggle 아래로 세로 분리됨 */}
        <div className="flex justify-end mb-6">
          <UserMenu />
        </div>

        {/* ── 헤더 ─────────────────────────────────────────── */}
        <header className="mb-14">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-subtle mb-4">
            Dashboard
          </p>
          <h1 className="font-display text-5xl leading-[1.05] mb-5">
            {displayName}님, 다시 만나서{" "}
            <span className="text-accent">반가워요</span>
          </h1>
          <p className="text-fg-muted text-lg leading-relaxed">
            지금까지의 발음 데이터를 정리해두었어요. 약점부터 차근차근
            교정해볼까요?
          </p>
        </header>

        {/* ── 목표 / 달성률 ─────────────────────────────────── */}
        <section className="mb-16">
          <SectionHeader eyebrow="Goal" title="목표 달성률" />

          {dashboardQuery.isPending && <ProcessingSkeleton />}

          {dashboardQuery.isError && (
            <div className="p-4 rounded-md bg-score-low/10 border border-score-low/30 text-sm text-score-low">
              {getErrorMessage(dashboardQuery.error)}
            </div>
          )}

          {dashboardQuery.isSuccess && (
            <GoalProgressWidget
              goal={dashboardQuery.data.goal}
              progress={dashboardQuery.data.goal_progress}
              onEdit={() => setGoalModalOpen(true)}
            />
          )}
        </section>

        {/* ── 최신 페르소나 (면접 완료 시) ──────────────────── */}
        {dashboardQuery.data?.latest_persona && (
          <section className="mb-16">
            <SectionHeader eyebrow="Persona" title="최신 페르소나" />
            <PersonaCard persona={dashboardQuery.data.latest_persona} />
          </section>
        )}

        {/* ── 점수 추이 ─────────────────────────────────────── */}
        {dashboardQuery.isSuccess && (
          <section className="mb-16">
            <SectionHeader eyebrow="Trend" title="점수 추이" />
            <ScoreTrendChart data={dashboardQuery.data.recent_scores} />
          </section>
        )}

        {/* ── 맞춤 추천 ─────────────────────────────────────── */}
        <section className="mb-16">
          <SectionHeader eyebrow="For you" title="맞춤 학습 추천" />

          {recommendationsQuery.isPending && <ProcessingSkeleton />}

          {recommendationsQuery.isError && (
            <div className="p-4 rounded-md bg-score-low/10 border border-score-low/30 text-sm text-score-low">
              {getErrorMessage(recommendationsQuery.error)}
            </div>
          )}

          {recommendationsQuery.isSuccess && (
            <RecommendationsPanel data={recommendationsQuery.data} />
          )}
        </section>

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

      {/* 목표 설정/수정 모달 (open-gated) */}
      <GoalSettingModal
        open={goalModalOpen}
        onClose={() => setGoalModalOpen(false)}
        initialGoal={dashboardQuery.data?.goal ?? null}
      />
    </main>
  );
}

// ─────────────────────────────────────────────────────────────
// 누적 분석 본문
// ─────────────────────────────────────────────────────────────
function AnalysisContent({
  data,
}: {
  data: import("@/types/history").CumulativeAnalysisResponse;
}) {
  const isInsufficient =
    !data.weak_phonemes || data.weak_phonemes.length === 0;

  if (isInsufficient) {
    return (
      <div className="rounded-xl border border-border bg-bg-elevated p-8 text-center animate-fade-up">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-subtle mb-3">
          Not enough data yet
        </p>
        <h3 className="font-display text-2xl leading-tight mb-3">
          첫 연습을 마치면 <span className="text-accent">여기</span>에
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
        <AICoachingCard text={data.ai_analysis} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 섹션 헤더
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

/* ─── 아이콘 ─── */
function IconYoutube() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="5" width="19" height="14" rx="3" />
      <polygon points="10,9 16,12 10,15" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconInterview() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12c0 4.4-4 8-9 8-1.3 0-2.5-.2-3.6-.6L4 21l1.4-3.7C4.5 16 4 14.6 4 13c0-4.4 4-8 9-8s8 3.6 8 7z" />
    </svg>
  );
}

function IconHistory() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <polyline points="3 4 3 9 8 9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}
