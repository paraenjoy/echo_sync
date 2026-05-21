/**
 * HistoryDetailPage (/history/:id) — Step 5.4 정식 구현
 *
 * 책임:
 *  - URL 파라미터 :id로 단일 세션 상세 표시
 *  - useHistory 캐시에서 우선 탐색, 미스 시 첫 페이지 fetch 후 재탐색
 *  - 질문별 답변(log) 매칭 + 점수/코칭/음성 비교 표시
 *
 * 데이터 흐름:
 *  1) useHistory() 구독 → 캐시된 페이지에서 sessionId 검색
 *  2) 캐시 미스 → 자동으로 첫 페이지 로딩 진행, 로딩 끝나면 재검색
 *  3) 모든 페이지 fetch 완료 후에도 없으면 → 404 안내
 *
 * // TODO (Backend): GET /history/{session_id} 단일 세션 엔드포인트 추가
 *   현재는 전체 목록을 받아 클라이언트에서 찾는 구조다.
 *   딥링크/공유 시 초기 진입 속도 개선을 위해 단일 조회가 권장됨.
 *
 * // TODO (Backend): Include word_logs in GET /history logs[]
 *   단어 단위 정확도가 응답에 포함되면 WordHeatmap을 재사용할 수 있다.
 *   현재는 logs[]에 word-level 데이터가 없어 단어 분석 영역을 placeholder로 둔다.
 */
import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useHistory } from "@/hooks/queries/useHistory";
import { pickSessionFromPages } from "@/hooks/queries/useHistory";
import { cn, getScoreTier, scoreTierClasses } from "@/lib/utils";
import { ScoreDisplay } from "@/components/common/ScoreDisplay";
import { getErrorMessage } from "@/lib/api";
import type {
  HistorySession,
  HistoryQuestion,
  HistoryLog,
} from "@/types/history";

export default function HistoryDetailPage() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const sessionId = Number(params.id);
  const isValidId = Number.isFinite(sessionId) && sessionId > 0;

  // useHistory가 캐시되어 있으면 즉시 결과, 아니면 첫 페이지를 fetch한다.
  const historyQuery = useHistory();
  const session = useMemo(
    () =>
      isValidId
        ? pickSessionFromPages(historyQuery.data?.pages, sessionId)
        : undefined,
    [historyQuery.data, sessionId, isValidId]
  );

  // ── 잘못된 URL ───────────────────────────────────────────
  if (!isValidId) {
    return <NotFound onBack={() => navigate("/history")} />;
  }

  // ── 로딩 중 (캐시 미스) ───────────────────────────────────
  if (historyQuery.isPending) {
    return <DetailSkeleton onBack={() => navigate("/history")} />;
  }

  // ── 에러 ──────────────────────────────────────────────────
  if (historyQuery.isError) {
    return (
      <Shell onBack={() => navigate("/history")}>
        <div className="p-5 rounded-xl bg-score-low/10 border border-score-low/30 animate-fade-up">
          <p className="font-mono text-[10px] uppercase tracking-wider text-score-low mb-2">
            Error
          </p>
          <p className="text-sm text-fg mb-4 leading-relaxed">
            {getErrorMessage(historyQuery.error)}
          </p>
          <button
            type="button"
            onClick={() => historyQuery.refetch()}
            className="text-xs font-mono uppercase tracking-wider text-fg-muted hover:text-fg transition-colors"
          >
            재시도
          </button>
        </div>
      </Shell>
    );
  }

  // ── 데이터는 로드됐는데 해당 세션이 없음 (잘못된 ID 또는 다른 사용자 소유) ─
  if (!session) {
    return <NotFound onBack={() => navigate("/history")} />;
  }

  // ── 정상 ─────────────────────────────────────────────────
  return (
    <Shell onBack={() => navigate("/history")}>
      <SessionHeader session={session} />
      <OverallScoreCard logs={session.logs} />
      <QuestionList
        questions={session.questions}
        logs={session.logs}
      />
      <OrphanLogsSection logs={session.logs} />
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────
// Shell — 페이지 공통 레이아웃 (뒤로가기 + 컨테이너)
// ─────────────────────────────────────────────────────────────
function Shell({
  children,
  onBack,
}: {
  children: React.ReactNode;
  onBack: () => void;
}) {
  return (
    <main className="min-h-dvh bg-bg text-fg">
      <div className="mx-auto max-w-3xl px-6 pt-12 pb-24">
        <BackButton onClick={onBack} />
        <div className="mt-6 space-y-8">{children}</div>
      </div>
    </main>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-fg-subtle hover:text-fg transition-colors"
      aria-label="히스토리 목록으로 돌아가기"
    >
      <span aria-hidden>←</span>
      히스토리
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// 세션 헤더 (타입 + 날짜 + 제목)
// ─────────────────────────────────────────────────────────────
function SessionHeader({ session }: { session: HistorySession }) {
  const typeLabel = session.session_type === "youtube" ? "YouTube" : "Interview";
  const dateLabel = formatDateFull(session.created_at);
  const title = resolveTitle(session);

  return (
    <header className="animate-fade-up">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-subtle mb-3">
        {typeLabel} · {dateLabel}
      </p>
      <h1 className="font-display text-4xl leading-[1.1]">{title}</h1>
      {session.source_url && (
        
          href={session.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-3 text-xs font-mono text-fg-subtle hover:text-accent transition-colors break-all"
        >
          ↗ {session.source_url}
        </a>
      )}
    </header>
  );
}

// ─────────────────────────────────────────────────────────────
// 종합 점수 카드 (accuracy/pronunciation/fluency 평균)
// ─────────────────────────────────────────────────────────────
function OverallScoreCard({ logs }: { logs: HistoryLog[] }) {
  const stats = useMemo(() => {
    if (logs.length === 0) return null;
    const sum = logs.reduce(
      (acc, l) => ({
        accuracy: acc.accuracy + l.accuracy_score,
        pronunciation: acc.pronunciation + l.pronunciation_score,
        fluency: acc.fluency + l.fluency_score,
      }),
      { accuracy: 0, pronunciation: 0, fluency: 0 }
    );
    return {
      accuracy: sum.accuracy / logs.length,
      pronunciation: sum.pronunciation / logs.length,
      fluency: sum.fluency / logs.length,
      count: logs.length,
    };
  }, [logs]);

  if (!stats) {
    return (
      <section className="border border-border rounded-xl bg-bg-elevated p-6 animate-fade-up">
        <p className="font-mono text-xs uppercase tracking-wider text-fg-subtle">
          아직 답변이 기록되지 않은 세션이에요.
        </p>
      </section>
    );
  }

  return (
    <section className="border border-border rounded-xl bg-bg-elevated p-6 animate-fade-up">
      <div className="flex items-baseline justify-between mb-5">
        <p className="font-mono text-xs uppercase tracking-wider text-fg-subtle">
          Overall · 평균
        </p>
        <p className="text-[10px] font-mono uppercase tracking-wider text-fg-subtle">
          n = <span className="tabular-nums">{stats.count}</span>
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <ScoreDisplay label="Accuracy" value={stats.accuracy} size="lg" />
        <ScoreDisplay label="Pronunciation" value={stats.pronunciation} size="md" />
        <ScoreDisplay label="Fluency" value={stats.fluency} size="md" />
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// 질문 리스트 + 매칭된 답변
// ─────────────────────────────────────────────────────────────
function QuestionList({
  questions,
  logs,
}: {
  questions: HistoryQuestion[];
  logs: HistoryLog[];
}) {
  if (questions.length === 0) return null;

  // 질문별 최신 답변 매칭
  const sorted = useMemo(
    () => [...questions].sort((a, b) => a.order_no - b.order_no),
    [questions]
  );

  return (
    <section className="space-y-6 animate-fade-up">
      <SectionLabel eyebrow="Questions" title={`질문 ${questions.length}개`} />

      <div className="space-y-5">
        {sorted.map((q, idx) => {
          // 같은 질문에 여러 답변이 있다면 가장 최근 것만 (created_at desc)
          const matched = logs
            .filter((l) => l.question_id === q.question_id)
            .sort(
              (a, b) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime()
            );
          const latest = matched[0];

          return (
            <article
              key={q.question_id}
              className="border border-border rounded-xl bg-bg-elevated p-6"
            >
              {/* 질문 번호 + 텍스트 */}
              <p className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle mb-2 tabular-nums">
                Q{String(idx + 1).padStart(2, "0")}
              </p>
              <h2 className="font-display text-2xl leading-snug mb-2">
                {q.question_text}
              </h2>
              {q.question_ko && (
                <p className="text-fg-muted text-sm mb-4">{q.question_ko}</p>
              )}
              {q.model_answer && (
                <details className="mb-5 group">
                  <summary className="cursor-pointer text-xs font-mono uppercase tracking-wider text-fg-subtle hover:text-accent transition-colors list-none">
                    <span className="inline-block transition-transform group-open:rotate-90 mr-1">
                      ▸
                    </span>
                    모범 답안 보기
                  </summary>
                  <p className="mt-3 pl-4 border-l-2 border-accent/40 text-sm text-fg-muted italic leading-relaxed">
                    {q.model_answer}
                  </p>
                </details>
              )}

              {/* 답변 영역 */}
              {latest ? (
                <AnswerBlock log={latest} attempts={matched.length} />
              ) : (
                <p className="text-xs font-mono uppercase tracking-wider text-fg-subtle border-t border-border pt-4">
                  · 이 질문에는 답변 기록이 없어요 ·
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// 답변 블록 (한 log)
// ─────────────────────────────────────────────────────────────
function AnswerBlock({
  log,
  attempts,
}: {
  log: HistoryLog;
  attempts: number;
}) {
  const tier = getScoreTier(log.accuracy_score);
  const tierCls = scoreTierClasses[tier];

  return (
    <div className="border-t border-border pt-5 space-y-5">
      {/* 점수 3개 */}
      <div className="grid grid-cols-3 gap-3">
        <ScoreDisplay label="Accuracy" value={log.accuracy_score} size="sm" />
        <ScoreDisplay label="Pronunciation" value={log.pronunciation_score} size="sm" />
        <ScoreDisplay label="Fluency" value={log.fluency_score} size="sm" />
      </div>

      {/* 인식된 텍스트 */}
      {log.recognized_text && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle mb-2">
            You said
            {attempts > 1 && (
              <span className="ml-2 normal-case text-fg-subtle/70">
                (마지막 시도 · 총 {attempts}회)
              </span>
            )}
          </p>
          <p
            className={cn(
              "font-display text-lg leading-relaxed italic",
              tierCls.text
            )}
          >
            “{log.recognized_text}”
          </p>
        </div>
      )}

      {/* 단어 분석 자리 */}
      {/*
       * TODO (Backend): Include word_logs in GET /history logs[]
       *   word-level 데이터가 포함되면 WordHeatmap을 여기에 렌더한다:
       *     {log.word_logs && <WordHeatmap words={normalize(log.word_logs)} />}
       *   현재는 응답에 포함되지 않아 placeholder를 비워둔다.
       */}

      {/* 코칭 메시지 */}
      {log.coaching_message && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle mb-2">
            Coaching
          </p>
          <p className="text-sm text-fg leading-relaxed whitespace-pre-line">
            {log.coaching_message}
          </p>
        </div>
      )}

      {/* 음성 비교 */}
      {(log.user_tts_url || log.model_tts_url) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {log.user_tts_url && (
            <InlineAudio label="내 음성" src={log.user_tts_url} />
          )}
          {log.model_tts_url && (
            <InlineAudio label="모범 답안" src={log.model_tts_url} />
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 질문에 매칭되지 않은 로그 (question_id가 null) — 자유발화 등
// ─────────────────────────────────────────────────────────────
function OrphanLogsSection({ logs }: { logs: HistoryLog[] }) {
  const orphans = useMemo(
    () => logs.filter((l) => l.question_id == null),
    [logs]
  );
  if (orphans.length === 0) return null;

  return (
    <section className="space-y-5 animate-fade-up">
      <SectionLabel eyebrow="Free Responses" title="기타 응답" />
      {orphans.map((log) => (
        <article
          key={log.log_id}
          className="border border-border rounded-xl bg-bg-elevated p-6"
        >
          <AnswerBlock log={log} attempts={1} />
        </article>
      ))}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// 인라인 오디오 플레이어
// (InterviewRoomPage의 AudioUnit과 동일 마크업. 3번째 사용처가 등장하면 common/AudioUnit으로 추출 검토)
// ─────────────────────────────────────────────────────────────
function InlineAudio({ label, src }: { label: string; src: string }) {
  return (
    <div className="space-y-1.5">
      <p className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
        {label}
      </p>
      <audio controls src={src} className="w-full h-9" preload="none" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 섹션 라벨
// ─────────────────────────────────────────────────────────────
function SectionLabel({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle mb-1.5">
        {eyebrow}
      </p>
      <h2 className="font-display text-xl leading-tight">{title}</h2>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 404 / Not Found
// ─────────────────────────────────────────────────────────────
function NotFound({ onBack }: { onBack: () => void }) {
  return (
    <Shell onBack={onBack}>
      <div className="rounded-xl border border-border bg-bg-elevated p-10 text-center animate-fade-up">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-subtle mb-3">
          Not Found
        </p>
        <h2 className="font-display text-2xl leading-tight mb-3">
          이 세션을 <span className="italic text-accent">찾을 수 없어요</span>
        </h2>
        <p className="text-fg-muted text-sm leading-relaxed mb-6 max-w-md mx-auto">
          삭제되었거나, 잘못된 링크일 수 있어요. 히스토리에서 다시
          선택해주세요.
        </p>
        <Link
          to="/history"
          className="inline-block px-5 py-2.5 rounded-md border border-border-strong text-fg text-sm hover:border-accent hover:text-accent transition-colors"
        >
          히스토리로 돌아가기
        </Link>
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────
// 로딩 스켈레톤
// ─────────────────────────────────────────────────────────────
function DetailSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <Shell onBack={onBack}>
      {/* 헤더 자리 */}
      <div className="space-y-3" aria-busy="true">
        <div className="h-3 w-40 rounded-sm animate-shimmer" />
        <div className="h-10 w-3/4 rounded-md animate-shimmer" />
      </div>

      {/* 종합 점수 자리 */}
      <div className="border border-border rounded-xl bg-bg-elevated p-6 space-y-4">
        <div className="h-3 w-24 rounded-sm animate-shimmer" />
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-16 rounded-sm animate-shimmer" />
              <div className="h-10 w-full rounded-md animate-shimmer" />
            </div>
          ))}
        </div>
      </div>

      {/* 질문 카드 자리 */}
      {[0, 1].map((i) => (
        <div
          key={i}
          className="border border-border rounded-xl bg-bg-elevated p-6 space-y-4"
        >
          <div className="h-3 w-12 rounded-sm animate-shimmer" />
          <div className="h-7 w-5/6 rounded-md animate-shimmer" />
          <div className="h-3 w-2/3 rounded-sm animate-shimmer" />
          <div className="border-t border-border pt-4 grid grid-cols-3 gap-3">
            {[0, 1, 2].map((j) => (
              <div key={j} className="h-10 rounded-md animate-shimmer" />
            ))}
          </div>
        </div>
      ))}
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────
// 유틸: 제목 폴백 (SessionCard와 동일 규칙)
// ─────────────────────────────────────────────────────────────
function resolveTitle(s: HistorySession): string {
  if (s.title && s.title.trim()) return s.title;
  if (s.session_type === "youtube" && s.source_url) {
    try {
      const u = new URL(s.source_url);
      return `YouTube · ${u.hostname.replace(/^www\./, "")}`;
    } catch {
      return "YouTube 연습";
    }
  }
  return s.session_type === "youtube" ? "YouTube 연습" : "AI 면접";
}

// ─────────────────────────────────────────────────────────────
// 유틸: 날짜 포맷 (상세 페이지는 시각까지 포함)
// ─────────────────────────────────────────────────────────────
function formatDateFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}