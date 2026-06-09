import { useEffect, useRef, useState } from "react";
import { cn, resolveStaticUrl } from "@/lib/utils";

interface AudioPlayerProps {
  /** 재생할 오디오 URL. Blob URL 또는 서버 정적 경로(/static/audio/...) 모두 지원 */
  src: string;
  /** 상단에 표시될 라벨 (예: "내 발화", "모범 발음") */
  label?: string;
  /** 추가 클래스 */
  className?: string;
}

/**
 * 공용 오디오 플레이어 — 디자인 시스템 정합 + 메타데이터 버그 우회
 *
 * 배경:
 * - Chrome/Edge의 MediaRecorder가 만든 webm 파일은 컨테이너 헤더에
 *   duration 메타데이터를 기록하지 않는다 (Chromium 이슈 #642012).
 * - 그 결과 <audio> 기본 컨트롤은 "0:00 / 0:00" 으로 표시되고
 *   타임라인 스크럽이 불가능한 상태가 된다.
 *
 * 우회 전략 (널리 알려진 패턴):
 * 1) loadedmetadata 시점에 duration 이 Infinity 면 webm 누락 버그로 판단
 * 2) currentTime 을 매우 큰 값(MAX_SAFE_INTEGER)으로 설정 → 브라우저가
 *    실제 끝까지 디코딩하면서 정확한 duration 을 재계산
 * 3) timeupdate 가 한 번 발생하면 currentTime 을 0 으로 복귀시키고 핸들러 해제
 *
 * 서버 TTS(.mp3)는 정상적으로 duration 을 가지므로 1) 분기를 타지 않고 즉시 ready.
 *
 * URL 변환:
 * - 백엔드가 "/static/audio/..." 같은 상대 경로를 반환하면
 *   resolveStaticUrl()이 API_BASE_URL을 붙여 올바른 서버 origin으로 요청한다.
 * - Blob URL / 이미 절대 URL이면 그대로 통과.
 */
export function AudioPlayer({ src, label, className }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 서버 상대 경로 → 절대 URL 변환 (Blob URL / http(s) URL은 그대로)
  const resolvedSrc = resolveStaticUrl(src) ?? src;

  // src 변경 시 상태 초기화 (질문 전환 등으로 재마운트되지 않을 때 대비)
  useEffect(() => {
    setIsReady(false);
    setError(null);
  }, [resolvedSrc]);

  const handleLoadedMetadata = () => {
    const el = audioRef.current;
    if (!el) return;

    // 정상 케이스: duration 이 유한값이면 그대로 ready 처리
    if (Number.isFinite(el.duration) && el.duration > 0) {
      setIsReady(true);
      return;
    }

    // webm duration 누락 버그 우회: 끝까지 강제 시킹하여 브라우저가
    // duration 을 재계산하도록 유도
    const onTimeUpdate = () => {
      if (!audioRef.current) return;
      audioRef.current.currentTime = 0;
      audioRef.current.removeEventListener("timeupdate", onTimeUpdate);
      setIsReady(true);
    };
    el.addEventListener("timeupdate", onTimeUpdate);

    try {
      el.currentTime = Number.MAX_SAFE_INTEGER;
    } catch {
      // 일부 환경에서 currentTime 할당이 throw 할 수 있음 → 폴백으로 ready 처리
      el.removeEventListener("timeupdate", onTimeUpdate);
      setIsReady(true);
    }
  };

  const handleError = () => {
    setError("오디오를 불러올 수 없습니다.");
    setIsReady(false);
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <p className="font-mono text-xs uppercase tracking-wider text-fg-subtle">
          {label}
        </p>
      )}
      <audio
        ref={audioRef}
        src={resolvedSrc}
        controls
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onError={handleError}
        className={cn(
          "w-full transition-opacity duration-200",
          // 메타데이터 재계산 중에는 약하게 디밍 → UI 점프 방지
          !isReady && !error && "opacity-60"
        )}
      />
      {error && (
        <p
          className="font-mono text-xs text-fg-muted"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
