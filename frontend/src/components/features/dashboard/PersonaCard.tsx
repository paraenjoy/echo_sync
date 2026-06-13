/**
 * PersonaCard — 최신 동물 페르소나 (대시보드)
 *
 * 데이터: GET /dashboard 의 latest_persona (LatestPersona)
 *  - 면접 종료(/interview/finalize) 후 생성된 가장 최근 페르소나 요약
 *  - persona가 없으면(아직 면접 미완료) 페이지에서 섹션째 숨김
 *
 * 표시: 이미지(없으면 이니셜 폴백) + 동물 이름 + 총점(티어 색) + 사유 + 생성일.
 * 디자인(DESIGN_SYSTEM.md): 의미 토큰만. 총점에만 점수 티어 색(데이터 전용).
 * 이미지는 원형 느낌 대신 rounded-xl 썸네일(반경 한계 준수).
 */
import { Link } from "react-router-dom";
import type { LatestPersona } from "@/types/dashboard";
import { resolveStaticUrl } from "@/lib/utils";

interface PersonaCardProps {
  persona: LatestPersona;
}

function scoreColor(score: number): string {
  if (score >= 90) return "score-high";
  if (score >= 60) return "score-mid";
  return "score-low";
}

function formatDate(iso: string): string {
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function PersonaCard({ persona }: PersonaCardProps) {
  // 서버 상대 경로("/static/audio/...") → 절대 URL 변환.
  // 외부 http URL, 이전 데이터(placeholder 등)도 resolveStaticUrl이 그대로 통과시킨다.
  const imageUrl = resolveStaticUrl(persona.animal_image_url);

  return (
    <div className="rounded-xl border border-border bg-bg-elevated p-6 animate-fade-up">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={persona.animal_name}
            className="h-28 w-28 shrink-0 rounded-xl border border-border object-cover"
            loading="lazy"
          />
        ) : (
          <div className="grid h-28 w-28 shrink-0 place-items-center rounded-xl border border-border bg-bg-subtle font-display text-4xl text-fg-subtle">
            {persona.animal_name.charAt(0)}
          </div>
        )}

        {/* 본문 */}
        <div className="min-w-0 flex-1">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
            Latest persona
          </p>

          <div className="mb-3 flex items-baseline gap-3">
            <h3 className="font-display text-2xl leading-tight">
              {persona.animal_name}
            </h3>
            {persona.overall_score !== null && (
              <span className="flex items-baseline gap-1">
                <span
                  className={`font-mono text-xl tabular-nums ${scoreColor(
                    persona.overall_score
                  )}`}
                >
                  {Math.round(persona.overall_score)}
                </span>
                <span className="font-mono text-xs text-fg-subtle">/100</span>
              </span>
            )}
          </div>

          <p className="text-sm leading-relaxed text-fg-muted">
            {persona.animal_reason}
          </p>

          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] tabular-nums text-fg-subtle">
              {formatDate(persona.created_at)}
            </span>
            {/* session_id로 해당 면접 리포트 상세에 직링크 */}
            <Link
              to={`/history/${persona.session_id}`}
              className="text-xs text-fg-subtle transition-colors hover:text-accent"
            >
              히스토리에서 보기 →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
