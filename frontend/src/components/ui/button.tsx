/**
 * Button (shadcn/ui 스타일)
 * - variant: primary(accent), secondary, ghost, outline, destructive
 * - size: sm, md, lg, icon
 * - 디자인 토큰(--accent 등)을 활용해 일관된 외관 유지
 */
import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "destructive";
type Size = "sm" | "md" | "lg" | "icon";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg hover:bg-accent-hover disabled:bg-bg-subtle disabled:text-fg-subtle",
  secondary:
    "bg-bg-elevated text-fg hover:bg-bg-subtle border border-border",
  ghost:
    "bg-transparent text-fg hover:bg-bg-elevated",
  outline:
    "bg-transparent text-fg border border-border-strong hover:bg-bg-elevated",
  destructive:
    "bg-score-low/10 text-score-low border border-score-low/40 hover:bg-score-low/20",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-7 text-base",
  icon: "h-10 w-10",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-60",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";
