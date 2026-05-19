import type { Config } from "tailwindcss";

/**
 * Tailwind 설정
 * - CSS 변수(--bg, --fg, --accent 등)를 Tailwind 컬러로 매핑
 * - `bg-bg`, `text-fg`, `border-border`, `text-accent` 같은 유틸리티 사용 가능
 * - opacity modifier도 작동: `bg-accent/20`, `text-fg-muted/60` 등
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "rgb(var(--bg) / <alpha-value>)",
          elevated: "rgb(var(--bg-elevated) / <alpha-value>)",
          subtle: "rgb(var(--bg-subtle) / <alpha-value>)",
        },
        fg: {
          DEFAULT: "rgb(var(--fg) / <alpha-value>)",
          muted: "rgb(var(--fg-muted) / <alpha-value>)",
          subtle: "rgb(var(--fg-subtle) / <alpha-value>)",
        },
        border: {
          DEFAULT: "rgb(var(--border) / <alpha-value>)",
          strong: "rgb(var(--border-strong) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          fg: "rgb(var(--accent-fg) / <alpha-value>)",
          hover: "rgb(var(--accent-hover) / <alpha-value>)",
        },
        score: {
          low: "rgb(var(--score-low) / <alpha-value>)",
          mid: "rgb(var(--score-mid) / <alpha-value>)",
          high: "rgb(var(--score-high) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: "var(--font-display)",
        sans: "var(--font-sans)",
        mono: "var(--font-mono)",
      },
      borderRadius: {
        // Editorial 미감: 너무 둥글지 않게
        sm: "4px",
        md: "6px",
        lg: "10px",
        xl: "14px",
      },
    },
  },
  plugins: [],
} satisfies Config;
