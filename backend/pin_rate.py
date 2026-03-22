import time
from collections import defaultdict

_window_sec = 900
_max_fails = 5

_fails: defaultdict[str, list[float]] = defaultdict(list)


def _prune(vk_id: str) -> list[float]:
    now = time.time()
    arr = [t for t in _fails[vk_id] if now - t < _window_sec]
    _fails[vk_id] = arr
    return arr


def is_pin_locked(vk_id: str) -> bool:
    return len(_prune(vk_id)) >= _max_fails


def record_pin_failure(vk_id: str) -> None:
    _fails[vk_id].append(time.time())
    _prune(vk_id)


def clear_pin_failures(vk_id: str) -> None:
    _fails.pop(vk_id, None)
