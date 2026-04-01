import json
import os
import re
from datetime import datetime, timedelta
import random
from typing import Annotated, Any

import requests
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth_jwt import (
    create_access_token,
    decode_vk_id_from_authorization,
    require_same_vk,
    vk_path_guard,
)
from db import Base, engine, SessionLocal, wait_for_db, apply_legacy_migrations
from credit_logic import (
    add_months,
    apply_credit_payment,
    apply_credit_spend,
    apply_overdue_interest,
    calculate_minimum_credit_payment,
)
from pin_crypto import hash_pin, verify_pin
from pin_rate import clear_pin_failures, is_pin_locked, record_pin_failure
from vk_launch import is_valid_launch_sign
from models import (
    User,
    Account,
    Card,
    Operation,
    Application,
    SupportMessage,
    ServiceRequest,
    Notification,
    FavoritePayment,
    LoginEvent,
)

wait_for_db()
apply_legacy_migrations()
Base.metadata.create_all(bind=engine)

app = FastAPI(redirect_slashes=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "https://bank.zf-bank.ru",
        "https://www.bank.zf-bank.ru",
        "https://admin.zf-bank.ru",
        "https://www.admin.zf-bank.ru",
    ],
    allow_origin_regex=(
        r"^https://([a-zA-Z0-9-]+\.)*vk\.com$|"
        r"^https://([a-zA-Z0-9-]+\.)*vk\.ru$|"
        r"^https://([a-zA-Z0-9-]+\.)*vk-portal\.net$"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VK_APP_SECRET = os.getenv("VK_APP_SECRET", "")
VK_GROUP_ACCESS_TOKEN = os.getenv("VK_GROUP_ACCESS_TOKEN", "")
VK_API_VERSION = os.getenv("VK_API_VERSION", "5.199")
VK_SKIP_LAUNCH_VERIFY = os.getenv("VK_SKIP_LAUNCH_VERIFY", "").lower() in ("1", "true", "yes")
VK_CALLBACK_CONFIRMATION = os.getenv("VK_CALLBACK_CONFIRMATION", "").strip()
AI_SUPPORT_ENABLED = os.getenv("AI_SUPPORT_ENABLED", "1").lower() in ("1", "true", "yes")
AI_SUPPORT_PROVIDER = os.getenv("AI_SUPPORT_PROVIDER", "google").strip().lower()
GEMMA_API_KEY = os.getenv("GEMMA_API_KEY", "").strip() or os.getenv("GOOGLE_API_KEY", "").strip()
GEMMA_MODEL = os.getenv("GEMMA_MODEL", "gemma-3-27b-it").strip()


def verify_miniapp_launch(raw: dict[str, Any]) -> tuple[dict[str, str], str]:
    lp = {k: str(v) for k, v in raw.items() if v is not None}
    vk_raw = lp.get("vk_user_id")
    if not vk_raw:
        raise HTTPException(status_code=400, detail="Нет vk_user_id в параметрах запуска")
    if VK_APP_SECRET:
        if not VK_SKIP_LAUNCH_VERIFY and not is_valid_launch_sign(lp, VK_APP_SECRET):
            raise HTTPException(status_code=403, detail="Неверная подпись параметров запуска (sign)")
    elif not VK_SKIP_LAUNCH_VERIFY:
        raise HTTPException(
            status_code=503,
            detail="Задайте VK_APP_SECRET или для локальной разработки VK_SKIP_LAUNCH_VERIFY=1",
        )
    return lp, str(vk_raw)


def verify_admin_key(x_admin_key: Annotated[str | None, Header()] = None) -> None:
    expected = os.getenv("ADMIN_API_KEY", "").strip()
    if not expected:
        return
    if x_admin_key != expected:
        raise HTTPException(status_code=403, detail="Доступ к админ-API запрещён")


def verify_bot_key(x_bot_key: Annotated[str | None, Header()] = None) -> None:
    expected = os.getenv("BOT_API_KEY", "").strip() or VK_GROUP_ACCESS_TOKEN
    if not expected:
        raise HTTPException(status_code=503, detail="Bot API key is not configured")
    if x_bot_key != expected:
        raise HTTPException(status_code=403, detail="Bot API access denied")


class VkAuthRequest(BaseModel):
    launch_params: dict[str, Any]
    full_name: str = ""
    phone: str | None = None


class ApplicationCreate(BaseModel):
    vk_id: str = Field(min_length=1, max_length=32)
    product_type: str = Field(min_length=1, max_length=120)
    details: str = Field(default="", max_length=4000)


class TransferCreate(BaseModel):
    sender_vk_id: str = Field(min_length=1, max_length=32)
    from_account_id: int = Field(ge=1)
    recipient_phone: str = Field(min_length=10, max_length=20)
    amount: float = Field(gt=0, le=50_000_000)


class VkIdTransferPreviewRequest(BaseModel):
    sender_vk_id: str = Field(min_length=1, max_length=32)
    from_account_id: int = Field(ge=1)
    recipient_vk_id: str = Field(min_length=1, max_length=32)


class VkIdTransferCreate(BaseModel):
    sender_vk_id: str = Field(min_length=1, max_length=32)
    from_account_id: int = Field(ge=1)
    recipient_vk_id: str = Field(min_length=1, max_length=32)
    amount: float = Field(gt=0, le=50_000_000)


class SupportMessageCreate(BaseModel):
    vk_id: str = Field(min_length=1, max_length=32)
    message: str = Field(min_length=1, max_length=2000)


class AISupportMessageCreate(BaseModel):
    vk_id: str = Field(min_length=1, max_length=32)
    message: str = Field(min_length=1, max_length=2000)


class ServiceRequestCreate(BaseModel):
    vk_id: str = Field(min_length=1, max_length=32)
    request_type: str = Field(min_length=1, max_length=120)
    details: str = Field(min_length=1, max_length=4000)


class CreateAccountRequest(BaseModel):
    vk_id: str = Field(min_length=1, max_length=32)
    account_name: str = Field(min_length=2, max_length=120)
    currency: str = Field(default="RUB", min_length=3, max_length=8)


class InternalTransferRequest(BaseModel):
    vk_id: str = Field(min_length=1, max_length=32)
    from_account_id: int = Field(ge=1)
    to_account_id: int = Field(ge=1)
    amount: float = Field(gt=0, le=50_000_000)


class AccountCloseRequest(BaseModel):
    vk_id: str = Field(min_length=1, max_length=32)
    comment: str | None = Field(default=None, max_length=500)


class CreditAccountPaymentRequest(BaseModel):
    vk_id: str = Field(min_length=1, max_length=32)
    from_account_id: int = Field(ge=1)
    payment_kind: str = Field(min_length=1, max_length=32)


class InterbankTransferRequest(BaseModel):
    vk_id: str = Field(min_length=1, max_length=32)
    from_account_id: int = Field(ge=1)
    bank_name: str = Field(min_length=2, max_length=200)
    recipient_account_number: str = Field(min_length=5, max_length=34)
    amount: float = Field(gt=0, le=50_000_000)


class TopUpRequest(BaseModel):
    vk_id: str = Field(min_length=1, max_length=32)
    account_id: int = Field(ge=1)
    source: str = Field(min_length=2, max_length=200)
    amount: float = Field(gt=0, le=50_000_000)


class ServicePaymentRequest(BaseModel):
    vk_id: str = Field(min_length=1, max_length=32)
    from_account_id: int = Field(ge=1)
    service_type: str = Field(min_length=2, max_length=120)
    provider: str = Field(min_length=1, max_length=200)
    amount: float = Field(gt=0, le=50_000_000)


class FavoritePaymentCreate(BaseModel):
    vk_id: str = Field(min_length=1, max_length=32)
    template_name: str = Field(min_length=1, max_length=120)
    payment_type: str = Field(min_length=1, max_length=64)
    recipient_value: str = Field(min_length=1, max_length=200)
    provider_name: str | None = Field(default=None, max_length=200)


class SettingsUpdate(BaseModel):
    hide_balance: bool | None = None
    notifications_enabled: bool | None = None
    app_theme: str | None = None
    language: str | None = None
    onboarding_completed: bool | None = None


class PhoneUpdateRequest(BaseModel):
    phone: str = Field(min_length=11, max_length=20)


class PinChangeRequest(BaseModel):
    current_pin: str = Field(min_length=4, max_length=6, pattern=r"^\d+$")
    new_pin: str = Field(min_length=4, max_length=6, pattern=r"^\d+$")
    new_pin_confirm: str = Field(min_length=4, max_length=6, pattern=r"^\d+$")


class AdminBalanceTopUp(BaseModel):
    amount: float = Field(gt=0, le=500_000_000)
    comment: str = Field(default="Пополнение администратором", max_length=500)


class PinSetRequest(BaseModel):
    launch_params: dict[str, Any]
    pin: str = Field(min_length=4, max_length=6, pattern=r"^\d+$")
    pin_confirm: str = Field(min_length=4, max_length=6, pattern=r"^\d+$")


class PinVerifyRequest(BaseModel):
    launch_params: dict[str, Any]
    pin: str = Field(min_length=4, max_length=6, pattern=r"^\d+$")


class AdminApplicationStatusUpdate(BaseModel):
    status: str


class AdminServiceRequestStatusUpdate(BaseModel):
    status: str


class AdminSupportReply(BaseModel):
    message: str = Field(min_length=1, max_length=3000)


class BotNotificationsUpdate(BaseModel):
    enabled: bool


def now_str() -> str:
    return datetime.now().strftime("%d.%m.%Y %H:%M")


def _text_quality(value: str) -> int:
    if not value:
        return -10_000
    cyrillic = sum(1 for ch in value if "?" <= ch <= "?" or ch in "??")
    latin = sum(1 for ch in value if ch.isascii() and (ch.isalpha() or ch.isdigit()))
    broken = sum(value.count(token) for token in ("??", "??", "??", "?", "?", "?", "?"))
    replacement = value.count("?") + value.count("?")
    return cyrillic * 4 + latin - broken * 3 - replacement * 5


def normalize_text(value: str | None) -> str | None:
    if value is None or not isinstance(value, str):
        return value

    best = value
    for _ in range(2):
        candidates = [best]
        for src_encoding in ("cp1251", "latin1"):
            try:
                candidates.append(best.encode(src_encoding).decode("utf-8"))
            except (UnicodeEncodeError, UnicodeDecodeError):
                pass
        best = max(candidates, key=_text_quality)

    replacements = {
        "?????????????? ???? VK ID ??????????????": "??????? ?? VK ID ???????",
        "?????????????? ???? VK ID ????": "??????? ?? VK ID ??",
        "?????????????? ??????????????": "??????? ???????",
        "?????????????? ???? ??????????????": "??????? ?? ???????",
        "??????????????????????": "???????????",
        "????????????????????": "??????????",
        "??????????????????????????": "?????????????",
        "??????????????": "???????",
        "??????????????": "???????",
        "???????????????? ????????": "???????? ????",
        "?????????????????????????? ????????": "????????????? ????",
        "?????????????????? ????????": "????????? ????",
        "?????????????????? ??????????????": "????????? ???????",
        "???????????????? ??????????????": "???????? ???????",
        "?????? ????????????": "??? ??????",
        "???? VK ????????": "?? VK ????",
    }

    for broken, fixed in replacements.items():
        best = best.replace(broken, fixed)

    return best


def humanize_operation_title(title: str | None, operation_type: str | None) -> str | None:
    normalized = normalize_text(title)
    if not normalized:
        return normalized

    if "VK ID" not in normalized:
        return normalized

    words = normalized.split()
    human_tail: list[str] = []
    for word in reversed(words):
        if any("?" <= ch <= "?" or ch in "??" for ch in word):
            human_tail.append(word.strip(".,;:!?"))
            if len(human_tail) >= 2:
                break
        elif human_tail:
            break

    human_name = " ".join(reversed(human_tail)).strip()
    if operation_type == "income":
        return f"??????? ?? VK ID ?? {human_name}".strip()
    if operation_type == "expense":
        return f"??????? ?? VK ID ??????? {human_name}".strip()
    return normalized


def create_notification(db: Session, user_id: int, title: str, message: str) -> None:
    notification = Notification(
        user_id=user_id,
        title=normalize_text(title),
        message=normalize_text(message),
        is_read=False,
        created_at=now_str(),
    )
    db.add(notification)
    db.commit()


def notify_user(vk_id: str, text: str) -> None:
    if not VK_GROUP_ACCESS_TOKEN:
        print("VK_GROUP_ACCESS_TOKEN not set, skip notification")
        return

    try:
        res = requests.post(
            "https://api.vk.com/method/messages.send",
            data={
                "access_token": VK_GROUP_ACCESS_TOKEN,
                "v": VK_API_VERSION,
                "user_id": vk_id,
                "message": text,
                "random_id": random.randint(1, 2_147_000_000),
            },
            timeout=15,
        )
        data = res.json()
        if data.get("error"):
            print(f"VK messages.send error: {data['error']}")
    except Exception as e:
        print(f"Notification error: {e}")


def store_support_message(db: Session, user_id: int, sender_type: str, message: str) -> SupportMessage:
    item = SupportMessage(
        user_id=user_id,
        sender_type=sender_type,
        message=normalize_text(message) or message,
        created_at=now_str(),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def classify_support_intent(message: str) -> tuple[str | None, bool]:
    text = (message or "").lower()

    escalation_rules = [
        ("Проблема с переводом", ["перевод", "не приш", "ошибк", "завис", "списал", "не дош"]),
        ("Проблема с картой", ["карта", "заблок", "не вижу карту", "реквиз", "лимит"]),
        ("Техническая ошибка", ["не работает", "баг", "ошибка", "краш", "экран", "пустой"]),
        ("Заявка на продукт", ["заявк", "кредит", "вклад", "счет", "карта"]),
        ("Поддержка и консультация", ["оператор", "поддержк", "помогите", "консультац"]),
    ]

    for request_type, keywords in escalation_rules:
        if any(keyword in text for keyword in keywords):
            # FAQ-вопросы без признаков проблемы в эскалацию не гоняем.
            if any(keyword in text for keyword in ("как", "где", "что", "почему")) and not any(
                keyword in text for keyword in ("не", "ошиб", "проблем", "заблок", "не приш", "не дош")
            ):
                return request_type, False
            return request_type, True

    return "Поддержка и консультация", False


def knowledge_base_support_reply(message: str) -> str | None:
    text = (normalize_text(message) or message or "").lower()
    normalized = re.sub(r"\s+", " ", text).strip()

    rules = [
        (
            ["как пополнить", "пополнить баланс", "пополнение счета", "пополнить счет"],
            "Пополнить баланс можно в разделе «Платежи» → «Пополнить счет». "
            "Выберите счет зачисления, введите сумму или нажмите на быструю сумму и подтвердите действие.",
        ),
        (
            ["как поменять pin", "сменить pin", "изменить pin", "поменять пин", "сменить пин"],
            "PIN меняется в разделе «Еще» → «Безопасность». "
            "Откройте блок смены PIN, введите текущий PIN, затем новый PIN и подтверждение.",
        ),
        (
            ["как посмотреть реквизиты", "реквизиты карты", "где реквизиты карты"],
            "Реквизиты карты находятся в разделе «Мои карты». "
            "Откройте нужную карту и перейдите в экран реквизитов, где показаны номер, срок действия и связанный счет.",
        ),
        (
            ["как перевести", "перевод по vk id", "перевести по vk id"],
            "Перевод по VK ID выполняется в разделе «Платежи». "
            "Выберите сценарий перевода по VK ID, укажите получателя, сумму и подтвердите операцию.",
        ),
        (
            ["между своими счетами", "перевод между своими счетами", "свои счета"],
            "Перевод между своими счетами доступен в разделе «Платежи». "
            "Выберите сценарий «Свои счета», затем укажите счет списания, счет зачисления и сумму.",
        ),
        (
            ["как оформить", "новый продукт", "оформить карту", "оформить вклад", "оформить кредит"],
            "Оформление продукта доступно в разделе «Еще» → «Заявки» или через экран нового продукта. "
            "Выберите тип продукта, заполните форму и отправьте заявку на рассмотрение.",
        ),
        (
            ["где мои карты", "не вижу карты", "мои карты"],
            "Раздел «Мои карты» находится во вкладке «Еще». "
            "Там доступны список карт, баланс связанного счета, реквизиты и действия по карте.",
        ),
        (
            ["уведомления", "где уведомления"],
            "Уведомления доступны в отдельном разделе приложения. "
            "Там отображаются финансовые и сервисные события, а также ответы поддержки.",
        ),
        (
            ["чат с оператором", "связаться с поддержкой", "как написать в поддержку"],
            "Написать в поддержку можно во вкладке «Чат». "
            "AI-помощник ответит сразу, а если проблема требует участия человека, обращение будет передано оператору.",
        ),
    ]

    for triggers, reply in rules:
        if any(trigger in normalized for trigger in triggers):
            return reply
    return None


def fallback_ai_support_reply(message: str, should_escalate: bool, request_type: str | None) -> str:
    kb_reply = knowledge_base_support_reply(message)
    if kb_reply:
        if should_escalate and request_type:
            return (
                f"{kb_reply} Если проблема уже возникла на практике, я также подготовил "
                f"сервисный запрос типа «{request_type}» для оператора."
            )
        return kb_reply

    text = (message or "").lower()
    if "перевод" in text:
        base = (
            "Проверяю сценарий по переводам. Откройте раздел «Платежи», проверьте сумму, "
            "счет списания и статус операции в истории."
        )
    elif "карта" in text:
        base = (
            "Проверяю сценарий по картам. Откройте раздел «Мои карты», выберите карту и "
            "посмотрите статус, реквизиты и связанный счет."
        )
    elif "заяв" in text:
        base = (
            "По заявкам ориентируйтесь на раздел «Заявки». Там видны статус, продукт и дата создания заявки."
        )
    else:
        base = (
            "Я помогу разобраться. Опишите вопрос чуть подробнее: что именно вы пытались сделать и что получилось в итоге."
        )

    if should_escalate and request_type:
        return (
            f"{base} Я также подготовил сервисный запрос типа «{request_type}», "
            "чтобы оператор мог быстрее подключиться к ситуации."
        )
    return base


def call_gemma_support(user: User, message: str, history: list[SupportMessage], should_escalate: bool, request_type: str | None) -> str:
    kb_reply = knowledge_base_support_reply(message)
    if kb_reply and not should_escalate:
        return kb_reply

    if not AI_SUPPORT_ENABLED:
        return fallback_ai_support_reply(message, should_escalate, request_type)

    if AI_SUPPORT_PROVIDER != "google" or not GEMMA_API_KEY:
        return fallback_ai_support_reply(message, should_escalate, request_type)

    conversation_parts: list[str] = []
    for item in history[-6:]:
        role = {
            "user": "Клиент",
            "ai": "AI-помощник",
            "admin": "Оператор",
            "system": "Система",
        }.get(item.sender_type, "Сообщение")
        conversation_parts.append(f"{role}: {normalize_text(item.message) or item.message}")

    system_prompt = (
        "Ты AI-помощник банка внутри VK Mini App. "
        "Отвечай по-русски, кратко, доброжелательно и без выдумывания несуществующих функций. "
        "Не выполняй переводы, не меняй PIN и не обещай финансовые операции. "
        "Если проблема требует вмешательства человека, скажи, что сервисный запрос будет передан оператору. "
        "Дай максимум 5 коротких предложений. Не используй markdown."
    )
    if should_escalate and request_type:
        system_prompt += f" Текущий запрос классифицирован как «{request_type}» и должен быть эскалирован оператору."

    user_prompt = (
        f"Профиль клиента: {normalize_text(user.full_name) or user.full_name}, VK ID {user.vk_id}. "
        f"История диалога:\n" + "\n".join(conversation_parts) + f"\nПоследнее сообщение клиента: {message}"
    )

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMMA_MODEL}:generateContent"
        f"?key={GEMMA_API_KEY}"
    )
    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "temperature": 0.4,
            "topP": 0.9,
            "maxOutputTokens": 300,
        },
    }

    try:
        response = requests.post(url, json=payload, timeout=30)
        if not response.ok:
            print(f"Gemma support HTTP error: {response.status_code} {response.text[:500]}")
            return fallback_ai_support_reply(message, should_escalate, request_type)
        data = response.json()
        parts = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [])
        )
        text = " ".join(part.get("text", "") for part in parts).strip()
        if text:
            return normalize_text(text) or text
    except Exception as exc:
        print(f"Gemma support error: {exc}")

    return fallback_ai_support_reply(message, should_escalate, request_type)


def create_ai_service_request(
    db: Session,
    user: User,
    request_type: str,
    details: str,
) -> ServiceRequest:
    item = ServiceRequest(
        user_id=user.id,
        request_type=f"AI: {request_type}",
        details=normalize_text(details) or details,
        status="Создан",
        created_at=now_str(),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def process_support_message(db: Session, user: User, message: str) -> dict[str, Any]:
    cleaned_message = (normalize_text(message) or message).strip()
    user_message = store_support_message(db, user.id, "user", cleaned_message)
    request_type, should_escalate = classify_support_intent(cleaned_message)

    history = (
        db.query(SupportMessage)
        .filter(SupportMessage.user_id == user.id)
        .order_by(SupportMessage.id.asc())
        .all()
    )
    ai_reply = call_gemma_support(user, cleaned_message, history, should_escalate, request_type)
    ai_message = store_support_message(db, user.id, "ai", ai_reply)

    created_request = None
    if should_escalate and request_type:
        created_request = create_ai_service_request(
            db,
            user,
            request_type=request_type,
            details=f"Сообщение клиента: {cleaned_message}",
        )
        create_notification(
            db,
            user.id,
            "Создан сервисный запрос",
            f"AI-помощник передал обращение оператору. Тип: {created_request.request_type}.",
        )

    create_notification(
        db,
        user.id,
        "Ответ поддержки",
        "AI-помощник обработал ваше сообщение в чате поддержки.",
    )

    return {
        "message": "Сообщение обработано",
        "user_message": {
            "id": user_message.id,
            "sender_type": user_message.sender_type,
            "message": user_message.message,
            "created_at": user_message.created_at,
        },
        "ai_message": {
            "id": ai_message.id,
            "sender_type": ai_message.sender_type,
            "message": ai_message.message,
            "created_at": ai_message.created_at,
        },
        "service_request": (
            {
                "id": created_request.id,
                "request_type": created_request.request_type,
                "status": created_request.status,
                "created_at": created_request.created_at,
            }
            if created_request
            else None
        ),
    }


def mask_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = "".join(ch for ch in str(phone) if ch.isdigit())
    if len(digits) >= 4:
        return f"+7 *** *** {digits[-4:]}"
    return phone


def _client_ip(request: Request) -> str | None:
    for header in ("x-forwarded-for", "x-real-ip"):
        value = request.headers.get(header)
        if value:
            return value.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def _device_snapshot(user_agent: str | None) -> tuple[str, str]:
    ua = (user_agent or "").lower()
    platform = "Неизвестное устройство"
    device = "Вход через VK Mini App"

    if "iphone" in ua:
        platform = "iPhone"
        device = "VK Mini App на iPhone"
    elif "ipad" in ua:
        platform = "iPad"
        device = "VK Mini App на iPad"
    elif "android" in ua:
        platform = "Android"
        device = "VK Mini App на Android"
    elif "windows" in ua:
        platform = "Windows"
        device = "VK Mini App в браузере Windows"
    elif "mac os" in ua or "macintosh" in ua:
        platform = "macOS"
        device = "VK Mini App в браузере macOS"

    return device, platform


def record_login_event(db: Session, user: User, request: Request, source: str) -> None:
    device_name, platform = _device_snapshot(request.headers.get("user-agent"))
    event = LoginEvent(
        user_id=user.id,
        device_name=device_name,
        platform=platform,
        ip_address=_client_ip(request),
        source=source,
        created_at=now_str(),
    )
    db.add(event)
    db.commit()


def _get_primary_account(db: Session, user_id: int) -> Account | None:
    return (
        db.query(Account)
        .filter(Account.user_id == user_id)
        .order_by(Account.id.asc())
        .first()
    )


def _build_transfer_party_payload(user: User) -> dict[str, Any]:
    return {
        "vk_id": user.vk_id,
        "full_name": normalize_text(user.full_name),
        "phone_masked": mask_phone(user.phone),
    }


def _get_user_account(db: Session, user_id: int, account_id: int) -> Account | None:
    return (
        db.query(Account)
        .filter(Account.user_id == user_id, Account.id == account_id)
        .first()
    )


def _account_type(account_name: str | None) -> str:
    normalized = (normalize_text(account_name) or "").lower()
    if "ипот" in normalized:
        return "mortgage"
    if "кредит" in normalized:
        return "credit"
    if "вклад" in normalized:
        return "deposit"
    if "накоп" in normalized:
        return "savings"
    if "основ" in normalized:
        return "main"
    return "current"


def _is_credit_account(account: Account | None) -> bool:
    if not account:
        return False
    return _account_type(account.account_name) in {"credit", "mortgage"}


def _account_number(account_id: int) -> str:
    return f"40817810{account_id:012d}"


def _credit_original_amount(account: Account | None) -> float:
    if not account:
        return 0.0
    amount = float(getattr(account, "credit_original_amount", 0) or 0)
    if amount > 0:
        return round(amount, 2)
    return round(max(float(account.balance or 0), 0.0), 2)


def _credit_debt_amount(account: Account | None) -> float:
    if not account:
        return 0.0
    debt_amount = float(getattr(account, "credit_debt_amount", 0) or 0)
    if debt_amount > 0:
        return round(debt_amount, 2)
    return round(max(float(account.balance or 0), 0.0), 2)


def _credit_term_months(account: Account | None) -> int:
    if not account:
        return 12
    term_months = int(getattr(account, "credit_term_months", 0) or 0)
    return term_months if term_months > 0 else 12


def _minimum_credit_payment(account: Account | None) -> float:
    return calculate_minimum_credit_payment(
        original_amount=_credit_original_amount(account),
        term_months=_credit_term_months(account),
        debt_amount=_credit_debt_amount(account),
    )


def _parse_due_date(raw_value: str | None) -> datetime | None:
    if not raw_value:
        return None
    try:
        return datetime.strptime(raw_value, "%Y-%m-%d")
    except ValueError:
        return None


def _format_due_date(value: datetime) -> str:
    return value.strftime("%Y-%m-%d")


def _display_due_date(account: Account | None) -> str | None:
    due_date = _parse_due_date(getattr(account, "credit_next_payment_due", None))
    if not due_date:
        return None
    return due_date.strftime("%d.%m.%Y")


def _refresh_credit_schedule(db: Session, account: Account | None) -> None:
    if not account or not _is_credit_account(account):
        return

    debt_amount = _credit_debt_amount(account)
    if debt_amount <= 0:
        if not getattr(account, "credit_next_payment_due", None):
            account.credit_next_payment_due = _format_due_date(datetime.now() + timedelta(days=30))
            db.commit()
            db.refresh(account)
        return

    due_date = _parse_due_date(getattr(account, "credit_next_payment_due", None))
    if not due_date:
        due_date = datetime.now() + timedelta(days=15)
        account.credit_next_payment_due = _format_due_date(due_date)
        db.commit()
        db.refresh(account)
        return

    now_dt = datetime.now()
    overdue_periods = 0
    while now_dt.date() > due_date.date():
        overdue_periods += 1
        due_date = datetime.combine(add_months(due_date.date(), 1), datetime.min.time())

    if overdue_periods <= 0:
        return

    account.credit_debt_amount = apply_overdue_interest(
        debt_amount=debt_amount,
        monthly_rate=0.03,
        overdue_periods=overdue_periods,
    )
    account.credit_next_payment_due = _format_due_date(due_date)
    db.commit()
    db.refresh(account)


def _ensure_credit_metadata(db: Session, user_id: int, account: Account | None) -> None:
    if not account or not _is_credit_account(account):
        return
    if (
        getattr(account, "credit_original_amount", None)
        and getattr(account, "credit_term_months", None)
        and getattr(account, "credit_debt_amount", None) is not None
        and getattr(account, "credit_next_payment_due", None)
    ):
        return

    product_type = "РљСЂРµРґРёС‚" if _account_type(account.account_name) == "credit" else "РРїРѕС‚РµРєР°"
    application = (
        db.query(Application)
        .filter(Application.user_id == user_id, Application.product_type == product_type)
        .order_by(Application.id.desc())
        .first()
    )

    original_amount = None
    term_months = None
    if application:
        normalized_details = normalize_text(application.details) or application.details or ""
        if product_type == "РљСЂРµРґРёС‚":
            amount_match = re.search(r"Сумма кредита: (\d+(?:\.\d+)?)", normalized_details)
            term_match = re.search(r"Срок кредита: (\d+)", normalized_details)
        else:
            amount_match = re.search(r"Стоимость/сумма: (\d+(?:\.\d+)?)", normalized_details)
            term_match = re.search(r"Срок: (\d+)", normalized_details)
        if amount_match:
            original_amount = float(amount_match.group(1))
        if term_match:
            term_months = int(term_match.group(1))

    if not original_amount or original_amount <= 0:
        original_amount = max(float(account.balance or 0), 0.0)
    if not term_months or term_months <= 0:
        term_months = 12

    paid_amount = (
        db.query(Operation)
        .filter(
            Operation.account_id == account.id,
            Operation.category == "credit_payment",
        )
        .with_entities(Operation.amount)
        .all()
    )
    total_paid = round(sum(float(item[0] or 0) for item in paid_amount), 2)
    debt_amount = round(max(original_amount - total_paid, 0.0), 2)

    account.credit_original_amount = original_amount
    account.credit_term_months = term_months
    account.credit_debt_amount = debt_amount
    account.credit_next_payment_due = _format_due_date(datetime.now() + timedelta(days=15))
    db.commit()
    db.refresh(account)


def _debit_account_balance(db: Session, user_id: int, account: Account, amount: float) -> None:
    if _is_credit_account(account):
        _ensure_credit_metadata(db, user_id, account)
        new_balance, new_debt_amount = apply_credit_spend(
            available_balance=float(account.balance or 0),
            debt_amount=_credit_debt_amount(account),
            spend_amount=amount,
        )
        account.balance = new_balance
        account.credit_debt_amount = new_debt_amount
        return

    account.balance -= amount


def _extract_account_number_from_request(details: str | None) -> str | None:
    text = normalize_text(details) or details or ""
    match = re.search(r"(40817810\d{12})", text)
    return match.group(1) if match else None


def _extract_transfer_recipient_name(title: str | None) -> str | None:
    normalized = normalize_text(title) or title or ""
    patterns = [
        r"клиенту\s+(.+)$",
        r"от\s+(.+)$",
    ]
    for pattern in patterns:
        match = re.search(pattern, normalized, flags=re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return None


def _execute_person_to_person_transfer(
    db: Session,
    sender: User,
    recipient: User,
    amount: float,
    sender_title: str,
    recipient_title: str,
    sender_account: Account | None = None,
) -> dict[str, Any]:
    sender_account = sender_account or _get_primary_account(db, sender.id)
    recipient_account = _get_primary_account(db, recipient.id)

    if not sender_account or not recipient_account:
        return {"error": "Счет отправителя или получателя не найден"}

    if sender_account.balance < amount:
        return {"error": "Недостаточно средств"}

    _debit_account_balance(db, sender.id, sender_account, amount)
    recipient_account.balance += amount

    current_dt = now_str()

    db.add(
        Operation(
            user_id=sender.id,
            account_id=sender_account.id,
            title=sender_title,
            amount=amount,
            operation_type="expense",
            category="transfer",
            created_at=current_dt,
        )
    )

    db.add(
        Operation(
            user_id=recipient.id,
            account_id=recipient_account.id,
            title=recipient_title,
            amount=amount,
            operation_type="income",
            category="transfer",
            created_at=current_dt,
        )
    )

    db.commit()

    create_notification(
        db,
        sender.id,
        "Исходящий перевод",
        f"Перевод {amount:.2f} ₽ клиенту {recipient.full_name} выполнен.",
    )
    create_notification(
        db,
        recipient.id,
        "Входящий перевод",
        f"Получен перевод {amount:.2f} ₽ от {sender.full_name}.",
    )

    notify_user(
        sender.vk_id,
        f"💸 Списание: {amount:.2f} ₽\nПолучатель: {recipient.full_name}\nБаланс: {sender_account.balance:.2f} ₽",
    )
    notify_user(
        recipient.vk_id,
        f"💰 Зачисление: {amount:.2f} ₽\nОтправитель: {sender.full_name}\nБаланс: {recipient_account.balance:.2f} ₽",
    )

    return {
        "message": "Перевод выполнен успешно",
        "amount": amount,
        "sender_new_balance": sender_account.balance,
        "recipient_new_balance": recipient_account.balance,
        "recipient": _build_transfer_party_payload(recipient),
        "sender": _build_transfer_party_payload(sender),
    }


def generate_card_number() -> str:
    while True:
        suffix = random.randint(1000, 9999)
        middle1 = random.randint(1000, 9999)
        middle2 = random.randint(1000, 9999)
        value = f"2200{middle1}{middle2}{suffix}"
        db: Session = SessionLocal()
        try:
            exists = db.query(Card).filter(Card.full_card_number == value).first()
            if not exists:
                return value
        finally:
            db.close()


def generate_cvv_code() -> str:
    return f"{random.randint(0, 999):03d}"


def format_card_mask(full_number: str) -> str:
    return f"{full_number[:4]} •••• •••• {full_number[-4:]}"


@app.get("/")
def read_root():
    return {"message": "Bank VK Mini App API работает"}


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/bot/users/{vk_id}/summary")
def bot_user_summary(vk_id: str, _: None = Depends(verify_bot_key)):
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        accounts = db.query(Account).filter(Account.user_id == user.id).order_by(Account.id.asc()).all()
        cards = db.query(Card).filter(Card.user_id == user.id).order_by(Card.id.asc()).all()
        applications = (
            db.query(Application)
            .filter(Application.user_id == user.id)
            .order_by(Application.id.desc())
            .limit(3)
            .all()
        )
        return {
            "vk_id": user.vk_id,
            "full_name": normalize_text(user.full_name) or "Клиент банка",
            "notifications_enabled": bool(user.notifications_enabled),
            "accounts_count": len(accounts),
            "cards_count": len(cards),
            "active_cards_count": sum(1 for card in cards if "блок" not in normalize_text(card.status or "").lower()),
            "applications": [
                {
                    "id": item.id,
                    "product_type": normalize_text(item.product_type),
                    "status": normalize_text(item.status),
                    "created_at": item.created_at,
                }
                for item in applications
            ],
        }
    finally:
        db.close()


@app.patch("/bot/users/{vk_id}/notifications")
def bot_update_notifications(
    vk_id: str,
    data: BotNotificationsUpdate,
    _: None = Depends(verify_bot_key),
):
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        user.notifications_enabled = data.enabled
        db.commit()
        return {
            "message": "Настройки уведомлений обновлены",
            "notifications_enabled": bool(user.notifications_enabled),
        }
    finally:
        db.close()


def _vk_plain_text(body: str, status_code: int = 200) -> Response:
    """Тело ответа без JSON — VK сравнивает строку подтверждения побайтово."""
    cleaned = body.strip().replace("\r", "").replace("\n", "").strip("\ufeff")
    return Response(
        content=cleaned.encode("utf-8"),
        media_type="text/plain",
        status_code=status_code,
    )


@app.post("/vk/callback")
@app.post("/vk/callback/")
async def vk_callback(request: Request):
    """Подтверждение Callback API сообщества VK (type: confirmation)."""
    raw = await request.body()
    if not raw:
        return _vk_plain_text("ok")

    try:
        body = json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return _vk_plain_text("ok")

    if body.get("type") == "confirmation":
        code = (
            VK_CALLBACK_CONFIRMATION.strip()
            .replace("\r", "")
            .replace("\n", "")
            .strip("\ufeff")
            .strip('"')
            .strip("'")
        )
        if not code:
            return _vk_plain_text("vk_callback_confirmation_missing", status_code=500)
        # group_id не проверяем: при несовпадении с .env VK получал JSON-ошибку и ругался на ответ
        return _vk_plain_text(code)

    return _vk_plain_text("ok")


@app.post("/auth/vk")
def auth_vk(body: VkAuthRequest, request: Request):
    _, vk_id = verify_miniapp_launch(body.launch_params)
    display_name = (body.full_name or "").strip() or "Пользователь VK"
    phone = body.phone

    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()

        if user:
            fn = (body.full_name or "").strip()
            if fn:
                user.full_name = fn
            if phone is not None:
                user.phone = phone
            db.commit()
            db.refresh(user)
            record_login_event(db, user, request, "auth")
            return {
                "message": "Пользователь найден",
                "user": {
                    "id": user.id,
                    "vk_id": user.vk_id,
                    "full_name": normalize_text(user.full_name),
                    "phone": user.phone,
                    "hide_balance": user.hide_balance,
                    "notifications_enabled": user.notifications_enabled,
                    "app_theme": user.app_theme,
                    "language": user.language,
                    "onboarding_completed": user.onboarding_completed,
                    "created_at": user.created_at,
                    "pin_set": user.pin_hash is not None,
                },
            }

        new_user = User(
            vk_id=vk_id,
            full_name=display_name,
            phone=phone,
            hide_balance=False,
            notifications_enabled=True,
            app_theme="dark",
            language="ru",
            onboarding_completed=False,
            created_at=now_str(),
        )
        db.add(new_user)
        db.commit()
        db.refresh(new_user)

        new_account = Account(
            user_id=new_user.id,
            account_name="Основной счет",
            balance=0.0,
            currency="RUB",
            status="Активен",
        )
        db.add(new_account)
        db.commit()
        db.refresh(new_account)

        full_card_number = generate_card_number()
        new_card = Card(
            user_id=new_user.id,
            account_id=new_account.id,
            card_name="Основная карта",
            card_number_mask=format_card_mask(full_card_number),
            full_card_number=full_card_number,
            cvv_code=generate_cvv_code(),
            expiry_date="12/29",
            payment_system="МИР",
            status="Активна",
        )
        db.add(new_card)
        db.commit()

        create_notification(
            db,
            new_user.id,
            "Добро пожаловать",
            "Ваш аккаунт успешно создан.",
        )

        notify_user(
            new_user.vk_id,
            "🏦 Добро пожаловать в VK Банк!\nВаш аккаунт успешно создан.",
        )
        record_login_event(db, new_user, request, "auth")

        return {
            "message": "Пользователь создан",
            "user": {
                "id": new_user.id,
                "vk_id": new_user.vk_id,
                "full_name": normalize_text(new_user.full_name),
                "phone": new_user.phone,
                "hide_balance": new_user.hide_balance,
                "notifications_enabled": new_user.notifications_enabled,
                "app_theme": new_user.app_theme,
                "language": new_user.language,
                "onboarding_completed": new_user.onboarding_completed,
                "created_at": new_user.created_at,
                "pin_set": new_user.pin_hash is not None,
            },
        }
    finally:
        db.close()


@app.post("/auth/vk/pin/set")
def pin_set(body: PinSetRequest):
    if body.pin != body.pin_confirm:
        raise HTTPException(status_code=400, detail="PIN и подтверждение не совпадают")
    _, vk_id = verify_miniapp_launch(body.launch_params)
    if is_pin_locked(vk_id):
        raise HTTPException(status_code=429, detail="Слишком много попыток. Подождите до 15 минут.")
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="Сначала войдите через VK")
        if user.pin_hash:
            raise HTTPException(status_code=400, detail="PIN уже установлен")
        user.pin_hash = hash_pin(body.pin)
        db.commit()
        clear_pin_failures(vk_id)
        return {"message": "PIN установлен", "access_token": create_access_token(vk_id)}
    finally:
        db.close()


@app.post("/auth/vk/pin/verify")
def pin_verify(body: PinVerifyRequest, request: Request):
    _, vk_id = verify_miniapp_launch(body.launch_params)
    if is_pin_locked(vk_id):
        raise HTTPException(status_code=429, detail="Слишком много попыток. Подождите до 15 минут.")
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user or not user.pin_hash:
            record_pin_failure(vk_id)
            raise HTTPException(status_code=401, detail="Неверный PIN")
        if not verify_pin(body.pin, user.pin_hash):
            record_pin_failure(vk_id)
            raise HTTPException(status_code=401, detail="Неверный PIN")
        clear_pin_failures(vk_id)
        record_login_event(db, user, request, "pin")
        return {"access_token": create_access_token(vk_id)}
    finally:
        db.close()


@app.post("/seed-test-data")
def seed_test_data():
    db: Session = SessionLocal()
    try:
        existing_user_1 = db.query(User).filter(User.vk_id == "123456789").first()
        existing_user_2 = db.query(User).filter(User.vk_id == "987654321").first()

        if existing_user_1 and existing_user_2:
            return {"message": "Тестовые данные уже существуют"}

        if not existing_user_1:
            user1 = User(
                vk_id="123456789",
                full_name="Иван Иванов",
                phone="+79991234567",
                hide_balance=False,
                notifications_enabled=True,
                app_theme="dark",
                language="ru",
                onboarding_completed=False,
                created_at=now_str(),
            )
            db.add(user1)
            db.commit()
            db.refresh(user1)

            account1 = Account(
                user_id=user1.id,
                account_name="Основной счет",
                balance=125400.50,
                currency="RUB",
                status="Активен",
            )
            db.add(account1)
            db.commit()
            db.refresh(account1)

            account1_extra = Account(
                user_id=user1.id,
                account_name="Накопительный счет",
                balance=25000.00,
                currency="RUB",
                status="Активен",
            )
            db.add(account1_extra)
            db.commit()
            db.refresh(account1_extra)

            full_card_1 = generate_card_number()
            card1 = Card(
                user_id=user1.id,
                account_id=account1.id,
                card_name="Основная карта",
                card_number_mask=format_card_mask(full_card_1),
                full_card_number=full_card_1,
                cvv_code=generate_cvv_code(),
                expiry_date="11/28",
                payment_system="МИР",
                status="Активна",
            )
            db.add(card1)
            db.commit()

            operations1 = [
                Operation(
                    user_id=user1.id,
                    account_id=account1.id,
                    title="Перевод от клиента",
                    amount=2000.00,
                    operation_type="income",
                    category="transfer",
                    created_at="09.03.2026",
                ),
                Operation(
                    user_id=user1.id,
                    account_id=account1.id,
                    title="Оплата в магазине",
                    amount=1250.00,
                    operation_type="expense",
                    category="shopping",
                    created_at="08.03.2026",
                ),
                Operation(
                    user_id=user1.id,
                    account_id=account1.id,
                    title="Пополнение счета",
                    amount=15000.00,
                    operation_type="income",
                    category="topup",
                    created_at="07.03.2026",
                ),
                Operation(
                    user_id=user1.id,
                    account_id=account1.id,
                    title="Оплата подписки",
                    amount=499.00,
                    operation_type="expense",
                    category="subscription",
                    created_at="06.03.2026",
                ),
                Operation(
                    user_id=user1.id,
                    account_id=account1.id,
                    title="Комиссия за обслуживание",
                    amount=150.00,
                    operation_type="expense",
                    category="commission",
                    created_at="05.03.2026",
                ),
                Operation(
                    user_id=user1.id,
                    account_id=account1.id,
                    title="Оплата мобильной связи",
                    amount=890.00,
                    operation_type="expense",
                    category="services",
                    created_at="04.03.2026",
                ),
            ]
            db.add_all(operations1)
            db.commit()

            create_notification(db, user1.id, "Тестовые данные", "Профиль заполнен тестовыми счетами и операциями.")

        if not existing_user_2:
            user2 = User(
                vk_id="987654321",
                full_name="Петр Петров",
                phone="+79990001122",
                hide_balance=False,
                notifications_enabled=True,
                app_theme="dark",
                language="ru",
                onboarding_completed=False,
                created_at=now_str(),
            )
            db.add(user2)
            db.commit()
            db.refresh(user2)

            account2 = Account(
                user_id=user2.id,
                account_name="Основной счет",
                balance=54320.00,
                currency="RUB",
                status="Активен",
            )
            db.add(account2)
            db.commit()
            db.refresh(account2)

            full_card_2 = generate_card_number()
            card2 = Card(
                user_id=user2.id,
                account_id=account2.id,
                card_name="Основная карта",
                card_number_mask=format_card_mask(full_card_2),
                full_card_number=full_card_2,
                cvv_code=generate_cvv_code(),
                expiry_date="08/27",
                payment_system="МИР",
                status="Активна",
            )
            db.add(card2)
            db.commit()

            operations2 = [
                Operation(
                    user_id=user2.id,
                    account_id=account2.id,
                    title="Пополнение счета",
                    amount=10000.00,
                    operation_type="income",
                    category="topup",
                    created_at="05.03.2026",
                )
            ]
            db.add_all(operations2)
            db.commit()

            create_notification(db, user2.id, "Тестовые данные", "Профиль заполнен тестовыми счетами и операциями.")

        return {"message": "Тестовые данные успешно созданы"}
    finally:
        db.close()


@app.get("/users/{vk_id}")
def get_user_by_vk_id(vk_id: str, _: None = Depends(vk_path_guard)):
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        return {
            "id": user.id,
            "vk_id": user.vk_id,
            "full_name": normalize_text(user.full_name),
            "phone": user.phone,
            "hide_balance": user.hide_balance,
            "notifications_enabled": user.notifications_enabled,
            "app_theme": user.app_theme,
            "language": user.language,
            "onboarding_completed": user.onboarding_completed,
            "created_at": user.created_at,
            "pin_set": user.pin_hash is not None,
        }
    finally:
        db.close()


@app.patch("/users/{vk_id}/settings")
def update_user_settings(vk_id: str, data: SettingsUpdate, _: None = Depends(vk_path_guard)):
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        if data.hide_balance is not None:
            user.hide_balance = data.hide_balance
        if data.notifications_enabled is not None:
            user.notifications_enabled = data.notifications_enabled
        if data.app_theme is not None:
            user.app_theme = data.app_theme
        if data.language is not None:
            user.language = data.language
        if data.onboarding_completed is not None:
            user.onboarding_completed = data.onboarding_completed

        db.commit()

        return {
            "message": "Настройки обновлены",
            "settings": {
                "hide_balance": user.hide_balance,
                "notifications_enabled": user.notifications_enabled,
                "app_theme": user.app_theme,
                "language": user.language,
                "onboarding_completed": user.onboarding_completed,
            },
        }
    finally:
        db.close()


@app.patch("/users/{vk_id}/profile")
def update_user_profile(
    vk_id: str,
    data: PhoneUpdateRequest,
    authorization: Annotated[str | None, Header()] = None,
):
    require_same_vk(vk_id, authorization)
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        normalized_phone = data.phone.strip()
        if not normalized_phone.startswith("+7") or len("".join(ch for ch in normalized_phone if ch.isdigit())) != 11:
            return {"error": "Укажите номер в формате +7XXXXXXXXXX"}

        existing_owner = (
            db.query(User)
            .filter(User.phone == normalized_phone, User.vk_id != vk_id)
            .first()
        )
        if existing_owner:
            return {"error": "Этот номер уже привязан к другому профилю"}

        user.phone = normalized_phone
        db.commit()
        db.refresh(user)

        return {
            "message": "Телефон обновлен",
            "profile": {
                "vk_id": user.vk_id,
                "full_name": normalize_text(user.full_name),
                "phone": user.phone,
            },
        }
    finally:
        db.close()


@app.post("/users/{vk_id}/pin/change")
def change_user_pin(
    vk_id: str,
    data: PinChangeRequest,
    authorization: Annotated[str | None, Header()] = None,
):
    require_same_vk(vk_id, authorization)
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user or not user.pin_hash:
            return {"error": "Сначала установите PIN"}
        if data.new_pin != data.new_pin_confirm:
            return {"error": "Новый PIN и подтверждение не совпадают"}
        if not verify_pin(data.current_pin, user.pin_hash):
            return {"error": "Текущий PIN указан неверно"}

        user.pin_hash = hash_pin(data.new_pin)
        db.commit()
        return {"message": "PIN успешно изменен"}
    finally:
        db.close()


@app.get("/users/{vk_id}/security")
def get_user_security(vk_id: str, _: None = Depends(vk_path_guard)):
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        login_events = (
            db.query(LoginEvent)
            .filter(LoginEvent.user_id == user.id)
            .order_by(LoginEvent.id.desc())
            .limit(8)
            .all()
        )

        return {
            "phone": user.phone,
            "phone_masked": mask_phone(user.phone),
            "pin_set": user.pin_hash is not None,
            "notifications_enabled": user.notifications_enabled,
            "hide_balance": user.hide_balance,
            "app_theme": user.app_theme,
            "language": user.language,
            "login_history": [
                {
                    "id": item.id,
                    "device_name": normalize_text(item.device_name),
                    "platform": normalize_text(item.platform),
                    "ip_address": item.ip_address,
                    "source": normalize_text(item.source),
                    "created_at": item.created_at,
                }
                for item in login_events
            ],
        }
    finally:
        db.close()


@app.get("/users/{vk_id}/accounts")
def get_user_accounts(vk_id: str, _: None = Depends(vk_path_guard)):
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        primary_account = _get_primary_account(db, user.id)
        accounts = (
            db.query(Account)
            .filter(Account.user_id == user.id)
            .order_by(Account.id.asc())
            .all()
        )

        return [
            {
                "id": account.id,
                "account_name": normalize_text(account.account_name),
                "balance": account.balance,
                "currency": account.currency,
                "status": normalize_text(account.status),
                "is_primary": bool(primary_account and account.id == primary_account.id),
                "account_type": _account_type(account.account_name),
                "account_number": _account_number(account.id),
                "is_credit": _is_credit_account(account),
            }
            for account in accounts
        ]
    finally:
        db.close()


@app.get("/accounts/{account_id}")
def get_account_details(
    account_id: int,
    authorization: Annotated[str | None, Header()] = None,
):
    vk_id = decode_vk_id_from_authorization(authorization)
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        account = _get_user_account(db, user.id, account_id)
        if not account:
            return {"error": "Счет не найден"}
        _ensure_credit_metadata(db, user.id, account)
        _refresh_credit_schedule(db, account)

        primary_account = _get_primary_account(db, user.id)
        linked_cards = (
            db.query(Card)
            .filter(Card.user_id == user.id, Card.account_id == account.id)
            .order_by(Card.id.asc())
            .all()
        )
        operations = (
            db.query(Operation)
            .filter(Operation.user_id == user.id, Operation.account_id == account.id)
            .order_by(Operation.id.desc())
            .limit(8)
            .all()
        )

        account_type = _account_type(account.account_name)
        is_credit = _is_credit_account(account)
        credit_debt_amount = _credit_debt_amount(account) if is_credit else 0.0
        can_request_close = not (primary_account and account.id == primary_account.id) and not (
            is_credit and credit_debt_amount > 0
        )

        return {
            "id": account.id,
            "account_name": normalize_text(account.account_name),
            "account_number": _account_number(account.id),
            "balance": account.balance,
            "currency": account.currency,
            "status": normalize_text(account.status) or "Активен",
            "account_type": account_type,
            "is_primary": bool(primary_account and account.id == primary_account.id),
            "is_credit": is_credit,
            "credit_original_amount": _credit_original_amount(account) if is_credit else 0.0,
            "credit_term_months": _credit_term_months(account) if is_credit else None,
            "debt_amount": credit_debt_amount,
            "minimum_payment": _minimum_credit_payment(account) if is_credit else 0.0,
            "next_payment_date": _display_due_date(account) if is_credit else None,
            "can_request_close": can_request_close,
            "close_restriction": (
                "Основной счет нельзя закрыть, пока он остается главным."
                if primary_account and account.id == primary_account.id
                else "Сначала погасите задолженность по кредитному счету."
                if is_credit and credit_debt_amount > 0
                else None
            ),
            "linked_cards": [
                {
                    "id": card.id,
                    "card_name": normalize_text(card.card_name),
                    "card_number_mask": card.card_number_mask,
                    "payment_system": normalize_text(card.payment_system),
                    "status": normalize_text(card.status),
                }
                for card in linked_cards
            ],
            "operations": [
                {
                    "id": item.id,
                    "title": humanize_operation_title(item.title, item.operation_type),
                    "amount": item.amount,
                    "operation_type": item.operation_type,
                    "category": item.category,
                    "created_at": item.created_at,
                }
                for item in operations
            ],
        }
    finally:
        db.close()


@app.post("/accounts/create")
def create_account(
    data: CreateAccountRequest,
    authorization: Annotated[str | None, Header()] = None,
):
    require_same_vk(data.vk_id, authorization)
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == data.vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        new_account = Account(
            user_id=user.id,
            account_name=data.account_name,
            balance=0.0,
            currency=data.currency,
            status="Активен",
        )
        db.add(new_account)
        db.commit()
        db.refresh(new_account)

        create_notification(
            db,
            user.id,
            "Открыт новый счет",
            f"Счет «{new_account.account_name}» успешно создан.",
        )

        notify_user(
            user.vk_id,
            f"🏦 Открыт новый счет\nНазвание: {new_account.account_name}\nВалюта: {new_account.currency}"
        )

        return {
            "message": "Счет успешно создан",
            "account": {
                "id": new_account.id,
                "account_name": normalize_text(new_account.account_name),
                "balance": new_account.balance,
                "currency": new_account.currency,
                "status": new_account.status,
            },
        }
    finally:
        db.close()


@app.get("/users/{vk_id}/cards")
def get_user_cards(vk_id: str, _: None = Depends(vk_path_guard)):
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        primary_account = _get_primary_account(db, user.id)
        cards = (
            db.query(Card)
            .filter(Card.user_id == user.id)
            .order_by(Card.id.asc())
            .all()
        )

        return [
            {
                "id": card.id,
                "account_id": card.account_id,
                "card_name": normalize_text(card.card_name),
                "card_number_mask": card.card_number_mask,
                "cvv_code": card.cvv_code,
                "expiry_date": card.expiry_date,
                "payment_system": normalize_text(card.payment_system),
                "status": normalize_text(card.status),
                "balance": card.account.balance if card.account else 0.0,
                "linked_account_name": normalize_text(card.account.account_name) if card.account else "",
                "linked_account_status": normalize_text(card.account.status) if card.account else "",
                "is_primary_account_card": bool(
                    primary_account and card.account_id == primary_account.id
                ),
            }
            for card in cards
        ]
    finally:
        db.close()


@app.get("/cards/{card_id}")
def get_card_details(
    card_id: int,
    authorization: Annotated[str | None, Header()] = None,
):
    vk_id = decode_vk_id_from_authorization(authorization)
    db: Session = SessionLocal()
    try:
        card = db.query(Card).filter(Card.id == card_id).first()
        if not card:
            return {"error": "Карта не найдена"}

        owner = db.query(User).filter(User.id == card.user_id).first()
        if not owner or owner.vk_id != vk_id:
            raise HTTPException(status_code=403, detail="Карта принадлежит другому пользователю")

        account = db.query(Account).filter(Account.id == card.account_id).first()

        return {
            "id": card.id,
            "card_name": normalize_text(card.card_name),
            "card_number_mask": card.card_number_mask,
            "full_card_number": card.full_card_number,
            "cvv_code": card.cvv_code,
            "expiry_date": card.expiry_date,
            "payment_system": normalize_text(card.payment_system),
            "status": normalize_text(card.status),
            "balance": account.balance if account else 0.0,
            "linked_account_name": normalize_text(account.account_name) if account else "",
            "requisites": {
                "account_number": f"40817810{card.account_id:012d}",
                "bik": "044525225",
                "correspondent_account": "30101810400000000225",
                "bank_name": "АО VK Банк",
                "currency": account.currency if account else "RUB",
            },
        }
    finally:
        db.close()


@app.post("/cards/{card_id}/block")
def block_card(
    card_id: int,
    authorization: Annotated[str | None, Header()] = None,
):
    vk_id = decode_vk_id_from_authorization(authorization)
    db: Session = SessionLocal()
    try:
        card = db.query(Card).filter(Card.id == card_id).first()
        if not card:
            return {"error": "Карта не найдена"}

        owner = db.query(User).filter(User.id == card.user_id).first()
        if not owner or owner.vk_id != vk_id:
            raise HTTPException(status_code=403, detail="Карта принадлежит другому пользователю")

        card.status = "Заблокирована"
        db.commit()

        user = db.query(User).filter(User.id == card.user_id).first()
        if user:
            create_notification(
                db,
                user.id,
                "Карта заблокирована",
                f"Карта {card.card_number_mask} была заблокирована.",
            )
            notify_user(
                user.vk_id,
                f"🔒 Ваша карта {card.card_number_mask} заблокирована."
            )

        return {
            "message": "Карта заблокирована",
            "card_id": card.id,
            "status": normalize_text(card.status),
        }
    finally:
        db.close()


@app.get("/users/{vk_id}/operations")
def get_user_operations(
    vk_id: str,
    account_id: int | None = None,
    operation_type: str | None = None,
    category: str | None = None,
    _: None = Depends(vk_path_guard),
):
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        query = db.query(Operation).filter(Operation.user_id == user.id)

        if account_id is not None:
            query = query.filter(Operation.account_id == account_id)
        if operation_type:
            query = query.filter(Operation.operation_type == operation_type)
        if category:
            query = query.filter(Operation.category == category)

        operations = query.order_by(Operation.id.desc()).all()

        result = []
        for operation in operations:
            recipient_name = None
            recipient_vk_id = None
            if operation.category == "transfer" and operation.operation_type == "expense":
                recipient_name = _extract_transfer_recipient_name(operation.title)
                if recipient_name:
                    recipient_user = db.query(User).filter(User.full_name == recipient_name).first()
                    if recipient_user:
                        recipient_vk_id = recipient_user.vk_id

            result.append(
                {
                    "id": operation.id,
                    "title": humanize_operation_title(operation.title, operation.operation_type),
                    "amount": operation.amount,
                    "operation_type": operation.operation_type,
                    "category": operation.category,
                    "account_id": operation.account_id,
                    "created_at": operation.created_at,
                    "recipient_name": normalize_text(recipient_name) if recipient_name else None,
                    "recipient_vk_id": recipient_vk_id,
                }
            )

        return result
    finally:
        db.close()


@app.get("/users/{vk_id}/operations/{operation_id}")
def get_user_operation_details(
    vk_id: str,
    operation_id: int,
    _: None = Depends(vk_path_guard),
):
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        operation = (
            db.query(Operation)
            .filter(Operation.id == operation_id, Operation.user_id == user.id)
            .first()
        )
        if not operation:
            return {"error": "Операция не найдена"}

        account = db.query(Account).filter(Account.id == operation.account_id).first()

        return {
            "id": operation.id,
            "title": humanize_operation_title(operation.title, operation.operation_type),
            "amount": operation.amount,
            "operation_type": operation.operation_type,
            "category": operation.category,
            "account_id": operation.account_id,
            "account_name": normalize_text(account.account_name) if account else None,
            "currency": account.currency if account else "RUB",
            "status": "Исполнено",
            "created_at": operation.created_at,
            "reference": f"OP-{operation.id:08d}",
        }
    finally:
        db.close()


@app.get("/users/{vk_id}/expense-analytics")
def get_expense_analytics(vk_id: str, _: None = Depends(vk_path_guard)):
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        operations = (
            db.query(Operation)
            .filter(
                Operation.user_id == user.id,
                Operation.operation_type == "expense",
            )
            .all()
        )

        categories = {
            "transfer": 0.0,
            "shopping": 0.0,
            "subscription": 0.0,
            "services": 0.0,
            "commission": 0.0,
            "other": 0.0,
        }

        for operation in operations:
            key = operation.category if operation.category in categories else "other"
            categories[key] += float(operation.amount)

        total = sum(categories.values())

        return {
            "total_expenses": total,
            "categories": categories,
        }
    finally:
        db.close()


@app.get("/users/{vk_id}/notifications")
def get_user_notifications(vk_id: str, _: None = Depends(vk_path_guard)):
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        notifications = (
            db.query(Notification)
            .filter(Notification.user_id == user.id)
            .order_by(Notification.id.desc())
            .all()
        )

        return [
            {
                "id": item.id,
                "title": normalize_text(item.title),
                "message": normalize_text(item.message),
                "is_read": item.is_read,
                "created_at": item.created_at,
            }
            for item in notifications
        ]
    finally:
        db.close()


@app.post("/notifications/{notification_id}/read")
def mark_notification_as_read(
    notification_id: int,
    authorization: Annotated[str | None, Header()] = None,
):
    vk_id = decode_vk_id_from_authorization(authorization)
    db: Session = SessionLocal()
    try:
        notification = db.query(Notification).filter(Notification.id == notification_id).first()
        if not notification:
            return {"error": "Уведомление не найдено"}

        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user or notification.user_id != user.id:
            raise HTTPException(status_code=403, detail="Нет доступа к уведомлению")

        notification.is_read = True
        db.commit()

        return {"message": "Уведомление отмечено как прочитанное"}
    finally:
        db.close()


@app.get("/users/{vk_id}/favorites")
def get_favorite_payments(vk_id: str, _: None = Depends(vk_path_guard)):
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        favorites = (
            db.query(FavoritePayment)
            .filter(FavoritePayment.user_id == user.id)
            .order_by(FavoritePayment.id.desc())
            .all()
        )

        return [
            {
                "id": item.id,
                "template_name": normalize_text(item.template_name),
                "payment_type": item.payment_type,
                "recipient_value": normalize_text(item.recipient_value),
                "provider_name": normalize_text(item.provider_name),
                "created_at": item.created_at,
            }
            for item in favorites
        ]
    finally:
        db.close()


@app.post("/favorites")
def create_favorite_payment(
    data: FavoritePaymentCreate,
    authorization: Annotated[str | None, Header()] = None,
):
    require_same_vk(data.vk_id, authorization)
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == data.vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        favorite = FavoritePayment(
            user_id=user.id,
            template_name=data.template_name,
            payment_type=data.payment_type,
            recipient_value=data.recipient_value,
            provider_name=data.provider_name,
            created_at=now_str(),
        )
        db.add(favorite)
        db.commit()
        db.refresh(favorite)

        create_notification(
            db,
            user.id,
            "Шаблон сохранен",
            f"Шаблон «{favorite.template_name}» добавлен в избранное.",
        )

        return {
            "message": "Шаблон сохранен",
            "favorite": {
                "id": favorite.id,
                "template_name": favorite.template_name,
                "payment_type": favorite.payment_type,
                "recipient_value": favorite.recipient_value,
                "provider_name": favorite.provider_name,
                "created_at": favorite.created_at,
            },
        }
    finally:
        db.close()


@app.post("/transfer/internal")
def transfer_between_accounts(
    data: InternalTransferRequest,
    authorization: Annotated[str | None, Header()] = None,
):
    require_same_vk(data.vk_id, authorization)
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == data.vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        if data.from_account_id == data.to_account_id:
            return {"error": "Счета должны быть разными"}

        if data.amount <= 0:
            return {"error": "Сумма должна быть больше нуля"}

        from_account = (
            db.query(Account)
            .filter(Account.id == data.from_account_id, Account.user_id == user.id)
            .first()
        )
        to_account = (
            db.query(Account)
            .filter(Account.id == data.to_account_id, Account.user_id == user.id)
            .first()
        )

        if not from_account or not to_account:
            return {"error": "Один из счетов не найден"}

        if from_account.balance < data.amount:
            return {"error": "Недостаточно средств"}

        _debit_account_balance(db, user.id, from_account, data.amount)
        to_account.balance += data.amount

        current_dt = now_str()

        db.add(
            Operation(
                user_id=user.id,
                account_id=from_account.id,
                title=f"Перевод на свой счет {to_account.account_name}",
                amount=data.amount,
                operation_type="expense",
                category="transfer",
                created_at=current_dt,
            )
        )

        db.add(
            Operation(
                user_id=user.id,
                account_id=to_account.id,
                title=f"Пополнение со своего счета {from_account.account_name}",
                amount=data.amount,
                operation_type="income",
                category="transfer",
                created_at=current_dt,
            )
        )

        db.commit()

        create_notification(
            db,
            user.id,
            "Перевод между счетами",
            f"Выполнен перевод между своими счетами на сумму {data.amount:.2f} ₽.",
        )

        notify_user(
            user.vk_id,
            f"🔄 Перевод между своими счетами\nСумма: {data.amount:.2f} ₽"
        )

        return {"message": "Перевод между счетами выполнен"}
    finally:
        db.close()


@app.post("/transfer/interbank")
def interbank_transfer(
    data: InterbankTransferRequest,
    authorization: Annotated[str | None, Header()] = None,
):
    require_same_vk(data.vk_id, authorization)
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == data.vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        if data.amount <= 0:
            return {"error": "Сумма должна быть больше нуля"}

        from_account = (
            db.query(Account)
            .filter(Account.id == data.from_account_id, Account.user_id == user.id)
            .first()
        )

        if not from_account:
            return {"error": "Счет списания не найден"}

        if from_account.balance < data.amount:
            return {"error": "Недостаточно средств"}

        _debit_account_balance(db, user.id, from_account, data.amount)

        db.add(
            Operation(
                user_id=user.id,
                account_id=from_account.id,
                title=f"Межбанковский перевод в {data.bank_name}",
                amount=data.amount,
                operation_type="expense",
                category="services",
                created_at=now_str(),
            )
        )

        db.commit()

        create_notification(
            db,
            user.id,
            "Межбанковский перевод",
            f"Перевод в {data.bank_name} на сумму {data.amount:.2f} ₽ выполнен.",
        )

        notify_user(
            user.vk_id,
            f"🏦 Межбанковский перевод\nБанк: {data.bank_name}\nСумма: {data.amount:.2f} ₽"
        )

        return {"message": "Межбанковский перевод выполнен"}
    finally:
        db.close()


@app.post("/applications")
def create_application(
    application_data: ApplicationCreate,
    authorization: Annotated[str | None, Header()] = None,
):
    require_same_vk(application_data.vk_id, authorization)
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == application_data.vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        application = Application(
            user_id=user.id,
            product_type=application_data.product_type,
            details=application_data.details,
            status="На рассмотрении",
            created_at=now_str(),
        )

        db.add(application)
        db.commit()
        db.refresh(application)

        create_notification(
            db,
            user.id,
            "Новая заявка",
            f"Создана заявка на продукт «{application.product_type}».",
        )

        notify_user(
            user.vk_id,
            f"📄 Заявка создана\nПродукт: {application.product_type}\nСтатус: {application.status}"
        )

        return {
            "message": "Заявка успешно создана",
            "application": {
                "id": application.id,
                "product_type": application.product_type,
                "details": application.details,
                "status": application.status,
                "created_at": application.created_at,
            },
        }
    finally:
        db.close()


@app.get("/users/{vk_id}/applications")
def get_user_applications(vk_id: str, _: None = Depends(vk_path_guard)):
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        applications = (
            db.query(Application)
            .filter(Application.user_id == user.id)
            .order_by(Application.id.desc())
            .all()
        )

        return [
            {
                "id": application.id,
                "product_type": application.product_type,
                "details": application.details,
                "status": application.status,
                "created_at": application.created_at,
            }
            for application in applications
        ]
    finally:
        db.close()


@app.post("/transfer")
def make_transfer(
    transfer_data: TransferCreate,
    authorization: Annotated[str | None, Header()] = None,
):
    require_same_vk(transfer_data.sender_vk_id, authorization)
    db: Session = SessionLocal()
    try:
        sender = db.query(User).filter(User.vk_id == transfer_data.sender_vk_id).first()
        if not sender:
            return {"error": "Отправитель не найден"}

        recipient = db.query(User).filter(User.phone == transfer_data.recipient_phone).first()
        if not recipient:
            return {"error": "Получатель не найден"}

        if sender.id == recipient.id:
            return {"error": "Нельзя перевести деньги самому себе"}

        if transfer_data.amount <= 0:
            return {"error": "Сумма должна быть больше нуля"}

        sender_account = _get_user_account(db, sender.id, transfer_data.from_account_id)
        recipient_account = db.query(Account).filter(Account.user_id == recipient.id).first()

        if not sender_account or not recipient_account:
            return {"error": "Счет отправителя или получателя не найден"}

        if normalize_text(sender_account.status) == "Заблокирована":
            return {"error": "Счет списания заблокирован"}

        if sender_account.balance < transfer_data.amount:
            return {"error": "Недостаточно средств"}

        _debit_account_balance(db, sender.id, sender_account, transfer_data.amount)
        recipient_account.balance += transfer_data.amount

        current_dt = now_str()

        sender_operation = Operation(
            user_id=sender.id,
            account_id=sender_account.id,
            title=f"Перевод клиенту {recipient.full_name}",
            amount=transfer_data.amount,
            operation_type="expense",
            category="transfer",
            created_at=current_dt,
        )

        recipient_operation = Operation(
            user_id=recipient.id,
            account_id=recipient_account.id,
            title=f"Перевод от клиента {sender.full_name}",
            amount=transfer_data.amount,
            operation_type="income",
            category="transfer",
            created_at=current_dt,
        )

        db.add(sender_operation)
        db.add(recipient_operation)
        db.commit()

        create_notification(
            db,
            sender.id,
            "Исходящий перевод",
            f"Перевод {transfer_data.amount:.2f} ₽ клиенту {recipient.full_name} выполнен.",
        )
        create_notification(
            db,
            recipient.id,
            "Входящий перевод",
            f"Получен перевод {transfer_data.amount:.2f} ₽ от {sender.full_name}.",
        )

        notify_user(
            sender.vk_id,
            f"💸 Списание: {transfer_data.amount:.2f} ₽\nПолучатель: {recipient.full_name}\nБаланс: {sender_account.balance:.2f} ₽"
        )

        notify_user(
            recipient.vk_id,
            f"💰 Зачисление: {transfer_data.amount:.2f} ₽\nОтправитель: {sender.full_name}\nБаланс: {recipient_account.balance:.2f} ₽"
        )

        return {
            "message": "Перевод выполнен успешно",
            "sender_new_balance": sender_account.balance,
            "recipient_full_name": recipient.full_name,
            "amount": transfer_data.amount,
        }
    finally:
        db.close()


@app.post("/transfer/vk-id/preview")
def preview_transfer_by_vk_id(
    transfer_data: VkIdTransferPreviewRequest,
    authorization: Annotated[str | None, Header()] = None,
):
    require_same_vk(transfer_data.sender_vk_id, authorization)
    db: Session = SessionLocal()
    try:
        sender = db.query(User).filter(User.vk_id == transfer_data.sender_vk_id).first()
        if not sender:
            return {"error": "Отправитель не найден"}

        sender_account = _get_user_account(db, sender.id, transfer_data.from_account_id)
        if not sender_account:
            return {"error": "Счет списания не найден"}

        if normalize_text(sender_account.status) == "Заблокирована":
            return {"error": "Счет списания заблокирован"}

        recipient = db.query(User).filter(User.vk_id == str(transfer_data.recipient_vk_id).strip()).first()
        if not recipient:
            return {"error": "Получатель с таким VK ID не найден"}

        if sender.id == recipient.id:
            return {"error": "РќРµР»СЊР·СЏ РїРµСЂРµРІРµСЃС‚Рё РґРµРЅСЊРіРё СЃР°РјРѕРјСѓ СЃРµР±Рµ"}

        recipient_account = _get_primary_account(db, recipient.id)
        if not recipient_account:
            return {"error": "РЈ РїРѕР»СѓС‡Р°С‚РµР»СЏ РїРѕРєР° РЅРµС‚ Р°РєС‚РёРІРЅРѕРіРѕ С‡С‘С‚Р°"}

        return {
            "recipient": {
                **_build_transfer_party_payload(recipient),
                "account_name": normalize_text(recipient_account.account_name),
            }
        }
    finally:
        db.close()


@app.post("/transfer/vk-id")
def make_transfer_by_vk_id(
    transfer_data: VkIdTransferCreate,
    authorization: Annotated[str | None, Header()] = None,
):
    require_same_vk(transfer_data.sender_vk_id, authorization)
    db: Session = SessionLocal()
    try:
        sender = db.query(User).filter(User.vk_id == transfer_data.sender_vk_id).first()
        if not sender:
            return {"error": "Отправитель не найден"}

        recipient = db.query(User).filter(User.vk_id == str(transfer_data.recipient_vk_id).strip()).first()
        if not recipient:
            return {"error": "Получатель с таким VK ID не найден"}

        if sender.id == recipient.id:
            return {"error": "РќРµР»СЊР·СЏ РїРµСЂРµРІРµСЃС‚Рё РґРµРЅСЊРіРё СЃР°РјРѕРјСѓ СЃРµР±Рµ"}

        sender_account = _get_user_account(db, sender.id, transfer_data.from_account_id)
        if not sender_account:
            return {"error": "Счет списания не найден"}

        if normalize_text(sender_account.status) == "Заблокирована":
            return {"error": "Счет списания заблокирован"}

        return _execute_person_to_person_transfer(
            db,
            sender=sender,
            recipient=recipient,
            amount=transfer_data.amount,
            sender_title=f"Перевод по VK ID клиенту {recipient.full_name}",
            recipient_title=f"Перевод по VK ID от {sender.full_name}",
            sender_account=sender_account,
        )
    finally:
        db.close()


@app.post("/support/message")
def send_support_message(
    data: SupportMessageCreate,
    authorization: Annotated[str | None, Header()] = None,
):
    require_same_vk(data.vk_id, authorization)
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == data.vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}
        return process_support_message(db, user, data.message)
    finally:
        db.close()


@app.post("/accounts/{account_id}/close-request")
def request_account_close(
    account_id: int,
    data: AccountCloseRequest,
    authorization: Annotated[str | None, Header()] = None,
):
    require_same_vk(data.vk_id, authorization)
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == data.vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        account = _get_user_account(db, user.id, account_id)
        if not account:
            return {"error": "Счет не найден"}
        if _is_credit_account(account):
            _ensure_credit_metadata(db, user.id, account)

        primary_account = _get_primary_account(db, user.id)
        if primary_account and account.id == primary_account.id:
            return {"error": "Основной счет нельзя закрыть, пока он остается главным"}

        if _is_credit_account(account) and _credit_debt_amount(account) > 0:
            return {"error": "Сначала погасите задолженность по кредитному счету"}

        existing = (
            db.query(ServiceRequest)
            .filter(
                ServiceRequest.user_id == user.id,
                ServiceRequest.request_type == "Закрытие счета",
                ServiceRequest.status.in_(["Создан", "В обработке"]),
                ServiceRequest.details.contains(_account_number(account.id)),
            )
            .first()
        )
        if existing:
            return {"message": "Запрос на закрытие уже создан", "request_id": existing.id}

        request_item = ServiceRequest(
            user_id=user.id,
            request_type="Закрытие счета",
            details=(
                f"Счет: {normalize_text(account.account_name) or account.account_name}; "
                f"Номер: {_account_number(account.id)}; "
                f"Комментарий: {(data.comment or 'Клиент запросил закрытие счета').strip()}"
            ),
            status="Создан",
            created_at=now_str(),
        )
        db.add(request_item)
        db.commit()
        db.refresh(request_item)

        create_notification(
            db,
            user.id,
            "Запрос на закрытие счета",
            f"Запрос на закрытие счета {(normalize_text(account.account_name) or account.account_name)} передан в банк.",
        )

        return {
            "message": "Запрос на закрытие счета отправлен",
            "request_id": request_item.id,
        }
    finally:
        db.close()


@app.post("/accounts/{account_id}/credit-payment")
def pay_credit_account(
    account_id: int,
    data: CreditAccountPaymentRequest,
    authorization: Annotated[str | None, Header()] = None,
):
    require_same_vk(data.vk_id, authorization)
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == data.vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        credit_account = _get_user_account(db, user.id, account_id)
        if not credit_account:
            return {"error": "Счет не найден"}
        if not _is_credit_account(credit_account):
            return {"error": "Платеж доступен только для кредитных счетов"}
        _ensure_credit_metadata(db, user.id, credit_account)

        source_account = _get_user_account(db, user.id, data.from_account_id)
        if not source_account:
            return {"error": "Счет списания не найден"}
        if source_account.id == credit_account.id:
            return {"error": "Выберите другой счет списания"}
        if _is_credit_account(source_account):
            return {"error": "Для погашения долга нужен обычный счет, а не кредитный"}

        debt_amount = _credit_debt_amount(credit_account)
        if debt_amount <= 0:
            return {"error": "По этому счету нет задолженности"}

        payment_kind = (data.payment_kind or "").strip().lower()
        if payment_kind == "minimum":
            payment_amount = _minimum_credit_payment(credit_account)
            payment_title = f"Обязательный платеж по счету {normalize_text(credit_account.account_name) or credit_account.account_name}"
        elif payment_kind == "full":
            payment_amount = debt_amount
            payment_title = f"Полное погашение счета {normalize_text(credit_account.account_name) or credit_account.account_name}"
        else:
            return {"error": "Неизвестный тип платежа"}

        if source_account.balance < payment_amount:
            return {"error": "Недостаточно средств на счете списания"}

        source_account.balance -= payment_amount
        _, new_debt_amount = apply_credit_payment(
            available_balance=float(credit_account.balance or 0),
            debt_amount=debt_amount,
            payment_amount=payment_amount,
        )
        credit_account.credit_debt_amount = new_debt_amount
        current_due_date = _parse_due_date(getattr(credit_account, "credit_next_payment_due", None))
        if not current_due_date:
            current_due_date = datetime.now() + timedelta(days=15)
        credit_account.credit_next_payment_due = _format_due_date(
            datetime.combine(add_months(current_due_date.date(), 1), datetime.min.time())
        )

        current_dt = now_str()
        db.add(
            Operation(
                user_id=user.id,
                account_id=source_account.id,
                title=payment_title,
                amount=payment_amount,
                operation_type="expense",
                category="credit_payment",
                created_at=current_dt,
            )
        )
        db.add(
            Operation(
                user_id=user.id,
                account_id=credit_account.id,
                title=payment_title,
                amount=payment_amount,
                operation_type="expense",
                category="credit_payment",
                created_at=current_dt,
            )
        )
        db.commit()

        create_notification(
            db,
            user.id,
            "Платеж по кредиту выполнен",
            f"Со счета {(normalize_text(source_account.account_name) or source_account.account_name)} списано {payment_amount:.2f} ₽.",
        )

        return {
            "message": "Платеж по кредитному счету выполнен",
            "paid_amount": payment_amount,
            "remaining_debt": credit_account.credit_debt_amount,
        }
    finally:
        db.close()


@app.post("/cards/{card_id}/request-unblock")
def request_card_unblock(
    card_id: int,
    authorization: Annotated[str | None, Header()] = None,
):
    vk_id = decode_vk_id_from_authorization(authorization)
    db: Session = SessionLocal()
    try:
        card = db.query(Card).filter(Card.id == card_id).first()
        if not card:
            return {"error": "Карта не найдена"}

        owner = db.query(User).filter(User.id == card.user_id).first()
        if not owner or owner.vk_id != vk_id:
            raise HTTPException(status_code=403, detail="Карта принадлежит другому пользователю")

        safe_status = normalize_text(card.status) or ""
        if "Заблок" not in safe_status:
            return {"error": "Разблокировка доступна только для заблокированной карты"}

        existing = (
            db.query(ServiceRequest)
            .filter(
                ServiceRequest.user_id == owner.id,
                ServiceRequest.request_type == "Разблокировка карты",
                ServiceRequest.status.in_(["Создан", "В обработке"]),
                ServiceRequest.details.contains(card.card_number_mask),
            )
            .first()
        )
        if existing:
            return {"message": "Запрос на разблокировку уже создан", "request_id": existing.id}

        request_item = ServiceRequest(
            user_id=owner.id,
            request_type="Разблокировка карты",
            details=f"Карта: {card.card_number_mask}; Причина: пользователь запросил разблокировку.",
            status="Создан",
            created_at=now_str(),
        )
        db.add(request_item)
        db.commit()
        db.refresh(request_item)

        create_notification(
            db,
            owner.id,
            "Запрос на разблокировку",
            f"Запрос на разблокировку карты {card.card_number_mask} передан администратору.",
        )

        return {"message": "Запрос на разблокировку отправлен", "request_id": request_item.id}
    finally:
        db.close()


@app.post("/support/ai-message")
def send_ai_support_message(
    data: AISupportMessageCreate,
    authorization: Annotated[str | None, Header()] = None,
):
    require_same_vk(data.vk_id, authorization)
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == data.vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}
        return process_support_message(db, user, data.message)
    finally:
        db.close()


@app.get("/support/messages/{vk_id}")
def get_support_messages(vk_id: str, _: None = Depends(vk_path_guard)):
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        messages = (
            db.query(SupportMessage)
            .filter(SupportMessage.user_id == user.id)
            .order_by(SupportMessage.id)
            .all()
        )

        return [
            {
                "id": m.id,
                "sender_type": m.sender_type,
                "sender_label": {
                    "user": "Вы",
                    "ai": "AI-помощник",
                    "admin": "Оператор",
                    "system": "Система",
                }.get(m.sender_type, "Сообщение"),
                "message": normalize_text(m.message) or m.message,
                "created_at": m.created_at,
            }
            for m in messages
        ]
    finally:
        db.close()


@app.post("/service-requests")
def create_service_request(
    data: ServiceRequestCreate,
    authorization: Annotated[str | None, Header()] = None,
):
    require_same_vk(data.vk_id, authorization)
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == data.vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        new_request = ServiceRequest(
            user_id=user.id,
            request_type=data.request_type,
            details=data.details,
            status="Создан",
            created_at=now_str(),
        )

        db.add(new_request)
        db.commit()
        db.refresh(new_request)

        create_notification(
            db,
            user.id,
            "Сервисный запрос",
            f"Создан запрос типа «{new_request.request_type}».",
        )

        notify_user(
            user.vk_id,
            f"🧰 Создан сервисный запрос\nТип: {new_request.request_type}\nСтатус: {new_request.status}"
        )

        return {
            "message": "Запрос успешно создан",
            "request": {
                "id": new_request.id,
                "request_type": new_request.request_type,
                "details": new_request.details,
                "status": new_request.status,
                "created_at": new_request.created_at,
            },
        }
    finally:
        db.close()


@app.get("/users/{vk_id}/service-requests")
def get_user_service_requests(vk_id: str, _: None = Depends(vk_path_guard)):
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        requests_list = (
            db.query(ServiceRequest)
            .filter(ServiceRequest.user_id == user.id)
            .order_by(ServiceRequest.id.desc())
            .all()
        )

        return [
            {
                "id": req.id,
                "request_type": req.request_type,
                "details": req.details,
                "status": req.status,
                "created_at": req.created_at,
            }
            for req in requests_list
        ]
    finally:
        db.close()


# =========================
# ADMIN API
# =========================

@app.get("/admin/stats", dependencies=[Depends(verify_admin_key)])
def admin_get_stats():
    db: Session = SessionLocal()
    try:
        users_count = db.query(User).count()
        accounts_count = db.query(Account).count()
        cards_count = db.query(Card).count()
        operations_count = db.query(Operation).count()
        applications_count = db.query(Application).count()
        service_requests_count = db.query(ServiceRequest).count()
        support_messages_count = db.query(SupportMessage).count()
        ai_messages_count = db.query(SupportMessage).filter(SupportMessage.sender_type == "ai").count()
        ai_escalations_count = db.query(ServiceRequest).filter(ServiceRequest.request_type.like("AI:%")).count()

        total_balance = sum(item.balance for item in db.query(Account).all())

        pending_applications = db.query(Application).filter(Application.status == "На рассмотрении").count()
        approved_applications = db.query(Application).filter(Application.status == "Одобрено").count()
        rejected_applications = db.query(Application).filter(Application.status == "Отклонено").count()

        requests_created = db.query(ServiceRequest).filter(ServiceRequest.status == "Создан").count()
        requests_in_progress = db.query(ServiceRequest).filter(ServiceRequest.status == "В обработке").count()
        requests_done = db.query(ServiceRequest).filter(ServiceRequest.status == "Выполнен").count()
        requests_rejected = db.query(ServiceRequest).filter(ServiceRequest.status == "Отклонен").count()

        return {
            "users_count": users_count,
            "accounts_count": accounts_count,
            "cards_count": cards_count,
            "operations_count": operations_count,
            "applications_count": applications_count,
            "service_requests_count": service_requests_count,
            "support_messages_count": support_messages_count,
            "ai_messages_count": ai_messages_count,
            "ai_escalations_count": ai_escalations_count,
            "total_balance": total_balance,
            "pending_applications": pending_applications,
            "approved_applications": approved_applications,
            "rejected_applications": rejected_applications,
            "requests_created": requests_created,
            "requests_in_progress": requests_in_progress,
            "requests_done": requests_done,
            "requests_rejected": requests_rejected,
        }
    finally:
        db.close()


@app.get("/admin/users", dependencies=[Depends(verify_admin_key)])
def admin_get_users():
    db: Session = SessionLocal()
    try:
        users = db.query(User).order_by(User.id.desc()).all()
        result = []

        for user in users:
            accounts_count = db.query(Account).filter(Account.user_id == user.id).count()
            cards_count = db.query(Card).filter(Card.user_id == user.id).count()
            applications_count = db.query(Application).filter(Application.user_id == user.id).count()

            result.append(
                {
                    "id": user.id,
                    "vk_id": user.vk_id,
                    "full_name": normalize_text(user.full_name),
                    "phone": user.phone,
                    "created_at": user.created_at,
                    "accounts_count": accounts_count,
                    "cards_count": cards_count,
                    "applications_count": applications_count,
                }
            )

        return result
    finally:
        db.close()


@app.get("/admin/users/{vk_id}/full", dependencies=[Depends(verify_admin_key)])
def admin_get_user_full(vk_id: str):
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        accounts = db.query(Account).filter(Account.user_id == user.id).all()
        cards = db.query(Card).filter(Card.user_id == user.id).all()
        applications = db.query(Application).filter(Application.user_id == user.id).order_by(Application.id.desc()).all()
        requests_list = db.query(ServiceRequest).filter(ServiceRequest.user_id == user.id).order_by(ServiceRequest.id.desc()).all()
        operations = db.query(Operation).filter(Operation.user_id == user.id).order_by(Operation.id.desc()).limit(12).all()
        support_messages = db.query(SupportMessage).filter(SupportMessage.user_id == user.id).order_by(SupportMessage.id.desc()).limit(20).all()

        return {
            "user": {
                "id": user.id,
                "vk_id": user.vk_id,
                "full_name": normalize_text(user.full_name),
                "phone": user.phone,
                "created_at": user.created_at,
            },
            "accounts": [
                {
                    "id": acc.id,
                    "account_name": acc.account_name,
                    "balance": acc.balance,
                    "currency": acc.currency,
                    "status": acc.status,
                }
                for acc in accounts
            ],
            "cards": [
                {
                    "id": card.id,
                    "account_id": card.account_id,
                    "card_name": normalize_text(card.card_name),
                    "card_number_mask": card.card_number_mask,
                    "cvv_code": card.cvv_code,
                    "status": normalize_text(card.status),
                    "expiry_date": card.expiry_date,
                    "linked_account_name": normalize_text(card.account.account_name) if card.account else "",
                }
                for card in cards
            ],
            "applications": [
                {
                    "id": app_item.id,
                    "product_type": app_item.product_type,
                    "details": app_item.details,
                    "status": app_item.status,
                    "created_at": app_item.created_at,
                }
                for app_item in applications
            ],
            "service_requests": [
                {
                    "id": req.id,
                    "request_type": req.request_type,
                    "details": req.details,
                    "status": req.status,
                    "created_at": req.created_at,
                }
                for req in requests_list
            ],
            "operations": [
                {
                    "id": item.id,
                    "title": normalize_text(item.title),
                    "amount": item.amount,
                    "operation_type": item.operation_type,
                    "category": item.category,
                    "created_at": item.created_at,
                }
                for item in operations
            ],
            "support_messages": [
                {
                    "id": item.id,
                    "sender_type": item.sender_type,
                    "message": normalize_text(item.message) or item.message,
                    "created_at": item.created_at,
                }
                for item in support_messages
            ],
        }
    finally:
        db.close()


@app.post("/support/messages/{vk_id}/clear")
def clear_support_messages(
    vk_id: str,
    authorization: Annotated[str | None, Header()] = None,
):
    require_same_vk(vk_id, authorization)
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        db.query(SupportMessage).filter(SupportMessage.user_id == user.id).delete()
        db.commit()
        return {"message": "Чат поддержки очищен"}
    finally:
        db.close()


@app.post("/topup")
def top_up_account(
    data: TopUpRequest,
    authorization: Annotated[str | None, Header()] = None,
):
    require_same_vk(data.vk_id, authorization)
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == data.vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        account = _get_user_account(db, user.id, data.account_id)
        if not account:
            return {"error": "Счет зачисления не найден"}

        if normalize_text(account.status) == "Заблокирован":
            return {"error": "Счет зачисления заблокирован"}

        account.balance += data.amount
        db.add(
            Operation(
                user_id=user.id,
                account_id=account.id,
                title=f"Пополнение счета из источника {data.source}",
                amount=data.amount,
                operation_type="income",
                category="topup",
                created_at=now_str(),
            )
        )
        db.commit()

        create_notification(
            db,
            user.id,
            "Пополнение счета",
            f"Счет «{account.account_name}» пополнен на {data.amount:.2f} ₽.",
        )

        return {"message": "Счет успешно пополнен", "new_balance": account.balance}
    finally:
        db.close()


@app.post("/service-payment")
def create_service_payment(
    data: ServicePaymentRequest,
    authorization: Annotated[str | None, Header()] = None,
):
    require_same_vk(data.vk_id, authorization)
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == data.vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        account = _get_user_account(db, user.id, data.from_account_id)
        if not account:
            return {"error": "Счет списания не найден"}

        if normalize_text(account.status) == "Заблокирован":
            return {"error": "Счет списания заблокирован"}

        if account.balance < data.amount:
            return {"error": "Недостаточно средств"}

        _debit_account_balance(db, user.id, account, data.amount)
        db.add(
            Operation(
                user_id=user.id,
                account_id=account.id,
                title=f"Оплата услуги {data.provider}",
                amount=data.amount,
                operation_type="expense",
                category="services",
                created_at=now_str(),
            )
        )
        db.commit()

        create_notification(
            db,
            user.id,
            "Оплата услуги",
            f"Платеж {data.provider} на сумму {data.amount:.2f} ₽ выполнен.",
        )

        return {"message": "Платеж выполнен", "new_balance": account.balance}
    finally:
        db.close()


@app.get("/admin/applications", dependencies=[Depends(verify_admin_key)])
def admin_get_applications():
    db: Session = SessionLocal()
    try:
        applications = db.query(Application).order_by(Application.id.desc()).all()
        result = []

        for app_item in applications:
            user = db.query(User).filter(User.id == app_item.user_id).first()
            result.append(
                {
                    "id": app_item.id,
                    "product_type": app_item.product_type,
                    "details": app_item.details,
                    "status": app_item.status,
                    "created_at": app_item.created_at,
                    "user_full_name": normalize_text(user.full_name) if user else "",
                    "user_vk_id": user.vk_id if user else "",
                }
            )

        return result
    finally:
        db.close()


@app.post("/admin/applications/{application_id}/approve", dependencies=[Depends(verify_admin_key)])
def admin_approve_application(application_id: int):
    db: Session = SessionLocal()
    try:
        application = db.query(Application).filter(Application.id == application_id).first()

        if not application:
            return {"error": "Заявка не найдена"}

        if application.status != "На рассмотрении":
            return {"error": "Заявка уже обработана"}

        user = db.query(User).filter(User.id == application.user_id).first()

        if not user:
            return {"error": "Пользователь не найден"}

        application.status = "Одобрено"
        db.commit()

        # --- ДЕБЕТОВАЯ КАРТА ---
        if application.product_type == "Дебетовая карта":
            account = _get_primary_account(db, user.id)
            if not account:
                account = Account(
                    user_id=user.id,
                    account_name="Основной счет",
                    balance=0.0,
                    currency="RUB",
                    status="Активен",
                )
                db.add(account)
                db.commit()
                db.refresh(account)

            full_card_number = generate_card_number()
            card = Card(
                user_id=user.id,
                account_id=account.id,
                card_name="Дебетовая карта",
                card_number_mask=format_card_mask(full_card_number),
                full_card_number=full_card_number,
                cvv_code=generate_cvv_code(),
                payment_system="МИР",
                expiry_date="12/30",
                status="Активна",
            )
            db.add(card)
            db.commit()

        # --- ВКЛАД ---
        elif application.product_type == "Вклад":
            deposit_account = Account(
                user_id=user.id,
                account_name="Вклад",
                balance=0.0,
                currency="RUB",
                status="Активен",
            )
            db.add(deposit_account)
            db.commit()

        # --- КРЕДИТ ---
        elif application.product_type == "Кредит":
            import re

            normalized_details = normalize_text(application.details) or application.details
            amount_match = re.search(r"Сумма кредита: (\d+(?:\.\d+)?)", normalized_details)
            credit_amount = float(amount_match.group(1)) if amount_match else 0.0
            term_match = re.search(r"Срок кредита: (\d+)", normalized_details)
            credit_term_months = int(term_match.group(1)) if term_match else 12

            credit_account = Account(
                user_id=user.id,
                account_name="Кредитный счет",
                balance=credit_amount,
                credit_original_amount=credit_amount,
                credit_debt_amount=credit_amount,
                credit_term_months=credit_term_months,
                credit_next_payment_due=_format_due_date(datetime.now() + timedelta(days=15)),
                currency="RUB",
                status="Активен",
            )
            db.add(credit_account)
            db.commit()
            db.refresh(credit_account)

            if credit_amount > 0:
                credit_operation = Operation(
                    user_id=user.id,
                    account_id=credit_account.id,
                    title="Зачисление кредитных средств",
                    amount=credit_amount,
                    operation_type="income",
                    category="topup",
                    created_at=now_str(),
                )
                db.add(credit_operation)
                db.commit()

        # --- ИПОТЕКА ---
        elif application.product_type == "Ипотека":
            import re

            amount_match = re.search(r"Стоимость/сумма: (\d+(?:\.\d+)?)", application.details)
            mortgage_amount = float(amount_match.group(1)) if amount_match else 0.0

            mortgage_account = Account(
                user_id=user.id,
                account_name="Ипотечный счет",
                balance=mortgage_amount,
                credit_original_amount=mortgage_amount,
                credit_debt_amount=mortgage_amount,
                credit_term_months=240,
                credit_next_payment_due=_format_due_date(datetime.now() + timedelta(days=15)),
                currency="RUB",
                status="Активен",
            )
            db.add(mortgage_account)
            db.commit()
            db.refresh(mortgage_account)

            if mortgage_amount > 0:
                mortgage_operation = Operation(
                    user_id=user.id,
                    account_id=mortgage_account.id,
                    title="Зачисление ипотечных средств",
                    amount=mortgage_amount,
                    operation_type="income",
                    category="topup",
                    created_at=now_str(),
                )
                db.add(mortgage_operation)
                db.commit()

        create_notification(
            db,
            user.id,
            "Заявка одобрена",
            f"Ваша заявка на продукт «{application.product_type}» одобрена.",
        )

        notify_user(
            user.vk_id,
            f"✅ Ваша заявка одобрена\nПродукт: {application.product_type}"
        )

        return {"message": "Заявка одобрена"}
    finally:
        db.close()

@app.post("/admin/applications/{application_id}/reject", dependencies=[Depends(verify_admin_key)])
def admin_reject_application(application_id: int):
    db: Session = SessionLocal()
    try:
        application = db.query(Application).filter(Application.id == application_id).first()
        if not application:
            return {"error": "Заявка не найдена"}

        user = db.query(User).filter(User.id == application.user_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        if application.status == "Отклонено":
            return {"message": "Заявка уже была отклонена"}

        if application.status == "Одобрено":
            return {"message": "Одобренная заявка не может быть отклонена"}

        application.status = "Отклонено"
        db.commit()

        create_notification(
            db,
            user.id,
            "Заявка отклонена",
            f"Ваша заявка на продукт «{application.product_type}» отклонена.",
        )

        notify_user(
            user.vk_id,
            f"❌ Ваша заявка отклонена\nПродукт: {application.product_type}"
        )

        return {"message": "Заявка отклонена"}
    finally:
        db.close()


@app.get("/admin/service-requests", dependencies=[Depends(verify_admin_key)])
def admin_get_service_requests():
    db: Session = SessionLocal()
    try:
        requests_list = db.query(ServiceRequest).order_by(ServiceRequest.id.desc()).all()
        result = []

        for req in requests_list:
            user = db.query(User).filter(User.id == req.user_id).first()
            result.append(
                {
                    "id": req.id,
                    "request_type": req.request_type,
                    "details": req.details,
                    "status": req.status,
                    "created_at": req.created_at,
                    "user_full_name": normalize_text(user.full_name) if user else "",
                    "user_vk_id": user.vk_id if user else "",
                }
            )

        return result
    finally:
        db.close()


@app.get("/admin/support-messages", dependencies=[Depends(verify_admin_key)])
def admin_get_support_messages():
    db: Session = SessionLocal()
    try:
        messages = db.query(SupportMessage).order_by(SupportMessage.id.desc()).limit(120).all()
        result = []
        for item in messages:
            user = db.query(User).filter(User.id == item.user_id).first()
            result.append(
                {
                    "id": item.id,
                    "sender_type": item.sender_type,
                    "message": normalize_text(item.message) or item.message,
                    "created_at": item.created_at,
                    "user_full_name": normalize_text(user.full_name) if user else "",
                    "user_vk_id": user.vk_id if user else "",
                }
            )
        return result
    finally:
        db.close()


@app.post("/admin/users/{vk_id}/support-reply", dependencies=[Depends(verify_admin_key)])
def admin_send_support_reply(vk_id: str, data: AdminSupportReply):
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        reply = store_support_message(db, user.id, "admin", data.message)

        create_notification(
            db,
            user.id,
            "Ответ поддержки",
            "Оператор ответил на ваше обращение в чате поддержки.",
        )

        notify_user(
            user.vk_id,
            f"💬 Оператор поддержки ответил:\n{normalize_text(data.message) or data.message}",
        )

        return {
            "message": "Ответ отправлен",
            "support_message": {
                "id": reply.id,
                "sender_type": reply.sender_type,
                "message": normalize_text(reply.message) or reply.message,
                "created_at": reply.created_at,
            },
        }
    finally:
        db.close()


@app.post("/admin/cards/{card_id}/unblock", dependencies=[Depends(verify_admin_key)])
def admin_unblock_card(card_id: int):
    db: Session = SessionLocal()
    try:
        card = db.query(Card).filter(Card.id == card_id).first()
        if not card:
            return {"error": "Карта не найдена"}

        card.status = "Активна"

        related_request = (
            db.query(ServiceRequest)
            .filter(
                ServiceRequest.request_type == "Разблокировка карты",
                ServiceRequest.details.contains(card.card_number_mask),
                ServiceRequest.status.in_(["Создан", "В обработке"]),
            )
            .order_by(ServiceRequest.id.desc())
            .first()
        )
        if related_request:
            related_request.status = "Выполнен"

        db.commit()

        user = db.query(User).filter(User.id == card.user_id).first()
        if user:
            create_notification(
                db,
                user.id,
                "Карта разблокирована",
                f"Карта {card.card_number_mask} снова активна и готова к оплате.",
            )

        return {"message": "Карта разблокирована", "card_id": card.id, "status": normalize_text(card.status)}
    finally:
        db.close()


@app.post("/admin/service-requests/{request_id}/status", dependencies=[Depends(verify_admin_key)])
def admin_update_service_request_status(request_id: int, data: AdminServiceRequestStatusUpdate):
    db: Session = SessionLocal()
    try:
        req = db.query(ServiceRequest).filter(ServiceRequest.id == request_id).first()
        if not req:
            return {"error": "Запрос не найден"}

        user = db.query(User).filter(User.id == req.user_id).first()
        req.status = data.status

        normalized_type = normalize_text(req.request_type) or req.request_type or ""
        normalized_status = normalize_text(data.status) or data.status or ""
        if normalized_type == "Закрытие счета" and normalized_status == "Выполнен" and user:
            account_number = _extract_account_number_from_request(req.details)
            if not account_number:
                return {"error": "Не удалось определить счет в запросе"}

            account = (
                db.query(Account)
                .filter(Account.user_id == user.id)
                .filter(Account.id == int(account_number[-12:]))
                .first()
            )
            if not account:
                return {"error": "Счет для закрытия не найден"}

            primary_account = _get_primary_account(db, user.id)
            if _is_credit_account(account):
                _ensure_credit_metadata(db, user.id, account)
            if primary_account and account.id == primary_account.id:
                return {"error": "Основной счет нельзя закрыть"}
            if _is_credit_account(account) and _credit_debt_amount(account) > 0:
                return {"error": "Нельзя закрыть кредитный счет с задолженностью"}

            db.delete(account)

        db.commit()

        if user:
            create_notification(
                db,
                user.id,
                "Статус сервисного запроса",
                f"Запрос «{req.request_type}» обновлен: {req.status}.",
            )
            notify_user(
                user.vk_id,
                f"🧰 Статус запроса обновлен\nТип: {req.request_type}\nСтатус: {req.status}"
            )

        return {"message": "Статус сервисного запроса обновлен"}
    finally:
        db.close()


@app.post("/admin/users/{vk_id}/add-balance", dependencies=[Depends(verify_admin_key)])
def admin_add_balance(vk_id: str, data: AdminBalanceTopUp):
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        if data.amount <= 0:
            return {"error": "Сумма должна быть больше нуля"}

        account = db.query(Account).filter(Account.user_id == user.id).first()
        if not account:
            return {"error": "Счет пользователя не найден"}

        account.balance += data.amount

        operation = Operation(
            user_id=user.id,
            account_id=account.id,
            title=data.comment,
            amount=data.amount,
            operation_type="income",
            category="topup",
            created_at=now_str(),
        )
        db.add(operation)
        db.commit()

        create_notification(
            db,
            user.id,
            "Пополнение баланса",
            f"Администратор зачислил {data.amount:.2f} ₽ на ваш счет.",
        )

        notify_user(
            user.vk_id,
            f"💰 Баланс пополнен\nСумма: {data.amount:.2f} ₽\nКомментарий: {data.comment}"
        )

        return {
            "message": "Баланс успешно пополнен",
            "new_balance": account.balance,
        }
    finally:
        db.close()
