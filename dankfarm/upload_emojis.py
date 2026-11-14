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


async def upload_all() -> dict[str, str]:
    mapping = dict(E._cache)  # keep anything already known
    headers = {"Authorization": f"Bot {config.BOT_TOKEN}"}
    files = sorted(Path(config.EMOJI_DIR).glob("*"))
    if not files:
        log.warning("No emoji files found in %s", config.EMOJI_DIR)
        return mapping

    async with aiohttp.ClientSession(headers=headers) as session:
        # Existing application emojis, so re-runs are idempotent.
        async with session.get(f"{API}/applications/@me/emojis") as resp:
            existing = {e["name"]: e for e in (await resp.json()).get("items", [])} if resp.status == 200 else {}

        for path in files:
            name = path.stem
            if name in existing:
                emoji = existing[name]
                mapping[name] = f"<{'a' if emoji.get('animated') else ''}:{name}:{emoji['id']}>"
                continue
            data = aiohttp.FormData()
            data.add_field("name", name)
            data.add_field(
                "image",
                path.read_bytes(),
                filename=path.name,
                content_type="image/gif" if path.suffix == ".gif" else "image/png",
            )
            async with session.post(f"{API}/applications/@me/emojis", data=data) as resp:
                if resp.status in (200, 201):
                    emoji = await resp.json()
                    mapping[name] = f"<{'a' if emoji.get('animated') else ''}:{name}:{emoji['id']}>"
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
