import re

import bcrypt
from fastapi import HTTPException

_PIN_RE = re.compile(r"^\d{4,6}$")


def normalize_pin(pin: str) -> str:
    return "".join(str(pin or "").split())


def assert_pin_format(pin: str) -> str:
    p = normalize_pin(pin)
    if not _PIN_RE.match(p):
        raise HTTPException(status_code=400, detail="PIN: только цифры, длина от 4 до 6")
    return p


def hash_pin(pin: str) -> str:
    p = assert_pin_format(pin).encode()
    return bcrypt.hashpw(p, bcrypt.gensalt(rounds=12)).decode()


def verify_pin(pin: str, pin_hash: str | None) -> bool:
    if not pin_hash:
        return False
    p = normalize_pin(pin)
    if not _PIN_RE.match(p):
        return False
    try:
        return bcrypt.checkpw(p.encode(), pin_hash.encode())
    except (ValueError, TypeError):
        return False
