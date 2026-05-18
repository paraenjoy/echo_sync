from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session, select

from database import get_session
from models import User
from security import decode_access_token

security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    session: Session = Depends(get_session),
):
    token = credentials.credentials

    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
    except Exception:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다.")

    user = session.exec(select(User).where(User.id == user_id)).first()

    if not user:
        raise HTTPException(status_code=401, detail="사용자를 찾을 수 없습니다.")

    return user