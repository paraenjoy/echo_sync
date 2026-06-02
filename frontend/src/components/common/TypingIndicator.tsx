/**
 * TypingIndicator — 메신저형 점 3개 bounce 인디케이터
 *
 * 사용 시점:
 *  - InterviewRoomPage: `audio.status === "processing"` 동안 채팅 영역
 *    끝에 transient하게 표시 ("AI가 답변을 듣고 있어요" 신호).
 *    메시지 큐와 분리되어 있어 completed 전환 시 자동으로 unmount된다.
 *
 * 디자인:
 *  - QuestionBubble과 동일한 좌측 정렬 + "AI 면접관" 라벨 톤을 따라가서
 *    채팅 흐름에 자연스럽게 녹아든다.
 *  - 점 3개가 200ms 지연 차로 부드럽게 튀어오르며 한 사이클이 1.2초.
 *
 * 자기완결성:
 *  - keyframes를 컴포넌트 안에 <style>로 정의 → 외부 CSS / 디자인 토큰 변경 0.
 *  - 페이지에 한 인스턴스만 존재한다는 전제(채팅 끝에만 표시).
 *  - 색은 accent 토큰을 통해 다크/라이트 자동 반응.
 *
 * 접근성:
 *  - 부모(section[aria-live="polite"]) 안에 들어가는 것을 전제로 별도 role 부여 없음.
 *    mount 시 한 번만 라벨이 읽히고, unmount는 조용히 사라진다.
 */
import { cn } from "@/lib/utils";

interface TypingIndicatorProps {
  /** 인디케이터 우측 보조 라벨. 기본 문구는 인터뷰 컨텍스트에 맞춰져 있다. */
  label?: string;
  className?: string;
}

// 컴포넌트 외부 상수 — JSX 안에 직접 두면 매 렌더마다 문자열이 새로 생성됨
const KEYFRAMES = `
@keyframes ec-typing-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
  30%          { transform: translateY(-4px); opacity: 1; }
}
`;

// 점 3개의 시작 지연(ms) — 200ms 간격으로 시퀀스를 형성
const DOT_DELAYS_MS = [0, 200, 400] as const;

export function TypingIndicator({
  label = "AI가 답변을 듣고 있어요",
  className,
}: TypingIndicatorProps) {
  return (
    <div className={cn("max-w-[88%] animate-fade-up", className)}>
      {/* keyframes 정의 — React가 같은 <style>을 중복 삽입해도 브라우저가
          캐싱하므로 성능 부담 없음 */}
      <style>{KEYFRAMES}</style>

      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle mb-2">
        AI 면접관
      </p>

      <div className="flex items-center gap-2.5">
        {/* 점 3개 캡슐 — rounded-full + 보더로 채팅 버블 느낌 */}
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-3.5 py-2">
          {DOT_DELAYS_MS.map((delay) => (
            <span
              key={delay}
              aria-hidden
              className="block w-1.5 h-1.5 rounded-full bg-accent"
              style={{
                animation: `ec-typing-bounce 1.2s ${delay}ms infinite ease-in-out`,
              }}
            />
          ))}
        </div>

        {/* 보조 라벨 — 첫 렌더 시 한 번만 스크린리더에 전달됨 */}
        <span className="text-xs text-fg-muted font-mono">{label}</span>
      </div>
    </div>
  );
}
