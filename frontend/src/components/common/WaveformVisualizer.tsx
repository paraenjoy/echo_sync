/**
 * WaveformVisualizer — 마이크 음성의 실시간 주파수 막대 시각화
 *
 * 책임:
 *  - useAudioStreamer가 노출한 AnalyserNode에서 매 frame 주파수 데이터를 읽어
 *    SVG 막대 그래프로 렌더링
 *  - active=false면 RAF를 멈추고 모든 막대를 idle 높이로 복귀
 *
 * 사용 가이드:
 *  - 마이크 버튼 근처에 가로로 길게 배치하는 것을 가정
 *  - 색은 `currentColor` 위임 — 부모에서 `text-accent` 등으로 지정한다
 *    (디자인 토큰 컨벤션: 컴포넌트는 의미 토큰만 사용, 헥스 하드코딩 금지)
 *
 * 성능:
 *  - 매 frame setState 대신 SVG <rect> ref를 직접 조작 → React 리렌더 0회
 *  - 30fps로 throttle — 막대 시각화는 60fps까지 갈 이유가 없고 CPU 부담만 늘어남
 *
 * 접근성:
 *  - 장식 요소이지만 status 안내 역할도 겸하므로 role="img" + aria-label 부여
 *  - 음량 자체는 RMS volume prop이 별도로 존재하므로 여기는 시각 정보 전용
 *
 * 배치 위치:
 *  - InterviewRoomPage VoiceInputPanel (Step 11-B2)
 *  - YoutubePage 마이크 영역 (Step 11-B2)
 */
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface WaveformVisualizerProps {
  /** useAudioStreamer가 노출한 AnalyserNode. null이면 idle 상태로 유지. */
  analyser: AnalyserNode | null;
  /** 녹음 중일 때 true. false면 RAF 정지 + idle 막대로 복귀. */
  active: boolean;
  /** 막대 개수 (기본 32) */
  bars?: number;
  /** 컴포넌트 높이(px). 내부 SVG viewBox는 100 기준으로 비율 변환된다. */
  height?: number;
  className?: string;
}

// idle 상태에서의 막대 최소 높이 (viewBox 100 기준)
const IDLE_BAR_HEIGHT = 6;
// 30fps — 60fps까지 갈 이유 없음
const FRAME_INTERVAL_MS = 1000 / 30;

export function WaveformVisualizer({
  analyser,
  active,
  bars = 32,
  height = 48,
  className,
}: WaveformVisualizerProps) {
  const rectsRef = useRef<(SVGRectElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  const dataRef = useRef<Uint8Array | null>(null);

  // analyser 인스턴스 변경 시 주파수 빈에 맞춰 버퍼 재할당
  useEffect(() => {
    if (!analyser) {
      dataRef.current = null;
      return;
    }
    dataRef.current = new Uint8Array(analyser.frequencyBinCount);
  }, [analyser]);

  useEffect(() => {
    // 비활성/미연결: idle 상태로 복귀
    if (!active || !analyser || !dataRef.current) {
      rectsRef.current.forEach((rect) => {
        if (!rect) return;
        rect.setAttribute("height", String(IDLE_BAR_HEIGHT));
        rect.setAttribute("y", String((100 - IDLE_BAR_HEIGHT) / 2));
      });
      return;
    }

    const data = dataRef.current;
    let lastTs = 0;

    const tick = (ts: number) => {
      // 30fps throttle
      if (ts - lastTs < FRAME_INTERVAL_MS) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastTs = ts;

      analyser.getByteFrequencyData(data);

      // 주파수 빈을 막대 개수에 맞춰 균등 분할, 각 구간 평균 사용
      const binSize = Math.floor(data.length / bars);
      for (let i = 0; i < bars; i++) {
        let sum = 0;
        for (let j = 0; j < binSize; j++) {
          sum += data[i * binSize + j];
        }
        const avg = sum / binSize; // 0~255

        // 0~255 → 0~100 정규화 + 1.4배 보정 (저주파대가 잘 보이도록)
        const normalized = Math.min(100, (avg / 255) * 100 * 1.4);
        const h = Math.max(IDLE_BAR_HEIGHT, normalized);

        const rect = rectsRef.current[i];
        if (rect) {
          rect.setAttribute("height", String(h));
          rect.setAttribute("y", String((100 - h) / 2));
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
    };
  }, [active, analyser, bars]);

  // ── SVG 막대 기하 계산 ────────────────────────────────────
  // viewBox 100 기준으로 막대 간격 비율을 0.55로 설정 (보기 좋게 비례)
  const barSlot = 100 / bars;
  const barWidth = barSlot * 0.55;
  const barGapHalf = (barSlot - barWidth) / 2;

  return (
    <svg
      role="img"
      aria-label={active ? "음성 입력 시각화" : "마이크 대기 상태"}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      width="100%"
      height={height}
      className={cn("text-accent transition-opacity", className)}
      // active=false면 살짝 흐려 idle 상태임을 시각적으로 강조
      style={{ opacity: active ? 1 : 0.45 }}
    >
      {Array.from({ length: bars }).map((_, i) => (
        <rect
          key={i}
          ref={(el) => {
            rectsRef.current[i] = el;
          }}
          x={i * barSlot + barGapHalf}
          y={(100 - IDLE_BAR_HEIGHT) / 2}
          width={barWidth}
          height={IDLE_BAR_HEIGHT}
          rx={barWidth / 2}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}
