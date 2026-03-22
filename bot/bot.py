import os
import random

import vk_api
from vk_api.bot_longpoll import VkBotLongPoll, VkBotEventType
from dotenv import load_dotenv

load_dotenv()

VK_GROUP_ACCESS_TOKEN = os.getenv("VK_GROUP_ACCESS_TOKEN")
VK_GROUP_ID_RAW = os.getenv("VK_GROUP_ID", "0")


def main() -> None:
    if not VK_GROUP_ACCESS_TOKEN:
        print("VK_GROUP_ACCESS_TOKEN не задан")
        return

    try:
        group_id = int(VK_GROUP_ID_RAW)
    except ValueError:
        print("VK_GROUP_ID должен быть числом (ID сообщества)")
        return

    if group_id <= 0:
        print("VK_GROUP_ID не задан")
        return

    vk_session = vk_api.VkApi(token=VK_GROUP_ACCESS_TOKEN)
    vk = vk_session.get_api()
    longpoll = VkBotLongPoll(vk_session, group_id=group_id)

    for event in longpoll.listen():
        if event.type != VkBotEventType.MESSAGE_NEW:
            continue
        msg = event.message
        if not msg:
            continue
        from_id = msg.get("from_id")
        if not from_id or from_id < 0:
            continue

        text = (msg.get("text") or "").strip().lower()
        if text in ("начать", "start", "/start", "старт"):
            try:
                vk.messages.send(
                    user_id=from_id,
                    random_id=random.randint(1, 2_147_000_000),
                    message=(
                        "Добро пожаловать в VK Банк.\n\n"
                        "Откройте мини-приложение сообщества. "
                        "Сюда будут приходить уведомления о переводах, заявках и запросах."
                    ),
                )
            except Exception as e:
                print(f"messages.send: {e}")


if __name__ == "__main__":
    main()
