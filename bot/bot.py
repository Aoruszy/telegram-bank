import json
import os
import random
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import vk_api
from dotenv import load_dotenv
from vk_api.bot_longpoll import VkBotEventType, VkBotLongPoll
from vk_api.keyboard import VkKeyboard, VkKeyboardColor

load_dotenv()

VK_GROUP_ACCESS_TOKEN = os.getenv("VK_GROUP_ACCESS_TOKEN", "").strip()
VK_GROUP_ID_RAW = os.getenv("VK_GROUP_ID", "0").strip()
VK_APP_ID = os.getenv("VK_APP_ID", "").strip() or os.getenv("VITE_VK_APP_ID", "").strip() or "54499573"
BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8000").rstrip("/")
BOT_API_KEY = os.getenv("BOT_API_KEY", "").strip() or VK_GROUP_ACCESS_TOKEN


def app_url() -> str:
    return f"https://vk.com/app{VK_APP_ID}"


def make_keyboard() -> str:
    keyboard = VkKeyboard(one_time=False)
    keyboard.add_button("Открыть банк", color=VkKeyboardColor.PRIMARY)
    keyboard.add_button("Мои продукты", color=VkKeyboardColor.SECONDARY)
    keyboard.add_line()
    keyboard.add_button("Заявки", color=VkKeyboardColor.SECONDARY)
    keyboard.add_button("Поддержка", color=VkKeyboardColor.SECONDARY)
    keyboard.add_line()
    keyboard.add_button("Уведомления", color=VkKeyboardColor.SECONDARY)
    keyboard.add_button("Уведомления ВКЛ", color=VkKeyboardColor.POSITIVE)
    keyboard.add_button("Уведомления ВЫКЛ", color=VkKeyboardColor.NEGATIVE)
    return keyboard.get_keyboard()


def send_message(vk, user_id: int, message: str) -> None:
    vk.messages.send(
        user_id=user_id,
        random_id=random.randint(1, 2_147_000_000),
        message=message,
        keyboard=make_keyboard(),
    )


def backend_request(method: str, path: str, payload: dict | None = None) -> dict:
    body = None
    headers = {"X-Bot-Key": BOT_API_KEY}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = Request(f"{BACKEND_URL}{path}", data=body, headers=headers, method=method.upper())
    try:
        with urlopen(request, timeout=10) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="ignore")
        try:
            data = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            data = {}
        data["_http_status"] = exc.code
        return data
    except (URLError, TimeoutError, json.JSONDecodeError):
        return {"error": "Сервис банка временно недоступен"}


def fetch_summary(vk_id: str) -> dict:
    return backend_request("GET", f"/bot/users/{vk_id}/summary")


def update_notifications(vk_id: str, enabled: bool) -> dict:
    return backend_request("PATCH", f"/bot/users/{vk_id}/notifications", {"enabled": enabled})


def welcome_text() -> str:
    return (
        "Добро пожаловать в ZF Bank.\n\n"
        f"Откройте мини-приложение: {app_url()}\n\n"
        "Доступные команды:\n"
        "• Открыть банк\n"
        "• Мои продукты\n"
        "• Заявки\n"
        "• Поддержка\n"
        "• Уведомления\n"
        "• Уведомления ВКЛ\n"
        "• Уведомления ВЫКЛ"
    )


def products_text(summary: dict) -> str:
    if summary.get("error"):
        return (
            "Пока не удалось найти ваш профиль в банке.\n\n"
            f"Откройте мини-приложение и войдите в аккаунт: {app_url()}"
        )

    return (
        f"Ваши продукты, {summary.get('full_name', 'клиент')}:\n\n"
        f"• Счета: {summary.get('accounts_count', 0)}\n"
        f"• Карты: {summary.get('cards_count', 0)}\n"
        f"• Активные карты: {summary.get('active_cards_count', 0)}\n\n"
        f"Открыть банк: {app_url()}"
    )


def applications_text(summary: dict) -> str:
    if summary.get("error"):
        return (
            "Не удалось получить ваши заявки.\n\n"
            f"Откройте мини-приложение: {app_url()}"
        )

    applications = summary.get("applications") or []
    if not applications:
        return (
            "У вас пока нет активных заявок.\n\n"
            f"Оформить продукт можно здесь: {app_url()}"
        )

    lines = ["Последние заявки:\n"]
    for item in applications:
        product_type = item.get("product_type") or "Продукт"
        status = item.get("status") or "На рассмотрении"
        created_at = item.get("created_at") or ""
        lines.append(f"• {product_type} — {status} ({created_at})")
    lines.append(f"\nОткрыть банк: {app_url()}")
    return "\n".join(lines)


def support_text() -> str:
    return (
        "Поддержка доступна в мини-приложении.\n\n"
        "Там можно:\n"
        "• написать в чат\n"
        "• открыть сервисный запрос\n"
        "• посмотреть историю обращений\n\n"
        f"Открыть поддержку: {app_url()}"
    )


def notifications_text(summary: dict) -> str:
    if summary.get("error"):
        return "Не удалось проверить статус уведомлений."
    enabled = bool(summary.get("notifications_enabled"))
    return (
        "Уведомления сейчас "
        + ("включены." if enabled else "выключены.")
        + "\n\nИспользуйте команды:\n• Уведомления ВКЛ\n• Уведомления ВЫКЛ"
    )


def toggle_notifications_text(vk_id: str, enabled: bool) -> str:
    data = update_notifications(vk_id, enabled)
    if data.get("error"):
        return data["error"]
    current = bool(data.get("notifications_enabled"))
    return "Уведомления включены." if current else "Уведомления выключены."


def help_text() -> str:
    return (
        "Я могу помочь с быстрыми действиями банка.\n\n"
        "Команды:\n"
        "• Начать\n"
        "• Открыть банк\n"
        "• Мои продукты\n"
        "• Заявки\n"
        "• Поддержка\n"
        "• Уведомления\n"
        "• Уведомления ВКЛ\n"
        "• Уведомления ВЫКЛ"
    )


def handle_command(text: str, user_id: int) -> str:
    normalized = text.strip().lower()
    vk_id = str(user_id)

    if normalized in {"начать", "старт", "start", "/start"}:
        return welcome_text()
    if normalized in {"открыть банк", "банк", "мини приложение", "мини-приложение"}:
        return f"Открыть ZF Bank: {app_url()}"
    if normalized in {"мои продукты", "продукты", "счета", "карты"}:
        return products_text(fetch_summary(vk_id))
    if normalized in {"заявки", "мои заявки"}:
        return applications_text(fetch_summary(vk_id))
    if normalized in {"поддержка", "чат", "помощь"}:
        return support_text()
    if normalized in {"уведомления", "статус уведомлений"}:
        return notifications_text(fetch_summary(vk_id))
    if normalized in {"уведомления вкл", "включить уведомления", "уведомления on"}:
        return toggle_notifications_text(vk_id, True)
    if normalized in {"уведомления выкл", "выключить уведомления", "уведомления off"}:
        return toggle_notifications_text(vk_id, False)
    return help_text()


def main() -> None:
    if not VK_GROUP_ACCESS_TOKEN:
        print("VK_GROUP_ACCESS_TOKEN не задан")
        return

    try:
        group_id = int(VK_GROUP_ID_RAW)
    except ValueError:
        print("VK_GROUP_ID должен быть числом")
        return

    if group_id <= 0:
        print("VK_GROUP_ID не задан")
        return

    vk_session = vk_api.VkApi(token=VK_GROUP_ACCESS_TOKEN)
    vk = vk_session.get_api()
    retry_delay = 5

    while True:
        try:
            longpoll = VkBotLongPoll(vk_session, group_id=group_id)
            for event in longpoll.listen():
                if event.type != VkBotEventType.MESSAGE_NEW:
                    continue
                msg = event.message or {}
                from_id = msg.get("from_id")
                if not from_id or from_id < 0:
                    continue

                text = (msg.get("text") or "").strip()
                if not text:
                    continue

                try:
                    send_message(vk, from_id, handle_command(text, from_id))
                except Exception as exc:
                    print(f"messages.send: {exc}")
        except Exception as exc:
            print(f"longpoll.listen: {exc}; reconnect in {retry_delay}s")
            time.sleep(retry_delay)


if __name__ == "__main__":
    main()
