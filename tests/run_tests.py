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
    store.save_tokens({"tokens": []})
    g = G.Grinder()
    check("grinder: add token", g.add_token("tok-1", 555))
    check("grinder: duplicate rejected", not g.add_token("tok-1", 555))
    eq("grinder: one token stored", len(store.load_tokens()["tokens"]), 1)
    check("grinder: not running initially", not g.is_running("tok-1"))
    eq("grinder: running set empty", g.running_tokens(), set())


def test_grinder_bad_login() -> None:
    """A token that cannot log in must report failure, not silent success."""
    import asyncio

    store.save_tokens({"tokens": []})
    g = G.Grinder()
    g.add_token("invalid-token", 123456789012345678)

    async def run() -> dict:
        res = await g.start("invalid-token", 123456789012345678)
        await g.shutdown()
        return res

    res = asyncio.run(run())
    check("bad login: reports failure", res.get("ok") is False, str(res))
    eq("bad login: status failed", res.get("status"), "failed")
    eq("bad login: account deactivated", store.load_tokens()["tokens"][0]["active"], False)


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
        test_classify,
        test_apply_stats,
        test_emojis,
        test_grinder_helpers,
        test_grinder_bookkeeping,
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
