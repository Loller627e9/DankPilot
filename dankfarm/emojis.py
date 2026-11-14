"""Custom-emoji lookup with a unicode fallback.

A custom emoji string is only valid inside the guild that hosts it, so the raw
``<:name:id>`` form is only handed out when the caller confirms the target is
that guild. Everywhere else the unicode fallback is used, so an embed never
renders a broken ``:name:`` placeholder.
"""

from __future__ import annotations

from . import config, store

FALLBACK: dict[str, str] = {
    "dk_coin": "\U0001f4b0",      # 💰
    "dk_sparkle": "\u2728",       # ✨
    "dk_paw": "\U0001f43e",       # 🐾
    "dk_gift": "\U0001f381",      # 🎁
    "dk_cmds": "\u26a1",          # ⚡
    "dk_fail": "\u274c",          # ❌
    "dk_on": "\U0001f7e2",        # 🟢
    "dk_off": "\u26ab",           # ⚫
    "dk_farm": "\U0001f69c",      # 🚜
}

_cache: dict[str, str] = {}


def reload() -> None:
    """Re-read the uploaded-emoji map from disk."""
    global _cache
    data = store.read_json(config.EMOJIS_PATH, {})
    _cache = data if isinstance(data, dict) else {}


def get(name: str, in_guild: bool = True) -> str:
    if in_guild and name in _cache:
        return _cache[name]
    return FALLBACK.get(name, "")


def unicode(name: str) -> str:
    return FALLBACK.get(name, "")


def has_custom(name: str) -> bool:
    return name in _cache


def count_custom() -> int:
    return sum(1 for name in FALLBACK if name in _cache)


def save_custom(mapping: dict[str, str]) -> bool:
    global _cache
    _cache = dict(mapping)
    return store.write_json(config.EMOJIS_PATH, _cache)


reload()
