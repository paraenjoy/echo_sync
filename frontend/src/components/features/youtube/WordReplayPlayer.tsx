/**
 * WordReplayPlayer — 선택된 단어의 정확한 발음 구간 재생
 *
 * 동작:
 *  - user_tts_url(사용자가 한 말을 Azure TTS로 정확히 발음한 음성) 안에서
 *    word.start ~ word.end 구간만 재생한다. (Step 11-D)
 *  - word prop이 새 단어로 바뀌면 자동으로 1회 재생 (클릭 = 즉시 듣기).
 *  - 재생/일시정지 토글 + "다시 듣기" 컨트롤.
 *
 * 사용:
 *  - WordHeatmap 단어 클릭 → 부모가 selectedWord 갱신 → 이 컴포넌트가 재생.
 *  - start/end가 없는 단어는 WordHeatmap에서 클릭 비활성 처리하므로
 *    여기서는 방어적으로만 체크한다.
 *
 * 구간 제어:
 *  - 단일 <audio>(컨트롤 숨김) + timeupdate에서 end 도달 시 pause.
 *  - rAF 대신 timeupdate 이벤트로 충분 — 구간 경계 정밀도가 학습 용도에 적합하고
 *    구현이 단순하다.
 *
 * 디자인:
 *  - 디자인 토큰만 소비 (--bg-elevated / --border / --accent / --fg*).
 *  - 인라인 SVG 아이콘 (프로젝트 컨벤션 — 아이콘 라이브러리 미사용).
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { WsWord } from "@/types/ws";

interface WordReplayPlayerProps {
  /** 재생 소스 — user_tts_url (없으면 비활성 안내) */
  audioUrl: string | null;
  /** 현재 선택된 단어 (null이면 안내 상태) */
  word: WsWord | null;
  className?: string;
}

export function WordReplayPlayer({
  audioUrl,
  word,
  className,
}: WordReplayPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasTiming =
    !!word &&
    typeof word.start === "number" &&
    typeof word.end === "number" &&
    (word.end as number) > (word.start as number);

  // 구간 재생 — currentTime을 start로 옮기고 play
  const playSegment = () => {
    const el = audioRef.current;
    if (!el || !hasTiming || !word) return;
    setError(null);
    try {
      el.currentTime = word.start as number;
      const p = el.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => setError("재생할 수 없어요."));
      }
    } catch {
      setError("재생할 수 없어요.");
    }
  };

  // 선택 단어가 바뀌면 자동 재생 (클릭 = 즉시 듣기)
  useEffect(() => {
    if (hasTiming && audioUrl) {
      playSegment();
    } else {
      audioRef.current?.pause();
      setIsPlaying(false);
    }
    // word 참조 변화로 트리거 (부모가 매 클릭 새 객체를 전달한다고 가정).
    // playSegment는 클로저로 최신 word를 잡으므로 deps에서 제외해도 안전.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word, audioUrl]);

  // end 도달 시 구간 정지
  const handleTimeUpdate = () => {
    const el = audioRef.current;
    if (!el || !word || typeof word.end !== "number") return;
    if (el.currentTime >= word.end) {
      el.pause();
      setIsPlaying(false);
    }
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el || !hasTiming) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      playSegment();
    }
  };

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-bg-elevated/60 px-4 py-3",
        className
      )}
    >
      {/* 컨트롤 대상 오디오 — 커스텀 UI를 위해 기본 컨트롤 숨김 */}
      <audio
        ref={audioRef}
        src={audioUrl ?? undefined}
        preload="auto"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onError={() => setError("오디오를 불러올 수 없어요.")}
        className="hidden"
      />

      {!word ? (
        // ── 선택 전 안내 ───────────────────────────────────────
        <p className="text-xs text-fg-subtle font-mono">
          아래에서 단어를 눌러 정확한 발음을 들어보세요
        </p>
      ) : (
        <div className="flex items-center gap-3">
          {/* 재생/일시정지 */}
          <button
            type="button"
            onClick={togglePlay}
            disabled={!hasTiming || !audioUrl}
            aria-label={isPlaying ? "일시정지" : "재생"}
            className={cn(
              "grid place-items-center w-10 h-10 rounded-full shrink-0 transition-colors",
              hasTiming && audioUrl
                ? "bg-accent/15 text-accent hover:bg-accent/25"
                : "bg-bg text-fg-subtle cursor-not-allowed"
            )}
          >
            {isPlaying ? <IconPause /> : <IconPlay />}
          </button>

          <div className="min-w-0 flex-1">
            {/* 선택 단어 */}
            <p className="font-display text-lg leading-tight text-fg truncate">
              {word.word}
            </p>
            {hasTiming ? (
              <p className="text-[11px] text-fg-subtle font-mono tabular-nums">
                정확한 발음 듣기
              </p>
            ) : (
              <p className="text-[11px] text-fg-subtle font-mono">
                이 단어는 발음 재생을 지원하지 않아요
              </p>
            )}
          </div>

          {/* 다시 듣기 */}
          <button
            type="button"
            onClick={playSegment}
            disabled={!hasTiming || !audioUrl}
            className={cn(
              "flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider shrink-0 transition-colors",
              hasTiming && audioUrl
                ? "text-fg-muted hover:text-accent"
                : "text-fg-subtle cursor-not-allowed"
            )}
          >
            <IconReplay />
            다시 듣기
          </button>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-fg-muted font-mono" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 인라인 SVG 아이콘 (프로젝트 컨벤션 — 아이콘 라이브러리 미사용)
// ─────────────────────────────────────────────────────────────
function IconPlay() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function IconReplay() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 4v6h6" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}
