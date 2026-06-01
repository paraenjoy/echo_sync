/**
 * InterviewRoomPage (/interview/room) — 음성 전용 완성본
 *
 * 책임:
 *  - AI 면접관과의 멀티턴 음성 대화 진행
 *  - useAudioStreamer로 답변을 녹음하면, 백엔드 /ws/audio가 채점·코칭과 함께
 *    다음 꼬리질문을 final 메시지(next_question / next_question_id)로 반환한다.
 *    프론트는 그 값을 그대로 다음 턴으로 사용한다(별도 REST 호출 없음).
 *  - 종료는 사용자 주도(면접 종료 버튼) → useFinalizeInterview로 동물 페르소나
 *    리포트 생성 → 히스토리 상세(/history/{id})로 이동.
 *
 * 백엔드 계약 메모(검증 완료):
 *  - POST /interview/answer 는 백엔드에 존재하지 않는다. 꼬리질문은 /ws/audio
 *    final 전용이며, interview_manager.generate_follow_up은 항상 질문을 반환하므로
 *    백엔드발 자동 종료 신호(status 등)도 없다 → 종료는 전적으로 사용자 결정.
 *  - 직전 답변 피드백(점수·WordHeatmap·코칭·오디오)은 UserVoiceBubble이 다음 질문
 *    직전에 그대로 표시하므로 별도 누적/이벤트가 필요 없다.
 *
 * 핵심 흐름:
 *   마이크 클릭 → audio.start() → 녹음 → 재클릭 → audio.stop()
 *   → 서버 분석(asr→scoring→coaching) → audio.status==="completed" 도달 시
 *     1. user-voice 카드 + WS final의 next_question을 messages에 한 번에 push
 *     2. currentQuestion/Id를 꼬리질문으로 갱신, audio.reset()
 *   "면접 종료" → 종료 패널 → finalize.mutate(sessionId)
 *     → 로딩 오버레이(ProcessingSkeleton) → onSuccess navigate(/history/{id})
 *
 * 라우터 state 의존:
 *  - Setup에서 navigate state로 sessionId, questionId, firstQuestion,
 *    position, interviewMode 전달
 *  - state 없으면 (URL 직접 입력, 새로고침 등) Setup으로 redirect
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MicButton } from "@/components/common/MicButton";
import { ErrorModal } from "@/components/common/ErrorModal";
import { ProcessingSkeleton } from "@/components/common/ProcessingSkeleton";
import { WordHeatmap } from "@/components/features/youtube/WordHeatmap";
import { useAudioStreamer } from "@/hooks/useAudioStreamer";
import { useFinalizeInterview } from "@/hooks/queries/useInterviewMutations";
import { getErrorMessage } from "@/lib/api";
import { cn, getScoreTier, scoreTierClasses } from "@/lib/utils";
import { ScoreDisplay } from "@/components/common/ScoreDisplay";
import { AudioPlayer } from "@/components/common/AudioPlayer";
import type { WsFinalResult } from "@/types/ws";

// ─────────────────────────────────────────────────────────────
// 라우터 state 모델 (Setup → Room으로 전달)
// ─────────────────────────────────────────────────────────────
interface RoomLocationState {
  sessionId: number;
  questionId: number;
  firstQuestion: string;
  position: string;
  interviewMode: string;
}

function isValidRoomState(s: unknown): s is RoomLocationState {
  if (!s || typeof s !== "object") return false;
  const v = s as Record<string, unknown>;
  return (
    typeof v.sessionId === "number" &&
    typeof v.questionId === "number" &&
    typeof v.firstQuestion === "string" &&
    typeof v.position === "string" &&
    typeof v.interviewMode === "string"
  );
}

// ─────────────────────────────────────────────────────────────
// 채팅 메시지 모델 (음성 전용)
// ─────────────────────────────────────────────────────────────
export type ChatMessage =
  | { kind: "question"; id: string; questionId: number; text: string }
  | {
      kind: "user-voice";
      id: string;
      transcript: string;
      result: WsFinalResult;
      localAudioUrl: string | null;
    }
  | { kind: "error"; id: string; message: string };

const genId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ─────────────────────────────────────────────────────────────
// 페이지
// ─────────────────────────────────────────────────────────────
export default function InterviewRoomPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state;

  // ── 직접 진입 방어 ─────────────────────────────────────────
  useEffect(() => {
    if (!isValidRoomState(state)) {
      navigate("/interview/setup", { replace: true });
    }
  }, [state, navigate]);

  if (!isValidRoomState(state)) return null;

  // ── 훅 ────────────────────────────────────────────────────
  const audio = useAudioStreamer();
  const finalize = useFinalizeInterview();

  // ── 핵심 상태 ──────────────────────────────────────────────
  const sessionId = state.sessionId;
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      kind: "question",
      id: genId(),
      questionId: state.questionId,
      text: state.firstQuestion,
    },
  ]);
  const [currentQuestionId, setCurrentQuestionId] = useState(state.questionId);
  const [currentQuestion, setCurrentQuestion] = useState(state.firstQuestion);

  // 면접 종료 여부 (백엔드 자동 종료 없음 → 사용자 종료 버튼으로만 true)
  const [ended, setEnded] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  // ── 자동 스크롤 ────────────────────────────────────────────
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages]);

  // ── 음성 결과 중복 처리 방지 ────────────────────────────────
  // useEffect가 result 객체 변화로 재실행될 때 같은 결과를 두 번 반영하지 않도록 가드
  const handledResultRef = useRef<WsFinalResult | null>(null);

  // ── 음성 모드: 결과 도착 → WS final의 꼬리질문으로 진행 ───────
  useEffect(() => {
    if (audio.status !== "completed" || !audio.result) return;
    // 같은 result 객체가 반복 감지되는 경우 무시
    if (handledResultRef.current === audio.result) return;
    handledResultRef.current = audio.result;

    const result = audio.result;
    const transcript = result.user_said;

    // 빈 transcript = STT 인식 실패 → 에러 안내 후 reset (다시 답변 가능)
    if (!transcript || !transcript.trim()) {
      setMessages((prev) => [
        ...prev,
        {
          kind: "error",
          id: genId(),
          message:
            "답변이 인식되지 않았어요. 마이크 가까이에서 다시 말해주세요.",
        },
      ]);
      audio.reset();
      handledResultRef.current = null;
      return;
    }

    // 백엔드(/ws/audio)가 final에 동봉한 다음 꼬리질문
    //  - 현 백엔드(interview_manager.generate_follow_up)는 짧은/정상 답변 모두 항상
    //    질문을 반환하므로 hasFollowUp === false 분기는 사실상 도달하지 않는다.
    //  - 다만 백엔드 정책 변경 시 채팅이 무응답으로 멈추는 것을 막기 위한 안전망으로
    //    error 카드를 보여주는 분기를 유지한다. (제거 금지 — 회귀 방지 목적)
    const nextQuestion = result.next_question;
    const nextQuestionId = result.next_question_id;
    const hasFollowUp =
      typeof nextQuestion === "string" &&
      nextQuestion.trim().length > 0 &&
      typeof nextQuestionId === "number";

    // user-voice 카드 + (있으면) 다음 질문을 한 번에 반영
    setMessages((prev) => [
      ...prev,
      {
        kind: "user-voice",
        id: genId(),
        transcript,
        result,
        localAudioUrl: audio.localAudioUrl,
      },
      ...(hasFollowUp
        ? [
            {
              kind: "question" as const,
              id: genId(),
              questionId: nextQuestionId as number,
              text: nextQuestion as string,
            },
          ]
        : [
            {
              kind: "error" as const,
              id: genId(),
              message:
                "다음 질문이 생성되지 않았어요. 다시 답하거나 면접을 종료할 수 있어요.",
            },
          ]),
    ]);

    // 다음 답변 대상 질문 갱신 (꼬리질문이 있을 때만)
    if (hasFollowUp) {
      setCurrentQuestion(nextQuestion as string);
      setCurrentQuestionId(nextQuestionId as number);
    }

    // streamer는 다음 답변 위해 idle 상태로 복원
    audio.reset();
    handledResultRef.current = null;
    // ⚠️ deps에 audio 전체를 넣으면 매 렌더 재실행 위험. 안정화된 값만 의존.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.status, audio.result]);

  // ── 음성 모드: 마이크 토글 ─────────────────────────────────
  const handleMicToggle = () => {
    if (audio.status === "recording") {
      audio.stop();
    } else if (audio.status === "idle" || audio.status === "error") {
      audio.start({
        sessionId,
        questionId: currentQuestionId,
        questionText: currentQuestion,
      });
    }
  };

  // ── 모드 라벨 ──────────────────────────────────────────────
  const modeLabel = useMemo(() => {
    const map: Record<string, string> = {
      "Friendly and Supportive": "친절한 멘토",
      "Sharp and Analytical": "날카로운 분석",
      "Aggressive Stress Interview": "압박 면접",
    };
    return map[state.interviewMode] ?? state.interviewMode;
  }, [state.interviewMode]);

  // ── 종료 → 페르소나 리포트 생성 후 상세로 이동 ───────────────
  const finalizeAndGoToReport = useCallback(() => {
    if (finalize.isPending) return;
    setFinalizeError(null);
    finalize.mutate(sessionId, {
      onSuccess: (data) => {
        // finalize는 데이터 부족 시 200 + status:"error"로 응답
        if (data.status === "error" || !data.session_id) {
          setFinalizeError(
            data.animal_reason ||
              "리포트를 생성하기에 답변 데이터가 부족해요. 조금 더 진행한 뒤 다시 시도해주세요."
          );
          return;
        }
        navigate(`/history/${sessionId}`, { replace: true });
      },
      onError: (err) => setFinalizeError(getErrorMessage(err)),
    });
  }, [finalize, sessionId, navigate]);

  // 헤더 종료: 진행 중이면 이탈만(리포트 없음)
  const handleExit = () => {
    if (finalize.isPending) return;
    const ok = window.confirm(
      "면접을 나가시겠어요? 진행 내역은 저장되어 있어요. (결과 리포트는 종료 후 생성할 수 있어요)"
    );
    if (ok) navigate("/", { replace: true });
  };

  const questionCount = messages.filter((m) => m.kind === "question").length;
  // 분석/연결 중에만 마이크·종료 잠금
  const inputDisabled =
    audio.status === "processing" || audio.status === "connecting";

  return (
    <main className="min-h-dvh bg-bg text-fg flex flex-col">
      {/* ── 헤더 (sticky) ─────────────────────────────────── */}
      <header className="border-b border-border bg-bg/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle mb-0.5">
              AI Interview
            </p>
            <h1 className="font-display text-lg truncate leading-tight">
              <span className="text-fg">{state.position}</span>
              <span className="text-fg-subtle mx-2">·</span>
              <span className="text-accent">{modeLabel}</span>
            </h1>
          </div>
          <button
            type="button"
            onClick={handleExit}
            disabled={finalize.isPending}
            className="shrink-0 mr-12 text-xs font-mono uppercase tracking-wider text-fg-subtle hover:text-fg transition-colors px-2 py-1 disabled:opacity-50"
          >
            나가기
          </button>
        </div>
      </header>

      {/* ── 채팅 영역 ─────────────────────────────────────── */}
      <section
        className="flex-1 overflow-y-auto"
        aria-live="polite"
        aria-label="면접 대화"
      >
        <div className="mx-auto max-w-3xl px-6 py-10 space-y-8">
          {messages.map((msg) => (
            <ChatMessageView key={msg.id} message={msg} />
          ))}
          <div ref={scrollAnchorRef} aria-hidden />
        </div>
      </section>

      {/* ── 입력/종료 영역 (sticky bottom) ─────────────────── */}
      <footer className="border-t border-border bg-bg-elevated/40 backdrop-blur-sm sticky bottom-0 z-20">
        <div className="mx-auto max-w-3xl px-6 py-5">
          {ended ? (
            <EndPanel
              onViewReport={finalizeAndGoToReport}
              onLater={() => navigate("/", { replace: true })}
              pending={finalize.isPending}
              error={finalizeError}
            />
          ) : (
            <>
              {/* 질문 카운터 + 사용자 종료 (백엔드 자동 종료 없음) */}
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-mono uppercase tracking-wider text-fg-subtle tabular-nums">
                  Question #{questionCount}
                </p>
                <button
                  type="button"
                  onClick={() => setEnded(true)}
                  disabled={inputDisabled}
                  className="text-xs font-mono uppercase tracking-wider text-fg-subtle hover:text-accent transition-colors disabled:opacity-50"
                >
                  면접 종료 →
                </button>
              </div>

              {/* 음성 입력 위젯 (음성 전용) */}
              <VoiceInputPanel
                status={audio.status}
                volume={audio.volume}
                onToggle={handleMicToggle}
                disabled={inputDisabled}
              />
            </>
          )}
        </div>
      </footer>

      {/* ── 음성 에러 모달 (페이지 오버레이) ──────────────────── */}
      {audio.status === "error" && audio.error && (
        <ErrorModal
          error={audio.error}
          onDismiss={audio.reset}
          onRetry={
            audio.error.code === "NETWORK_ERROR" ||
            audio.error.code === "DEVICE_NOT_FOUND"
              ? () => {
                  audio.reset();
                  audio.start({
                    sessionId,
                    questionId: currentQuestionId,
                    questionText: currentQuestion,
                  });
                }
              : undefined
          }
        />
      )}

      {/* ── 페르소나 생성 로딩 오버레이 ──────────────────────── */}
      {finalize.isPending && <FinalizeOverlay />}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────
// 종료 패널 — 면접 종료 후 리포트 생성 진입점
// ─────────────────────────────────────────────────────────────
function EndPanel({
  onViewReport,
  onLater,
  pending,
  error,
}: {
  onViewReport: () => void;
  onLater: () => void;
  pending: boolean;
  error: string | null;
}) {
  return (
    <div className="text-center py-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle mb-2">
        Interview complete
      </p>
      <p className="text-sm text-fg-muted mb-4">
        면접이 끝났어요. 동물 페르소나 리포트를 만들어 결과를 확인해보세요.
      </p>

      {error && (
        <p className="mx-auto mb-4 max-w-md rounded-md border border-score-low/30 bg-score-low/10 px-3 py-2 text-sm text-score-low">
          {error}
        </p>
      )}

      <div className="flex items-center justify-center gap-2">
        <Button variant="primary" onClick={onViewReport} disabled={pending}>
          {pending ? "리포트 생성 중…" : "결과 리포트 보기"}
        </Button>
        <Button variant="ghost" onClick={onLater} disabled={pending}>
          나중에
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 페르소나 생성 로딩 오버레이 (무거운 AI 호출 마스킹)
// ─────────────────────────────────────────────────────────────
function FinalizeOverlay() {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-bg/90 p-6 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-md">
        <p className="mb-2 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
          Generating report
        </p>
        <h2 className="mb-3 text-center font-display text-2xl leading-tight">
          면접 데이터를 분석하고 있어요
        </h2>
        <p className="mb-8 text-center text-sm leading-relaxed text-fg-muted">
          답변을 종합해 동물 페르소나와 총평, 기술 스택 비중을 만드는 중이에요.
          잠시만 기다려주세요.
        </p>
        <ProcessingSkeleton />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ChatMessageView — kind별 렌더링 분기
// ─────────────────────────────────────────────────────────────
function ChatMessageView({ message }: { message: ChatMessage }) {
  switch (message.kind) {
    case "question":
      return <QuestionBubble text={message.text} />;
    case "user-voice":
      return (
        <UserVoiceBubble
          transcript={message.transcript}
          result={message.result}
          localAudioUrl={message.localAudioUrl}
        />
      );
    case "error":
      return <ErrorBubble message={message.message} />;
  }
}

// ─────────────────────────────────────────────────────────────
// 채팅 버블
// ─────────────────────────────────────────────────────────────

function QuestionBubble({ text }: { text: string }) {
  return (
    <div className="max-w-[88%] animate-fade-up">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle mb-2">
        AI 면접관
      </p>
      <p className="font-display text-2xl leading-snug text-fg">{text}</p>
    </div>
  );
}

function ErrorBubble({ message }: { message: string }) {
  return (
    <div className="max-w-[88%] mx-auto animate-fade-up">
      <div className="bg-score-low/10 border border-score-low/40 rounded-md px-4 py-3">
        <p className="text-[10px] font-mono uppercase tracking-wider text-score-low mb-1">
          오류
        </p>
        <p className="text-sm text-fg">{message}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// UserVoiceBubble — 음성 답변 결과 카드
//
// 디자인:
//  - 기본: transcript + 점수 3개 (인지 부하 최소화)
//  - <details>로 접이식: 펼치면 WordHeatmap + AI 피드백 + 로컬 오디오
//  - 채팅 흐름이 거대한 결과 카드로 깨지지 않도록 설계
// ─────────────────────────────────────────────────────────────
function UserVoiceBubble({
  transcript,
  result,
  localAudioUrl,
}: {
  transcript: string;
  result: WsFinalResult;
  localAudioUrl: string | null;
}) {
  const tier = getScoreTier(result.score.accuracy);
  const tierCls = scoreTierClasses[tier];

  return (
    <div className="max-w-[88%] ml-auto animate-fade-up">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle mb-2 text-right">
        내 답변 · 음성
      </p>

      <div className="bg-bg-elevated border border-border rounded-xl rounded-tr-sm overflow-hidden">
        {/* ── transcript ─────────────────────────────────── */}
        <div className="px-5 py-4">
          <p
            className={cn(
              "font-display text-base leading-relaxed",
              tierCls.text
            )}
          >
            “{transcript}”
          </p>
        </div>

        {/* ── 점수 라인 ───────────────────────────────────── */}
        <div className="px-5 py-3 border-t border-border bg-bg-subtle/40">
          <div className="grid grid-cols-3 gap-3">
            <ScoreDisplay label="Accuracy" value={result.score.accuracy} size="sm" />
            <ScoreDisplay label="Pronunciation" value={result.score.pronunciation} size="sm" />
            <ScoreDisplay label="Fluency" value={result.score.fluency} size="sm" />
          </div>
        </div>

        {/* ── 접이식 상세 분석 ──────────────────────────────── */}
        <details className="group border-t border-border">
          <summary
            className={cn(
              "cursor-pointer list-none px-5 py-3",
              "text-xs font-mono uppercase tracking-wider text-fg-subtle",
              "hover:text-accent transition-colors flex items-center gap-2"
            )}
          >
            <span className="inline-block transition-transform group-open:rotate-90">
              ▸
            </span>
            <span>발음 분석 자세히 보기</span>
          </summary>

          <div className="px-5 pb-5 pt-1 space-y-5">
            {/* WordHeatmap */}
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle mb-2">
                Word Breakdown
              </p>
              <WordHeatmap words={result.words} />
            </div>

            {/* AI 피드백 */}
            {result.feedback && (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle mb-2">
                  Coaching
                </p>
                <p className="text-sm text-fg leading-relaxed whitespace-pre-line">
                  {result.feedback}
                </p>
              </div>
            )}

            {/* 음성 비교 */}
            {(localAudioUrl || result.model_tts_url) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {localAudioUrl && (
                  <AudioPlayer label="내 음성" src={localAudioUrl} />
                )}
                {result.model_tts_url && (
                  <AudioPlayer label="모범 답안" src={result.model_tts_url} />
                )}
              </div>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 입력 패널 — 음성 모드
// ─────────────────────────────────────────────────────────────
function VoiceInputPanel({
  status,
  volume,
  onToggle,
  disabled,
}: {
  status: ReturnType<typeof useAudioStreamer>["status"];
  volume: number;
  onToggle: () => void;
  disabled: boolean;
}) {
  const hint =
    status === "recording"
      ? "답변이 끝나면 마이크를 다시 눌러주세요"
      : status === "processing"
        ? "음성을 분석하고 있어요"
        : status === "connecting"
          ? "마이크를 연결하고 있어요"
          : "마이크를 눌러 답변을 시작하세요";

  return (
    <div className="grid place-items-center py-2">
      <MicButton
        size="sm"
        showCaption={false}
        status={status}
        volume={volume}
        onToggle={onToggle}
        disabled={disabled}
      />
      <p className="mt-4 text-xs text-fg-subtle font-mono uppercase tracking-wider">
        {hint}
      </p>
    </div>
  );
}
