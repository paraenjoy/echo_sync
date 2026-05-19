/**
 * MicButton — 마이크 버튼 + 음량 시각화
 *
 * 시각화 전략:
 *  - useAudioStreamer가 노출하는 volume(0~1)을 3개의 동심원 링으로 표현
 *  - 가장 안쪽 링은 즉시 반응, 바깥 링들은 transition으로 약간 느리게 따라옴 → 깊이감
 *  - status에 따라 색상/애니메이션이 바뀜:
 *      idle/error  → 기본 (accent 보더)
 *      connecting  → 펄스 (좀 더 느린)
 *      recording   → 외곽 펄스 + 음량 링
 *      processing  → 회전 인디케이터 (전송 후 분석 대기)
 *      completed   → 체크 표시 후 자동 reset 트리거는 페이지가 담당
 *
 * 접근성:
 *  - aria-pressed로 녹음 토글 상태 노출
 *  - aria-label은 상태별로 변경
 */
import { cn } from "@/lib/utils";
import type { StreamerStatus } from "@/hooks/useAudioStreamer";

interface MicButtonProps {
  status: StreamerStatus;
  /** 0.0 ~ 1.0 정규화된 음량 */
  volume: number;
  /** 클릭 시 동작: idle/error/completed → start, recording → stop */
  onToggle: () => void;
  disabled?: boolean;
}

export function MicButton({ status, volume, onToggle, disabled }: MicButtonProps) {
  const isRecording = status === "recording";
  const isProcessing = status === "processing";
  const isConnecting = status === "connecting";
  const isCompleted = status === "completed";

  // 음량 → 링 크기 (recording 상태에서만 반영)
  // 1.0(중심) ~ 1.45(최대 볼륨) 사이로 스케일
  const ringScale = isRecording ? 1 + volume * 0.45 : 1;

  const label = isRecording
    ? "녹음 중지"
    : isProcessing
      ? "분석 중"
      : isConnecting
        ? "연결 중"
        : "녹음 시작";

  return (
    <div className="relative grid place-items-center w-44 h-44">
      {/* ── 외곽 펄스 (recording 시) ────────────────────────────── */}
      {isRecording && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border border-accent/30 animate-mic-pulse"
        />
      )}

      {/* ── 음량 반응 링 3겹 ──────────────────────────────────── */}
      {isRecording && (
        <>
          <span
            aria-hidden
            className="absolute rounded-full bg-accent/8 transition-transform duration-100 ease-out"
            style={{
              width: "100%",
              height: "100%",
              transform: `scale(${ringScale})`,
            }}
          />
          <span
            aria-hidden
            className="absolute rounded-full bg-accent/12 transition-transform duration-150 ease-out"
            style={{
              width: "80%",
              height: "80%",
              transform: `scale(${1 + volume * 0.3})`,
            }}
          />
          <span
            aria-hidden
            className="absolute rounded-full bg-accent/18 transition-transform duration-75 ease-out"
            style={{
              width: "62%",
              height: "62%",
              transform: `scale(${1 + volume * 0.2})`,
            }}
          />
        </>
      )}

      {/* ── connecting/processing 회전 링 ─────────────────────── */}
      {(isConnecting || isProcessing) && (
        <span
          aria-hidden
          className="absolute inset-4 rounded-full border-2 border-accent/20 border-t-accent animate-spin"
          style={{ animationDuration: "1.4s" }}
        />
      )}

      {/* ── 메인 버튼 ──────────────────────────────────────── */}
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled || isProcessing || isConnecting}
        aria-pressed={isRecording}
        aria-label={label}
        className={cn(
          "relative z-10 grid place-items-center rounded-full transition-all duration-300",
          "w-24 h-24 shadow-lg",
          isRecording
            ? "bg-accent text-accent-fg scale-95"
            : isCompleted
              ? "bg-score-high/20 text-score-high border border-score-high/50"
              : isProcessing || isConnecting
                ? "bg-bg-elevated text-fg-muted border border-border"
                : "bg-bg-elevated text-fg border border-border-strong hover:border-accent hover:text-accent",
          "disabled:cursor-not-allowed"
        )}
      >
        {isCompleted ? <IconCheck /> : isRecording ? <IconStop /> : <IconMic />}
      </button>

      {/* ── 캡션 ────────────────────────────────────────────── */}
      <span
        className={cn(
          "absolute -bottom-2 translate-y-full text-xs tracking-wider uppercase",
          "font-mono tabular-nums",
          isRecording ? "text-accent" : "text-fg-subtle"
        )}
      >
        {label}
      </span>
    </div>
  );
}

/* ─── 아이콘 (의존성 없이 인라인 SVG) ─────────────────────────── */

function IconMic() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}

function IconStop() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
