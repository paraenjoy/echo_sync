/**
 * PhonemeHeatmap — 누적 약점 음소 히트맵 (+ 발음 듣기)
 *
 * UX 목표:
 *  - "어떤 음소가 약한가"를 한눈에 파악 (avg_score 기준 R/Y/G)
 *  - 카드를 누르면 해당 음소 발음을 TTS로 들려준다 (GET /tts/phoneme)
 *    · 백엔드가 "예시 단어 우선 + 가능하면 순수 음소" SSML로 합성한 mp3를 반환
 *  - 가장 약한 음소를 먼저 보여주는 "교정 우선순위" UX
 *
 * 재생 동작:
 *  - 카드 클릭 → (캐시 없으면) /tts/phoneme 호출 → resolveStaticUrl로 절대화 → 재생
 *  - 재생 중 같은 카드 재클릭 → 정지(토글)
 *  - 음소별 절대 URL을 컴포넌트 메모리에 캐시해 재클릭 시 네트워크 왕복 생략
 *
 * 접근성:
 *  - 카드는 <button> 으로 키보드 포커스/엔터 재생 가능, aria-label 제공
 *  - 색만으로 정보를 전달하지 않도록 점수 숫자를 항상 같이 노출
 *  - 가장 약한 음소(low tier)에는 좌측 보더 강조로 한 번 더 시그널
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { cn, getScoreTier, scoreTierClasses, resolveStaticUrl } from "@/lib/utils";
import { api, getErrorMessage } from "@/lib/api";
import type { WeakPhoneme } from "@/types/history";

interface PhonemeHeatmapProps {
  phonemes: WeakPhoneme[];
  /** 표시 개수 제한 (기본 12개). null이면 전체 */
  limit?: number | null;
}

/** GET /tts/phoneme 응답 */
interface PhonemeTtsResponse {
  audio_url: string;
  phoneme: string;
  example_word: string | null;
}

export function PhonemeHeatmap({ phonemes, limit = 12 }: PhonemeHeatmapProps) {
  // 가장 약한 음소부터 보여준다 (avg_score 오름차순)
  // 동일 점수면 시도 횟수가 많은 쪽이 더 신뢰도 높으므로 우선 노출
  const sorted = useMemo(() => {
    const arr = [...phonemes].sort((a, b) => {
      if (a.avg_score !== b.avg_score) return a.avg_score - b.avg_score;
      return b.total_count - a.total_count;
    });
    return limit != null ? arr.slice(0, limit) : arr;
  }, [phonemes, limit]);

  // ── 재생 상태 ────────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlCacheRef = useRef<Map<string, string>>(new Map());
  // 빠른 연속 클릭 시 늦게 도착한 이전 요청이 재생되지 않도록 하는 가드
  const reqSeqRef = useRef(0);
  // 현재 로딩/재생 중인 음소
  const [activePh, setActivePh] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "playing" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 언마운트 시 재생 중지
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const stop = () => {
    audioRef.current?.pause();
    setActivePh(null);
    setPhase(null);
  };

  const playPhoneme = async (phoneme: string) => {
    setError(null);

    // 같은 음소가 이미 활성(로딩/재생) 상태면 토글로 정지
    if (activePh === phoneme) {
      stop();
      return;
    }

    // 진행 중인 다른 재생 중지
    audioRef.current?.pause();
    setActivePh(phoneme);
    setPhase("loading");

    const seq = ++reqSeqRef.current;

    try {
      let absUrl = urlCacheRef.current.get(phoneme);

      if (!absUrl) {
        const res = await api.get<PhonemeTtsResponse>("/tts/phoneme", {
          params: { ph: phoneme },
        });
        const resolved = resolveStaticUrl(res.data.audio_url);
        if (!resolved) throw new Error("재생할 오디오 주소가 없어요.");
        absUrl = resolved;
        urlCacheRef.current.set(phoneme, absUrl);
      }

      // 그 사이 다른 카드를 눌렀다면(stale) 이 재생은 버린다
      if (reqSeqRef.current !== seq) return;

      if (!audioRef.current) audioRef.current = new Audio();
      const audio = audioRef.current;
      audio.src = absUrl;
      audio.onended = () => {
        setActivePh((cur) => (cur === phoneme ? null : cur));
        setPhase((cur) => (cur ? null : cur));
      };

      await audio.play();
      if (reqSeqRef.current !== seq) return;
      setPhase("playing");
    } catch (e) {
      if (reqSeqRef.current !== seq) return;
      setActivePh(null);
      setPhase(null);
      setError(getErrorMessage(e));
    }
  };

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        아직 분석할 음소 데이터가 없어요.
      </p>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
        {sorted.map((p) => (
          <PhonemeCard
            key={p.phoneme}
            item={p}
            loading={activePh === p.phoneme && phase === "loading"}
            playing={activePh === p.phoneme && phase === "playing"}
            onPlay={() => playPhoneme(p.phoneme)}
          />
        ))}
      </div>

      {error && (
        <p className="mt-3 text-xs text-score-low" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 음소 카드 한 칸 (클릭 시 발음 재생)
// ─────────────────────────────────────────────────────────────
function PhonemeCard({
  item,
  loading,
  playing,
  onPlay,
}: {
  item: WeakPhoneme;
  loading: boolean;
  playing: boolean;
  onPlay: () => void;
}) {
  const tier = getScoreTier(item.avg_score);
  const cls = scoreTierClasses[tier];

  // 백엔드 analyzer.py: fail_rate = (fail_count / total_count) * 100
  // 항상 0~100 (퍼센트) 반환 → 직접 반올림하여 사용
  const failPct = Math.round(item.fail_rate);

  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`${item.phoneme} 발음 듣기`}
      title={`발음 듣기 · 총 ${item.total_count}회 시도 · 실패율 ${failPct}%`}
      className={cn(
        "group relative w-full text-left rounded-lg border border-border bg-bg-elevated p-3",
        "transition-colors hover:border-accent/60 hover:bg-bg-subtle",
        "focus-visible:border-accent",
        // low tier는 좌측 보더로 한 번 더 강조 (색맹 접근성 보조)
        tier === "low" && "border-l-2 border-l-score-low",
        (loading || playing) && "border-accent/60"
      )}
    >
      {/* 음소 기호 + 점수 */}
      <div className="flex items-baseline justify-between mb-2">
        <span className={cn("font-mono text-xl uppercase tracking-wide", cls.text)}>
          {item.phoneme}
        </span>
        <span className={cn("font-display tabular-nums text-lg leading-none", cls.text)}>
          {Math.round(item.avg_score)}
          <span className="text-[10px] text-fg-subtle font-mono ml-0.5">/100</span>
        </span>
      </div>

      {/* 메타데이터: 시도수 · 실패율 + 재생 아이콘 */}
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-fg-subtle">
        <span>
          n=<span className="tabular-nums text-fg-muted">{item.total_count}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span>
            fail <span className="tabular-nums text-fg-muted">{failPct}%</span>
          </span>
          <PlaybackIcon loading={loading} playing={playing} />
        </span>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// 재생 상태 아이콘 (idle: 스피커 / loading: 스피너 / playing: 액센트 스피커)
// ─────────────────────────────────────────────────────────────
function PlaybackIcon({ loading, playing }: { loading: boolean; playing: boolean }) {
  if (loading) {
    return (
      <svg
        className="h-3.5 w-3.5 animate-spin text-accent"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg
      className={cn(
        "h-3.5 w-3.5 transition-colors",
        playing ? "text-accent" : "text-fg-subtle group-hover:text-accent"
      )}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="4 9 8 9 13 5 13 19 8 15 4 15" fill="currentColor" stroke="none" />
      {playing ? (
        <>
          <path d="M16.5 8.5a5 5 0 0 1 0 7" />
          <path d="M19 6a8 8 0 0 1 0 12" />
        </>
      ) : (
        <path d="M16.5 8.5a5 5 0 0 1 0 7" />
      )}
    </svg>
  );
}
