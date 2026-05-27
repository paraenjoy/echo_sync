import json

from sqlmodel import Session, select

from database import engine
from models import SpeakingLog, WordLog


def _sort_logs_by_created_at(logs):
    return sorted(logs, key=lambda log: log.created_at)


def _score_avg(logs):
    if not logs:
        return {
            "accuracy": 0,
            "pronunciation": 0,
            "fluency": 0,
            "overall": 0,
        }

    accuracy = sum(float(log.accuracy_score) for log in logs) / len(logs)
    pronunciation = sum(float(log.pronunciation_score) for log in logs) / len(logs)
    fluency = sum(float(log.fluency_score) for log in logs) / len(logs)
    overall = (accuracy + pronunciation + fluency) / 3

    return {
        "accuracy": round(accuracy, 1),
        "pronunciation": round(pronunciation, 1),
        "fluency": round(fluency, 1),
        "overall": round(overall, 1),
    }


def _improvement_rate(old_score, new_score):
    if old_score == 0:
        return 0
    return round(((new_score - old_score) / old_score) * 100, 1)


def get_user_progress(user_id: int):
    with Session(engine) as session:
        logs = session.exec(
            select(SpeakingLog).where(SpeakingLog.user_id == user_id)
        ).all()

        logs = _sort_logs_by_created_at(logs)

        if not logs:
            return {
                "message": "아직 학습 기록이 없습니다.",
                "total_logs": 0,
                "initial_avg": None,
                "recent_avg": None,
                "improvement": None,
                "trend": "none",
            }

        total_logs = len(logs)
        window_size = min(5, total_logs)

        initial_logs = logs[:window_size]
        recent_logs = logs[-window_size:]

        initial_avg = _score_avg(initial_logs)
        recent_avg = _score_avg(recent_logs)

        improvement = {
            "accuracy_point": round(recent_avg["accuracy"] - initial_avg["accuracy"], 1),
            "pronunciation_point": round(recent_avg["pronunciation"] - initial_avg["pronunciation"], 1),
            "fluency_point": round(recent_avg["fluency"] - initial_avg["fluency"], 1),
            "overall_point": round(recent_avg["overall"] - initial_avg["overall"], 1),

            "accuracy_rate": _improvement_rate(initial_avg["accuracy"], recent_avg["accuracy"]),
            "pronunciation_rate": _improvement_rate(initial_avg["pronunciation"], recent_avg["pronunciation"]),
            "fluency_rate": _improvement_rate(initial_avg["fluency"], recent_avg["fluency"]),
            "overall_rate": _improvement_rate(initial_avg["overall"], recent_avg["overall"]),
        }

        if improvement["overall_point"] > 3:
            trend = "improving"
        elif improvement["overall_point"] < -3:
            trend = "declining"
        else:
            trend = "stable"

        return {
            "message": "향상률 분석 완료",
            "total_logs": total_logs,
            "comparison_window": window_size,
            "initial_avg": initial_avg,
            "recent_avg": recent_avg,
            "improvement": improvement,
            "trend": trend,
        }


def get_total_weak_patterns(user_id: int):
    """
    AI 리포트 내부 참고용 약점 분석.
    화면에는 음소별 리스트를 직접 노출하지 않고,
    AI 요약에만 참고 데이터로 사용.
    """
    with Session(engine) as session:
        logs = session.exec(
            select(SpeakingLog).where(SpeakingLog.user_id == user_id)
        ).all()

        if not logs:
            return []

        log_ids = [log.id for log in logs if log.id is not None]
        if not log_ids:
            return []

        words = session.exec(select(WordLog)).all()

        phoneme_stats = {}

        for word in words:
            if word.speaking_log_id not in log_ids:
                continue

            if not word.phoneme_data:
                continue

            try:
                phonemes = json.loads(word.phoneme_data)
            except Exception:
                continue

            for ph in phonemes:
                phoneme = ph.get("ph")
                score = ph.get("score")

                if phoneme is None or score is None:
                    continue

                score = float(score)

                if phoneme not in phoneme_stats:
                    phoneme_stats[phoneme] = {
                        "total_score": 0,
                        "total_count": 0,
                        "fail_count": 0,
                        "words": set(),
                    }

                phoneme_stats[phoneme]["total_score"] += score
                phoneme_stats[phoneme]["total_count"] += 1

                if score < 60:
                    phoneme_stats[phoneme]["fail_count"] += 1

                if word.word:
                    phoneme_stats[phoneme]["words"].add(word.word)

        analysis_list = []

        for phoneme, stat in phoneme_stats.items():
            total_count = stat["total_count"]

            if total_count < 3:
                continue

            avg_score = stat["total_score"] / total_count
            fail_rate = (stat["fail_count"] / total_count) * 100

            if total_count >= 10:
                confidence = "high"
            elif total_count >= 5:
                confidence = "medium"
            else:
                confidence = "low"

            analysis_list.append({
                "phoneme": phoneme,
                "avg_score": round(avg_score, 1),
                "fail_rate": round(fail_rate, 1),
                "total_count": total_count,
                "example_words": list(stat["words"])[:5],
                "confidence": confidence,
            })

        weak_patterns = sorted(
            analysis_list,
            key=lambda x: (x["fail_rate"], 100 - x["avg_score"], x["total_count"]),
            reverse=True
        )[:5]

        return weak_patterns