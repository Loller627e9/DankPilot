"""Reply parsing and stats accounting.

Kept free of any Discord imports so it can be unit-tested in isolation.

The regexes here are ported from the Node.js ``AssistanceBot`` that tracked
stats correctly, so the shapes they match are the ones Dank Memer actually
sends. The important one is :func:`extract_reply_text`: Dank Memer puts the
result inside an *embed* and ``message.content`` is usually empty, which is why
reading ``message.content`` alone recorded nothing.
"""

from __future__ import annotations

import re

from . import store

# A custom Discord emoji, e.g. <:Coin:123> or <a:Coin:123>.
_EMOJI = r"<a?:[A-Za-z0-9_]+:\d+>"

# Balance line: "<:Coin:123> 1,234" / "<:Bank:456> 5,000" (old working format).
_COIN_EMOJI = re.compile(r"<:Coin:.*?>\s*([\d,]+)")
_BANK_EMOJI = re.compile(r"<:Bank:.*?>\s*([\d,]+)")
# Last resort when the custom emoji is missing from the reply: the unicode coin.
_COIN_UNICODE = re.compile(r"\U0001f4b0\s*([\d,]+)")

# Amount that follows a label, e.g. "Wallet: 1,234" or "Bank 5,000". Kept as a
# fallback for replies that spell the label out instead of using an emoji.
_LABEL_AMOUNT = re.compile(r"(?:wallet|cash|purse|bank)[^\d\n]{0,32}?([\d,]+)", re.IGNORECASE)

# Loot line, exactly the old working shape:
#   "**1 <:Frog:123> Frog"  -> name is everything after the emoji, up to "*".
_LOOT_ITEM = re.compile(r"\*\*\d+ [<:a-zA-Z0-9]+:\d+> ([^\*\n]+)")
# The same but with a space between the number and its bold markers, which some
# replies use: "**1** <:Frog:123> Frog".
_LOOT_ITEM_SPACED = re.compile(r"\*\*\s*\d+\s*\*\*\s*(?:<a?:[A-Za-z0-9_]+:\d+>)?\s*([^\n,*]+)")
# Plain "<verb> a Frog" or "<verb> a **Frog**" with no numbering.
_PLAIN_LOOT = re.compile(
    r"(?:caught|found|dug up|picked up|obtained)[^\S\n]+a[n]? "
    r"\*{0,2}([A-Za-z][A-Za-z0-9' \-]{1,30}?)\*{0,2}(?=[\s.!?,]|$)",
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


def extract_reply_text(message) -> str:
    """Flattens a Discord message into plain text.

    Dank Memer sends its results inside embeds, so ``message.content`` is often
    empty. This pulls the description, title, author, footer and every field out
    of each embed and joins them, which is what the old working bot did.
    """
    parts: list[str] = []
    content = getattr(message, "content", "") or ""
    if content:
        parts.append(str(content))
    for embed in getattr(message, "embeds", None) or []:
        for attr in ("title", "description"):
            value = getattr(embed, attr, None)
            if value:
                parts.append(str(value))
        author = getattr(embed, "author", None)
        if author is not None and getattr(author, "name", None):
            parts.append(str(author.name))
        footer = getattr(embed, "footer", None)
        if footer is not None and getattr(footer, "text", None):
            parts.append(str(footer.text))
        for field in getattr(embed, "fields", None) or []:
            name = getattr(field, "name", "") or ""
            value = getattr(field, "value", "") or ""
            parts.append(f"{name} {value}")
    return "\n".join(p for p in parts if p)


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
    wallet = _first(_COIN_EMOJI, text) or _first(_COIN_UNICODE, text)
    bank = _first(_BANK_EMOJI, text)
    if not wallet and not bank:
        for match in _LABEL_AMOUNT.finditer(text):
            label = match.group(0).lower()
            value = _to_int(match.group(1))
            if "bank" in label:
                bank = bank or value
            else:
                wallet = wallet or value
    return {"wallet": wallet, "bank": bank}


def parse_loot(content: str, kind: str | None = None) -> dict[str, list[str]]:
    """Splits a hunt/dig reply into animals and items.

    ``kind`` (``"hunt"`` or ``"dig"``) decides which bucket the names go into;
    without it, the wording of the reply is used as a fallback.
    """
    text = str(content or "")
    if is_failure(text):
        return {"animals": [], "items": []}

    names: list[str] = []
    for pattern in (_LOOT_ITEM, _LOOT_ITEM_SPACED):
        for match in pattern.finditer(text):
            name = _clean_name(match.group(1))
            if name:
                names.append(name)
        if names:
            break

    if not names:
        for match in _PLAIN_LOOT.finditer(text):
            name = _clean_name(match.group(1))
            if name:
                names.append(name)

    if not names:
        return {"animals": [], "items": []}

    if kind in {"hunt", "dig"}:
        is_animal = kind == "hunt"
    else:
        is_animal = bool(re.search(r"caught|hunting|hunt", text, re.IGNORECASE))
    return {"animals": names, "items": []} if is_animal else {"animals": [], "items": names}


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
    if _COIN_EMOJI.search(text) or re.search(r"\d[\d,]*\s*coins?", text):
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

    # The old working bot looked for a balance on every reply, not only on
    # `pls bal`, so a beg/work reply that shows the wallet still counts.
    coins = parse_coins(content)
    total = coins["wallet"] + coins["bank"]
    if total > entry.get("lastTotal", 0):
        # High-water mark: coins earned is the highest balance ever seen. The
        # mark only ever rises, so spending (which lowers the balance) cannot
        # make a later rise re-count coins that were already tallied.
        entry["coins"] = entry.get("coins", 0) + (total - entry.get("lastTotal", 0))
        entry["lastTotal"] = total

    if kind == "hunt":
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
