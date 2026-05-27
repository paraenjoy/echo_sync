import os

from dotenv import load_dotenv
from sqlmodel import SQLModel, Session, create_engine

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://geunhan:password123@localhost:5432/sync_db"
)

engine = create_engine(DATABASE_URL, echo=False)


def init_db():
    # models import는 여기 안에서 해야 순환 import 문제가 줄어듦
    import models
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session