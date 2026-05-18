import os
from dotenv import load_dotenv
from sqlmodel import SQLModel, create_engine, Session

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://sync:sync123@localhost:5432/speaking"
)

engine = create_engine(DATABASE_URL, echo=False)


def get_session():
    with Session(engine) as session:
        yield session


def init_db():
    SQLModel.metadata.create_all(engine)