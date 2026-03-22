import os
from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
from fastapi import Header, HTTPException

JWT_SECRET = os.getenv("APP_JWT_SECRET", "").strip() or "dev-only-change-APP_JWT_SECRET"
JWT_ALG = "HS256"
JWT_EXP_HOURS = int(os.getenv("JWT_EXP_HOURS", "8"))


def create_access_token(vk_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=JWT_EXP_HOURS)
    return jwt.encode({"sub": str(vk_id), "exp": exp}, JWT_SECRET, algorithm=JWT_ALG)


def decode_vk_id_from_authorization(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Требуется вход по PIN")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Требуется вход по PIN")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        sub = payload.get("sub")
        if not sub:
            raise HTTPException(status_code=401, detail="Недействительный токен")
        return str(sub)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Сессия истекла, введите PIN снова") from None
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Недействительный токен") from None


def require_same_vk(vk_id: str, authorization: str | None) -> None:
    token_vk = decode_vk_id_from_authorization(authorization)
    if token_vk != vk_id:
        raise HTTPException(status_code=403, detail="Доступ запрещён")


def vk_path_guard(
    vk_id: str,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    require_same_vk(vk_id, authorization)
