"""Health server + self-ping.

Free hosting tiers (Render, Fly, etc.) idle-sleep an idle web service. This
serves ``/`` and ``/health`` and, when ``SELF_URL`` is known, pings itself on a
timer so the instance stays warm.
"""

from __future__ import annotations

import asyncio
import logging

from aiohttp import web

from . import config

log = logging.getLogger("dankfarm.keepalive")

_start_time = 0.0


async def _root(_request: web.Request) -> web.Response:
    return web.Response(text=f"{config.BRAND_NAME} is running.")


async def _health(_request: web.Request) -> web.Response:
    import time

    uptime = int(time.monotonic() - _start_time) if _start_time else 0
    return web.json_response({"status": "ok", "uptime": uptime})


async def _self_ping_loop(session, url: str) -> None:
    interval = max(30, config.SELF_PING_MS // 1000)
    while True:
        await asyncio.sleep(interval)
        try:
            async with session.get(url) as resp:
                log.debug("Self-ping %s -> %s", url, resp.status)
        except Exception as exc:  # pragma: no cover - network dependent
            log.debug("Self-ping failed: %s", exc)


async def start() -> tuple[web.AppRunner, asyncio.Task | None]:
    """Starts the web server. Returns the runner and the ping task (or None)."""
    global _start_time
    import time

    _start_time = time.monotonic()

    app = web.Application()
    app.router.add_get("/", _root)
    app.router.add_get("/health", _health)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", config.PORT)
    await site.start()
    log.info("Keep-alive server listening on port %d", config.PORT)

    ping_task = None
    if config.SELF_URL:
        import aiohttp

        session = aiohttp.ClientSession()
        url = config.SELF_URL.rstrip("/") + "/health"
        ping_task = asyncio.create_task(_self_ping_loop(session, url))
        log.info("Self-ping enabled -> %s", url)
    return runner, ping_task
