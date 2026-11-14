"""Reply parsing and stats accounting.

Kept free of any Discord imports so it can be unit-tested in isolation.
"""

from __future__ import annotations

import re

from . import store

_NUM = r"([\d,]+)"

# Amount that follows a label, e.g. "Wallet: 1,234" or "**Wallet** 1,234".
_LABEL_AMOUNT = re.compile(
    r"(?:{label})[^0-9\n]{{0,24}}?{num}".format(label=r"(?:wallet|cash|purse|bank)", num=_NUM),
    re.IGNORECASE,
)

# Amount that follows a coin/bank emoji.
_EMOJI_AMOUNT = re.compile(
    rf"(?:<a?:[A-Za-z0-9_]+:\d+>|\U0001f4b0|\U0001f3e6)\s*{_NUM}",
)

# Loot lines come in two shapes:
#   numbered: "**1** 🐸 Frog, **2** 🐍 Snake"
#   bold-name: "**Frog**"
_NUMBERED_LOOT = re.compile(r"\*\*\s*\d+\s*\*\*\s*([^,*\n]+)")
_NAMED_LOOT = re.compile(r"\*\*([A-Za-z][A-Za-z0-9' \-]*?)\*\*")


def _clean_name(raw: str) -> str:
    # Strip emoji/symbols and surrounding whitespace, leaving the word.
    cleaned = re.sub(r"[^\w\s'\-]", " ", str(raw))
    return re.sub(r"\s+", " ", cleaned).strip()


def _to_int(raw: str) -> int:
    try:
        return int(str(raw).replace(",", ""))
    except (TypeError, ValueError):
        return 0


def _first(pattern: re.Pattern[str], text: str) -> int:
    match = pattern.search(text)
    return _to_int(match.group(1)) if match else 0


def parse_coins(content: str) -> dict[str, int]:
    """Extracts ``{wallet, bank}`` from a balance reply (0 when absent)."""
    text = str(content or "")
    wallet = 0
    bank = 0
    for match in _LABEL_AMOUNT.finditer(text):
        label = match.group(0).lower()
        value = _to_int(match.group(1))
        if "bank" in label:
            bank = bank or value
        else:
            wallet = wallet or value
    if not wallet:
        wallet = _first(_EMOJI_AMOUNT, text)
    if not bank and re.search(r"bank", text, re.IGNORECASE):
        bank = _first(_EMOJI_AMOUNT, text)
    return {"wallet": wallet, "bank": bank}


def parse_loot(content: str) -> dict[str, list[str]]:
    """Splits a hunt/dig reply into animals and items."""
    text = str(content or "")
    is_animal = bool(re.search(r"caught|hunting|hunt", text, re.IGNORECASE))
    names: list[str] = []
    for match in _NUMBERED_LOOT.finditer(text):
        name = _clean_name(match.group(1))
        if name:
            names.append(name)
    if not names:
        for match in _NAMED_LOOT.finditer(text):
            name = _clean_name(match.group(1))
            if name and not name.isdigit():
                names.append(name)
    if is_animal:
        return {"animals": names, "items": []}
    return {"animals": [], "items": names}


def classify_reply(command: str, content: str) -> str:
    """Maps a command + reply to one of: balance, hunt, dig, other."""
    cmd = str(command or "").lower()
    if "bal" in cmd:
        return "balance"
    if "hunt" in cmd:
        return "hunt"
    if any(word in cmd for word in ("dig", "search", "fish")):
        return "dig"
    text = str(content or "").lower()
    if re.search(r"wallet|bank|cash|coins? you have", text):
        return "balance"
    if re.search(r"caught|hunting", text):
        return "hunt"
    if re.search(r"found|dug|digging", text):
        return "dig"
    return "other"


def initialize_stats(token: str, username: str | None = None) -> None:
    data = store.load_stats()
    entry = data["stats"].get(token)
    if entry is None:
        data["stats"][token] = store.blank_stats(username or "unknown")
        store.save_stats(data)
    elif username and entry.get("name") != username:
        entry["name"] = username
        store.save_stats(data)


def apply_stats(token: str, kind: str, content: str) -> dict | None:
    """Folds a reply into the token's running totals. Returns the entry."""
    data = store.load_stats()
    entry = data["stats"].get(token)
    if entry is None:
        return None

    if kind == "balance":
        coins = parse_coins(content)
        total = coins["wallet"] + coins["bank"]
        # Track a high-water mark so spending does not lower lifetime earnings.
        if total > entry.get("lastTotal", 0):
            entry["coins"] = entry.get("coins", 0) + (total - entry.get("lastTotal", 0))
        if total > 0:
            entry["lastTotal"] = total
    elif kind == "hunt":
        animals = parse_loot(content)["animals"]
        entry["animals"] = entry.get("animals", 0) + len(animals)
        entry["catches"] = entry.get("catches", 0) + len(animals)
    elif kind == "dig":
        items = parse_loot(content)["items"]
        entry["items"] = entry.get("items", 0) + len(items)
        entry["catches"] = entry.get("catches", 0) + len(items)

    store.save_stats(data)
    return entry


def record_command(token: str) -> None:
    data = store.load_stats()
    entry = data["stats"].get(token)
    if entry is not None:
        entry["commands"] = entry.get("commands", 0) + 1
        store.save_stats(data)


def record_failure(token: str) -> None:
    data = store.load_stats()
    entry = data["stats"].get(token)
    if entry is not None:
        entry["failures"] = entry.get("failures", 0) + 1
        store.save_stats(data)
