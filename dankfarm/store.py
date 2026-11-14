"""Tiny JSON persistence helpers.

Writes are atomic (temp file + replace) so a crash mid-write cannot leave a
half-written file that fails to parse on the next boot.
"""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any


def read_json(path: Path, default: Any) -> Any:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return default


def write_json(path: Path, data: Any) -> bool:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    except OSError:
        return False
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
        os.replace(tmp, path)
        return True
    except (OSError, TypeError, ValueError):
        return False
    finally:
        # Only removes the temp file when the replace did not happen; after a
        # successful replace the path no longer exists.
        with contextlib.suppress(OSError):
            os.remove(tmp)


def load_tokens() -> dict:
    from . import config

    data = read_json(config.TOKENS_PATH, {"tokens": []})
    if not isinstance(data, dict) or not isinstance(data.get("tokens"), list):
        return {"tokens": []}
    return data


def save_tokens(data: dict) -> bool:
    from . import config

    return write_json(config.TOKENS_PATH, data)


def load_access() -> dict:
    from . import config

    data = read_json(config.ACCESS_PATH, {"ownerId": config.OWNER_ID, "authorizedUsers": []})
    if not isinstance(data, dict):
        data = {"ownerId": config.OWNER_ID, "authorizedUsers": []}
    data.setdefault("ownerId", config.OWNER_ID)
    if not isinstance(data.get("authorizedUsers"), list):
        data["authorizedUsers"] = []
    return data


def save_access(data: dict) -> bool:
    from . import config

    return write_json(config.ACCESS_PATH, data)


def blank_stats(name: str) -> dict:
    return {
        "name": name,
        "coins": 0,
        "lastTotal": 0,
        "animals": 0,
        "items": 0,
        "catches": 0,
        "commands": 0,
        "failures": 0,
    }


def load_stats() -> dict:
    from . import config

    data = read_json(config.STATS_PATH, {"stats": {}})
    if not isinstance(data, dict) or not isinstance(data.get("stats"), dict):
        return {"stats": {}}
    return data


def save_stats(data: dict) -> bool:
    from . import config

    return write_json(config.STATS_PATH, data)
