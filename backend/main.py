import json
import os
from datetime import datetime
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
    recipient_phone: str = Field(min_length=10, max_length=20)
    amount: float = Field(gt=0, le=50_000_000)


class VkIdTransferPreviewRequest(BaseModel):
    sender_vk_id: str = Field(min_length=1, max_length=32)
    recipient_vk_id: str = Field(min_length=1, max_length=32)


class VkIdTransferCreate(BaseModel):
    sender_vk_id: str = Field(min_length=1, max_length=32)
    recipient_vk_id: str = Field(min_length=1, max_length=32)
    amount: float = Field(gt=0, le=50_000_000)


class SupportMessageCreate(BaseModel):
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


class InterbankTransferRequest(BaseModel):
    vk_id: str = Field(min_length=1, max_length=32)
    from_account_id: int = Field(ge=1)
    bank_name: str = Field(min_length=2, max_length=200)
    recipient_account_number: str = Field(min_length=5, max_length=34)
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


def mask_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = "".join(ch for ch in str(phone) if ch.isdigit())
    if len(digits) >= 4:
        return f"+7 *** *** {digits[-4:]}"
    return phone


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


def _execute_person_to_person_transfer(
    db: Session,
    sender: User,
    recipient: User,
    amount: float,
    sender_title: str,
    recipient_title: str,
) -> dict[str, Any]:
    sender_account = _get_primary_account(db, sender.id)
    recipient_account = _get_primary_account(db, recipient.id)

    if not sender_account or not recipient_account:
        return {"error": "Счет отправителя или получателя не найден"}

    if sender_account.balance < amount:
        return {"error": "Недостаточно средств"}

    sender_account.balance -= amount
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
    suffix = random.randint(1000, 9999)
    middle1 = random.randint(1000, 9999)
    middle2 = random.randint(1000, 9999)
    return f"2200{middle1}{middle2}{suffix}"


def format_card_mask(full_number: str) -> str:
    return f"{full_number[:4]} •••• •••• {full_number[-4:]}"


@app.get("/")
def read_root():
    return {"message": "Bank VK Mini App API работает"}


@app.get("/health")
def health_check():
    return {"status": "ok"}


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
def auth_vk(body: VkAuthRequest):
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

        full_card_number = "2200123412341234"
        new_card = Card(
            user_id=new_user.id,
            account_id=new_account.id,
            card_name="Основная карта",
            card_number_mask=format_card_mask(full_card_number),
            full_card_number=full_card_number,
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
def pin_verify(body: PinVerifyRequest):
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

            full_card_1 = "2200286923456789"
            card1 = Card(
                user_id=user1.id,
                account_id=account1.id,
                card_name="Основная карта",
                card_number_mask=format_card_mask(full_card_1),
                full_card_number=full_card_1,
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

            full_card_2 = "2200112234567890"
            card2 = Card(
                user_id=user2.id,
                account_id=account2.id,
                card_name="Основная карта",
                card_number_mask=format_card_mask(full_card_2),
                full_card_number=full_card_2,
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


@app.get("/users/{vk_id}/accounts")
def get_user_accounts(vk_id: str, _: None = Depends(vk_path_guard)):
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.vk_id == vk_id).first()
        if not user:
            return {"error": "Пользователь не найден"}

        accounts = db.query(Account).filter(Account.user_id == user.id).all()

        return [
            {
                "id": account.id,
                "account_name": normalize_text(account.account_name),
                "balance": account.balance,
                "currency": account.currency,
                "status": account.status,
            }
            for account in accounts
        ]
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

        cards = db.query(Card).filter(Card.user_id == user.id).all()

        return [
            {
                "id": card.id,
                "card_name": normalize_text(card.card_name),
                "card_number_mask": card.card_number_mask,
                "expiry_date": card.expiry_date,
                "payment_system": normalize_text(card.payment_system),
                "status": normalize_text(card.status),
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
            "expiry_date": card.expiry_date,
            "payment_system": normalize_text(card.payment_system),
            "status": normalize_text(card.status),
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

        return [
            {
                "id": operation.id,
                "title": humanize_operation_title(operation.title, operation.operation_type),
                "amount": operation.amount,
                "operation_type": operation.operation_type,
                "category": operation.category,
                "account_id": operation.account_id,
                "created_at": operation.created_at,
            }
            for operation in operations
        ]
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

        from_account.balance -= data.amount
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

        from_account.balance -= data.amount

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

        sender_account = db.query(Account).filter(Account.user_id == sender.id).first()
        recipient_account = db.query(Account).filter(Account.user_id == recipient.id).first()

        if not sender_account or not recipient_account:
            return {"error": "Счет отправителя или получателя не найден"}

        if sender_account.balance < transfer_data.amount:
            return {"error": "Недостаточно средств"}

        sender_account.balance -= transfer_data.amount
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

        return _execute_person_to_person_transfer(
            db,
            sender=sender,
            recipient=recipient,
            amount=transfer_data.amount,
            sender_title=f"Перевод по VK ID клиенту {recipient.full_name}",
            recipient_title=f"Перевод по VK ID от {sender.full_name}",
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

        new_message = SupportMessage(
            user_id=user.id,
            sender_type="user",
            message=data.message,
            created_at=now_str(),
        )

        db.add(new_message)
        db.commit()

        create_notification(
            db,
            user.id,
            "Сообщение в поддержку",
            "Ваше сообщение отправлено в поддержку.",
        )

        notify_user(
            user.vk_id,
            "💬 Ваше сообщение в поддержку отправлено."
        )

        return {"message": "Сообщение отправлено"}
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
                "message": m.message,
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
                    "card_name": normalize_text(card.card_name),
                    "card_number_mask": card.card_number_mask,
                    "status": normalize_text(card.status),
                    "expiry_date": card.expiry_date,
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
        }
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

            amount_match = re.search(r"Сумма кредита: (\d+(?:\.\d+)?)", application.details)
            credit_amount = float(amount_match.group(1)) if amount_match else 0.0

            credit_account = Account(
                user_id=user.id,
                account_name="Кредитный счет",
                balance=credit_amount,
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


@app.post("/admin/service-requests/{request_id}/status", dependencies=[Depends(verify_admin_key)])
def admin_update_service_request_status(request_id: int, data: AdminServiceRequestStatusUpdate):
    db: Session = SessionLocal()
    try:
        req = db.query(ServiceRequest).filter(ServiceRequest.id == request_id).first()
        if not req:
            return {"error": "Запрос не найден"}

        user = db.query(User).filter(User.id == req.user_id).first()
        req.status = data.status
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
