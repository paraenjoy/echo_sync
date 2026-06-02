/**
 * AICoachingCard — AI 코칭 텍스트 카드 (경량 마크다운 + 자동 접힘)
 *
 * 배경 (feedback.md 2순위 — Step 10-B):
 *  - 누적 분석의 ai_analysis(Gemini 출력)가 너무 길어 메인 페이지가 무거워 보였다.
 *  - 사용자 피드백에서 "마크다운 펼치기/접기" 요구 → 임계치 초과 시 자동 접힘.
 *
 * 설계 선택:
 *  - react-markdown 신규 의존성 도입 대신, 경량 인라인 파서 + React 노드 직접 빌드.
 *    dangerouslySetInnerHTML 미사용 → XSS 위험 없음(React가 텍스트를 자동 escape).
 *  - 지원: # h1~### h3, 글머리표(`- `), 번호 리스트(`1. `), **bold**, *italic*, `code`.
 *    표/이미지/링크/코드 펜스는 코치 텍스트에서 사실상 등장하지 않아 제외(YAGNI).
 *
 * 접힘 정책:
 *  - 줄 수 > LINE_LIMIT(6) 또는 글자 수 > CHAR_LIMIT(320) → 자동 접힘 + 그라데이션 마스킹.
 *  - 그 외 짧은 텍스트는 접힘 없이 전체 노출.
 *
 * 디자인 토큰만 소비 (DESIGN_SYSTEM.md):
 *  --bg-elevated / --border / --fg / --fg-muted / --fg-subtle / --accent
 *  - 코드 인라인 배경은 --bg-subtle, 헤딩 강조는 font-display.
 *  - "더 보기" 그라데이션 마스킹은 var(--bg-elevated)에서 투명으로 페이드 → 라이트/다크 양립.
 */
import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// 접힘 임계치
// ─────────────────────────────────────────────────────────────
const LINE_LIMIT = 6;
const CHAR_LIMIT = 320;
/** 접힘 상태에서 마스킹 영역까지 포함한 최대 높이(px). 너무 짧으면 도입부가 끊겨 보이므로 6줄 라인하이트 기준. */
const COLLAPSED_MAX_HEIGHT_PX = 168;

// ─────────────────────────────────────────────────────────────
// 공개 props
// ─────────────────────────────────────────────────────────────
export interface AICoachingCardProps {
  /** 카드 상단 eyebrow 라벨 (기본 "AI Coaching") */
  eyebrow?: string;
  /** Gemini 등이 생성한 마크다운 문자열 */
  text: string;
  /** 추가 클래스 */
  className?: string;
}

export function AICoachingCard({
  eyebrow = "AI Coaching",
  text,
  className,
}: AICoachingCardProps) {
  // 텍스트가 길면 자동 접힘 (사용자가 펼치면 setExpanded(true))
  const shouldCollapse = useMemo(
    () => isLongText(text),
    [text]
  );
  const [expanded, setExpanded] = useState(false);

  // 마크다운 → React 노드. text가 바뀔 때만 다시 계산.
  const rendered = useMemo(() => renderMarkdown(text), [text]);

  const collapsed = shouldCollapse && !expanded;

  return (
    <div
      className={cn(
        "border border-border rounded-xl bg-bg-elevated p-6 animate-fade-up",
        className
      )}
    >
      <p className="font-mono text-xs uppercase tracking-wider text-fg-subtle mb-3">
        {eyebrow}
      </p>

      {/* 본문 컨테이너: 접힘 상태면 max-height + 하단 그라데이션 마스킹 */}
      <div className="relative">
        <div
          className={cn(
            "text-sm text-fg leading-relaxed",
            // 마크다운 요소 간 간격 (전역 prose 미사용 — 토큰 일관성 유지)
            "[&>*+*]:mt-3"
          )}
          style={
            collapsed
              ? {
                  maxHeight: `${COLLAPSED_MAX_HEIGHT_PX}px`,
                  overflow: "hidden",
                }
              : undefined
          }
          aria-expanded={!collapsed}
        >
          {rendered}
        </div>

        {/* 접힘 하단 페이드 마스크 — 카드 배경색에서 투명으로 */}
        {collapsed && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16"
            style={{
              background:
                "linear-gradient(to bottom, rgb(var(--bg-elevated) / 0), rgb(var(--bg-elevated) / 1))",
            }}
          />
        )}
      </div>

      {/* 토글 버튼 — 텍스트가 짧으면 렌더하지 않음 */}
      {shouldCollapse && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            "mt-4 inline-flex items-center gap-1.5",
            "font-mono text-[11px] uppercase tracking-[0.14em]",
            "text-fg-muted hover:text-accent transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded-sm"
          )}
          aria-label={expanded ? "AI 코칭 텍스트 접기" : "AI 코칭 텍스트 더 보기"}
        >
          <span>{expanded ? "접기" : "더 보기"}</span>
          <Chevron expanded={expanded} />
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 접힘 필요성 판정
// ─────────────────────────────────────────────────────────────
function isLongText(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length > CHAR_LIMIT) return true;
  const lineCount = trimmed.split(/\r?\n/).length;
  return lineCount > LINE_LIMIT;
}

// ─────────────────────────────────────────────────────────────
// 마크다운 → React 노드 (블록 파서)
// ─────────────────────────────────────────────────────────────
//  블록 종류:
//   - 헤딩:           ^(#{1,3})\s+(.+)$
//   - 글머리표 리스트: ^\s*[-*]\s+(.+)$           (연속 줄을 한 <ul>로 묶음)
//   - 번호 리스트:    ^\s*\d+\.\s+(.+)$           (연속 줄을 한 <ol>로 묶음)
//   - 단락:           그 외 — 빈 줄로 분리
// ─────────────────────────────────────────────────────────────
function renderMarkdown(text: string): ReactNode[] {
  if (!text) return [];
  // 줄 단위로 잘라 블록 단위로 묶는다
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];

  let i = 0;
  let key = 0;

  const pushList = (
    ordered: boolean,
    items: string[]
  ) => {
    const Tag = ordered ? "ol" : "ul";
    nodes.push(
      <Tag
        key={`l-${key++}`}
        className={cn(
          "pl-5 space-y-1.5 marker:text-fg-subtle",
          ordered ? "list-decimal" : "list-disc"
        )}
      >
        {items.map((it, idx) => (
          <li key={idx} className="text-fg">
            {renderInline(it)}
          </li>
        ))}
      </Tag>
    );
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    // 빈 줄 — 블록 구분, 단순히 건너뜀 (간격은 [&>*+*]:mt-3로 해결)
    if (line === "") {
      i++;
      continue;
    }

    // 헤딩 — # / ## / ###
    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const sharedCls = "font-display tracking-tight text-fg";
      if (level === 1) {
        nodes.push(
          <h3
            key={`h-${key++}`}
            className={cn(sharedCls, "text-xl leading-tight")}
          >
            {renderInline(content)}
          </h3>
        );
      } else if (level === 2) {
        nodes.push(
          <h4
            key={`h-${key++}`}
            className={cn(sharedCls, "text-lg leading-tight")}
          >
            {renderInline(content)}
          </h4>
        );
      } else {
        nodes.push(
          <h5
            key={`h-${key++}`}
            className={cn(
              "font-mono text-[11px] uppercase tracking-[0.16em] text-fg-subtle"
            )}
          >
            {renderInline(content)}
          </h5>
        );
      }
      i++;
      continue;
    }

    // 글머리표 리스트 — 연속된 - / * 라인을 한 <ul>로
    if (/^\s*[-*]\s+/.test(raw)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      pushList(false, items);
      continue;
    }

    // 번호 리스트 — 연속된 1. 2. ... 를 한 <ol>로
    if (/^\s*\d+\.\s+/.test(raw)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      pushList(true, items);
      continue;
    }

    // 단락 — 다음 빈 줄/블록 시작 전까지 모은다 (줄바꿈은 <br/>로 보존)
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,3})\s+/.test(lines[i].trim()) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    nodes.push(
      <p key={`p-${key++}`} className="text-fg leading-relaxed">
        {joinWithBreaks(buf.map((l) => renderInline(l)))}
      </p>
    );
  }

  return nodes;
}

/** 단락 내부 다중 라인을 <br/>로 이어붙임 */
function joinWithBreaks(parts: ReactNode[]): ReactNode[] {
  const out: ReactNode[] = [];
  parts.forEach((p, idx) => {
    if (idx > 0) out.push(<br key={`br-${idx}`} />);
    out.push(<span key={`s-${idx}`}>{p}</span>);
  });
  return out;
}

// ─────────────────────────────────────────────────────────────
// 인라인 마크다운 → React 노드
//  처리 순서가 중요: code → bold → italic
//  (코드 안의 ** 등을 마크다운으로 오해하지 않도록 code를 먼저)
// ─────────────────────────────────────────────────────────────
function renderInline(text: string): ReactNode {
  // 1) `code` 토큰 우선 분리 — 코드 내부는 마크다운 파싱하지 않음
  const codeParts = splitByPattern(text, /`([^`]+)`/g, (m, key) => (
    <code
      key={key}
      className="px-1.5 py-0.5 rounded-sm font-mono text-[12px] bg-bg-subtle text-fg"
    >
      {m[1]}
    </code>
  ));

  // 2) 각 string 조각에 대해 bold → italic 순으로 처리
  const out: ReactNode[] = [];
  codeParts.forEach((part, idx) => {
    if (typeof part !== "string") {
      out.push(part);
      return;
    }
    const boldParts = splitByPattern(
      part,
      /\*\*([^*]+)\*\*/g,
      (m, key) => (
        <strong key={key} className="font-semibold text-fg">
          {m[1]}
        </strong>
      )
    );
    boldParts.forEach((bp, j) => {
      if (typeof bp !== "string") {
        out.push(bp);
        return;
      }
      // italic — *...* (앞뒤가 영문/한글 단어 중간이 아닌 경우만 안전, 단순화 위해 토큰만 매칭)
      const italicParts = splitByPattern(
        bp,
        /(?<!\*)\*([^*\n]+)\*(?!\*)/g,
        (m, key) => (
          <em key={key} className="italic text-fg">
            {m[1]}
          </em>
        )
      );
      italicParts.forEach((ip, k) => {
        out.push(
          typeof ip === "string" ? (
            <span key={`t-${idx}-${j}-${k}`}>{ip}</span>
          ) : (
            ip
          )
        );
      });
    });
  });

  return out;
}

/**
 * 정규식 매치 지점에서 문자열을 분리하고, 매치 부분은 ReactNode로 치환한다.
 * 비매치 구간은 string으로 남겨 후속 파서가 추가 처리할 수 있게 한다.
 */
function splitByPattern(
  input: string,
  pattern: RegExp,
  toNode: (match: RegExpExecArray, key: string) => ReactNode
): Array<string | ReactNode> {
  const result: Array<string | ReactNode> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  // RegExp는 g 플래그 가정. 안전을 위해 매 호출마다 lastIndex 초기화.
  pattern.lastIndex = 0;
  let i = 0;
  while ((match = pattern.exec(input)) !== null) {
    if (match.index > lastIndex) {
      result.push(input.slice(lastIndex, match.index));
    }
    result.push(toNode(match, `m-${i++}-${match.index}`));
    lastIndex = match.index + match[0].length;
    // 무한 루프 방지 (빈 매치)
    if (match[0].length === 0) pattern.lastIndex++;
  }
  if (lastIndex < input.length) {
    result.push(input.slice(lastIndex));
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// 토글 버튼용 chevron (회전)
// ─────────────────────────────────────────────────────────────
function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden
      className={cn(
        "transition-transform",
        expanded ? "rotate-180" : "rotate-0"
      )}
    >
      <path
        d="M2 3.5 L5 6.5 L8 3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
