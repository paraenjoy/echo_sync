from typing import Optional
from pydantic import BaseModel, EmailStr


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    nickname: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    message: str
    access_token: str
    token_type: str


class MeResponse(BaseModel):
    id: int
    email: EmailStr
    nickname: Optional[str]
    role: str