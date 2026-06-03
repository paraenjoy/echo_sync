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
import { WordAnalysis } from "@/components/features/youtube/WordAnalysis";
import { useAudioStreamer } from "@/hooks/useAudioStreamer";
import { useFinalizeInterview } from "@/hooks/queries/useInterviewMutations";
import { getErrorMessage } from "@/lib/api";
import { cn, getScoreTier, scoreTierClasses } from "@/lib/utils";
import { ScoreDisplay } from "@/components/common/ScoreDisplay";
import { AudioPlayer } from "@/components/common/AudioPlayer";
import { WaveformVisualizer } from "@/components/common/WaveformVisualizer";
import { TypingIndicator } from "@/components/common/TypingIndicator";
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
  maxQuestions: number;
}

function isValidRoomState(s: unknown): s is RoomLocationState {
  if (!s || typeof s !== "object") return false;
  const v = s as Record<string, unknown>;
  return (
    typeof v.sessionId === "number" &&
    typeof v.questionId === "number" &&
    typeof v.firstQuestion === "string" &&
    typeof v.position === "string" &&
    typeof v.interviewMode === "string" &&
    typeof v.maxQuestions === "number"
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
  | { kind: "error"; id: string; message: string }
  | { kind: "completion"; id: string; questionCount: number };

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
    // audio.status를 deps에 포함 → processing 진입 시 TypingIndicator 위치까지
    // 부드럽게 스크롤된다 (Step 11-C).
  }, [messages, audio.status]);

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

    // 현재까지의 질문 수 (이번 응답 처리 직전 기준).
    // 백엔드가 next_question=null을 보낸 경우, 이 값이 한계와 같거나 크면
    // "한계 도달 → 자연 종료(completion)", 그 외는 안전망(에러 카드)로 분기한다.
    const currentQuestionCount = messages.filter(
      (m) => m.kind === "question"
    ).length;

    // Step 10-C2 정상 종료 판정: 백엔드(C-1)가 5번째(또는 사용자가 정한 N번째)
    // 답변 후 의도적으로 next_question=null을 보낸 케이스인지 판별.
    // questionCount는 messages 기준이므로 첫 질문 이후 매 턴 자연스럽게 증가한다.
    const reachedLimit =
      !hasFollowUp && currentQuestionCount >= state.maxQuestions;

    // user-voice 카드 + (다음 질문 / 정상 종료 / 안전망 에러) 중 하나를 한 번에 반영
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
        : reachedLimit
        ? [
            {
              kind: "completion" as const,
              id: genId(),
              questionCount: currentQuestionCount,
            },
          ]
        : [
            {
              // 안전망: 백엔드가 한계 도달이 아닌데도 null을 보낸 경우.
              // 제거 금지 — 회귀 방지 목적.
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

    // 한계 도달 → 자동으로 종료 패널로 전환 (사용자가 "면접 종료" 버튼을
    // 누르지 않아도 흐름이 자연스럽게 finalize 진입점에 도달)
    if (reachedLimit) {
      setEnded(true);
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
          {/* ── 분석 중 타이핑 인디케이터 (Step 11-C) ─────────────
              processing 동안만 transient하게 노출. 메시지 큐와 분리되어
              있어 completed 전환 시 자동으로 unmount되며, user-voice +
              next question 카드가 그 자리를 자연스럽게 메운다. */}
          {audio.status === "processing" && <TypingIndicator />}
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
                analyser={audio.analyser}
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
    case "completion":
      return <CompletionBubble questionCount={message.questionCount} />;
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
// CompletionBubble — 한계 도달로 자연 종료된 면접의 완료 알림
//
// 디자인 의도 (Step 10-C2):
//  - 에러 톤 아님: 사용자가 setup에서 정한 분량을 모두 답변한 정상 종료.
//  - accent 톤 보더 + 체크 마크로 긍정적 마무리 신호.
//  - 직후 자동으로 EndPanel이 노출되므로, 별도 CTA 없이 안내문 역할만 담당.
// ─────────────────────────────────────────────────────────────
function CompletionBubble({ questionCount }: { questionCount: number }) {
  return (
    <div className="max-w-[88%] mx-auto animate-fade-up">
      <div className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <CheckIcon />
          <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-accent">
            Interview complete
          </p>
        </div>
        <p className="text-sm text-fg leading-relaxed">
          설정하신 <span className="tabular-nums font-display">{questionCount}</span>개
          질문에 모두 답변하셨어요. 아래에서 페르소나 리포트를 생성할 수 있어요.
        </p>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-accent"
      aria-hidden
    >
      <path d="M2.5 7.5l3 3 6-6" />
    </svg>
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
              <WordAnalysis words={result.words} audioUrl={result.user_tts_url} />
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
//
// 스톱워치 (Step 10-C3):
//  - status === "recording" 동안 0:00부터 카운트업, 그 외엔 숨김
//  - 권장 시간: 90초까지 기본 톤, 90~120초 주의(score-mid), 120초+ 경고(score-low)
//  - 강제 정지는 하지 않는다 — 답변 중 생각 시간을 차단하지 않도록 사용자 자율에 맡김
//  - 1초마다 읽히면 스크린리더에 부담이라 시계 자체는 aria-hidden, 임계치 메시지만
//    role="status" + aria-live="polite"로 한 번 안내
// ─────────────────────────────────────────────────────────────
function VoiceInputPanel({
  status,
  volume,
  analyser,
  onToggle,
  disabled,
}: {
  status: ReturnType<typeof useAudioStreamer>["status"];
  volume: number;
  analyser: AnalyserNode | null;
  onToggle: () => void;
  disabled: boolean;
}) {
  const isRecording = status === "recording";

  // 권장 시간 임계치 (초)
  const WARN_AT = 90; // 1:30 — 주의
  const ALERT_AT = 120; // 2:00 — 경고

  // 녹음 경과 시간(초). recording 진입 시 0으로 리셋되고, 다른 상태로 빠지면 정지.
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isRecording) {
      setElapsed(0);
      return;
    }
    // Date.now 기준으로 계산 → 탭이 비활성됐다가 돌아와도 정확한 경과를 복원
    const startedAt = Date.now();
    setElapsed(0);
    // 0.25초 간격으로 polling — 표시는 초 단위이지만 부드러운 동기화 확보
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [isRecording]);

  // 임계치별 톤 분기
  const tone =
    elapsed >= ALERT_AT
      ? "score-low"
      : elapsed >= WARN_AT
        ? "score-mid"
        : null;
  const timerColorCls =
    tone === "score-low"
      ? "text-score-low"
      : tone === "score-mid"
        ? "text-score-mid"
        : "text-fg-muted";

  const mm = Math.floor(elapsed / 60);
  const ss = elapsed % 60;
  const timeStr = `${mm}:${ss.toString().padStart(2, "0")}`;

  const hint = isRecording
    ? "답변이 끝나면 마이크를 다시 눌러주세요"
    : status === "processing"
      ? "음성을 분석하고 있어요"
      : status === "connecting"
        ? "마이크를 연결하고 있어요"
        : "마이크를 눌러 답변을 시작하세요";

  return (
    <div className="grid place-items-center py-2">
      {/* ── 스톱워치 (recording 동안만) ───────────────────────── */}
      {isRecording && (
        <div className="mb-3 text-center min-h-[44px]">
          <p
            className={cn(
              "font-display tabular-nums text-2xl leading-none transition-colors",
              timerColorCls
            )}
            aria-hidden
          >
            {timeStr}
          </p>
          {tone && (
            <p
              role="status"
              aria-live="polite"
              className={cn(
                "mt-1 text-[10px] font-mono uppercase tracking-wider transition-colors",
                timerColorCls
              )}
            >
              {tone === "score-low"
                ? "답변이 길어요 — 마무리해주세요"
                : "권장 시간을 넘었어요"}
            </p>
          )}
        </div>
      )}

      {/* ── 실시간 파형 (Step 11-B) ─────────────────────────────
          - recording 동안만 활성. 그 외엔 컴포넌트가 자체적으로 idle 처리
          - 마이크 위에 배치 — 입력 신호를 마이크로 흘려보내는 시각적 흐름
          - sm 마이크(112px) 폭에 맞춰 192px(w-48)로 비례 */}
      <WaveformVisualizer
        analyser={analyser}
        active={isRecording}
        bars={28}
        height={28}
        className="mb-3 w-48"
      />

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
