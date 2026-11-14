"""Reply parsing and stats accounting.

Kept free of any Discord imports so it can be unit-tested in isolation.
"""

from __future__ import annotations

import re

from . import store

_NUM = r"([\d,]+)"

# A custom Discord emoji, e.g. <:Coin:123> or <a:Coin:123>.
_EMOJI = r"<a?:[A-Za-z0-9_]+:\d+>"

# Amount that follows a label, e.g. "Wallet: 1,234", "**Wallet** 1,234" or
# "Wallet <:Coin:1> 1,234". The label may be separated from the number by a
# Discord emoji, which is why the gap is "anything that is not a digit".
_LABEL_AMOUNT = re.compile(
    r"(?:{label})[^\d\n]{{0,32}}?{num}".format(label=r"(?:wallet|cash|purse|bank)", num=_NUM),
    re.IGNORECASE,
)

# Amount that follows a coin/bank emoji, e.g. "<:Coin:1> 750" or "💰 750".
_EMOJI_AMOUNT = re.compile(rf"(?:{_EMOJI}|\U0001f4b0|\U0001f3e6)\s*{_NUM}")

# Loot lines come in several shapes; real Dank Memer replies put a custom emoji
# between the number and the name:
#   "**1** <:Frog:123> Frog, **2** <:Snake:456> Snake"
#   "**1** 🐸 Frog, **2** 🐍 Snake"
#   "You caught a **Frog**!"
_LOOT_ITEM = re.compile(rf"\*\*\s*\d+\s*\*\*[^\S\n]*(?:{_EMOJI}|\S{{1,4}})?[^\S\n]*([^\n,*]+)")
_NAMED_LOOT = re.compile(r"\*\*([A-Za-z][A-Za-z0-9' \-]*?)\*\*")
# A plain "<verb> a Frog" line with no bold markup.
_PLAIN_LOOT = re.compile(
    r"(?:caught|found|dug up|picked up|obtained)[^\S\n]+a[n]? ([A-Za-z][A-Za-z0-9' \-]{1,30})",
    re.IGNORECASE,
)

# Wording that means the command failed or was on cooldown; such a reply must
# never be counted as loot or as a balance.
_FAILURE = re.compile(
    r"cooldown|you don'?t have|not enough|you can'?t|you need|"
    r"you'?re too|failed|better luck next time|try again|no luck|"
    r"you already|nothing to|you have no|are you sure|"
    r"you must wait|slow down|you are being|ratelimit|rate limit",
    re.IGNORECASE,
)


def _clean_name(raw: str) -> str:
    # Drop custom emoji tokens entirely, then strip remaining symbols.
    text = re.sub(_EMOJI, " ", str(raw))
    cleaned = re.sub(r"[^\w\s'\-]", " ", text)
    return re.sub(r"\s+", " ", cleaned).strip()


def is_failure(content: str) -> bool:
    """True when a reply is a cooldown / refusal rather than a result."""
    return bool(_FAILURE.search(str(content or "")))


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


def parse_loot(content: str, kind: str | None = None) -> dict[str, list[str]]:
    """Splits a hunt/dig reply into animals and items.

    ``kind`` (``"hunt"`` or ``"dig"``) decides which bucket the names go into;
    without it, the wording of the reply is used as a fallback.
    """
    text = str(content or "")
    if is_failure(text):
        return {"animals": [], "items": []}
    is_animal = kind == "hunt" if kind in {"hunt", "dig"} else bool(
        re.search(r"caught|hunting|hunt", text, re.IGNORECASE)
    )
    names: list[str] = []
    for match in _LOOT_ITEM.finditer(text):
        name = _clean_name(match.group(1))
        if name:
            names.append(name)
    if not names:
        for match in _NAMED_LOOT.finditer(text):
            name = _clean_name(match.group(1))
            # Skip the "**1**" numbering and headers like "**Hunt**".
            if name and not name.isdigit() and name.lower() not in {"hunt", "dig", "search", "fish"}:
                names.append(name)
    if not names:
        for match in _PLAIN_LOOT.finditer(text):
            name = _clean_name(match.group(1))
            if name:
                names.append(name)
    if is_animal:
        return {"animals": names, "items": []}
    return {"animals": [], "items": names}


def classify_reply(command: str, content: str) -> str:
    """Maps a command + reply to one of: balance, hunt, dig, coin, other."""
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
    # Any other reply that still contains a coin figure counts as a coin gain.
    if re.search(r"\d[\d,]*\s*(?:coins?|<:coin:)", text) or _EMOJI_AMOUNT.search(text):
        return "coin"
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

    # A cooldown / refusal reply is not a result: count it as a failure and
    # change nothing else, so the numbers cannot be inflated by error text.
    if is_failure(content):
        entry["failures"] = entry.get("failures", 0) + 1
        store.save_stats(data)
        return entry

    if kind == "balance":
        coins = parse_coins(content)
        total = coins["wallet"] + coins["bank"]
        # Track a high-water mark so spending does not lower lifetime earnings.
        if total > entry.get("lastTotal", 0):
            entry["coins"] = entry.get("coins", 0) + (total - entry.get("lastTotal", 0))
        if total > 0:
            entry["lastTotal"] = total
    elif kind == "coin":
        # A direct "you earned 500 coins" style reply.
        gained = _first(re.compile(rf"{_NUM}\s*(?:coins?|<\S+>)"), content)
        if not gained:
            gained = _first(_EMOJI_AMOUNT, content)
        if gained:
            entry["coins"] = entry.get("coins", 0) + gained
            # Advance the balance baseline by the same amount, otherwise the
            # next balance check would count this gain a second time.
            entry["lastTotal"] = entry.get("lastTotal", 0) + gained
    elif kind == "hunt":
        animals = parse_loot(content, "hunt")["animals"]
        entry["animals"] = entry.get("animals", 0) + len(animals)
        entry["catches"] = entry.get("catches", 0) + len(animals)
    elif kind == "dig":
        items = parse_loot(content, "dig")["items"]
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
