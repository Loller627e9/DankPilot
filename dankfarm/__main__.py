"""Entrypoint: wires the grinder, admin bot and health server together."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import signal

from . import banner, config, keepalive
from . import grinder as grinder_mod

logging.basicConfig(
    level=logging.DEBUG if config.DEBUG_STATS else logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("dankfarm")


async def main() -> None:
    config.ensure_dirs()

    problems = config.validate()
    if problems:
        for problem in problems:
            log.error("Configuration error: %s", problem)
        log.error("Copy .env.example to .env and fill in the required values.")
        return

    log.info("Starting %s v3 ...", config.BRAND_NAME)
    if not banner.available():
        log.warning("Pillow not available — falling back to text-only embeds")

    runner, ping_task = (None, None)
    if config.KEEP_ALIVE:
        runner, ping_task = await keepalive.start()

    grind = grinder_mod.Grinder()
    grind.start_watchdog()
    started = await grind.start_active()
    log.info("Resumed %d active account(s)", started)

    stop_event = asyncio.Event()

    def _request_stop() -> None:
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, _request_stop)

    bot_task = asyncio.create_task(_run_bot(grind, _request_stop))
    await stop_event.wait()

    log.info("Shutting down ...")
    bot_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await bot_task
    await grind.shutdown()
    if ping_task:
        ping_task.cancel()
    if runner:
        await runner.cleanup()


async def _run_bot(grind, on_fatal) -> None:
    from . import bot as bot_mod

    try:
        await bot_mod.run(grind)
    except Exception as exc:  # a bad token or a fatal gateway error
        log.error("Admin bot stopped: %s", exc)
        on_fatal()


def run() -> None:
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(main())


if __name__ == "__main__":
    run()
