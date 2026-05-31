/**
 * ScoreTrendChart — 점수 추이 (대시보드)
 *
 * 데이터: GET /dashboard 의 recent_scores (RecentScore[])
 *  - 정확도 / 발음 / 유창성 3개 시리즈를 시간순 라인으로 표시
 *  - 2건 미만이면 추이를 그릴 수 없어 빈 상태 안내
 *
 * 색상(DESIGN_SYSTEM.md 준수):
 *  - 점수 3색(low/mid/high)은 "티어" 전용이라 시리즈 구분에 쓰면 의미가 왜곡된다.
 *  - 단일 accent 원칙 안에서: 발음=accent(목표 추적 지표라 강조), 정확도=fg-muted, 유창성=fg-subtle.
 *
 * Recharts 색 주입:
 *  - 토큰은 alpha 지원을 위해 채널 형식("91 133 218")으로 저장된다.
 *  - SVG 속성엔 var()가 해석되지 않으므로 getComputedStyle로 읽어 rgb(...)로 래핑해 전달.
 *  - 다크/라이트 전환 시 :root의 class/style이 바뀌므로 MutationObserver로 재계산(themeStore 비결합).
 */
import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { RecentScore } from "@/types/dashboard";

interface ScoreTrendChartProps {
  data: RecentScore[];
}

// ── 토큰 색 읽기 (채널 → rgb) ──────────────────────────────
function readColor(varName: string): string {
  if (typeof window === "undefined") return "";
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  if (!raw) return "";
  // "91 133 218" 형태면 rgb()로, 이미 색 문자열이면 그대로
  return /^[\d.\s]+$/.test(raw) ? `rgb(${raw})` : raw;
}

interface ChartColors {
  pronunciation: string;
  accuracy: string;
  fluency: string;
  grid: string;
  axis: string;
}

function useChartColors(): ChartColors {
  const compute = (): ChartColors => ({
    pronunciation: readColor("--accent"),
    accuracy: readColor("--fg-muted"),
    fluency: readColor("--fg-subtle"),
    grid: readColor("--border"),
    axis: readColor("--fg-subtle"),
  });

  const [colors, setColors] = useState<ChartColors>(compute);

  useEffect(() => {
    setColors(compute());
    const obs = new MutationObserver(() => setColors(compute()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    return () => obs.disconnect();
  }, []);

  return colors;
}

// ── 날짜 라벨 ("M/D") — str(datetime)의 공백 구분자도 안전 파싱 ──
function shortLabel(iso: string): string {
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const SERIES = [
  { key: "pronunciation", label: "발음" },
  { key: "accuracy", label: "정확도" },
  { key: "fluency", label: "유창성" },
] as const;

export function ScoreTrendChart({ data }: ScoreTrendChartProps) {
  const colors = useChartColors();

  const chartData = useMemo(
    () =>
      [...data]
        .sort(
          (a, b) =>
            new Date(a.created_at.replace(" ", "T")).getTime() -
            new Date(b.created_at.replace(" ", "T")).getTime()
        )
        .map((d) => ({
          label: shortLabel(d.created_at),
          accuracy: Math.round(d.accuracy),
          pronunciation: Math.round(d.pronunciation),
          fluency: Math.round(d.fluency),
        })),
    [data]
  );

  // 추이는 최소 2점 필요
  if (chartData.length < 2) {
    return (
      <div className="rounded-xl border border-border bg-bg-elevated p-8 text-center animate-fade-up">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-subtle mb-3">
          Not enough data
        </p>
        <p className="text-fg-muted text-sm leading-relaxed max-w-md mx-auto">
          연습을 2회 이상 마치면 점수 변화 추이를 그래프로 보여드려요.
        </p>
      </div>
    );
  }

  const seriesColor: Record<string, string> = {
    pronunciation: colors.pronunciation,
    accuracy: colors.accuracy,
    fluency: colors.fluency,
  };

  return (
    <div className="rounded-xl border border-border bg-bg-elevated p-6 animate-fade-up">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle mb-1">
            Recent sessions
          </p>
          <h3 className="font-display text-xl leading-tight">점수 추이</h3>
        </div>
        {/* 범례 (토큰 색 직접 매핑) */}
        <ul className="flex flex-wrap gap-3">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: seriesColor[s.key] }}
              />
              <span className="font-mono text-[11px] text-fg-muted">
                {s.label}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
          >
            <CartesianGrid
              stroke={colors.grid}
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: colors.axis }}
              tickLine={false}
              axisLine={{ stroke: colors.grid }}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fontSize: 11, fill: colors.axis }}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip content={<TrendTooltip seriesColor={seriesColor} />} />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={seriesColor[s.key]}
                strokeWidth={2}
                dot={{ r: 2, strokeWidth: 0, fill: seriesColor[s.key] }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── 커스텀 툴팁 (토큰 스타일) ──────────────────────────────
interface TooltipItem {
  name?: string;
  value?: number | string;
  dataKey?: string | number;
}

function TrendTooltip({
  active,
  payload,
  label,
  seriesColor,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string;
  seriesColor: Record<string, string>;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-bg-elevated px-3 py-2 shadow-lg">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
        {label}
      </p>
      <ul className="space-y-0.5">
        {payload.map((item) => (
          <li
            key={String(item.dataKey)}
            className="flex items-center gap-2 text-xs"
          >
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{
                backgroundColor: seriesColor[String(item.dataKey)],
              }}
            />
            <span className="text-fg-muted">{item.name}</span>
            <span className="ml-auto font-mono tabular-nums text-fg">
              {item.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
