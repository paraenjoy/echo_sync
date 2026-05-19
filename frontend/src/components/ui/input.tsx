/**
 * Input (shadcn/ui 스타일)
 * - bg-elevated 위에 놓여도 자연스러운 톤
 * - focus 시 accent ring
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-11 w-full rounded-md border border-border bg-bg-elevated px-4 py-2",
        "text-sm text-fg placeholder:text-fg-subtle",
        "focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/60",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "transition-colors",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
