from datetime import datetime, timezone
from typing import Optional, ClassVar

from sqlmodel import SQLModel, Field


class User(SQLModel, table=True):
    __tablename__: ClassVar[str] = "users"

    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    hashed_password: str
    nickname: Optional[str] = None
    role: str = Field(default="user")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StudySession(SQLModel, table=True):
    __tablename__: ClassVar[str] = "study_sessions"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id")

    session_type: str
    title: Optional[str] = None

    source_url: Optional[str] = None
    source_text: Optional[str] = None
    metadata_json: Optional[str] = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Question(SQLModel, table=True):
    __tablename__: ClassVar[str] = "questions"

    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="study_sessions.id")

    order_no: int
    question_type: str

    question_text: str
    question_ko: Optional[str] = None
    model_answer: Optional[str] = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SpeakingLog(SQLModel, table=True):
    __tablename__: ClassVar[str] = "speaking_logs"

    id: Optional[int] = Field(default=None, primary_key=True)

    user_id: int = Field(foreign_key="users.id")
    session_id: Optional[int] = Field(default=None, foreign_key="study_sessions.id")
    question_id: Optional[int] = Field(default=None, foreign_key="questions.id")

    reference_text: str
    recognized_text: Optional[str] = None

    accuracy_score: float
    pronunciation_score: float
    fluency_score: float

    coaching_message: Optional[str] = None

    audio_url: Optional[str] = None
    user_tts_url: Optional[str] = None
    model_tts_url: Optional[str] = None
    pronunciation_guide: Optional[str] = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WordLog(SQLModel, table=True):
    __tablename__: ClassVar[str] = "word_logs"

    id: Optional[int] = Field(default=None, primary_key=True)
    speaking_log_id: int = Field(foreign_key="speaking_logs.id")

    word: str
    accuracy_score: float
    error_type: Optional[str] = None
    phoneme_data: Optional[str] = None
    start_time: Optional[float] = None   # Step 11-D — user_tts 내 재생 시작(초)
    end_time: Optional[float] = None     # Step 11-D — user_tts 내 재생 끝(초)

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class InterviewReport(SQLModel, table=True):
    __tablename__: ClassVar[str] = "interview_reports"

    id: Optional[int] = Field(default=None, primary_key=True)

    user_id: int = Field(foreign_key="users.id")
    session_id: int = Field(foreign_key="study_sessions.id")

    animal_name: str
    animal_reason: str
    animal_image_url: Optional[str] = None

    content_improvement: Optional[str] = None
    tech_stack_percent_json: Optional[str] = None

    overall_score: Optional[float] = None
    pronunciation_avg: Optional[float] = None
    accuracy_avg: Optional[float] = None
    fluency_avg: Optional[float] = None
    content_score: Optional[float] = None
    technical_score: Optional[float] = None
    confidence_score: Optional[float] = None
    score_json: Optional[str] = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class UserGoal(SQLModel, table=True):
    __tablename__: ClassVar[str] = "user_goals"

    id: Optional[int] = Field(default=None, primary_key=True)

    user_id: int = Field(foreign_key="users.id", unique=True)

    target_pronunciation_score: Optional[float] = None
    target_accuracy_score: Optional[float] = None
    target_fluency_score: Optional[float] = None
    weekly_practice_count: Optional[int] = None

    target_position: Optional[str] = None
    target_tech_stack_json: Optional[str] = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))