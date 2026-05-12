import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

import bcrypt
import jwt
from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from db import SessionLocal
from models import AdminAuditLog, AdminStaff

ADMIN_JWT_SECRET = os.getenv("ADMIN_JWT_SECRET", "").strip() or os.getenv("APP_JWT_SECRET", "").strip() or "dev-only-change-ADMIN_JWT_SECRET"
ADMIN_JWT_ALG = "HS256"
ADMIN_ACCESS_MINUTES = int(os.getenv("ADMIN_ACCESS_MINUTES", "20"))
ADMIN_REFRESH_DAYS = int(os.getenv("ADMIN_REFRESH_DAYS", "7"))
ADMIN_COOKIE_SECURE = os.getenv("ADMIN_COOKIE_SECURE", "1").lower() in ("1", "true", "yes")
ADMIN_COOKIE_SAMESITE = os.getenv("ADMIN_COOKIE_SAMESITE", "lax").strip().lower() or "lax"
ADMIN_ACCESS_COOKIE = "admin_access_token"
ADMIN_REFRESH_COOKIE = "admin_refresh_token"
ADMIN_CSRF_HEADER = "X-CSRF-Token"

ROLE_ORDER = {"operator": 0, "admin": 1, "superadmin": 2}


def admin_now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def hash_admin_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_admin_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_admin_token(
    staff: AdminStaff,
    token_type: str,
    *,
    csrf_token: str | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    exp = now + (
        timedelta(minutes=ADMIN_ACCESS_MINUTES)
        if token_type == "access"
        else timedelta(days=ADMIN_REFRESH_DAYS)
    )
    payload = {
        "sub": str(staff.id),
        "username": staff.username,
        "role": staff.role,
        "type": token_type,
        "exp": exp,
        "iat": now,
    }
    if csrf_token is not None:
        payload["csrf"] = csrf_token
    return jwt.encode(payload, ADMIN_JWT_SECRET, algorithm=ADMIN_JWT_ALG)


def decode_admin_token(token: str, expected_type: str) -> dict:
    try:
        payload = jwt.decode(token, ADMIN_JWT_SECRET, algorithms=[ADMIN_JWT_ALG])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Сессия администратора истекла") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Недействительный токен администратора") from exc

    if payload.get("type") != expected_type:
        raise HTTPException(status_code=401, detail="Неверный тип токена администратора")
    return payload


def issue_admin_auth_tokens(staff: AdminStaff) -> tuple[str, str, str]:
    csrf_token = secrets.token_urlsafe(24)
    access_token = create_admin_token(staff, "access", csrf_token=csrf_token)
    refresh_token = create_admin_token(staff, "refresh")
    return access_token, refresh_token, csrf_token


def apply_admin_auth_cookies(response, staff: AdminStaff) -> str:
    access_token, refresh_token, csrf_token = issue_admin_auth_tokens(staff)
    response.set_cookie(
        ADMIN_ACCESS_COOKIE,
        access_token,
        httponly=True,
        secure=ADMIN_COOKIE_SECURE,
        samesite=ADMIN_COOKIE_SAMESITE,
        max_age=ADMIN_ACCESS_MINUTES * 60,
        path="/",
    )
    response.set_cookie(
        ADMIN_REFRESH_COOKIE,
        refresh_token,
        httponly=True,
        secure=ADMIN_COOKIE_SECURE,
        samesite=ADMIN_COOKIE_SAMESITE,
        max_age=ADMIN_REFRESH_DAYS * 24 * 60 * 60,
        path="/",
    )
    return csrf_token


def clear_admin_auth_cookies(response) -> None:
    response.delete_cookie(ADMIN_ACCESS_COOKIE, path="/")
    response.delete_cookie(ADMIN_REFRESH_COOKIE, path="/")


def serialize_admin_staff(staff: AdminStaff) -> dict[str, object]:
    return {
        "id": staff.id,
        "username": staff.username,
        "full_name": staff.full_name,
        "role": staff.role,
        "is_active": staff.is_active,
        "created_at": staff.created_at,
        "last_login_at": staff.last_login_at,
    }


def get_admin_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for", "").strip()
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def log_admin_action(
    db: Session,
    *,
    action_type: str,
    description: str,
    result: str = "success",
    request: Request | None = None,
    actor: AdminStaff | None = None,
    target_type: str | None = None,
    target_id: str | int | None = None,
    actor_username: str | None = None,
    actor_role: str | None = None,
) -> AdminAuditLog:
    entry = AdminAuditLog(
        actor_staff_id=actor.id if actor else None,
        actor_username=actor.username if actor else actor_username,
        actor_role=actor.role if actor else actor_role,
        action_type=action_type,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        description=description,
        result=result,
        ip_address=get_admin_ip(request) if request else None,
        user_agent=request.headers.get("user-agent") if request else None,
        created_at=admin_now_str(),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def ensure_bootstrap_superadmin() -> None:
    username = os.getenv("ADMIN_BOOTSTRAP_USERNAME", "").strip()
    password = os.getenv("ADMIN_BOOTSTRAP_PASSWORD", "").strip()
    if not username or not password:
        return

    full_name = os.getenv("ADMIN_BOOTSTRAP_FULL_NAME", "").strip() or "Super Admin"

    db = SessionLocal()
    try:
        existing = db.query(AdminStaff).filter(AdminStaff.username == username).first()
        if existing:
            return
        staff = AdminStaff(
            username=username,
            full_name=full_name,
            password_hash=hash_admin_password(password),
            role="superadmin",
            is_active=True,
            created_at=admin_now_str(),
        )
        db.add(staff)
        db.commit()
    finally:
        db.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _load_staff_from_access_cookie(request: Request, db: Session) -> tuple[AdminStaff, dict]:
    token = request.cookies.get(ADMIN_ACCESS_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Требуется вход в административную панель")

    payload = decode_admin_token(token, "access")
    staff = db.query(AdminStaff).filter(AdminStaff.id == int(payload["sub"])).first()
    if not staff or not staff.is_active:
        raise HTTPException(status_code=403, detail="Учетная запись администратора недоступна")
    return staff, payload


def extract_csrf_token_from_request(request: Request, db: Session) -> str:
    _, payload = _load_staff_from_access_cookie(request, db)
    csrf_token = str(payload.get("csrf") or "").strip()
    if not csrf_token:
        raise HTTPException(status_code=401, detail="CSRF-токен недоступен")
    return csrf_token


def require_admin_role(min_role: str, *, require_csrf: bool = False):
    def dependency(
        request: Request,
        db: Session = Depends(get_db),
        x_csrf_token: Annotated[str | None, Header(alias=ADMIN_CSRF_HEADER)] = None,
    ) -> AdminStaff:
        try:
            staff, payload = _load_staff_from_access_cookie(request, db)
        except HTTPException as exc:
            log_admin_action(
                db,
                action_type="security.access_denied",
                description=f"{request.method} {request.url.path}",
                result=exc.detail,
                request=request,
                actor_username="anonymous",
            )
            raise

        if ROLE_ORDER.get(staff.role, -1) < ROLE_ORDER[min_role]:
            log_admin_action(
                db,
                action_type="security.access_denied",
                description=f"{request.method} {request.url.path}",
                result="insufficient_role",
                request=request,
                actor=staff,
            )
            raise HTTPException(status_code=403, detail="Недостаточно прав для действия")

        if require_csrf:
            csrf_claim = payload.get("csrf")
            if not csrf_claim or x_csrf_token != csrf_claim:
                log_admin_action(
                    db,
                    action_type="security.csrf_rejected",
                    description=f"{request.method} {request.url.path}",
                    result="invalid_csrf",
                    request=request,
                    actor=staff,
                )
                raise HTTPException(status_code=403, detail="CSRF-защита не пройдена")

        return staff

    return dependency
