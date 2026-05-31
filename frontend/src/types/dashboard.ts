/**
 * 학습 분석 대시보드 / 목표 타입
 *
 * 출처: backend/learning_features.py (라우터 루트 마운트)
 *  - GET  /dashboard       → DashboardResponse
 *  - GET  /goals           → { message: string; goal: GoalView | null }
 *  - POST /goals (JSON)     → { message: string; goal: GoalView }   바디는 GoalRequest
 *  - GET  /recommendations → { ...; weak_words: WeakWord[]; ... }   (WeakWord 재사용)
 *
 * 모든 필드는 learning_features.py의 실제 응답 조립부와 1:1 대조하여 정의했다.
 * (Implementation.md의 초기 구상 타입은 폐기 — 실키 기준으로 작성)
 */

/** _get_weak_words 항목 (avg_score ≤ 75인 단어만, /dashboard·/recommendations 공용) */
export interface WeakWord {
  word: string;
  avg_score: number;
  count: number;
  min_score: number;
}

/** 최근 점수 추이용 단건 (recent_scores) */
export interface RecentScore {
  /** 응답에 포함될 수 있음 (백엔드 확인 후 필수화 가능). 차트엔 불필요 */
  log_id?: number;
  created_at: string;
  accuracy: number;
  pronunciation: number;
  fluency: number;
}

/** 최신 동물 페르소나 요약 (latest_persona) — 점수 미산출 시 overall_score=null */
export interface LatestPersona {
  animal_name: string;
  animal_reason: string;
  animal_image_url: string | null;
  overall_score: number | null;
  created_at: string;
}

/** 누적 통계 (totals) */
export interface DashboardTotals {
  sessions: number;
  answers: number;
  youtube_sessions: number;
  interview_sessions: number;
}

/** 평균 점수 (averages, goal_progress의 분모) */
export interface ScoreAverages {
  accuracy: number;
  pronunciation: number;
  fluency: number;
}

/**
 * 목표 (POST/GET /goals 바디·응답, /dashboard의 goal).
 *  - /dashboard의 goal에는 id/timestamps가 없으나, /goals 응답엔 포함될 수 있어 옵셔널.
 *  - target_tech_stack은 응답에서 파싱된 배열(JSON 컬럼 → list).
 */
export interface GoalView {
  target_pronunciation_score: number | null;
  target_accuracy_score: number | null;
  target_fluency_score: number | null;
  weekly_practice_count: number | null;
  target_position: string | null;
  target_tech_stack: string[];
  id?: number;
  created_at?: string;
  updated_at?: string;
}

/** 목표 설정 요청 바디 (POST /goals) — 모든 필드 옵셔널(부분 갱신) */
export interface GoalRequest {
  target_pronunciation_score?: number | null;
  target_accuracy_score?: number | null;
  target_fluency_score?: number | null;
  weekly_practice_count?: number | null;
  target_position?: string | null;
  target_tech_stack?: string[] | null;
}

/** 목표 달성 진행도 (goal_progress) — goal이 없으면 DashboardResponse.goal_progress=null */
export interface GoalProgress {
  current_pronunciation_avg: number;
  pronunciation_gap: number | null;
  weekly_practice_done: number;
  weekly_practice_target: number | null;
  weekly_practice_remaining: number | null;
}

/**
 * 점수 추세 (trend) — 유니온.
 *  - 로그 2건 미만: "not_enough_data"
 *  - 그 외: 초기/최근 발음 평균과 차이(diff>3 improving, diff<-3 declining, 그 외 stable)
 */
export type DashboardTrend =
  | "not_enough_data"
  | {
      trend: "improving" | "declining" | "stable";
      initial_pronunciation_avg: number;
      recent_pronunciation_avg: number;
      difference: number;
    };

/** GET /dashboard 응답 */
export interface DashboardResponse {
  user: {
    id: number;
    email: string;
    nickname: string | null;
  };
  totals: DashboardTotals;
  averages: ScoreAverages;
  /** 최근 N건 (라인 차트용) */
  recent_scores: RecentScore[];
  /** 상위 약점 단어 (limit 5) */
  weak_words: WeakWord[];
  latest_persona: LatestPersona | null;
  goal: GoalView | null;
  goal_progress: GoalProgress | null;
  trend: DashboardTrend;
}

/**
 * trend 유니온 좁히기 헬퍼 — 객체형(데이터 충분)일 때만 true.
 * 사용 예: if (isTrendData(d.trend)) { d.trend.difference ... }
 */
export function isTrendData(
  trend: DashboardTrend
): trend is Exclude<DashboardTrend, "not_enough_data"> {
  return typeof trend === "object" && trend !== null;
}

/** GET /recommendations 응답 (weak_words·averages는 dashboard 타입 재사용) */
export interface RecommendationsResponse {
  message: string;
  averages: ScoreAverages;
  weak_points: string[];
  weak_words: WeakWord[];
  practice_sentences: string[];
  recommendation_strategy: string[];
}
