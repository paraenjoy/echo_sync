/**
 * Select (shadcn/ui 스타일)
 *
 * 설계:
 *  - native <select> 기반: Radix 등 추가 의존성 없이 가볍고, 모바일에서는 OS 네이티브
 *    피커가 떠 UX가 더 좋다.
 *  - Input.tsx와 동일한 디자인 토큰(bg-elevated, border, accent ring) 사용
 *  - 우측 chevron 아이콘은 의존성 없이 인라인 SVG (MicButton/ErrorModal과 동일 컨벤션)
 *  - [color-scheme:dark]는 OS 드롭다운 패널이 다크 톤으로 렌더링되도록 브라우저에
 *    힌트를 주는 CSS 속성 (Chrome/Edge에서 효과 있음, Safari/Firefox는 OS 기본 사용)
 *
 * 사용 예:
 *   <Select
 *     value={position}
 *     onChange={(e) => setPosition(e.target.value)}
 *     placeholder="직무를 선택해주세요"
 *   >
 *     {POSITION_OPTIONS.map((p) => (
 *       <option key={p} value={p}>{p}</option>
 *     ))}
 *   </Select>
 *
 * placeholder 동작:
 *  - placeholder prop을 주면 첫 줄에 disabled hidden 옵션이 자동 삽입됨
 *  - controlled 컴포넌트에서 value=""로 초기화하면 placeholder가 표시된다
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** value=""(선택 안 됨) 상태일 때 표시할 안내 텍스트 */
  placeholder?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, placeholder, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          // 레이아웃: pr-10으로 우측 chevron 영역 확보
          "flex h-11 w-full rounded-md border border-border bg-bg-elevated px-4 py-2 pr-10",
          // 타이포: Input과 동일한 작은 본문 크기
          "text-sm text-fg",
          // 포커스: accent ring + 보더 강조 (Input과 정확히 동일)
          "focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/60",
          // 비활성
          "disabled:cursor-not-allowed disabled:opacity-60",
          // native chevron 제거 + 부드러운 색상 전이
          "appearance-none transition-colors",
          // OS 네이티브 드롭다운 패널을 다크 톤으로 렌더링하라는 힌트
          "[color-scheme:dark]",
          className
        )}
        {...props}
      >
        {placeholder && (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        )}
        {children}
      </select>

      {/* 커스텀 chevron */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-fg-muted"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </span>
    </div>
  )
);
Select.displayName = "Select";
