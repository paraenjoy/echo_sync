/**
 * GoalSettingModal — 학습 목표 생성/수정
 *
 * 데이터: POST /goals (useUpsertGoal). 성공 시 goal·dashboard 캐시 갱신은 훅이 처리.
 * prefill: 부모(DashboardPage)가 이미 가진 goal을 initialGoal로 전달 → 별도 GET /goals 미발생.
 *
 * 관례:
 *  - 오버레이/backdrop/dialog 구조와 토큰은 ErrorModal과 동일.
 *  - Escape / backdrop 클릭으로 닫기 (UserMenu의 Escape 패턴).
 *  - FormField·Button·Input은 기존 컴포넌트 재사용.
 *
 * 점수 필드는 비우면 null(목표 없음)로 전송된다.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpsertGoal } from "@/hooks/queries/useGoal";
import { getErrorMessage } from "@/lib/api";
import type { GoalRequest, GoalView } from "@/types/dashboard";

interface GoalSettingModalProps {
  open: boolean;
  onClose: () => void;
  /** 현재 목표 (대시보드가 보유) — 폼 prefill용. 없으면 빈 폼 */
  initialGoal: GoalView | null;
}

interface FormState {
  pronunciation: string;
  accuracy: string;
  fluency: string;
  weekly: string;
  position: string;
  tech: string;
}

const EMPTY: FormState = {
  pronunciation: "",
  accuracy: "",
  fluency: "",
  weekly: "",
  position: "",
  tech: "",
};

function fromGoal(goal: GoalView | null): FormState {
  if (!goal) return EMPTY;
  const s = (v: number | null) => (v === null || v === undefined ? "" : String(v));
  return {
    pronunciation: s(goal.target_pronunciation_score),
    accuracy: s(goal.target_accuracy_score),
    fluency: s(goal.target_fluency_score),
    weekly: s(goal.weekly_practice_count),
    position: goal.target_position ?? "",
    tech: goal.target_tech_stack.join(", "),
  };
}

/** 빈 문자열 → null, 그 외 유한수만 통과 */
function num(value: string): number | null {
  const t = value.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function GoalSettingModal({
  open,
  onClose,
  initialGoal,
}: GoalSettingModalProps) {
  const [form, setForm] = useState<FormState>(() => fromGoal(initialGoal));
  const upsert = useUpsertGoal();

  // 열릴 때마다 현재 목표로 prefill (직전 입력 잔재 제거)
  useEffect(() => {
    if (open) {
      setForm(fromGoal(initialGoal));
      upsert.reset();
    }
    // upsert는 안정 참조가 아니므로 의존성에서 제외 (열림/목표 변화에만 반응)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialGoal]);

  // Escape 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !upsert.isPending) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, upsert.isPending]);

  if (!open) return null;

  const set = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = () => {
    const body: GoalRequest = {
      target_pronunciation_score: num(form.pronunciation),
      target_accuracy_score: num(form.accuracy),
      target_fluency_score: num(form.fluency),
      weekly_practice_count: num(form.weekly),
      target_position: form.position.trim() || null,
      target_tech_stack: form.tech
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };
    upsert.mutate(body, { onSuccess: () => onClose() });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="goal-modal-title"
      className="fixed inset-0 z-50 grid place-items-center p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-bg/80 backdrop-blur-sm"
        onClick={() => !upsert.isPending && onClose()}
      />

      {/* Dialog */}
      <div
        className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-border-strong bg-bg-elevated p-6 shadow-2xl animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle mb-1">
            Goal
          </p>
          <h2 id="goal-modal-title" className="font-display text-2xl leading-tight">
            학습 목표 설정
          </h2>
          <p className="mt-2 text-sm text-fg-muted">
            비워두면 해당 항목은 목표 없음으로 저장돼요.
          </p>
        </header>

        {/* 점수 목표 */}
        <div className="mb-4 grid grid-cols-3 gap-3">
          <Field label="목표 발음">
            <Input
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              value={form.pronunciation}
              onChange={(e) => set("pronunciation", e.target.value)}
              placeholder="80"
            />
          </Field>
          <Field label="목표 정확도">
            <Input
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              value={form.accuracy}
              onChange={(e) => set("accuracy", e.target.value)}
              placeholder="80"
            />
          </Field>
          <Field label="목표 유창성">
            <Input
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              value={form.fluency}
              onChange={(e) => set("fluency", e.target.value)}
              placeholder="80"
            />
          </Field>
        </div>

        {/* 주간 연습 */}
        <div className="mb-4">
          <Field label="주간 연습 횟수" hint="한 주에 목표로 하는 답변 녹음 횟수예요.">
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              value={form.weekly}
              onChange={(e) => set("weekly", e.target.value)}
              placeholder="5"
            />
          </Field>
        </div>

        {/* 직무 */}
        <div className="mb-4">
          <Field label="목표 직무">
            <Input
              value={form.position}
              onChange={(e) => set("position", e.target.value)}
              placeholder="예: 프론트엔드 개발자"
            />
          </Field>
        </div>

        {/* 기술 스택 */}
        <div className="mb-6">
          <Field label="목표 기술 스택" hint="쉼표(,)로 구분해 입력하세요.">
            <Input
              value={form.tech}
              onChange={(e) => set("tech", e.target.value)}
              placeholder="React, TypeScript, FastAPI"
            />
          </Field>
        </div>

        {upsert.isError && (
          <p className="mb-4 rounded-md border border-score-low/30 bg-score-low/10 px-3 py-2 text-sm text-score-low">
            {getErrorMessage(upsert.error)}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={upsert.isPending}>
            취소
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={upsert.isPending}>
            {upsert.isPending ? "저장 중…" : "저장"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block">
        <span className="font-mono text-xs uppercase tracking-wider text-fg-subtle">
          {label}
        </span>
      </label>
      {hint && <p className="mb-2 text-xs text-fg-muted/80">{hint}</p>}
      {children}
    </div>
  );
}
