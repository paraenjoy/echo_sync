from sqlmodel import Session, select
from models import WordLog, SpeakingLog
from database import engine


def get_total_weak_patterns(user_id: int):
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
                import json
                phonemes = json.loads(word.phoneme_data)
            except Exception:
                continue

            for ph in phonemes:
                phoneme = ph.get("ph")
                score = ph.get("score")

                if phoneme is None or score is None:
                    continue

                if phoneme not in phoneme_stats:
                    phoneme_stats[phoneme] = {
                        "total_score": 0,
                        "total_count": 0,
                        "fail_count": 0,
                    }

                phoneme_stats[phoneme]["total_score"] += score
                phoneme_stats[phoneme]["total_count"] += 1
                if score < 60:
                    phoneme_stats[phoneme]["fail_count"] += 1

        analysis_list = []
        for phoneme, stat in phoneme_stats.items():
            total_count = stat["total_count"]
            if total_count < 5:
                continue

            avg_score = stat["total_score"] / total_count
            fail_rate = (stat["fail_count"] / total_count) * 100

            analysis_list.append({
                "phoneme": phoneme,
                "avg_score": round(avg_score, 1),
                "fail_rate": round(fail_rate, 1),
                "total_count": total_count,
            })

        weak_patterns = sorted(
            analysis_list,
            key=lambda x: x["fail_rate"],
            reverse=True
        )[:5]

        return weak_patterns