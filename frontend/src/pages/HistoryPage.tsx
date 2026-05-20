/**
 * HistoryPage (/history) — PLACEHOLDER
 *
 * ⚠️ 본 파일은 라우터 컴파일을 위한 임시 placeholder다.
 *    Step 5에서 정식 작성 예정.
 *
 * Step 5 정식 구현 시 포함되어야 할 내용 (plan.md 참고):
 *  - GET /history 호출 (페이지네이션 — useInfiniteQuery 권장)
 *  - // TODO (Backend): Add limit/offset to GET /history
 *  - 세션 카드 리스트: 날짜, 타입(youtube/interview), 평균 점수
 *  - 카드 클릭 시 상세 리포트 (질문/답변/점수/단어별 히트맵)
 *  - 무한 스크롤 또는 페이지 버튼
 */
export default function HistoryPage() {
  return (
    <main className="min-h-dvh bg-bg text-fg">
      <div className="mx-auto max-w-2xl px-6 pt-24 pb-16">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-subtle mb-4">
          Placeholder
        </p>
        <h1 className="font-display text-5xl leading-[1.05] mb-4">
          히스토리는 <span className="italic text-accent">Step 5</span>에서 완성됩니다
        </h1>
        <p className="text-fg-muted text-lg leading-relaxed">
          페이지네이션을 적용한 세션 목록과 각 세션의 상세 리포트가 들어올
          예정이에요.
        </p>
      </div>
    </main>
  );
}
