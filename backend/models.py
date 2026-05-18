from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    hashed_password: str
    nickname: Optional[str] = None
    role: str = Field(default="user")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StudySession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    session_type: str  # youtube / interview
    title: Optional[str] = None
    source_url: Optional[str] = None
    source_text: Optional[str] = None
    metadata_json: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Question(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="studysession.id")
    order_no: int = 1
    question_type: str = "generated"
    question_text: str
    question_ko: Optional[str] = None
    model_answer: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SpeakingLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    session_id: int = Field(foreign_key="studysession.id")
    question_id: Optional[int] = Field(default=None, foreign_key="question.id")

    reference_text: str
    recognized_text: Optional[str] = None

    accuracy_score: float
    pronunciation_score: float
    fluency_score: float

    coaching_message: Optional[str] = None
    user_tts_url: Optional[str] = None
    model_tts_url: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WordLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    speaking_log_id: int = Field(foreign_key="speakinglog.id")

    word: str
    accuracy_score: float
    error_type: Optional[str] = None
    phoneme_data: Optional[str] = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))