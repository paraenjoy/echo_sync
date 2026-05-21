/**
 * YoutubePage (/youtube)
 *
 * 플로우:
 *  1) URL 입력 → "질문 생성" 클릭
 *  2) GET /generate-questions → questions[] 수신
 *  3) 질문별로 useAudioStreamer 사용해 녹음→stop→결과 수신
 *  4) WordHeatmap + 결과 카드 표시 → 다음 질문 이동
 *
 * 디자인:
 *  - 두 단계 화면 (intro / practice)을 같은 페이지 안에서 전환
 *  - Editorial 미감: display serif 헤드라인 + 넉넉한 negative space
 */
import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MicButton } from "@/components/common/MicButton";
import { WordHeatmap } from "@/components/features/youtube/WordHeatmap";
import { ProcessingSkeleton } from "@/components/common/ProcessingSkeleton";
import { ErrorModal } from "@/components/common/ErrorModal";
import { useAudioStreamer } from "@/hooks/useAudioStreamer";
import {
  useGenerateQuestions,
  youtubeQueryKeys,
} from "@/hooks/queries/useGenerateQuestions";
import { cn, getScoreTier, scoreTierClasses } from "@/lib/utils";
import { ScoreDisplay } from "@/components/common/ScoreDisplay";
import { getErrorMessage } from "@/lib/api";
import type { YoutubeQuestion } from "@/types/youtube";

export default function YoutubePage() {
  const [url, setUrl] = useState("");
  const [currentStep, setCurrentStep] = useState(0);

  const queryClient = useQueryClient();
  const questionsQuery = useGenerateQuestions(url);
  const audio = useAudioStreamer();

  // 백엔드 응답 안정화
  const sessionId = questionsQuery.data?.session_id;
  const questions: YoutubeQuestion[] = useMemo(
    () => questionsQuery.data?.questions ?? [],
    [questionsQuery.data]
  );
  const currentQuestion = questions[currentStep];
  const totalSteps = questions.length;

  // 질문이 새로 로드되면 첫 질문으로 리셋
  useEffect(() => {
    if (questions.length > 0) {
      setCurrentStep(0);
      audio.reset();
    }
    // audio.reset은 useCallback으로 안정화되어 있어 deps에서 제외해도 안전
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions]);

  // ── 핸들러 ─────────────────────────────────────────────────
  const handleGenerate = () => {
    if (!url.trim()) return;
    questionsQuery.refetch();
  };

  const handleMicToggle = () => {
    if (!sessionId || !currentQuestion) return;

    if (audio.status === "recording") {
      audio.stop();
    } else if (
      audio.status === "idle" ||
      audio.status === "completed" ||
      audio.status === "error"
    ) {
      // completed 상태에서 다시 클릭하면 같은 질문 재시도
      if (audio.status === "completed") audio.reset();

      audio.start({
        sessionId,
        questionId: currentQuestion.id,
        questionText: currentQuestion.question_text,
      });
    }
  };

  const handleNext = () => {
    audio.reset();
    setCurrentStep((s) => Math.min(s + 1, totalSteps - 1));
  };

  const handleRetry = () => {
    audio.reset();
  };

  // ── 단계 1: URL 입력 화면 ─────────────────────────────────
  if (questions.length === 0) {
    return (
      <main className="min-h-dvh bg-bg text-fg">
        <div className="mx-auto max-w-2xl px-6 pt-24 pb-16">
          {/* Eyebrow */}
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-subtle mb-4">
            YouTube Practice
          </p>

          {/* Headline */}
          <h1 className="font-display text-5xl leading-[1.05] mb-4">
            영상 한 편이면,
            <br />
            <span className="italic text-accent">스피킹 연습</span>이
            시작됩니다.
          </h1>

          <p className="text-fg-muted text-lg leading-relaxed mb-10 max-w-prose">
            관심 있는 YouTube 영상의 URL을 붙여넣으면, AI가 영상 내용을 바탕으로
            맞춤 질문을 만들어드려요. 직접 답해보고 발음 피드백까지 받아보세요.
          </p>

          {/* Form */}
          <div className="space-y-3">
            <Input
              type="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              disabled={questionsQuery.isFetching}
              className="h-14 text-base"
            />
            <Button
              size="lg"
              className="w-full h-14 text-base"
              onClick={handleGenerate}
              disabled={!url.trim() || questionsQuery.isFetching}
            >
              {questionsQuery.isFetching ? "질문 만드는 중…" : "질문 생성하기"}
            </Button>
          </div>

          {/* 로딩 스켈레톤 */}
          {questionsQuery.isFetching && (
            <div className="mt-10">
              <ProcessingSkeleton />
            </div>
          )}

          {/* 에러 메시지 */}
          {questionsQuery.isError && (
            <p className="mt-4 text-sm text-score-low">
              {getErrorMessage(questionsQuery.error)}
            </p>
          )}
        </div>
      </main>
    );
  }

  // ── 단계 2: 연습 화면 ─────────────────────────────────────
  return (
    <main className="min-h-dvh bg-bg text-fg">
      <div className="mx-auto max-w-2xl px-6 pt-20 pb-24">
        {/* 헤더: 진행 상황 + 새 영상 버튼 */}
        <header className="mb-10 flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle tabular-nums">
            질문 {currentStep + 1} / {totalSteps}
          </p>
          <button
            type="button"
            onClick={() => {
              const prevUrl = url;
              setUrl("");
              queryClient.removeQueries({
                queryKey: youtubeQueryKeys.questions(prevUrl),
              });
            }}
            className="text-xs text-fg-subtle hover:text-fg transition-colors"
          >
            새 영상
          </button>
        </header>

        {/* Question */}
        <section className="mb-12">
          <h2 className="font-display text-3xl leading-tight mb-3">
            {currentQuestion?.question_text}
          </h2>
          {currentQuestion?.question_ko && (
            <p className="text-fg-muted text-base">
              {currentQuestion.question_ko}
            </p>
          )}
          {currentQuestion?.model_answer && (
            <details className="mt-5 group">
              <summary className="cursor-pointer text-xs font-mono uppercase tracking-wider text-fg-subtle hover:text-accent transition-colors list-none">
                <span className="inline-block transition-transform group-open:rotate-90 mr-1">
                  ▸
                </span>
                모범 답안 보기
              </summary>
              <p className="mt-3 pl-4 border-l-2 border-accent/40 text-sm text-fg-muted italic">
                {currentQuestion.model_answer}
              </p>
            </details>
          )}
        </section>

        {/* Mic Button + Volume Visualizer */}
        <section className="grid place-items-center my-12">
          <MicButton
            status={audio.status}
            volume={audio.volume}
            onToggle={handleMicToggle}
          />
        </section>

        {/* Status text */}
        {audio.status === "recording" && (
          <p className="text-center text-sm text-fg-muted mb-8 animate-fade-up">
            답변이 끝나면 마이크 버튼을 다시 눌러주세요
          </p>
        )}

        {/* Processing skeleton */}
        {audio.status === "processing" && <ProcessingSkeleton />}

        {/* Result */}
        {audio.status === "completed" && audio.result && (
          <ResultSection
            result={audio.result}
            localAudioUrl={audio.localAudioUrl}
            isLast={currentStep === totalSteps - 1}
            onNext={handleNext}
            onRetry={handleRetry}
          />
        )}

        {/* Error modal */}
        {audio.status === "error" && audio.error && (
          <ErrorModal
            error={audio.error}
            onDismiss={audio.reset}
            onRetry={
              audio.error.code === "NETWORK_ERROR" ||
              audio.error.code === "DEVICE_NOT_FOUND"
                ? handleMicToggle
                : undefined
            }
          />
        )}
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────
// 결과 섹션 (페이지 내부에 inline으로 두어 한눈에 보이게)
// ─────────────────────────────────────────────────────────────

interface ResultSectionProps {
  result: NonNullable<ReturnType<typeof useAudioStreamer>["result"]>;
  localAudioUrl: string | null;
  isLast: boolean;
  onNext: () => void;
  onRetry: () => void;
}

function ResultSection({
  result,
  localAudioUrl,
  isLast,
  onNext,
  onRetry,
}: ResultSectionProps) {
  // ResultSection은 BrowserRouter 내부에서 렌더되므로 useNavigate 직접 호출 가능
  const navigate = useNavigate();

  const tier = getScoreTier(result.score.accuracy);
  const tierCls = scoreTierClasses[tier];

  return (
    <section className="space-y-6 animate-fade-up">
      {/* ── 점수 카드 ────────────────────────────────────────── */}
      <div className="border border-border rounded-xl bg-bg-elevated p-6">
        <p className="font-mono text-xs uppercase tracking-wider text-fg-subtle mb-4">
          Pronunciation Score
        </p>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <ScoreDisplay label="Accuracy" value={result.score.accuracy} size="lg" />
          <ScoreDisplay label="Pronunciation" value={result.score.pronunciation} size="md" />
          <ScoreDisplay label="Fluency" value={result.score.fluency} size="md" />
        </div>

        <div className="pt-5 border-t border-border">
          <p className="font-mono text-xs uppercase tracking-wider text-fg-subtle mb-2">
            You said
          </p>
          <p
            className={cn(
              "font-display text-xl leading-relaxed italic",
              tierCls.text
            )}
          >
            &ldquo;{result.user_said}&rdquo;
          </p>
        </div>
      </div>

      {/* ── 단어별 히트맵 ───────────────────────────────────── */}
      <div className="border border-border rounded-xl bg-bg-elevated p-6">
        <p className="font-mono text-xs uppercase tracking-wider text-fg-subtle mb-4">
          Word Breakdown
        </p>
        <WordHeatmap words={result.words} />
      </div>

      {/* ── AI 피드백 ────────────────────────────────────── */}
      {result.feedback && (
        <div className="border border-border rounded-xl bg-bg-elevated p-6">
          <p className="font-mono text-xs uppercase tracking-wider text-fg-subtle mb-3">
            Coaching
          </p>
          <p className="text-sm text-fg leading-relaxed whitespace-pre-line">
            {result.feedback}
          </p>
        </div>
      )}

      {/* ── 음성 비교 ───────────────────────────────────── */}
      {(localAudioUrl || result.model_tts_url) && (
        <div className="border border-border rounded-xl bg-bg-elevated p-6 space-y-4">
          <p className="font-mono text-xs uppercase tracking-wider text-fg-subtle">
            Listen & Compare
          </p>

          {localAudioUrl && (
            <div>
              <p className="text-xs text-fg-muted mb-1">내 발화</p>
              <audio controls src={localAudioUrl} className="w-full" />
            </div>
          )}

          {result.model_tts_url && (
            <div>
              <p className="text-xs text-fg-muted mb-1">모범 발음</p>
              <audio controls src={result.model_tts_url} className="w-full" />
            </div>
          )}
        </div>
      )}

      {/* ── 액션 ─────────────────────────────────────────── */}
      <div className="flex gap-3 justify-end pt-2">
        <Button variant="ghost" onClick={onRetry}>
          다시 답해보기
        </Button>
        {!isLast && (
          <Button variant="primary" onClick={onNext}>
            다음 질문 →
          </Button>
        )}
        {isLast && (
          // window.location.href 대신 SPA 전환 사용 (캐시 보존 + 빠른 전환)
          <Button variant="primary" onClick={() => navigate("/history")}>
            기록 보러 가기
          </Button>
        )}
      </div>
    </section>
  );
}