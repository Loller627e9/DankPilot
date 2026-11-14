"""Uploads the bundled custom emojis to the admin bot's application.

Run once (``python -m dankfarm.upload_emojis``) with BOT_TOKEN set. It uploads
every file in ``emojis/`` that is not already present and writes the resulting
``<:name:id>`` strings to the emoji map the UI reads.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import aiohttp

from . import config
from . import emojis as E

log = logging.getLogger("dankfarm.emojis")

API = "https://discord.com/api/v10"


async def resolve_application_id(session: aiohttp.ClientSession) -> str | None:
    """Returns the application's snowflake id.

    The emoji routes reject the ``@me`` shorthand ("Value \"@me\" is not
    snowflake"), so the real id has to be resolved first. ``/oauth2/applications/@me``
    does accept ``@me``, so it is used as the lookup.
    """
    async with session.get(f"{API}/oauth2/applications/@me") as resp:
        if resp.status != 200:
            log.warning("Could not resolve the application id: %s", resp.status)
            return None
        data = await resp.json()
    app_id = data.get("id")
    if not app_id:
        log.warning("Application lookup returned no id")
    return app_id


def _emoji_string(name: str, emoji: dict) -> str:
    prefix = "a" if emoji.get("animated") else ""
    return f"<{prefix}:{name}:{emoji['id']}>"


async def fetch_map_with_session(session: aiohttp.ClientSession) -> dict[str, str]:
    """Fetches the emoji map over an existing session (separated for testing)."""
    mapping: dict[str, str] = {}
    app_id = await resolve_application_id(session)
    if not app_id:
        return mapping
    async with session.get(f"{API}/applications/{app_id}/emojis") as resp:
        if resp.status != 200:
            log.warning("Could not list application emojis: %s", resp.status)
            return mapping
        for emoji in (await resp.json()).get("items", []):
            name = emoji.get("name")
            if name:
                mapping[name] = _emoji_string(name, emoji)
    return mapping


async def fetch_map() -> dict[str, str]:
    """Rebuilds the name -> ``<:name:id>`` map from the application's emojis.

    Application emojis live on Discord's side, so they survive a restart even
    when the local map does not (free hosts wipe the working directory). This
    lets the UI recover its custom emojis without re-uploading anything.
    """
    if not config.BOT_TOKEN:
        return {}
    headers = {"Authorization": f"Bot {config.BOT_TOKEN}"}
    async with aiohttp.ClientSession(headers=headers) as session:
        return await fetch_map_with_session(session)


async def ensure_map() -> dict[str, str]:
    """Populates the local emoji map from Discord when it is missing or empty.

    Returns the map in use. Safe to call on every boot: it is a no-op once the
    map is populated.
    """
    if E._cache:
        return dict(E._cache)
    mapping = await fetch_map()
    if mapping:
        E.save_custom(mapping)
        log.info("Recovered %d custom emoji(s) from the application", len(mapping))
    else:
        log.warning(
            "No custom emojis found on the application — the UI will use unicode "
            "icons. Run `python -m dankfarm.upload_emojis` once with BOT_TOKEN set."
        )
    return mapping


async def upload_all() -> dict[str, str]:
    mapping = dict(E._cache)  # keep anything already known
    headers = {"Authorization": f"Bot {config.BOT_TOKEN}"}
    files = sorted(Path(config.EMOJI_DIR).glob("*"))
    if not files:
        log.warning("No emoji files found in %s", config.EMOJI_DIR)
        return mapping

    async with aiohttp.ClientSession(headers=headers) as session:
        app_id = await resolve_application_id(session)
        if not app_id:
            log.warning("Cannot upload emojis without an application id")
            return mapping

        # Existing application emojis, so re-runs are idempotent.
        async with session.get(f"{API}/applications/{app_id}/emojis") as resp:
            existing = {e["name"]: e for e in (await resp.json()).get("items", [])} if resp.status == 200 else {}

        for path in files:
            name = path.stem
            if name in existing:
                mapping[name] = _emoji_string(name, existing[name])
                continue
            data = aiohttp.FormData()
            data.add_field("name", name)
            data.add_field(
                "image",
                path.read_bytes(),
                filename=path.name,
                content_type="image/gif" if path.suffix == ".gif" else "image/png",
            )
            async with session.post(f"{API}/applications/{app_id}/emojis", data=data) as resp:
                if resp.status in (200, 201):
                    emoji = await resp.json()
                    mapping[name] = _emoji_string(name, emoji)
                    log.info("Uploaded %s", name)
                else:
                    log.warning("Failed to upload %s: %s %s", name, resp.status, await resp.text())

    E.save_custom(mapping)
    return mapping


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    if not config.BOT_TOKEN:
        raise SystemExit("BOT_TOKEN is not set")
    mapping = asyncio.run(upload_all())
    print(f"Emoji map written ({len(mapping)} entries) -> {config.EMOJIS_PATH}")


if __name__ == "__main__":
    main()
