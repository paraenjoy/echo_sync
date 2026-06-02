/**
 * InterviewSetupPage (/interview/setup)
 *
 * 플로우:
 *  1) 직무 선택 → 해당 직무의 기술스택 칩이 동적 노출
 *  2) 경력/면접모드/프로젝트요약 입력 (필수) + PDF 자기소개서 (선택)
 *  3) "면접 시작" 클릭 → POST /interview/start-unified (multipart/form-data)
 *  4) 성공 시 useNavigate(state)로 첫 질문 데이터를 /interview/room에 전달
 *
 * 디자인:
 *  - YoutubePage와 동일한 Editorial Warmth 톤
 *  - 폼 필드는 FormField 래퍼로 라벨/힌트/슬롯 패턴 통일
 *  - 기술스택은 native checkbox 대신 토글 칩 (aria-pressed로 접근성 확보)
 *
 * 백엔드 계약 (main.py):
 *  - tech_stack은 JSON.stringify로 직렬화 (useStartInterview 내부 처리)
 *  - file은 Optional[UploadFile] - PDF 한 개만 허용
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useStartInterview } from "@/hooks/queries/useInterviewMutations";
import { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  POSITION_OPTIONS,
  TECH_STACK_MAP,
  EXPERIENCE_LEVELS,
  INTERVIEW_MODES,
  DEFAULT_MAX_QUESTIONS,
  MAX_QUESTIONS_OPTIONS,
  type Position,
} from "@/types/interview";

export default function InterviewSetupPage() {
  const navigate = useNavigate();
  const startMutation = useStartInterview();

  // ── 폼 상태 ────────────────────────────────────────────────
  const [position, setPosition] = useState<"" | Position>("");
  const [techStack, setTechStack] = useState<string[]>([]);
  const [experienceLevel, setExperienceLevel] = useState("");
  const [interviewMode, setInterviewMode] = useState("");
  const [projectSummary, setProjectSummary] = useState("");
  const [maxQuestions, setMaxQuestions] = useState<number>(DEFAULT_MAX_QUESTIONS);
  const [file, setFile] = useState<File | null>(null);

  // 직무 변경 시 기술 스택 자동 초기화
  // (이전 직무 기술이 새 직무 옵션에 포함되지 않을 수 있어 잔존 시 백엔드 혼선 유발)
  useEffect(() => {
    setTechStack([]);
  }, [position]);

  // ── 파생 상태 ──────────────────────────────────────────────
  const techOptions = position ? TECH_STACK_MAP[position] : [];
  const canSubmit =
    !!position &&
    !!experienceLevel &&
    !!interviewMode &&
    projectSummary.trim().length > 0 &&
    !startMutation.isPending;

  // ── 핸들러 ─────────────────────────────────────────────────
  const toggleTech = (tech: string) => {
    setTechStack((prev) =>
      prev.includes(tech) ? prev.filter((t) => t !== tech) : [...prev, tech]
    );
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    // PDF MIME 체크 (백엔드는 extract_text_from_pdf에서 PDF만 처리)
    if (picked && picked.type !== "application/pdf") {
      alert("PDF 파일만 업로드할 수 있어요.");
      e.target.value = ""; // input 초기화하여 같은 파일 재선택 가능하게
      return;
    }
    setFile(picked);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !position) return;

    startMutation.mutate(
      {
        position,
        tech_stack: techStack,
        experience_level: experienceLevel,
        project_summary: projectSummary.trim(),
        interview_mode: interviewMode,
        max_questions: maxQuestions,
        file,
      },
      {
        onSuccess: (data) => {
          // 첫 질문 데이터를 Room 페이지에 location.state로 전달
          // (URL에 노출하지 않으면서, 새로고침 시에는 Setup으로 자연스럽게 돌아가도록 의도)
          navigate("/interview/room", {
            state: {
              sessionId: data.session_id,
              questionId: data.question_id,
              firstQuestion: data.question,
              position,
              interviewMode,
              maxQuestions, // 신규 (Step 10-C2) — Room에서 자연 종료 분기에 사용
            },
          });
        },
      }
    );
  };

  return (
    <main className="min-h-dvh bg-bg text-fg">
      <div className="mx-auto max-w-2xl px-6 pt-20 pb-16">
        {/* ── Eyebrow ───────────────────────────────────────── */}
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-subtle mb-4">
          AI Interview / Setup
        </p>

        {/* ── Headline ──────────────────────────────────────── */}
        <h1 className="font-display text-5xl leading-[1.05] mb-4">
          오늘은 어떤,
          <br />
          <span className="text-accent">면접</span>을 준비할까요?
        </h1>

        <p className="text-fg-muted text-lg leading-relaxed mb-12 max-w-prose">
          직무·경력·프로젝트를 기반으로 AI가 맞춤 질문을 만들어드려요. 음성 또는
          텍스트로 답변하면 꼬리질문과 함께 실전처럼 진행됩니다.
        </p>

        {/* ── Form ──────────────────────────────────────────── */}
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* 직무 */}
          <FormField label="직무" required>
            <Select
              value={position}
              onChange={(e) => setPosition(e.target.value as "" | Position)}
              placeholder="직무를 선택해주세요"
              required
            >
              {POSITION_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </FormField>

          {/* 기술 스택 (직무 선택 후에만 표시) */}
          {position && (
            <FormField
              label="기술 스택"
              hint="자신있게 다룰 수 있는 기술을 모두 선택해주세요"
            >
              <div className="flex flex-wrap gap-2 animate-fade-up">
                {techOptions.map((tech) => {
                  const active = techStack.includes(tech);
                  return (
                    <button
                      key={tech}
                      type="button"
                      onClick={() => toggleTech(tech)}
                      aria-pressed={active}
                      className={cn(
                        "px-3.5 py-2 rounded-md text-sm font-medium border transition-all",
                        active
                          ? "border-accent bg-accent/15 text-accent"
                          : "border-border bg-bg-elevated text-fg-muted hover:border-border-strong hover:text-fg"
                      )}
                    >
                      {tech}
                    </button>
                  );
                })}
              </div>
            </FormField>
          )}

          {/* 경력 + 모드 (2열, 모바일은 1열) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <FormField label="경력 수준" required>
              <Select
                value={experienceLevel}
                onChange={(e) => setExperienceLevel(e.target.value)}
                placeholder="경력 선택"
                required
              >
                {EXPERIENCE_LEVELS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="면접 모드" required>
              <Select
                value={interviewMode}
                onChange={(e) => setInterviewMode(e.target.value)}
                placeholder="모드 선택"
                required
              >
                {INTERVIEW_MODES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          {/* 질문 개수 (Step 10-C1) ─── 1~9 칩 그리드 */}
          <FormField
            label="질문 개수"
            hint="첫 질문 + 꼬리질문을 합쳐 최대 몇 개까지 진행할지 정해주세요"
          >
            <div
              role="radiogroup"
              aria-label="질문 개수"
              className="grid grid-cols-9 gap-2"
            >
              {MAX_QUESTIONS_OPTIONS.map((n) => {
                const isSelected = maxQuestions === n;
                return (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setMaxQuestions(n)}
                    className={cn(
                      "h-11 rounded-md border font-display tabular-nums text-base",
                      "transition-colors focus:outline-none",
                      "focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                      isSelected
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-border bg-bg-elevated text-fg-muted hover:border-border-strong hover:text-fg"
                    )}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-fg-subtle">
              현재 선택 · <span className="text-fg-muted">{maxQuestions}개</span>
            </p>
          </FormField>

          {/* 프로젝트 요약 */}
          <FormField
            label="프로젝트 요약"
            required
            hint="가장 자신있게 설명할 수 있는 프로젝트를 한두 문단으로 적어주세요"
          >
            <Textarea
              value={projectSummary}
              onChange={(e) => setProjectSummary(e.target.value)}
              placeholder="예) 실시간 채팅 서비스를 React + WebSocket으로 구현했고, 메시지 큐를 도입해 동시 접속 1000명까지 처리한 경험..."
              rows={5}
              required
            />
          </FormField>

          {/* PDF 자기소개서 (선택) */}
          <FormField
            label="자기소개서"
            hint="선택 — PDF 파일을 첨부하면 자기소개서 내용 기반의 질문을 받을 수 있어요"
          >
            {/* ── 개인정보 처리 안내 (Step 11-A2 / feedback.md Q5) ──────
                백엔드 utils.mask_pii가 추출 직후 이메일/전화/주민번호/이름·주소
                라벨을 마스킹한 뒤 LLM에 전달한다는 사실을 사용자에게 명시한다.
                디자인 토큰만 사용 — accent 톤으로 신뢰감 + 강조 없는 차분한 카드. */}
            <div
              className="mb-2.5 flex items-start gap-2.5 rounded-md border border-border bg-bg-elevated/70 px-3.5 py-3"
              role="note"
            >
              <span className="grid place-items-center w-6 h-6 rounded-sm bg-accent/15 text-accent shrink-0 mt-px">
                <IconShield />
              </span>
              <div className="text-xs text-fg-muted leading-relaxed">
                <p className="text-fg mb-0.5 font-medium">
                  업로드한 PDF는 질문 생성에만 사용돼요
                </p>
                <p>
                  이메일·연락처·주민등록번호·이름·주소는 AI 전송 직전에 자동으로
                  가려져요. 파일은 분석이 끝나면 서버에서 즉시 삭제됩니다.
                </p>
              </div>
            </div>

            <FileUploader
              file={file}
              onFileChange={handleFileChange}
              onRemove={() => setFile(null)}
            />
          </FormField>

          {/* 에러 메시지 (인라인) */}
          {startMutation.isError && (
            <p
              role="alert"
              className="text-sm text-score-low animate-fade-up bg-score-low/10 border border-score-low/40 rounded-md px-4 py-3"
            >
              {getErrorMessage(startMutation.error)}
            </p>
          )}

          {/* 제출 */}
          <div className="pt-2">
            <Button
              type="submit"
              size="lg"
              className="w-full h-14 text-base"
              disabled={!canSubmit}
            >
              {startMutation.isPending ? "질문 생성 중..." : "면접 시작"}
            </Button>
            <p className="mt-3 text-xs text-fg-subtle text-center">
              제출 시 AI가 첫 질문을 생성하는 데 5~15초 정도 소요될 수 있어요
            </p>
          </div>
        </form>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────
// FormField — 라벨 + 힌트 + 슬롯 공통 패턴
// ─────────────────────────────────────────────────────────────
interface FormFieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}

function FormField({ label, required, hint, children }: FormFieldProps) {
  return (
    <div>
      <label className="block mb-1.5">
        <span className="font-mono text-xs uppercase tracking-wider text-fg-subtle">
          {label}
          {required && <span className="text-accent ml-1">*</span>}
        </span>
      </label>
      {hint && <p className="text-xs text-fg-muted/80 mb-2.5">{hint}</p>}
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// FileUploader — PDF 한 파일 선택 / 제거
// 디자인:
//   - 미선택: 점선 보더의 클릭 영역
//   - 선택됨: 실선 카드 + 파일명/크기 + 제거 버튼
// ─────────────────────────────────────────────────────────────
interface FileUploaderProps {
  file: File | null;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}

function FileUploader({ file, onFileChange, onRemove }: FileUploaderProps) {
  if (file) {
    return (
      <div className="flex items-center gap-3 bg-bg-elevated border border-border rounded-md px-4 py-3 animate-fade-up">
        <span className="grid place-items-center w-8 h-8 rounded-sm bg-accent/15 text-accent shrink-0">
          <IconPdf />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-fg truncate">{file.name}</p>
          <p className="text-xs text-fg-subtle font-mono tabular-nums">
            {(file.size / 1024).toFixed(1)} KB
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="파일 제거"
          className="text-fg-subtle hover:text-score-low transition-colors p-1.5 rounded-sm"
        >
          <IconX />
        </button>
      </div>
    );
  }

  return (
    <label
      className={cn(
        "flex items-center justify-center gap-2 cursor-pointer",
        "border border-dashed border-border rounded-md bg-bg-elevated/50",
        "px-4 py-6 transition-colors",
        "hover:border-accent/60 hover:bg-accent/5"
      )}
    >
      <IconUpload />
      <span className="text-sm text-fg-muted">PDF 파일을 선택해주세요</span>
      <input
        type="file"
        accept=".pdf,application/pdf"
        onChange={onFileChange}
        className="hidden"
      />
    </label>
  );
}

// ─────────────────────────────────────────────────────────────
// 인라인 SVG 아이콘 (의존성 없음 — MicButton/ErrorModal과 동일 컨벤션)
// ─────────────────────────────────────────────────────────────
function IconPdf() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function IconX() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-fg-muted"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* 방패 외곽 + 체크 — "보호되고 있음" 신호. lock 대신 shield-check를
          선택한 이유: lock은 "잠겨 있어 못 봄"의 뉘앙스가 강해 차단감을 주지만,
          여기서는 "처리되고 있으니 안심하라"가 톤에 맞다. */}
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
