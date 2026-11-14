"""Selfbot account lifecycle.

Owns the farming accounts: logging them in, running the command loop,
detecting drops, and recovering with backoff. Each account is an
:class:`~discord.Client` from ``discord.py-self`` running its own gateway
connection on the shared event loop.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import random
import time
from datetime import UTC

import discord

from . import config, parsing, store

log = logging.getLogger("dankfarm.grinder")

DANK_MEMER_ID = 270904126974590976


def mask_token(token: str | None) -> str:
    if not token:
        return "unknown"
    if len(token) <= 10:
        return "***"
    return f"{token[:4]}...{token[-4:]}"


def jittered(base_ms: int, spread_ms: int) -> float:
    """Fixed interval spread by a random amount, in seconds."""
    extra = random.uniform(0, spread_ms) if spread_ms > 0 else 0
    return (base_ms + extra) / 1000.0


def backoff_delay(attempt: int) -> float:
    """Exponential backoff with jitter, capped, in seconds."""
    base = min(config.MAX_BACKOFF_MS, 5000 * (2 ** max(0, attempt - 1)))
    return (base + random.uniform(0, 3000)) / 1000.0


class FarmAccount:
    """One farming account: a selfbot client plus its loop state."""

    def __init__(self, token: str, channel_id: int, grinder: Grinder) -> None:
        self.token = token
        self.channel_id = channel_id
        self.grinder = grinder
        self.client = discord.Client()
        self.ready = asyncio.Event()
        self.settled = asyncio.Event()
        self.outcome: str | None = None
        self._cycle_task: asyncio.Task | None = None
        self._closed = False
        self.last_activity = 0.0
        self.reconnecting = False
        self._bind_events()

    # -- events ---------------------------------------------------------------
    def _bind_events(self) -> None:
        client = self.client

        @client.event
        async def on_ready():
            self.reconnecting = False
            self.last_activity = time.monotonic()
            self.ready.set()
            self.outcome = "started"
            self.settled.set()
            parsing.initialize_stats(self.token, str(client.user))
            self.grinder.note_restart_success(self.token)
            log.info("Logged in as %s (%s)", client.user, mask_token(self.token))
            self._start_cycle()

        @client.event
        async def on_message(message):
            await self._on_message(message)

        @client.event
        async def on_disconnect():
            self.reconnecting = True
            log.warning("Disconnected (%s)", mask_token(self.token))

        @client.event
        async def on_resumed():
            self.reconnecting = False
            self.last_activity = time.monotonic()
            log.info("Resumed session (%s)", mask_token(self.token))

    async def _on_message(self, message) -> None:
        if message.author.id != DANK_MEMER_ID:
            return
        if message.channel.id != self.channel_id:
            return
        last = self.grinder.last_sent.get(self.token)
        if not last or message.id <= last["id"]:
            return
        kind = parsing.classify_reply(last["command"], message.content)
        parsing.apply_stats(self.token, kind, message.content)
        self.grinder.last_reply[self.token] = kind

    # -- farming --------------------------------------------------------------
    def _start_cycle(self) -> None:
        if self._cycle_task and not self._cycle_task.done():
            self._cycle_task.cancel()
        self._cycle_task = asyncio.create_task(self._run_cycle())

    async def _run_cycle(self) -> None:
        """Runs command cycles forever while the account stays active."""
        try:
            while self.grinder.is_running(self.token):
                await self.ready.wait()
                if not self.grinder.is_running(self.token):
                    break

                for command in config.FARM_COMMANDS:
                    if not self.grinder.is_running(self.token):
                        return
                    await self._send(command)
                    await asyncio.sleep(jittered(config.COMMAND_INTERVAL, config.COMMAND_JITTER))

                self.last_activity = time.monotonic()
                await asyncio.sleep(jittered(config.CYCLE_INTERVAL, config.CYCLE_JITTER))
        except asyncio.CancelledError:  # pragma: no cover - normal shutdown
            raise
        except Exception:
            log.exception("Cycle crashed (%s)", mask_token(self.token))
            if self.grinder.is_running(self.token):
                await self.grinder.handle_drop(self.token)

    async def _send(self, command: str) -> bool:
        if not self.client.is_ready():
            return False
        try:
            channel = self.client.get_channel(self.channel_id) or await self.client.fetch_channel(self.channel_id)
            message = await channel.send(
                command, allowed_mentions=discord.AllowedMentions.none()
            )
            self.grinder.last_sent[self.token] = {"id": message.id, "command": command}
            parsing.record_command(self.token)
            self.last_activity = time.monotonic()
            return True
        except Exception as exc:
            log.warning("Command failed (%s): %s", mask_token(self.token), exc)
            parsing.record_failure(self.token)
            return False

    # -- lifecycle ------------------------------------------------------------
    async def login(self) -> None:
        await self.client.start(self.token)

    async def close(self) -> None:
        self._closed = True
        if self._cycle_task and not self._cycle_task.done():
            self._cycle_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._cycle_task
        with contextlib.suppress(Exception):
            await self.client.close()


class Grinder:
    """Manages every farming account and the watchdog that keeps them alive."""

    def __init__(self) -> None:
        self.accounts: dict[str, FarmAccount] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._restart_attempts: dict[str, int] = {}
        self.last_sent: dict[str, dict] = {}
        self.last_reply: dict[str, str] = {}
        self._watchdog: asyncio.Task | None = None
        self._stopping = False
        # Keeps strong references to fire-and-forget tasks so the GC cannot
        # collect them mid-flight.
        self._background: set[asyncio.Task] = set()

    def _spawn(self, coro) -> asyncio.Task:
        task = asyncio.create_task(coro)
        self._background.add(task)
        task.add_done_callback(self._background.discard)
        return task

    # -- helpers --------------------------------------------------------------
    def is_running(self, token: str) -> bool:
        return token in self.accounts

    def running_tokens(self) -> set[str]:
        return {t for t, a in self.accounts.items() if a.client.is_ready()}

    def running_count(self) -> int:
        return len(self.running_tokens())

    def _lock(self, token: str) -> asyncio.Lock:
        return self._locks.setdefault(token, asyncio.Lock())

    def note_restart_success(self, token: str) -> None:
        self._restart_attempts.pop(token, None)

    # -- start / stop ---------------------------------------------------------
    async def start(self, token: str, channel_id: int) -> dict:
        if token in self.accounts:
            return {"ok": True, "status": "already"}

        async with self._lock(token):
            if token in self.accounts:
                return {"ok": True, "status": "already"}

            account = FarmAccount(token, channel_id, self)
            self.accounts[token] = account
            task = asyncio.create_task(self._run_account(account))
            self._tasks[token] = task
            # Wait until login resolves (ready or failed) so callers get a real
            # result, but never block forever on a slow gateway.
            try:
                await asyncio.wait_for(account.settled.wait(), timeout=30)
            except TimeoutError:
                if token in self.accounts and not account.ready.is_set():
                    log.warning("Login still pending for %s", mask_token(token))
                    return {"ok": True, "status": "pending"}
            if account.outcome == "failed":
                return {"ok": False, "status": "failed", "error": "login failed"}
            return {"ok": True, "status": "started"}

    async def _run_account(self, account: FarmAccount) -> None:
        try:
            await account.login()
        except Exception as exc:
            log.warning("Login failed (%s): %s", mask_token(account.token), exc)
            self.accounts.pop(account.token, None)
            await account.close()
            # A token that cannot log in is not worth retrying forever; drop it
            # from the active set so the watchdog stops resurrecting it.
            self._set_active(account.token, False)
            account.outcome = "failed"
            account.settled.set()

    async def stop(self, token: str) -> bool:
        account = self.accounts.pop(token, None)
        if account is None:
            self._set_active(token, False)
            self._restart_attempts.pop(token, None)
            return False
        self._restart_attempts.pop(token, None)
        await account.close()
        task = self._tasks.pop(token, None)
        if task:
            task.cancel()
        self.last_sent.pop(token, None)
        self._set_active(token, False)
        log.info("Stopped client for %s", mask_token(token))
        return True

    async def handle_drop(self, token: str) -> None:
        """Restarts an account whose session died, if it is still wanted."""
        async with self._lock(token):
            if self._stopping or token not in self.accounts:
                return
            account = self.accounts.pop(token)
            await account.close()
            task = self._tasks.pop(token, None)
            if task:
                task.cancel()
        # _schedule_restart calls start(), which takes the same lock, so it must
        # run outside the block above or the restart would deadlock.
        await self._schedule_restart(token, account.channel_id)

    async def _schedule_restart(self, token: str, channel_id: int) -> None:
        if self._stopping or not self._entry_active(token):
            return
        attempt = self._restart_attempts.get(token, 0) + 1
        if attempt > config.LOGIN_RETRIES:
            # Stop after a bounded number of tries instead of retrying a dead
            # token forever (and spamming the gateway with login attempts).
            log.warning("Giving up on %s after %d attempt(s)", mask_token(token), attempt - 1)
            self._restart_attempts.pop(token, None)
            self._set_active(token, False)
            return
        self._restart_attempts[token] = attempt
        delay = backoff_delay(attempt)
        log.info("Restarting %s in %.0fs (attempt %d)", mask_token(token), delay, attempt)
        await asyncio.sleep(delay)
        if self._stopping or not self._entry_active(token):
            return
        if token in self.accounts:
            return
        res = await self.start(token, channel_id)
        if not res.get("ok"):
            await self._schedule_restart(token, channel_id)

    # -- boot / bulk ----------------------------------------------------------
    async def start_active(self) -> int:
        started = 0
        for entry in self.verified_entries():
            if not entry.get("active"):
                continue
            res = await self.start(entry["token"], int(entry["channelId"]))
            if res.get("ok"):
                started += 1
        return started

    async def start_all(self) -> int:
        started = 0
        for entry in self.verified_entries():
            res = await self.start(entry["token"], int(entry["channelId"]))
            if res.get("ok"):
                started += 1
        return started

    async def stop_all(self) -> int:
        stopped = 0
        for token in list(self.accounts.keys()):
            if await self.stop(token):
                stopped += 1
        data = store.load_tokens()
        for entry in data.get("tokens", []):
            entry["active"] = False
        store.save_tokens(data)
        return stopped

    # -- watchdog -------------------------------------------------------------
    def start_watchdog(self) -> None:
        if self._watchdog is None:
            self._watchdog = asyncio.create_task(self._watchdog_loop())

    async def stop_watchdog(self) -> None:
        if self._watchdog:
            self._watchdog.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._watchdog
            self._watchdog = None

    async def _watchdog_loop(self) -> None:
        interval = config.WATCHDOG_INTERVAL_MS / 1000.0
        while not self._stopping:
            await asyncio.sleep(interval)
            now = time.monotonic()
            for token, account in list(self.accounts.items()):
                if account.reconnecting or not account.ready.is_set():
                    continue
                if now - account.last_activity <= config.STALL_MS / 1000.0:
                    continue
                log.warning("Watchdog: %s stalled", mask_token(token))
                self._spawn(self.handle_drop(token))

            for entry in self.verified_entries():
                if not entry.get("active"):
                    continue
                token = entry["token"]
                if token in self.accounts:
                    continue
                log.info("Watchdog: %s active but not running — starting", mask_token(token))
                self._spawn(self.start(token, int(entry["channelId"])))

    async def shutdown(self) -> None:
        self._stopping = True
        await self.stop_watchdog()
        for token in list(self.accounts.keys()):
            account = self.accounts.pop(token)
            await account.close()
        for task in list(self._tasks.values()):
            task.cancel()

    # -- persistence ----------------------------------------------------------
    def verified_entries(self) -> list[dict]:
        """Accounts with a verified login.

        An account is only written to disk after it has logged in once, so
        everything here is known-good. ``verified`` defaults to True so accounts
        saved by an older build keep working.
        """
        return [e for e in store.load_tokens().get("tokens", []) if e.get("verified", True)]

    def _entry_active(self, token: str) -> bool:
        for entry in store.load_tokens().get("tokens", []):
            if entry.get("token") == token:
                return bool(entry.get("active"))
        return False

    def _set_active(self, token: str, active: bool) -> None:
        data = store.load_tokens()
        changed = False
        for entry in data.get("tokens", []):
            if entry.get("token") == token and entry.get("active") != active:
                entry["active"] = active
                changed = True
        if changed:
            store.save_tokens(data)

    async def add_token(self, token: str, channel_id: int) -> dict:
        """Registers a token, but only after it proves it can log in.

        Nothing is written to disk unless the login succeeds, so a bad token
        never occupies storage or shows up in the stats panel.
        """
        if any(e.get("token") == token for e in store.load_tokens().get("tokens", [])):
            return {"ok": False, "error": "already registered"}

        res = await self.start(token, channel_id)
        # Only a definitive "started" counts; a pending/timed-out login must not
        # be saved, or an unverified account would end up on disk.
        if not res.get("ok") or res.get("status") != "started":
            # start() already tore the client down; make sure no stray state remains.
            await self.stop(token)
            return {"ok": False, "error": res.get("error") or "login did not complete"}

        data = store.load_tokens()
        data["tokens"].append(
            {"token": token, "channelId": str(channel_id), "active": True, "verified": True}
        )
        if not store.save_tokens(data):
            # Could not persist: do not leave a running account that vanishes on
            # the next restart.
            await self.stop(token)
            stats = store.load_stats()
            if stats["stats"].pop(token, None) is not None:
                store.save_stats(stats)
            return {"ok": False, "error": "could not save account to disk"}
        return {"ok": True, "index": len(data["tokens"]) - 1}

    async def remove_token(self, index: int) -> bool:
        # Resolve the index against the same list the panel shows, then drop the
        # matching entry from the raw store so the two cannot drift apart.
        entries = self.verified_entries()
        if index < 0 or index >= len(entries):
            return False
        token = entries[index]["token"]
        data = store.load_tokens()
        data["tokens"] = [e for e in data["tokens"] if e.get("token") != token]
        store.save_tokens(data)
        await self.stop(token)
        # Drop the account's stats too, so nothing is left behind.
        stats = store.load_stats()
        if stats["stats"].pop(token, None) is not None:
            store.save_stats(stats)
        return True

    async def toggle(self, index: int) -> dict:
        entries = self.verified_entries()
        if index < 0 or index >= len(entries):
            return {"ok": False, "active": False, "error": "no such account"}
        token = entries[index]["token"]
        active = not entries[index].get("active")

        if active:
            res = await self.start(token, int(entries[index]["channelId"]))
            if not res.get("ok"):
                # Never leave a dead token marked active.
                self._set_active(token, False)
                return {"ok": False, "active": False, "error": res.get("error")}
            self._set_active(token, True)
            return {"ok": True, "active": True}

        await self.stop(token)
        self._set_active(token, False)
        return {"ok": True, "active": False}

    def reset_stats(self) -> bool:
        data = store.load_stats()
        for entry in data["stats"].values():
            name = entry.get("name", "unknown")
            entry.clear()
            entry.update(store.blank_stats(name))
        return store.save_stats(data)

    def export_stats(self) -> str | None:
        from datetime import datetime

        data = store.load_stats()
        stamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
        path = config.DATA_DIR / f"stats_export_{stamp}.json"
        return str(path) if store.write_json(path, data) else None
