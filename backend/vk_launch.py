"""Проверка подписи параметров запуска VK Mini Apps (официальный алгоритм VK)."""

from base64 import b64encode
from hashlib import sha256
from hmac import HMAC
from urllib.parse import urlencode


def is_valid_launch_sign(query: dict[str, str], secret: str) -> bool:
    if not query.get("sign"):
        return False

    vk_subset = sorted(filter(lambda key: key.startswith("vk_"), query))
    if not vk_subset:
        return False

    ordered = {k: query[k] for k in vk_subset}
    hash_code = b64encode(
        HMAC(secret.encode(), urlencode(ordered, doseq=True).encode(), sha256).digest()
    ).decode("utf-8")

    if hash_code[-1] == "=":
        hash_code = hash_code[:-1]

    fixed_hash = hash_code.replace("+", "-").replace("/", "_")
    return query.get("sign") == fixed_hash
