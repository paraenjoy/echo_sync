/**
 * InterviewReportSection — 히스토리 면접 리포트
 *
 * 데이터: HistorySession.interview_report (HistoryInterviewReport)
 *  - 면접 세션에만 존재. 페이지에서 report가 있을 때만 렌더한다.
 *  - 질문별 상세는 페이지의 logs 렌더가 담당하므로 여기선 다루지 않는다.
 *
 * 구성: 페르소나 헤더(이미지/이름/총점) → 점수 분해 → 총평(content_improvement) → 기술 스택 파이.
 * 점수 필드는 session-score 호출 전이면 null → 분해 섹션을 숨긴다.
 * 디자인(DESIGN_SYSTEM.md): 의미 토큰. 점수에만 티어 색(데이터 전용).
 */
import { TechStackPie } from "./TechStackPie";
import { resolveStaticUrl } from "@/lib/utils";
import type { HistoryInterviewReport } from "@/types/history";

interface InterviewReportSectionProps {
  report: HistoryInterviewReport;
}

function scoreColor(score: number): string {
  if (score >= 90) return "score-high";
  if (score >= 60) return "score-mid";
  return "score-low";
}

const fmt = (v: number | null) => (v === null ? "–" : Math.round(v).toString());

export function InterviewReportSection({ report }: InterviewReportSectionProps) {
  const hasScores = report.overall_score !== null;

  // 서버 상대 경로 → 절대 URL 변환 (resolveStaticUrl로 통일)
  const imageUrl = resolveStaticUrl(report.animal_image_url);

  const breakdown: { label: string; value: number | null }[] = [
    { label: "발음", value: report.pronunciation_avg },
    { label: "정확도", value: report.accuracy_avg },
    { label: "유창성", value: report.fluency_avg },
    { label: "내용", value: report.content_score },
    { label: "기술", value: report.technical_score },
    { label: "자신감", value: report.confidence_score },
  ];

  return (
    <section className="space-y-4 animate-fade-up">
      {/* 페르소나 헤더 */}
      <div className="rounded-xl border border-border bg-bg-elevated p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={report.animal_name}
              className="h-28 w-28 shrink-0 rounded-xl border border-border object-cover"
              loading="lazy"
            />
          ) : (
            <div className="grid h-28 w-28 shrink-0 place-items-center rounded-xl border border-border bg-bg-subtle font-display text-4xl text-fg-subtle">
              {report.animal_name.charAt(0)}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
              Interview persona
            </p>
            <div className="mb-3 flex items-baseline gap-3">
              <h3 className="font-display text-2xl leading-tight">
                {report.animal_name}
              </h3>
              {report.overall_score !== null && (
                <span className="flex items-baseline gap-1">
                  <span
                    className={`font-mono text-xl tabular-nums ${scoreColor(
                      report.overall_score
                    )}`}
                  >
                    {Math.round(report.overall_score)}
                  </span>
                  <span className="font-mono text-xs text-fg-subtle">/100</span>
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-fg-muted">
              {report.animal_reason}
            </p>
          </div>
        </div>

        {/* 점수 분해 (산출된 경우만) */}
        {hasScores && (
          <div className="mt-6 grid grid-cols-3 gap-4 border-t border-border pt-5 sm:grid-cols-6">
            {breakdown.map((m) => (
              <div key={m.label}>
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
                  {m.label}
                </p>
                <p
                  className={`font-mono text-xl tabular-nums ${
                    m.value === null ? "text-fg-subtle" : scoreColor(m.value)
                  }`}
                >
                  {fmt(m.value)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 총평 */}
      {report.content_improvement && (
        <div className="rounded-xl border border-border bg-bg-elevated p-6">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
            Overall feedback
          </p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
            {report.content_improvement}
          </p>
        </div>
      )}

      {/* 기술 스택 비중 */}
      <div className="rounded-xl border border-border bg-bg-elevated p-6">
        <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
          Tech stack mentions
        </p>
        <TechStackPie data={report.tech_stack_percent} />
      </div>
    </section>
  );
}
