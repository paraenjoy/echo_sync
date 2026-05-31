import json
from datetime import datetime, timedelta, timezone
from typing import Optional, cast

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from database import get_session
from deps import get_current_user
from models import (
    User,
    StudySession,
    Question,
    SpeakingLog,
    WordLog,
    InterviewReport,
    UserGoal,
)


router = APIRouter(tags=["Learning Analytics"])


class GoalRequest(BaseModel):
    target_pronunciation_score: Optional[float] = None
    target_accuracy_score: Optional[float] = None
    target_fluency_score: Optional[float] = None
    weekly_practice_count: Optional[int] = None
    target_position: Optional[str] = None
    target_tech_stack: Optional[list[str]] = None


def _now():
    return datetime.now(timezone.utc)


def _as_aware(dt: datetime):
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _avg(values):
    values = [float(v) for v in values if v is not None]
    if not values:
        return 0.0
    return round(sum(values) / len(values), 2)


def _safe_json_loads(text: Optional[str], default):
    if not text:
        return default
    try:
        return json.loads(text)
    except Exception:
        return default


def _get_user_logs(session: Session, user_id: int):
    logs = session.exec(
        select(SpeakingLog).where(SpeakingLog.user_id == user_id)
    ).all()

    return sorted(logs, key=lambda x: x.created_at)


def _get_user_sessions(session: Session, user_id: int):
    sessions = session.exec(
        select(StudySession).where(StudySession.user_id == user_id)
    ).all()

    return sorted(sessions, key=lambda x: x.created_at)


def _get_word_logs_for_user(session: Session, user_logs: list[SpeakingLog]):
    log_ids = {
        cast(int, log.id)
        for log in user_logs
        if log.id is not None
    }

    if not log_ids:
        return []

    all_words = session.exec(select(WordLog)).all()

    return [
        word
        for word in all_words
        if word.speaking_log_id in log_ids
    ]


def _get_weak_words(word_logs: list[WordLog], limit: int = 8):
    word_stats: dict[str, dict[str, float]] = {}

    for word_log in word_logs:
        word = word_log.word.strip().lower()

        if not word:
            continue

        if word not in word_stats:
            word_stats[word] = {
                "total": 0,
                "count": 0,
                "min_score": 100,
            }

        score = float(word_log.accuracy_score)

        word_stats[word]["total"] += score
        word_stats[word]["count"] += 1
        word_stats[word]["min_score"] = min(word_stats[word]["min_score"], score)

    result = []

    for word, stat in word_stats.items():
        avg_score = stat["total"] / stat["count"]

        if avg_score <= 75:
            result.append({
                "word": word,
                "avg_score": round(avg_score, 2),
                "count": int(stat["count"]),
                "min_score": round(stat["min_score"], 2),
            })

    result.sort(key=lambda x: (x["avg_score"], -x["count"]))

    return result[:limit]


def _make_practice_sentences(weak_words: list[dict], target_position: Optional[str] = None):
    words = [item["word"] for item in weak_words[:5]]

    if not words:
        return [
            "I clearly explained my role in the project.",
            "I improved the system by analyzing user feedback.",
            "I solved the problem by testing several possible solutions.",
            "This experience helped me become a better developer.",
            "I want to keep improving my communication skills.",
        ]

    sentences = []

    for word in words:
        sentences.append(f"I practiced the word {word} to improve my pronunciation.")
        sentences.append(f"I can use {word} naturally when explaining my project.")

    if target_position:
        sentences.append(f"I am preparing for a {target_position} interview with clear and confident answers.")

    return sentences[:8]


def _trend_from_recent_scores(logs: list[SpeakingLog]):
    if len(logs) < 2:
        return "not_enough_data"

    first_window = logs[:min(5, len(logs))]
    recent_window = logs[-min(5, len(logs)):]

    first_avg = _avg([log.pronunciation_score for log in first_window])
    recent_avg = _avg([log.pronunciation_score for log in recent_window])

    diff = round(recent_avg - first_avg, 2)

    if diff > 3:
        trend = "improving"
    elif diff < -3:
        trend = "declining"
    else:
        trend = "stable"

    return {
        "trend": trend,
        "initial_pronunciation_avg": first_avg,
        "recent_pronunciation_avg": recent_avg,
        "difference": diff,
    }


def _period_report(session: Session, user_id: int, days: int):
    now = _now()
    start = now - timedelta(days=days)

    all_logs = _get_user_logs(session, user_id)
    all_sessions = _get_user_sessions(session, user_id)

    logs = [
        log
        for log in all_logs
        if _as_aware(log.created_at) >= start
    ]

    sessions = [
        item
        for item in all_sessions
        if _as_aware(item.created_at) >= start
    ]

    word_logs = _get_word_logs_for_user(session, logs)
    weak_words = _get_weak_words(word_logs, limit=5)

    report_name = "weekly" if days == 7 else "monthly"

    if not logs:
        return {
            "report_type": report_name,
            "days": days,
            "message": "해당 기간의 학습 기록이 없습니다.",
            "total_sessions": len(sessions),
            "total_answers": 0,
            "averages": None,
            "weak_words": [],
            "recommendations": [
                "먼저 유튜브 질문 또는 면접 질문에 1회 이상 답변해 보세요.",
                "녹음 답변이 쌓이면 기간별 향상률을 분석할 수 있습니다.",
            ],
        }

    averages = {
        "accuracy": _avg([log.accuracy_score for log in logs]),
        "pronunciation": _avg([log.pronunciation_score for log in logs]),
        "fluency": _avg([log.fluency_score for log in logs]),
        "overall": _avg([
            (float(log.accuracy_score) + float(log.pronunciation_score) + float(log.fluency_score)) / 3
            for log in logs
        ]),
    }

    recommendations = []

    if averages["pronunciation"] < 75:
        recommendations.append("발음 점수가 낮은 편이므로 짧은 문장부터 천천히 반복 녹음하는 연습이 필요합니다.")

    if averages["fluency"] < 75:
        recommendations.append("유창성 향상을 위해 문장을 한 번에 말하기보다 의미 단위로 끊어 읽는 연습을 추천합니다.")

    if averages["accuracy"] < 75:
        recommendations.append("정확도 향상을 위해 질문의 핵심 단어를 답변에 다시 포함시키는 연습이 좋습니다.")

    if weak_words:
        recommendations.append("반복적으로 낮게 나온 단어를 포함한 맞춤 문장을 먼저 연습하세요.")

    if not recommendations:
        recommendations.append("전반적으로 안정적인 흐름입니다. 이제 더 긴 답변과 기술 설명을 연습해도 좋습니다.")

    return {
        "report_type": report_name,
        "days": days,
        "period_start": str(start),
        "period_end": str(now),
        "total_sessions": len(sessions),
        "total_answers": len(logs),
        "averages": averages,
        "weak_words": weak_words,
        "recommendations": recommendations,
    }


def _compute_interview_scores(
    logs: list[SpeakingLog],
    study_session: StudySession,
):
    pronunciation_avg = _avg([log.pronunciation_score for log in logs])
    accuracy_avg = _avg([log.accuracy_score for log in logs])
    fluency_avg = _avg([log.fluency_score for log in logs])

    answers = [
        log.recognized_text or ""
        for log in logs
    ]

    avg_word_count = _avg([
        len(answer.split())
        for answer in answers
        if answer
    ])

    content_score = min(100, round(avg_word_count * 5, 2))

    metadata = _safe_json_loads(study_session.metadata_json, {})
    tech_stack = metadata.get("tech_stack", [])

    full_text = " ".join(answers).lower()

    if tech_stack:
        mentioned = 0

        for tech in tech_stack:
            if str(tech).lower() in full_text:
                mentioned += 1

        technical_score = round((mentioned / len(tech_stack)) * 100, 2)
    else:
        technical_score = 70.0

    confidence_score = round((pronunciation_avg * 0.4) + (fluency_avg * 0.6), 2)

    overall_score = round(
        pronunciation_avg * 0.25
        + accuracy_avg * 0.2
        + fluency_avg * 0.25
        + content_score * 0.15
        + technical_score * 0.15,
        2
    )

    return {
        "overall_score": overall_score,
        "pronunciation_avg": pronunciation_avg,
        "accuracy_avg": accuracy_avg,
        "fluency_avg": fluency_avg,
        "content_score": content_score,
        "technical_score": technical_score,
        "confidence_score": confidence_score,
        "answer_count": len(logs),
        "avg_answer_word_count": avg_word_count,
    }


@router.get("/dashboard")
def get_dashboard(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    user_id = cast(int, current_user.id)

    sessions = _get_user_sessions(session, user_id)
    logs = _get_user_logs(session, user_id)
    word_logs = _get_word_logs_for_user(session, logs)

    latest_report = session.exec(
        select(InterviewReport).where(InterviewReport.user_id == user_id)
    ).all()

    latest_report = sorted(latest_report, key=lambda x: x.created_at, reverse=True)

    goal = session.exec(
        select(UserGoal).where(UserGoal.user_id == user_id)
    ).first()

    now = _now()
    week_start = now - timedelta(days=7)

    weekly_logs = [
        log
        for log in logs
        if _as_aware(log.created_at) >= week_start
    ]

    recent_logs = logs[-10:]

    dashboard = {
        "user": {
            "id": current_user.id,
            "email": current_user.email,
            "nickname": current_user.nickname,
        },
        "totals": {
            "sessions": len(sessions),
            "answers": len(logs),
            "youtube_sessions": len([s for s in sessions if s.session_type == "youtube"]),
            "interview_sessions": len([s for s in sessions if s.session_type == "interview"]),
        },
        "averages": {
            "accuracy": _avg([log.accuracy_score for log in logs]),
            "pronunciation": _avg([log.pronunciation_score for log in logs]),
            "fluency": _avg([log.fluency_score for log in logs]),
        },
        "recent_scores": [
            {
                "log_id": log.id,
                "created_at": str(log.created_at),
                "accuracy": log.accuracy_score,
                "pronunciation": log.pronunciation_score,
                "fluency": log.fluency_score,
            }
            for log in recent_logs
        ],
        "weak_words": _get_weak_words(word_logs, limit=5),
        "latest_persona": None,
        "goal": None,
        "goal_progress": None,
        "trend": _trend_from_recent_scores(logs),
    }

    if latest_report:
        report = latest_report[0]
        dashboard["latest_persona"] = {
            "animal_name": report.animal_name,
            "animal_reason": report.animal_reason,
            "animal_image_url": report.animal_image_url,
            "overall_score": report.overall_score,
            "created_at": str(report.created_at),
        }

    if goal:
        target_pronunciation = goal.target_pronunciation_score
        weekly_target = goal.weekly_practice_count

        dashboard["goal"] = {
            "target_pronunciation_score": target_pronunciation,
            "target_accuracy_score": goal.target_accuracy_score,
            "target_fluency_score": goal.target_fluency_score,
            "weekly_practice_count": weekly_target,
            "target_position": goal.target_position,
            "target_tech_stack": _safe_json_loads(goal.target_tech_stack_json, []),
        }

        current_pronunciation = dashboard["averages"]["pronunciation"]

        dashboard["goal_progress"] = {
            "current_pronunciation_avg": current_pronunciation,
            "pronunciation_gap": (
                round(target_pronunciation - current_pronunciation, 2)
                if target_pronunciation is not None
                else None
            ),
            "weekly_practice_done": len(weekly_logs),
            "weekly_practice_target": weekly_target,
            "weekly_practice_remaining": (
                max(0, weekly_target - len(weekly_logs))
                if weekly_target is not None
                else None
            ),
        }

    return dashboard


@router.get("/recommendations")
def get_recommendations(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    user_id = cast(int, current_user.id)

    logs = _get_user_logs(session, user_id)
    word_logs = _get_word_logs_for_user(session, logs)
    weak_words = _get_weak_words(word_logs, limit=8)

    goal = session.exec(
        select(UserGoal).where(UserGoal.user_id == user_id)
    ).first()

    target_position = goal.target_position if goal else None

    averages = {
        "accuracy": _avg([log.accuracy_score for log in logs]),
        "pronunciation": _avg([log.pronunciation_score for log in logs]),
        "fluency": _avg([log.fluency_score for log in logs]),
    }

    weak_points = []

    if averages["pronunciation"] and averages["pronunciation"] < 75:
        weak_points.append("발음 명확도")

    if averages["fluency"] and averages["fluency"] < 75:
        weak_points.append("유창성")

    if averages["accuracy"] and averages["accuracy"] < 75:
        weak_points.append("문장 정확도")

    if weak_words:
        weak_points.append("반복적으로 낮게 나온 단어 발음")

    if not weak_points:
        weak_points.append("현재는 뚜렷한 약점보다 답변 길이와 구체성을 높이는 단계")

    practice_sentences = _make_practice_sentences(weak_words, target_position)

    return {
        "message": "맞춤 학습 추천 생성 완료",
        "averages": averages,
        "weak_points": weak_points,
        "weak_words": weak_words,
        "practice_sentences": practice_sentences,
        "recommendation_strategy": [
            "점수가 낮은 단어를 포함한 짧은 문장을 먼저 연습합니다.",
            "같은 문장을 2~3회 반복 녹음하여 점수 변화를 확인합니다.",
            "면접 답변에서는 프로젝트 상황, 역할, 문제 해결 과정, 결과를 순서대로 말하는 연습을 합니다.",
        ],
    }


@router.get("/questions/{question_id}/retry-info")
def get_retry_info(
    question_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    user_id = cast(int, current_user.id)

    question = session.exec(
        select(Question).where(Question.id == question_id)
    ).first()

    if not question:
        raise HTTPException(status_code=404, detail="질문을 찾을 수 없습니다.")

    study_session = session.exec(
        select(StudySession).where(
            StudySession.id == question.session_id,
            StudySession.user_id == user_id,
        )
    ).first()

    if not study_session:
        raise HTTPException(status_code=403, detail="해당 질문에 접근할 수 없습니다.")

    logs = session.exec(
        select(SpeakingLog).where(
            SpeakingLog.question_id == question_id,
            SpeakingLog.user_id == user_id,
        )
    ).all()

    logs = sorted(logs, key=lambda log: log.created_at)

    latest_log = logs[-1] if logs else None
    best_log = None

    if logs:
        best_log = max(
            logs,
            key=lambda log: (
                float(log.accuracy_score)
                + float(log.pronunciation_score)
                + float(log.fluency_score)
            ) / 3
        )

    return {
        "message": "재도전 정보 조회 완료",
        "session_id": study_session.id,
        "question_id": question.id,
        "question_text": question.question_text,
        "question_ko": question.question_ko,
        "model_answer": question.model_answer,
        "retry_method": "프론트에서 기존 /ws/audio에 session_id와 question_id를 그대로 넘기면 같은 질문 재도전 기록으로 저장됩니다.",
        "attempt_count": len(logs),
        "latest_attempt": (
            {
                "log_id": latest_log.id,
                "recognized_text": latest_log.recognized_text,
                "accuracy_score": latest_log.accuracy_score,
                "pronunciation_score": latest_log.pronunciation_score,
                "fluency_score": latest_log.fluency_score,
                "created_at": str(latest_log.created_at),
            }
            if latest_log
            else None
        ),
        "best_attempt": (
            {
                "log_id": best_log.id,
                "recognized_text": best_log.recognized_text,
                "accuracy_score": best_log.accuracy_score,
                "pronunciation_score": best_log.pronunciation_score,
                "fluency_score": best_log.fluency_score,
                "created_at": str(best_log.created_at),
            }
            if best_log
            else None
        ),
    }


@router.get("/reports/weekly")
def get_weekly_report(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    return _period_report(
        session=session,
        user_id=cast(int, current_user.id),
        days=7,
    )


@router.get("/reports/monthly")
def get_monthly_report(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    return _period_report(
        session=session,
        user_id=cast(int, current_user.id),
        days=30,
    )


@router.post("/goals")
def upsert_goal(
    request: GoalRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    user_id = cast(int, current_user.id)

    goal = session.exec(
        select(UserGoal).where(UserGoal.user_id == user_id)
    ).first()

    tech_stack_json = (
        json.dumps(request.target_tech_stack, ensure_ascii=False)
        if request.target_tech_stack is not None
        else None
    )

    if goal:
        goal.target_pronunciation_score = request.target_pronunciation_score
        goal.target_accuracy_score = request.target_accuracy_score
        goal.target_fluency_score = request.target_fluency_score
        goal.weekly_practice_count = request.weekly_practice_count
        goal.target_position = request.target_position
        goal.target_tech_stack_json = tech_stack_json
        goal.updated_at = _now()

        session.add(goal)
        session.commit()
        session.refresh(goal)

    else:
        goal = UserGoal(
            user_id=user_id,
            target_pronunciation_score=request.target_pronunciation_score,
            target_accuracy_score=request.target_accuracy_score,
            target_fluency_score=request.target_fluency_score,
            weekly_practice_count=request.weekly_practice_count,
            target_position=request.target_position,
            target_tech_stack_json=tech_stack_json,
        )

        session.add(goal)
        session.commit()
        session.refresh(goal)

    return {
        "message": "사용자 목표 저장 완료",
        "goal": {
            "id": goal.id,
            "target_pronunciation_score": goal.target_pronunciation_score,
            "target_accuracy_score": goal.target_accuracy_score,
            "target_fluency_score": goal.target_fluency_score,
            "weekly_practice_count": goal.weekly_practice_count,
            "target_position": goal.target_position,
            "target_tech_stack": _safe_json_loads(goal.target_tech_stack_json, []),
            "updated_at": str(goal.updated_at),
        },
    }


@router.get("/goals")
def get_goal(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    goal = session.exec(
        select(UserGoal).where(UserGoal.user_id == cast(int, current_user.id))
    ).first()

    if not goal:
        return {
            "message": "저장된 목표가 없습니다.",
            "goal": None,
        }

    return {
        "message": "사용자 목표 조회 완료",
        "goal": {
            "id": goal.id,
            "target_pronunciation_score": goal.target_pronunciation_score,
            "target_accuracy_score": goal.target_accuracy_score,
            "target_fluency_score": goal.target_fluency_score,
            "weekly_practice_count": goal.weekly_practice_count,
            "target_position": goal.target_position,
            "target_tech_stack": _safe_json_loads(goal.target_tech_stack_json, []),
            "created_at": str(goal.created_at),
            "updated_at": str(goal.updated_at),
        },
    }


@router.post("/interview/session-score/{session_id}")
def calculate_interview_session_score(
    session_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    user_id = cast(int, current_user.id)

    study_session = session.exec(
        select(StudySession).where(
            StudySession.id == session_id,
            StudySession.user_id == user_id,
            StudySession.session_type == "interview",
        )
    ).first()

    if not study_session:
        raise HTTPException(status_code=404, detail="면접 세션을 찾을 수 없습니다.")

    logs = session.exec(
        select(SpeakingLog).where(
            SpeakingLog.session_id == session_id,
            SpeakingLog.user_id == user_id,
        )
    ).all()

    logs = sorted(logs, key=lambda log: log.created_at)

    if not logs:
        raise HTTPException(status_code=400, detail="점수를 계산할 면접 답변 기록이 없습니다.")

    score_data = _compute_interview_scores(logs, study_session)

    report = session.exec(
        select(InterviewReport).where(
            InterviewReport.session_id == session_id,
            InterviewReport.user_id == user_id,
        )
    ).first()

    if report:
        report.overall_score = score_data["overall_score"]
        report.pronunciation_avg = score_data["pronunciation_avg"]
        report.accuracy_avg = score_data["accuracy_avg"]
        report.fluency_avg = score_data["fluency_avg"]
        report.content_score = score_data["content_score"]
        report.technical_score = score_data["technical_score"]
        report.confidence_score = score_data["confidence_score"]
        report.score_json = json.dumps(score_data, ensure_ascii=False)

        session.add(report)
        session.commit()
        session.refresh(report)

        report_id = report.id

    else:
        report = InterviewReport(
            user_id=user_id,
            session_id=session_id,
            animal_name="분석 전",
            animal_reason="면접 페르소나 리포트는 아직 생성되지 않았지만, 면접 점수는 계산되었습니다.",
            overall_score=score_data["overall_score"],
            pronunciation_avg=score_data["pronunciation_avg"],
            accuracy_avg=score_data["accuracy_avg"],
            fluency_avg=score_data["fluency_avg"],
            content_score=score_data["content_score"],
            technical_score=score_data["technical_score"],
            confidence_score=score_data["confidence_score"],
            score_json=json.dumps(score_data, ensure_ascii=False),
        )

        session.add(report)
        session.commit()
        session.refresh(report)

        report_id = report.id

    return {
        "message": "면접 세션 종합 점수 계산 완료",
        "report_id": report_id,
        "session_id": session_id,
        "scores": score_data,
    }