/**
 * TechStackPie — 기술 스택 언급 비중 (히스토리 면접 리포트)
 *
 * 데이터: interview_report.tech_stack_percent (Record<string, number>, 정수 %)
 *
 * 색상(DESIGN_SYSTEM.md): 카테고리형이지만 단일 accent 원칙을 지켜
 *   accent 단색의 불투명도 단계로 슬라이스를 구분하고, 범례(이름·%)가 식별을 보장한다.
 * 토큰은 채널 형식이라 getComputedStyle로 읽어 rgb()로 주입, 테마 전환에 MutationObserver로 반응.
 */
import { useEffect, useState } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";

interface TechStackPieProps {
  data: Record<string, number>;
}

function readColor(varName: string): string {
  if (typeof window === "undefined") return "";
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  if (!raw) return "";
  return /^[\d.\s]+$/.test(raw) ? `rgb(${raw})` : raw;
}

// 슬라이스 불투명도 (큰 비중일수록 진하게)
const sliceOpacity = (i: number) => Math.max(0.3, 1 - i * 0.16);

interface TooltipItem {
  name?: string;
  value?: number | string;
}

export function TechStackPie({ data }: TechStackPieProps) {
  const [accent, setAccent] = useState(() => readColor("--accent"));

  useEffect(() => {
    const compute = () => setAccent(readColor("--accent"));
    compute();
    const obs = new MutationObserver(compute);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    return () => obs.disconnect();
  }, []);

  const entries = Object.entries(data)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));

  if (entries.length === 0) {
    return (
      <p className="text-sm text-fg-subtle">기술 스택 언급 데이터가 없어요.</p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <div className="h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={entries}
              dataKey="value"
              nameKey="name"
              innerRadius={44}
              outerRadius={70}
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
            >
              {entries.map((e, i) => (
                <Cell key={e.name} fill={accent} fillOpacity={sliceOpacity(i)} />
              ))}
            </Pie>
            <Tooltip content={<PieTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* 범례 */}
      <ul className="w-full flex-1 space-y-1.5">
        {entries.map((e, i) => (
          <li key={e.name} className="flex items-center gap-2 text-sm">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: accent, opacity: sliceOpacity(i) }}
            />
            <span className="text-fg-muted">{e.name}</span>
            <span className="ml-auto font-mono tabular-nums text-fg">
              {e.value}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PieTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipItem[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0];
  return (
    <div className="rounded-md border border-border bg-bg-elevated px-3 py-1.5 shadow-lg">
      <span className="text-xs text-fg-muted">{item.name}</span>
      <span className="ml-2 font-mono text-xs tabular-nums text-fg">
        {item.value}%
      </span>
    </div>
  );
}
