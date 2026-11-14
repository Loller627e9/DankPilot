"""Environment-driven configuration.

Everything is read once at import time so the rest of the code can treat
``config`` as a constant. A local ``.env`` file is loaded first (if present),
then real environment variables win — that keeps Render/dotenv behaviour
predictable.
"""

from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    """Minimal .env loader (no external dependency)."""
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        # Do not clobber a variable the host already set.
        os.environ.setdefault(key, value)


_load_dotenv()


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name) or default)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(_env(name) or default)
    except ValueError:
        return default


def _env_bool(name: str, default: bool = False) -> bool:
    value = _env(name)
    if not value:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


# --- Required ----------------------------------------------------------------
BOT_TOKEN = _env("BOT_TOKEN")
OWNER_ID = _env_int("OWNER_ID", 0)

# --- Admin bot ---------------------------------------------------------------
COMMAND_PREFIX = _env("COMMAND_PREFIX", "$")

# --- Farming cadence (milliseconds) -----------------------------------------
COMMAND_INTERVAL = _env_int("COMMAND_INTERVAL", 4000)
CYCLE_INTERVAL = _env_int("CYCLE_INTERVAL", 65000)
COMMAND_JITTER = _env_int("COMMAND_JITTER", 1500)
CYCLE_JITTER = _env_int("CYCLE_JITTER", 20000)

FARM_COMMANDS = [
    cmd.strip()
    for cmd in _env(
        "FARM_COMMANDS", "pls beg,pls hunt,pls dig,pls search,pls fish,pls work,pls bal"
    ).split(",")
    if cmd.strip()
]

# --- Reliability -------------------------------------------------------------
LOGIN_RETRIES = _env_int("LOGIN_RETRIES", 3)
MAX_BACKOFF_MS = _env_int("MAX_BACKOFF_MS", 300000)
WATCHDOG_INTERVAL_MS = _env_int("WATCHDOG_INTERVAL_MS", 60000)
STALL_MS = _env_int("STALL_MS", 180000)
# Reacting to one of these emojis on a stats card navigates it.
NAV_EMOJI_PREV = _env("NAV_EMOJI_PREV", "\u25c0\ufe0f")
NAV_EMOJI_NEXT = _env("NAV_EMOJI_NEXT", "\u25b6\ufe0f")
NAV_EMOJI_CLOSE = _env("NAV_EMOJI_CLOSE", "\u23f9\ufe0f")

# --- Storage -----------------------------------------------------------------
DATA_DIR = Path(_env("DATA_DIR") or (BASE_DIR / "data"))
TOKENS_PATH = DATA_DIR / "tokens.json"
STATS_PATH = DATA_DIR / "stats.json"
ACCESS_PATH = DATA_DIR / "access.json"
EMOJIS_PATH = DATA_DIR / "emojis.json"

ASSETS_DIR = BASE_DIR / "assets"
EMOJI_DIR = BASE_DIR / "emojis"
FONT_DIR = BASE_DIR / "fonts"

# --- Keep-alive web server ---------------------------------------------------
KEEP_ALIVE = _env_bool("KEEP_ALIVE", True)
PORT = _env_int("PORT", 10000)
SELF_PING_MS = _env_int("SELF_PING_MS", 240000)
SELF_URL = _env("SELF_URL") or _env("RENDER_EXTERNAL_URL")

# --- Branding ----------------------------------------------------------------
BRAND_NAME = _env("BRAND_NAME", "DANK FARM")
BRAND_TAGLINE = _env("BRAND_TAGLINE", "Multi-Account Automation Suite")

# --- Discord client identity -------------------------------------------------
# discord.py-self fetches the live build number itself; these only force a
# value if you want to pin one.
CLIENT_BUILD_NUMBER = _env("CLIENT_BUILD_NUMBER")
CLIENT_VERSION = _env("CLIENT_VERSION")
DEBUG_STATS = _env_bool("DEBUG_STATS", False)


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def validate() -> list[str]:
    """Returns a list of human-readable problems (empty means OK)."""
    problems: list[str] = []
    if not BOT_TOKEN:
        problems.append("BOT_TOKEN is not set")
    if not OWNER_ID:
        problems.append("OWNER_ID is not set")
    return problems
