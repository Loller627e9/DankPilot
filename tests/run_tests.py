# ruff: noqa: E402 - DATA_DIR must be set before importing config.
"""Test suite for Dank Farm.

Pure-logic tests run without any Discord connection. Run with:

    python -m pytest -q          (if pytest is installed)
    python tests/run_tests.py    (no extra dependency)
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Point storage at a throwaway directory before importing config-dependent code.
_TMP = tempfile.mkdtemp(prefix="dankfarm-test-")
os.environ.setdefault("DATA_DIR", _TMP)

from dankfarm import banner, config, parsing, store
from dankfarm import emojis as E
from dankfarm import grinder as G

config.DATA_DIR = Path(_TMP)
config.TOKENS_PATH = config.DATA_DIR / "tokens.json"
config.STATS_PATH = config.DATA_DIR / "stats.json"
config.ACCESS_PATH = config.DATA_DIR / "access.json"
config.EMOJIS_PATH = config.DATA_DIR / "emojis.json"


# --- tiny test harness -------------------------------------------------------
_results: list[tuple[str, bool, str]] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    _results.append((name, bool(condition), detail))


def eq(name: str, got, want) -> None:
    check(name, got == want, f"got {got!r}, want {want!r}")


# --- store -------------------------------------------------------------------
def test_store() -> None:
    path = config.DATA_DIR / "roundtrip.json"
    store.write_json(path, {"a": 1, "b": [1, 2, 3]})
    eq("store round-trip", store.read_json(path, {}), {"a": 1, "b": [1, 2, 3]})
    eq("store default on missing", store.read_json(config.DATA_DIR / "nope.json", {"x": 1}), {"x": 1})
    # A corrupt file must not raise.
    bad = config.DATA_DIR / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    eq("store tolerates corruption", store.read_json(bad, {"ok": True}), {"ok": True})


# --- parsing -----------------------------------------------------------------
def test_parse_coins() -> None:
    eq("coins: label form", parsing.parse_coins("Wallet: 1,234\nBank: 5,000"),
       {"wallet": 1234, "bank": 5000})
    eq("coins: bold label", parsing.parse_coins("**Wallet** 2,000\n**Bank** 9,999"),
       {"wallet": 2000, "bank": 9999})
    eq("coins: emoji form", parsing.parse_coins("💰 750"), {"wallet": 750, "bank": 0})
    eq("coins: none", parsing.parse_coins("nothing here"), {"wallet": 0, "bank": 0})


def test_parse_loot() -> None:
    hunt = "You caught: **1** 🐸 Frog, **2** 🐍 Snake"
    loot = parsing.parse_loot(hunt)
    check("loot: animals detected", "Frog" in loot["animals"] and "Snake" in loot["animals"], str(loot))
    dig = "You found: **1** 🪨 Rock, **2** 💎 Gem"
    loot2 = parsing.parse_loot(dig)
    check("loot: items detected", "Rock" in loot2["items"] and "Gem" in loot2["items"], str(loot2))


def test_classify() -> None:
    eq("classify: bal command", parsing.classify_reply("pls bal", ""), "balance")
    eq("classify: hunt command", parsing.classify_reply("pls hunt", ""), "hunt")
    eq("classify: dig command", parsing.classify_reply("pls dig", ""), "dig")
    eq("classify: by content", parsing.classify_reply("pls x", "your wallet holds 5"), "balance")
    eq("classify: beg coin gain", parsing.classify_reply("pls beg", "You got 500 coins!"), "coin")


def test_parse_loot_custom_emoji() -> None:
    """Real Dank Memer loot puts a custom emoji between the number and name."""
    loot = parsing.parse_loot("**1** <:Frog:123> Frog, **2** <:Snake:456> Snake", "hunt")
    eq("loot: custom-emoji animals", loot["animals"], ["Frog", "Snake"])
    loot = parsing.parse_loot("**1** <:Rock:1> Rock, **2** <:Gem:2> Gem", "dig")
    eq("loot: custom-emoji items", loot["items"], ["Rock", "Gem"])
    loot = parsing.parse_loot("You dug up a Rock!", "dig")
    eq("loot: plain dug-up", loot["items"], ["Rock"])
    # The kind must win over the wording, so a dig never lands in animals.
    loot = parsing.parse_loot("You caught a Frog!", "dig")
    eq("loot: kind overrides wording", loot, {"animals": [], "items": ["Frog"]})


def test_failures_not_counted() -> None:
    """Cooldown / refusal replies must not inflate the totals."""
    token = "fail-tok"
    parsing.initialize_stats(token, "T")
    for text in ("You're on a cooldown!", "You don't have enough coins!"):
        check("failure: detected", parsing.is_failure(text), text)
    entry = parsing.apply_stats(token, "hunt", "You're on a cooldown!")
    eq("failure: animals unchanged", entry["animals"], 0)
    eq("failure: failure counted", entry["failures"], 1)
    eq("failure: no loot parsed", parsing.parse_loot("You're on a cooldown!"),
       {"animals": [], "items": []})


def test_coin_gain_recorded() -> None:
    """A beg/work reply that shows coins must raise the coin total."""
    token = "coin-tok"
    parsing.initialize_stats(token, "T")
    entry = parsing.apply_stats(token, "coin", "You begged and got 500 coins!")
    eq("coin: gain recorded", entry["coins"], 500)
    entry = parsing.apply_stats(token, "coin", "You earned <:Coin:1> 1,250 from work!")
    eq("coin: second gain added", entry["coins"], 1750)
    # A later balance check must not count the gains a second time.
    entry = parsing.apply_stats(token, "balance", "Wallet: 1,750\nBank: 0")
    eq("coin: no double count via balance", entry["coins"], 1750)


def test_permission_ids() -> None:
    """grant() stores a string id; has_permission must still match it."""
    from dankfarm import bot as bot_mod

    store.save_access({"ownerId": 1, "authorizedUsers": ["123456789"]})
    check("perm: string id matches", bot_mod.has_permission(123456789))
    check("perm: stranger rejected", not bot_mod.has_permission(999))
    store.save_access({"ownerId": 1, "authorizedUsers": []})


def test_apply_stats() -> None:
    token = "token-abc"
    parsing.initialize_stats(token, "Tester")
    parsing.apply_stats(token, "balance", "Wallet: 100\nBank: 900")
    entry = parsing.apply_stats(token, "balance", "Wallet: 50\nBank: 900")
    # Spending must not reduce lifetime earnings (high-water mark logic).
    eq("stats: coins high-water", entry["coins"], 1000)
    parsing.apply_stats(token, "hunt", "You caught: **1** 🐸 Frog, **2** 🐍 Snake")
    entry = parsing.apply_stats(token, "dig", "You found: **1** 🪨 Rock")
    eq("stats: animals", entry["animals"], 2)
    eq("stats: items", entry["items"], 1)
    eq("stats: catches", entry["catches"], 3)


# --- emojis ------------------------------------------------------------------
def test_emojis() -> None:
    eq("emoji: fallback coin", E.unicode("dk_coin"), "\U0001f4b0")
    eq("emoji: unknown empty", E.unicode("nope"), "")
    eq("emoji: custom hidden outside guild", E.get("dk_coin", in_guild=False), "\U0001f4b0")
    E.save_custom({"dk_coin": "<:dk_coin:123>"})
    eq("emoji: custom used in guild", E.get("dk_coin", in_guild=True), "<:dk_coin:123>")
    E.save_custom({})


# --- grinder helpers ---------------------------------------------------------
def test_grinder_helpers() -> None:
    eq("mask: short", G.mask_token("abc"), "***")
    eq("mask: long", G.mask_token("1234567890abcdef"), "1234...cdef")
    for attempt in range(1, 6):
        delay = G.backoff_delay(attempt)
        check(f"backoff in range (attempt {attempt})", 5.0 <= delay <= 303.0, str(delay))
    # Backoff must be monotonic-ish at the cap.
    check("backoff capped", G.backoff_delay(50) <= 303.0, str(G.backoff_delay(50)))
    for _ in range(50):
        value = G.jittered(4000, 1500)
        check("jitter in range", 4.0 <= value <= 5.5, str(value))
    eq("jitter zero spread", G.jittered(4000, 0), 4.0)


def test_grinder_bookkeeping() -> None:
    import asyncio

    store.save_tokens({"tokens": []})
    g = G.Grinder()

    # A token is only stored once its login succeeds, so stub start() to
    # simulate a good login and a rejected one.
    async def fake_start(token, channel_id):
        return {"ok": token == "good-token", "status": "started"} if token == "good-token" \
            else {"ok": False, "status": "failed", "error": "login failed"}

    g.start = fake_start  # type: ignore[assignment]

    async def run() -> None:
        ok = await g.add_token("good-token", 555)
        check("grinder: verified token added", ok.get("ok") is True, str(ok))
        dup = await g.add_token("good-token", 555)
        check("grinder: duplicate rejected", dup.get("ok") is False, str(dup))
        bad = await g.add_token("bad-token", 555)
        check("grinder: bad token rejected", bad.get("ok") is False, str(bad))

    asyncio.run(run())

    eq("grinder: only the verified token stored", len(store.load_tokens()["tokens"]), 1)
    eq("grinder: stored token marked verified", store.load_tokens()["tokens"][0]["verified"], True)
    check("grinder: bad token never stored",
          all(e["token"] != "bad-token" for e in store.load_tokens()["tokens"]))
    check("grinder: not running initially", not g.is_running("good-token"))
    eq("grinder: running set empty", g.running_tokens(), set())


def test_add_token_pending_not_saved() -> None:
    """A login that never completes must not be persisted as an account."""
    import asyncio

    store.save_tokens({"tokens": []})
    g = G.Grinder()

    async def pending_start(token, channel_id):
        return {"ok": True, "status": "pending"}

    async def fake_stop(token):
        return False

    g.start = pending_start  # type: ignore[assignment]
    g.stop = fake_stop  # type: ignore[assignment]
    res = asyncio.run(g.add_token("slow-token", 1))
    check("pending login: rejected", res.get("ok") is False, str(res))
    eq("pending login: nothing saved", store.load_tokens()["tokens"], [])


def test_unverified_hidden() -> None:
    """An account without a verified flag must not be listed."""
    store.save_tokens({"tokens": [
        {"token": "verified-1", "channelId": "1", "active": False, "verified": True},
        {"token": "pending-1", "channelId": "2", "active": False, "verified": False},
    ]})
    g = G.Grinder()
    tokens = [e["token"] for e in g.verified_entries()]
    eq("entries: unverified hidden", tokens, ["verified-1"])


def test_remove_token_drops_stats() -> None:
    """Removing an account must also delete its stats entry."""
    import asyncio

    store.save_tokens({"tokens": [{"token": "tok-x", "channelId": "1", "active": False, "verified": True}]})
    parsing.initialize_stats("tok-x", "Tester")
    g = G.Grinder()

    asyncio.run(g.remove_token(0))
    eq("remove: token list empty", store.load_tokens()["tokens"], [])
    check("remove: stats dropped", "tok-x" not in store.load_stats()["stats"])


def test_grinder_bad_login() -> None:
    """A token that cannot log in must report failure, not silent success."""
    import asyncio

    store.save_tokens({"tokens": []})
    g = G.Grinder()

    async def run() -> dict:
        res = await g.start("invalid-token", 123456789012345678)
        await g.shutdown()
        return res

    res = asyncio.run(run())
    check("bad login: reports failure", res.get("ok") is False, str(res))
    eq("bad login: status failed", res.get("status"), "failed")
    eq("bad login: nothing written to disk", store.load_tokens()["tokens"], [])


# --- banner ------------------------------------------------------------------
def test_banner() -> None:
    if not banner.available():
        check("banner: skipped (no Pillow)", True)
        return
    png = banner.render_banner()
    check("banner: renders bytes", isinstance(png, bytes) and png[:8] == b"\x89PNG\r\n\x1a\n", "")
    card = banner.render_account_card("Tester", index=0, running=True, coins=1234, animals=3, items=2)
    check("banner: account card renders", isinstance(card, bytes) and len(card) > 1000, "")
    overview = banner.render_overview({"coins": 10, "animals": 1, "items": 1, "commands": 5}, accounts=2, running=1)
    check("banner: overview renders", isinstance(overview, bytes) and len(overview) > 1000, "")


def test_branding() -> None:
    eq("brand: default name", config.BRAND_NAME, "DANK FARM")
    check("brand: tagline present", bool(config.BRAND_TAGLINE), config.BRAND_TAGLINE)


# --- runner ------------------------------------------------------------------
def main() -> int:
    tests = [
        test_store,
        test_parse_coins,
        test_parse_loot,
        test_parse_loot_custom_emoji,
        test_classify,
        test_failures_not_counted,
        test_coin_gain_recorded,
        test_permission_ids,
        test_apply_stats,
        test_emojis,
        test_grinder_helpers,
        test_grinder_bookkeeping,
        test_add_token_pending_not_saved,
        test_unverified_hidden,
        test_remove_token_drops_stats,
        test_grinder_bad_login,
        test_banner,
        test_branding,
    ]
    for test in tests:
        try:
            test()
        except Exception as exc:
            check(f"{test.__name__} raised", False, repr(exc))

    passed = sum(1 for _, ok, _ in _results if ok)
    failed = [(n, d) for n, ok, d in _results if not ok]
    for name, ok, detail in _results:
        mark = "PASS" if ok else "FAIL"
        print(f"[{mark}] {name}" + (f"  ({detail})" if not ok and detail else ""))
    print(f"\n{passed} check(s) passed, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
