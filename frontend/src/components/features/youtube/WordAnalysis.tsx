/**
 * WordAnalysis — 단어 히트맵 + 선택 단어 발음 재생 묶음
 *
 * WordHeatmap(단어별 정확도 + 음소 드로어)과 WordReplayPlayer(선택 단어의
 * 정확한 발음 구간 재생)를 하나로 묶어 selectedWord 상태를 캡슐화한다. (Step 11-D)
 *
 * 동일 패턴이 세 곳에 반복되므로 래퍼로 추출 — 각 페이지는 selectedWord 상태를
 * 직접 들 필요 없이 words + audioUrl만 넘기면 된다.
 *  - YoutubePage 결과 카드          → audioUrl = result.user_tts_url
 *  - InterviewRoomPage UserVoiceBubble → audioUrl = result.user_tts_url
 *  - HistoryDetailPage AnswerBlock   → audioUrl = log.user_tts_url
 *
 * audioUrl이 null이면 재생 플레이어를 숨기고 히트맵만 표시 → 타이밍/오디오가 없는
 * 과거 데이터에도 안전 (하위호환).
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { WordHeatmap } from "./WordHeatmap";
import { WordReplayPlayer } from "./WordReplayPlayer";
import type { WsWord } from "@/types/ws";

interface WordAnalysisProps {
  words: WsWord[];
  /** 단어 재생 소스 — user_tts_url. null이면 재생 플레이어를 표시하지 않는다. */
  audioUrl: string | null;
  className?: string;
}

export function WordAnalysis({ words, audioUrl, className }: WordAnalysisProps) {
  // 선택된 단어 — WordHeatmap 클릭으로 갱신, 토글 닫힘 시 null
  const [selected, setSelected] = useState<WsWord | null>(null);

  return (
    <div className={cn("space-y-3", className)}>
      {/* 재생 플레이어는 히트맵 위에 — 음소 드로어(히트맵 아래 펼침)와 시각적으로 분리.
          선택 전에는 안내 문구를 노출해 "단어를 누르면 들을 수 있다"는 발견성을 준다. */}
      {audioUrl && <WordReplayPlayer audioUrl={audioUrl} word={selected} />}

      <WordHeatmap words={words} onWordSelect={(w) => setSelected(w)} />
    </div>
  );
}
