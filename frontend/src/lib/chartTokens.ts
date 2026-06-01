/**
 * chartTokens — Recharts(SVG) 차트용 디자인 토큰 브릿지
 *
 * 배경:
 *  - 토큰은 alpha 지원을 위해 채널 형식("91 133 218")으로 저장된다(`:root`의 `--accent` 등).
 *  - SVG 속성에는 `var()`가 해석되지 않으므로, Recharts `stroke`/`fill`에 색을 직접 문자열로
 *    주입해야 한다.
 *  - 다크/라이트 전환 시 `:root`의 class/data-theme/style이 바뀌므로, 한 번 읽고 끝나는 게
 *    아니라 MutationObserver로 추적해 재계산해야 한다.
 *
 * 본 모듈은 위 두 가지(채널→rgb 변환, 테마 감지 재계산)를 한 곳으로 모은다.
 * 기존에는 ScoreTrendChart와 TechStackPie가 각자 동일 로직을 들고 있었다(중복 — HANDOFF TODO).
 *
 * 사용 예:
 *   const { accent, grid } = useChartTokens({ accent: "--accent", grid: "--border" });
 *   <Line stroke={accent} />
 *   <CartesianGrid stroke={grid} />
 */
import { useEffect, useState } from "react";

/**
 * `:root`에서 CSS 변수를 읽어 차트 SVG에 주입할 색 문자열을 반환한다.
 *  - 채널 형식("R G B")은 `rgb(R G B)`로 래핑.
 *  - 이미 색 문자열(예: hex/rgb/hsl)이면 그대로 반환.
 *  - SSR/비브라우저 환경에서는 빈 문자열.
 *
 * 단발 조회용. 테마 전환에 반응할 필요가 있으면 `useChartTokens`를 사용한다.
 */
export function readChartToken(varName: string): string {
  if (typeof window === "undefined") return "";
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  if (!raw) return "";
  // 숫자/공백/점만으로 구성되면 채널 형식 → rgb()로 래핑
  return /^[\d.\s]+$/.test(raw) ? `rgb(${raw})` : raw;
}

/**
 * 여러 CSS 변수를 한 번에 읽고, 테마 전환(`:root`의 class/data-theme/style 변경)에
 * 자동으로 반응한다.
 *
 * @param vars   원하는 키 → CSS 변수명 매핑 (예: `{ accent: "--accent" }`)
 * @returns      동일한 키 → 색 문자열 매핑
 *
 * 구현 메모:
 *  - 호출자가 매 렌더 새 객체를 넘겨도 내용이 같으면 effect를 재구독하지 않도록,
 *    vars의 키/값을 직렬화한 signature를 deps로 쓴다.
 *  - MutationObserver는 :root에만 부착(themeStore 비결합) → 어떤 테마 구현이든 동작.
 */
export function useChartTokens<K extends string>(
  vars: Record<K, string>
): Record<K, string> {
  // vars의 키/값을 안정 문자열로 직렬화 → 동일 내용 객체의 참조 변경에 둔감
  const signature = Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .sort()
    .join("|");

  const compute = (): Record<K, string> => {
    const out = {} as Record<K, string>;
    (Object.keys(vars) as K[]).forEach((k) => {
      out[k] = readChartToken(vars[k]);
    });
    return out;
  };

  const [colors, setColors] = useState<Record<K, string>>(compute);

  useEffect(() => {
    // 마운트(혹은 vars 내용 변경) 직후 한 번 + 이후 :root 변경마다 재계산
    setColors(compute());
    const obs = new MutationObserver(() => setColors(compute()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    return () => obs.disconnect();
    // compute는 vars 클로저를 캡처하지만, 동일 내용이면 signature가 같아 재구독 X.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return colors;
}
