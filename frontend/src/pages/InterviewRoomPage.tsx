/**
 * InterviewRoomPage (/interview/room) — 완성본
 *
 * 책임:
 *  - AI 면접관과의 멀티턴 대화 진행
 *  - 음성 모드: useAudioStreamer로 답변 → 결과 transcript을 자동으로 답변 제출
 *  - 텍스트 모드: Textarea로 답변 → useSubmitAnswer 호출
 *  - 각 턴: 사용자 답변 → 꼬리질문 → 다시 답변 → ...
 *  - 종료(status === "end" 또는 사용자 종료) → useFinalizeInterview로 동물 페르소나 리포트
 *    생성 → 히스토리 상세(/history/{id})로 이동 (Step 9, Implementation.md §2-C)
 *
 * 라우터 state 의존:
 *  - Setup에서 navigate state로 sessionId, questionId, firstQuestion,
 *    position, interviewMode 전달
 *  - state 없으면 (URL 직접 입력, 새로고침 등) Setup으로 redirect
 *
 * 직전 답변 피드백:
 *  - 음성 답변의 WsFinalResult(점수·WordHeatmap·코칭·오디오)는 UserVoiceBubble이
 *    다음 질문 직전에 그대로 표시하므로 별도 누적/이벤트가 필요 없다.
 *
 * 핵심 흐름:
 *
 *   [음성 모드]
 *     사용자 클릭 → audio.start() → 녹음 중
 *     사용자 재클릭 → audio.stop() → 서버 분석 대기(asr→scoring→coaching)
 *     audio.status === "completed" 도달 →
 *       1. messages에 user-voice + processing 추가
 *       2. submitMutation.mutate(transcript)
 *       3. audio.reset()
 *     submitMutation.onSuccess →
 *       1. processing 제거 + 새 question 추가
 *       2. status === "end"면 ended=true (종료 패널), 아니면 currentQuestion/Id 갱신
 *
 *   [텍스트 모드]
 *     사용자 입력 + 전송 → user-text + processing 추가 → mutate → onSuccess(위와 동일)
 *
 *   [종료]
 *     종료 패널 "결과 리포트 보기" 또는 헤더 종료 → finalize.mutate(sessionId)
 *       → 로딩 오버레이(ProcessingSkeleton) → onSuccess navigate(/history/{id})
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MicButton } from "@/components/common/MicButton";
import { ErrorModal } from "@/components/common/ErrorModal";
import { ProcessingSkeleton } from "@/components/common/ProcessingSkeleton";
import { WordHeatmap } from "@/components/features/youtube/WordHeatmap";
import { useAudioStreamer } from "@/hooks/useAudioStreamer";
import {
  useSubmitAnswer,
  useFinalizeInterview,
} from "@/hooks/queries/useInterviewMutations";
import { getErrorMessage } from "@/lib/api";
import { cn, getScoreTier, scoreTierClasses } from "@/lib/utils";
import { ScoreDisplay } from "@/components/common/ScoreDisplay";
import { AudioPlayer } from "@/components/common/AudioPlayer";
import type { WsFinalResult } from "@/types/ws";
import type { InterviewAnswerResponse } from "@/types/interview";

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
// 채팅 메시지 모델
// ─────────────────────────────────────────────────────────────
export type ChatMessage =
  | { kind: "question"; id: string; questionId: number; text: string }
  | { kind: "user-text"; id: string; text: string }
  | {
      kind: "user-voice";
      id: string;
      transcript: string;
      result: WsFinalResult;
      localAudioUrl: string | null;
    }
  | { kind: "processing"; id: string; label?: string }
  | { kind: "error"; id: string; message: string };

type InputMode = "voice" | "text";

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
  const submitMutation = useSubmitAnswer();
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
  const [mode, setMode] = useState<InputMode>("voice");
  const [textAnswer, setTextAnswer] = useState("");

  // 면접 종료 여부 (백엔드 status==="end" 또는 사용자 종료)
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

  // ── processing 추적 ───────────────────────────────────────
  // mutation 종료 시 제거하기 위한 ID. ref라 state 갱신을 트리거하지 않음.
  const processingIdRef = useRef<string | null>(null);

  // ── 음성 결과 중복 제출 방지 ────────────────────────────────
  // useEffect가 result 객체 변화로 재실행될 때 같은 결과를 두 번 보내지 않도록 가드
  const submittedResultRef = useRef<WsFinalResult | null>(null);

  // ── 메시지 헬퍼 ───────────────────────────────────────────
  const appendMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const removeMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  // ── mutation 콜백 ─────────────────────────────────────────
  const handleAnswerSuccess = useCallback(
    (data: InterviewAnswerResponse) => {
      // 1) processing 자리표시자 제거
      if (processingIdRef.current) {
        removeMessage(processingIdRef.current);
        processingIdRef.current = null;
      }
      // 2) 새 질문(또는 종료 멘트) push
      appendMessage({
        kind: "question",
        id: genId(),
        questionId: data.next_question_id,
        text: data.follow_up,
      });
      // 3) 종료 신호면 입력을 닫고 종료 패널로, 아니면 현재 질문 갱신
      if (data.status === "end") {
        setEnded(true);
      } else {
        setCurrentQuestion(data.follow_up);
        setCurrentQuestionId(data.next_question_id);
      }
    },
    [appendMessage, removeMessage]
  );

  const handleAnswerError = useCallback(
    (err: unknown) => {
      if (processingIdRef.current) {
        removeMessage(processingIdRef.current);
        processingIdRef.current = null;
      }
      appendMessage({
        kind: "error",
        id: genId(),
        message: getErrorMessage(err),
      });
    },
    [appendMessage, removeMessage]
  );

  // ── 답변 제출 (음성/텍스트 공통) ───────────────────────────
  const submitAnswer = useCallback(
    (userAnswer: string) => {
      submitMutation.mutate(
        {
          session_id: sessionId,
          current_question_id: currentQuestionId,
          current_question: currentQuestion,
          user_answer: userAnswer,
        },
        {
          onSuccess: handleAnswerSuccess,
          onError: handleAnswerError,
        }
      );
    },
    [
      submitMutation,
      sessionId,
      currentQuestionId,
      currentQuestion,
      handleAnswerSuccess,
      handleAnswerError,
    ]
  );

  // ── 음성 모드: 결과 도착 → 자동 답변 제출 ───────────────────
  useEffect(() => {
    if (audio.status !== "completed" || !audio.result) return;

    // 중복 트리거 방어: 같은 result 객체가 반복 감지되는 경우 무시
    if (submittedResultRef.current === audio.result) return;
    submittedResultRef.current = audio.result;

    const transcript = audio.result.user_said;

    // 빈 transcript는 STT가 인식 실패한 케이스 → 에러 메시지 후 reset
    if (!transcript || !transcript.trim()) {
      appendMessage({
        kind: "error",
        id: genId(),
        message:
          "답변이 인식되지 않았어요. 마이크 가까이에서 다시 말해주세요.",
      });
      audio.reset();
      submittedResultRef.current = null;
      return;
    }

    // 사용자 음성 답변 카드 + processing 자리표시자 push
    const procId = genId();
    setMessages((prev) => [
      ...prev,
      {
        kind: "user-voice",
        id: genId(),
        transcript,
        result: audio.result!,
        localAudioUrl: audio.localAudioUrl,
      },
      { kind: "processing", id: procId, label: "꼬리질문을 만들고 있어요" },
    ]);
    processingIdRef.current = procId;

    // 백엔드로 답변 전송
    submitAnswer(transcript);

    // streamer는 다음 답변 위해 idle 상태로 복원
    audio.reset();
    submittedResultRef.current = null;
    // ⚠️ deps에 audio 전체를 넣으면 매 렌더 재실행 위험. 안정화된 메서드만 의존.
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

  // ── 텍스트 모드: 전송 ──────────────────────────────────────
  const handleTextSubmit = () => {
    const trimmed = textAnswer.trim();
    if (!trimmed || submitMutation.isPending) return;

    const procId = genId();
    setMessages((prev) => [
      ...prev,
      { kind: "user-text", id: genId(), text: trimmed },
      { kind: "processing", id: procId, label: "꼬리질문을 만들고 있어요" },
    ]);
    processingIdRef.current = procId;
    setTextAnswer("");

    submitAnswer(trimmed);
  };

  // Cmd/Ctrl + Enter 단축키
  const handleTextareaKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleTextSubmit();
    }
  };

  // ── 모드 전환 시 모드 간 잔존물 정리 ─────────────────────────
  const handleModeChange = (next: InputMode) => {
    if (next === mode) return;
    if (next === "text" && audio.status !== "idle") audio.reset();
    if (next === "voice") setTextAnswer("");
    setMode(next);
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

  // 헤더 종료: 진행 중이면 이탈만(리포트 없음), 종료 상태면 동일 흐름
  const handleExit = () => {
    if (finalize.isPending) return;
    const ok = window.confirm(
      "면접을 나가시겠어요? 진행 내역은 저장되어 있어요. (결과 리포트는 종료 후 생성할 수 있어요)"
    );
    if (ok) navigate("/", { replace: true });
  };

  const questionCount = messages.filter((m) => m.kind === "question").length;
  const inputDisabled = submitMutation.isPending;

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
              {/* 모드 토글 + 질문 카운터 */}
              <div className="flex items-center justify-between mb-4">
                <ModeToggle mode={mode} onChange={handleModeChange} />
                <p className="text-[10px] font-mono uppercase tracking-wider text-fg-subtle tabular-nums">
                  Question #{questionCount}
                </p>
              </div>

              {/* 모드별 입력 위젯 */}
              {mode === "voice" ? (
                <VoiceInputPanel
                  status={audio.status}
                  volume={audio.volume}
                  onToggle={handleMicToggle}
                  disabled={inputDisabled}
                />
              ) : (
                <TextInputPanel
                  value={textAnswer}
                  onChange={setTextAnswer}
                  onSubmit={handleTextSubmit}
                  onKeyDown={handleTextareaKeyDown}
                  disabled={inputDisabled}
                  isPending={submitMutation.isPending}
                />
              )}
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
    case "user-text":
      return <UserBubble text={message.text} />;
    case "user-voice":
      return (
        <UserVoiceBubble
          transcript={message.transcript}
          result={message.result}
          localAudioUrl={message.localAudioUrl}
        />
      );
    case "processing":
      return <ProcessingBubble label={message.label} />;
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

function UserBubble({ text }: { text: string }) {
  return (
    <div className="max-w-[88%] ml-auto animate-fade-up">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle mb-2 text-right">
        내 답변
      </p>
      <div className="bg-bg-elevated border border-border rounded-xl rounded-tr-sm px-5 py-4">
        <p className="text-sm text-fg leading-relaxed whitespace-pre-wrap">
          {text}
        </p>
      </div>
    </div>
  );
}

function ProcessingBubble({ label }: { label?: string }) {
  return (
    <div className="max-w-[88%] ml-auto animate-fade-up">
      <div className="bg-bg-elevated border border-border rounded-xl rounded-tr-sm px-5 py-4 flex items-center gap-3">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-75 animate-ping" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
        </span>
        <p className="text-sm text-fg-muted">
          {label ?? "답변을 분석하고 있어요"}
        </p>
      </div>
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
// ModeToggle — voice ↔ text 세그먼트 컨트롤
// ─────────────────────────────────────────────────────────────
function ModeToggle({
  mode,
  onChange,
}: {
  mode: InputMode;
  onChange: (m: InputMode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="답변 입력 방식"
      className="inline-flex p-1 rounded-md bg-bg-elevated border border-border"
    >
      <ModeToggleButton
        active={mode === "voice"}
        onClick={() => onChange("voice")}
        label="음성"
      />
      <ModeToggleButton
        active={mode === "text"}
        onClick={() => onChange("text")}
        label="텍스트"
      />
    </div>
  );
}

function ModeToggleButton({
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
        "px-3 py-1 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors",
        active ? "bg-bg-subtle text-fg" : "text-fg-subtle hover:text-fg"
      )}
    >
      {label}
    </button>
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

// ─────────────────────────────────────────────────────────────
// 입력 패널 — 텍스트 모드
// ─────────────────────────────────────────────────────────────
function TextInputPanel({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  disabled,
  isPending,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled: boolean;
  isPending: boolean;
}) {
  return (
    <div className="space-y-3">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="답변을 입력해주세요. (Cmd/Ctrl + Enter로 전송)"
        rows={4}
        disabled={disabled}
        className="min-h-[112px]"
      />
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono uppercase tracking-wider text-fg-subtle">
          {isPending ? "전송 중" : "Cmd / Ctrl + Enter"}
        </p>
        <Button
          onClick={onSubmit}
          disabled={!value.trim() || disabled}
          size="md"
        >
          {isPending ? "전송 중..." : "전송"}
        </Button>
      </div>
    </div>
  );
}
