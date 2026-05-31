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
 * 크기 / 캡션 옵션:
 *  - size="lg"(기본): youtube 메인 인터랙션용 큰 버튼 (컨테이너 176px)
 *  - size="sm": interview footer 등 컴팩트 영역용 (컨테이너 112px)
 *  - showCaption(기본 true): 버튼 하단 status 캡션 표시 여부.
 *    외부에서 별도 안내 문구를 렌더하는 경우(예: interview의 hint) false로 끄면
 *    캡션 중복과 간격 겹침을 피할 수 있다.
 *  - 음량 링/외곽 펄스/캡션 위치는 컨테이너 기준 상대값(%, inset-0, -bottom-2)이라
 *    size에 따라 자동 비례. 컨테이너/메인 버튼/회전 스피너/아이콘만 size로 분기한다.
 *
 * 접근성:
 *  - aria-pressed로 녹음 토글 상태 노출
 *  - aria-label은 상태별로 변경
 *
 * 사용처:
 *  - /youtube (스피킹 연습)            → size 생략(lg), 캡션 사용
 *  - /interview/room (음성 답변)       → size="sm", showCaption={false} + 별도 hint
 */
import { cn } from "@/lib/utils";
import type { StreamerStatus } from "@/hooks/useAudioStreamer";

type MicSize = "lg" | "sm";

/**
 * size별 치수 맵.
 * - wrap/button/spinner는 Tailwind 클래스, icon은 SVG 픽셀 크기
 * - 새 size가 필요하면 이 맵에만 항목을 추가하면 된다(컴포넌트 본문 무수정)
 */
const SIZE: Record<
  MicSize,
  {
    wrap: string;
    button: string;
    spinner: string;
    icon: { mic: number; stop: number; check: number };
  }
> = {
  lg: {
    wrap: "w-44 h-44",
    button: "w-24 h-24",
    spinner: "inset-4",
    icon: { mic: 32, stop: 22, check: 30 },
  },
  sm: {
    wrap: "w-28 h-28",
    button: "w-16 h-16",
    spinner: "inset-3",
    icon: { mic: 24, stop: 16, check: 22 },
  },
};

interface MicButtonProps {
  status: StreamerStatus;
  /** 0.0 ~ 1.0 정규화된 음량 */
  volume: number;
  /** 클릭 시 동작: idle/error/completed → start, recording → stop */
  onToggle: () => void;
  disabled?: boolean;
  /** 버튼/링/아이콘 크기. 기본 "lg" */
  size?: MicSize;
  /** 버튼 하단 status 캡션 표시 여부. 기본 true */
  showCaption?: boolean;
}

export function MicButton({
  status,
  volume,
  onToggle,
  disabled,
  size = "lg",
  showCaption = true,
}: MicButtonProps) {
  const dim = SIZE[size];

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
    <div className={cn("relative grid place-items-center", dim.wrap)}>
      {/* ── 외곽 펄스 (recording 시) ────────────────────────────── */}
      {isRecording && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border border-accent/30 animate-mic-pulse"
        />
      )}

      {/* ── 음량 반응 링 3겹 (컨테이너 기준 %라 size 자동 비례) ──── */}
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
          className={cn(
            "absolute rounded-full border-2 border-accent/20 border-t-accent animate-spin",
            dim.spinner
          )}
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
          dim.button,
          "shadow-lg",
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
        {isCompleted ? (
          <IconCheck size={dim.icon.check} />
        ) : isRecording ? (
          <IconStop size={dim.icon.stop} />
        ) : (
          <IconMic size={dim.icon.mic} />
        )}
      </button>

      {/* ── 캡션 (showCaption일 때만) ──────────────────────────── */}
      {showCaption && (
        <span
          className={cn(
            "absolute -bottom-2 translate-y-full text-xs tracking-wider uppercase",
            "font-mono tabular-nums",
            isRecording ? "text-accent" : "text-fg-subtle"
          )}
        >
          {label}
        </span>
      )}
    </div>
  );
}

/* ─── 아이콘 (의존성 없이 인라인 SVG) ─────────────────────────── */

function IconMic({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}

function IconStop({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function IconCheck({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
