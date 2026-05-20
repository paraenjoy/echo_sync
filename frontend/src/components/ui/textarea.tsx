/**
 * Textarea (shadcn/ui 스타일)
 * - Input.tsx와 동일한 디자인 토큰: bg-elevated, accent ring, transition
 * - resize-y로 사용자가 세로 방향으로만 늘릴 수 있게 (가로 확장은 레이아웃을 깨뜨림)
 * - min-h-[120px]로 빈 상태에서도 안정적인 점유 영역 보장
 *
 * 사용처:
 *  - /interview/setup (프로젝트 요약 입력)
 *  - /interview/room  (텍스트 폴백 모드 답변 입력)
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex w-full min-h-[120px] rounded-md border border-border bg-bg-elevated px-4 py-3",
        "text-sm text-fg placeholder:text-fg-subtle leading-relaxed",
        "focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/60",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "transition-colors resize-y",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
