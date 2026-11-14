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
    # Exactly the old working shape: "**1 <:Frog:123> Frog" (no space before emoji).
    loot = parsing.parse_loot("**1 <:Frog:123> Frog, **2 <:Snake:456> Snake", "hunt")
    eq("loot: old-shape animals", loot["animals"], ["Frog", "Snake"])
    loot = parsing.parse_loot("**1 <:Rock:1> Rock, **2 <:Gem:2> Gem", "dig")
    eq("loot: old-shape items", loot["items"], ["Rock", "Gem"])
    # The other shape with a space: "**1** <:Frog:123> Frog".
    loot = parsing.parse_loot("**1** <:Frog:123> Frog, **2** <:Snake:456> Snake", "hunt")
    eq("loot: spaced-shape animals", loot["animals"], ["Frog", "Snake"])
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
    """A balance reply must raise the coin total.

    This mirrors the old working bot: a balance is counted only when the reply
    carries both the Coin and the Bank marker, and the total is tracked as a
    high-water mark so spending never lowers lifetime earnings.
    """
    token = "coin-tok"
    parsing.initialize_stats(token, "T")
    entry = parsing.apply_stats(token, "balance", "<:Coin:1> 500\n<:Bank:2> 0")
    eq("coin: gain recorded", entry["coins"], 500)
    entry = parsing.apply_stats(token, "balance", "<:Coin:1> 1,750\n<:Bank:2> 0")
    eq("coin: second gain added", entry["coins"], 1750)
    # Spending must not lower the lifetime total.
    entry = parsing.apply_stats(token, "balance", "<:Coin:1> 900\n<:Bank:2> 0")
    eq("coin: spending does not lower total", entry["coins"], 1750)
    # A wallet-only reply (no Bank marker) is not a balance and must be ignored.
    entry = parsing.apply_stats(token, "coin", "You got <:Coin:1> 9,999 coins!")
    eq("coin: wallet-only reply ignored", entry["coins"], 1750)
    # But a real balance check with both markers still counts.
    entry = parsing.apply_stats(token, "balance", "<:Coin:1> 2,000\n<:Bank:2> 0")
    eq("coin: balance with both markers counts", entry["coins"], 2000)


def test_extract_reply_text() -> None:
    """Dank Memer puts the result in an embed; content is usually empty."""
    class _Author:
        name = "Dank Memer"

    class _Footer:
        text = "dank memer"

    class _Field:
        name = "Caught"
        value = "**1 <:Frog:123> Frog**"

    class _Embed:
        title = "Hunt"
        description = "You caught a **Frog**!"
        author = _Author()
        footer = _Footer()
        fields: tuple = (_Field(),)

    class _Message:
        content = ""
        embeds: tuple = (_Embed(),)

    text = parsing.extract_reply_text(_Message())
    check("embed: description captured", "You caught a **Frog**" in text, text)
    check("embed: field captured", "Frog" in text, text)
    check("embed: title captured", "Hunt" in text, text)
    # And the loot parses out of that flattened text.
    eq("embed: animal recorded", parsing.parse_loot(text, "hunt")["animals"], ["Frog"])
    # A message with no embeds must not raise.
    class _Plain:
        content = "hi"
        embeds: tuple = ()
    eq("embed: plain content", parsing.extract_reply_text(_Plain()), "hi")


def test_loot_fallback_unknown() -> None:
    """An unrecognised 'caught a' / 'found a' reply must still count once."""
    eq("loot fallback: caught a", parsing.parse_loot("You caught a", "hunt")["animals"],
       ["Unknown Animal"])
    eq("loot fallback: found a", parsing.parse_loot("You found a", "dig")["items"],
       ["Unknown Item"])
    # A cooldown is still a failure, never a fallback catch.
    eq("loot fallback: failure excluded",
       parsing.parse_loot("You caught a cooldown!", "hunt"), {"animals": [], "items": []})


def test_reply_reference_gate() -> None:
    """Only a reply to our own command may be parsed (old-bot behaviour)."""
    import asyncio

    from dankfarm import grinder as G

    store.save_tokens({"tokens": [
        {"token": "ref-tok", "channelId": "1", "active": True, "verified": True},
    ]})
    parsing.initialize_stats("ref-tok", "Ref")

    class _Embed:
        title = None
        description = "You caught a **Frog**!"
        author = None
        footer = None
        fields: tuple = ()

    class _Ref:
        def __init__(self, mid):
            self.message_id = mid

    class _Msg:
        def __init__(self, mid, ref):
            self.id = mid
            self.content = ""
            self.embeds = (_Embed(),)
            self.reference = ref
            self.author = type("A", (), {"id": G.DANK_MEMER_ID})()
            self.channel = type("C", (), {"id": 1})()

    async def run():
        grinder = G.Grinder()
        account = G.FarmAccount("ref-tok", 1, grinder)
        # Two commands in flight at once: the reply to the first arrives only
        # after the second was already sent (the real-world slow-reply case).
        grinder.pending["ref-tok"] = {100: "pls hunt", 200: "pls dig"}

        # Reply to a *different* message must be ignored.
        await account._on_message(_Msg(101, _Ref(999)))
        eq("ref gate: unrelated reply ignored",
           store.load_stats()["stats"]["ref-tok"]["animals"], 0)

        # The slow reply to the FIRST command is still matched and counted, even
        # though a second command was sent in the meantime.
        await account._on_message(_Msg(102, _Ref(100)))
        eq("ref gate: slow reply to first command counted",
           store.load_stats()["stats"]["ref-tok"]["animals"], 1)

        # And the reply to the second command is counted too.
        await account._on_message(_Msg(103, _Ref(200)))
        eq("ref gate: second command reply counted",
           store.load_stats()["stats"]["ref-tok"]["items"], 1)

        # A duplicate reply for an already-answered command is ignored.
        await account._on_message(_Msg(104, _Ref(100)))
        eq("ref gate: duplicate reply ignored",
           store.load_stats()["stats"]["ref-tok"]["animals"], 1)

    asyncio.run(run())


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
    parsing.apply_stats(token, "balance", "<:Coin:1> 100\n<:Bank:2> 900")
    entry = parsing.apply_stats(token, "balance", "<:Coin:1> 50\n<:Bank:2> 900")
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


def test_view_navigation() -> None:
    """The panel buttons must actually move between pages."""
    import asyncio

    from dankfarm import bot as bot_mod

    store.save_tokens({"tokens": [
        {"token": "A", "channelId": "1", "active": True, "verified": True},
        {"token": "B", "channelId": "1", "active": False, "verified": True},
    ]})
    parsing.initialize_stats("A", "Alpha")
    parsing.initialize_stats("B", "Beta")

    class _Grinder:
        def verified_entries(self):
            return [e for e in store.load_tokens()["tokens"] if e.get("verified", True)]

        def running_tokens(self):
            return {"A"}

        async def toggle(self, index):
            entries = self.verified_entries()
            token = entries[index]["token"]
            data = store.load_tokens()
            for entry in data["tokens"]:
                if entry["token"] == token:
                    entry["active"] = not entry.get("active")
            store.save_tokens(data)
            return {"ok": True, "active": not entries[index].get("active")}

    class _Bot:
        grinder = _Grinder()
        use_custom = True

    class _Response:
        def __init__(self):
            self.done = False

        def is_done(self):
            return self.done

        async def defer(self):
            self.done = True

        async def send_message(self, *a, **k):
            pass

    class _Interaction:
        def __init__(self):
            self.response = _Response()
            self.author = type("A", (), {"id": 1})()

        async def edit_original_response(self, **k):
            self.last = k

        async def followup_send(self, *a, **k):
            pass

    async def run():
        view = bot_mod.StatsView(_Bot(), 1)
        eq("view: starts on overview", view.page, -1)
        check("view: next enabled from overview", not view.next.disabled)
        check("view: start disabled on overview", view.toggle.disabled)

        await view.next.callback(_Interaction())
        eq("view: next enters first account", view.page, 0)
        eq("view: start label for running account", view.toggle.label, "Stop")

        await view.toggle.callback(_Interaction())
        eq("view: toggle stops the account",
           store.load_tokens()["tokens"][0]["active"], False)

        await view.next.callback(_Interaction())
        eq("view: next reaches second account", view.page, 1)
        check("view: next disabled on last page", view.next.disabled)
        eq("view: start label for stopped account", view.toggle.label, "Start")

        await view.overview.callback(_Interaction())
        eq("view: overview jumps back", view.page, -1)

    asyncio.run(run())


def test_auto_start_default_off() -> None:
    """Farming must not resume by itself unless AUTO_START is set."""
    eq("config: AUTO_START defaults off", config.AUTO_START, False)


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
    ok = banner.render_status("success", "Verified and added as #2")
    check("banner: success status card renders", isinstance(ok, bytes) and len(ok) > 1000, "")
    err = banner.render_status("error", "Login failed — not saved")
    check("banner: error status card renders", isinstance(err, bytes) and len(err) > 1000, "")


def test_emoji_recovery() -> None:
    """The emoji map is rebuilt from the application when the local file is gone."""
    import asyncio

    from dankfarm import emojis as E
    from dankfarm import upload_emojis as U

    saved = dict(E._cache)
    try:
        E._cache = {}
        check("emoji: has_any false when empty", not E.has_any())

        async def fake_fetch() -> dict[str, str]:
            return {"dk_coin": "<:dk_coin:111>"}

        original = U.fetch_map
        U.fetch_map = fake_fetch
        try:
            mapping = asyncio.run(U.ensure_map())
        finally:
            U.fetch_map = original
        eq("emoji: recovered from application", mapping, {"dk_coin": "<:dk_coin:111>"})
        check("emoji: has_any true after recovery", E.has_any())
        eq("emoji: custom string used", E.get("dk_coin", True), "<:dk_coin:111>")
    finally:
        E._cache = saved


def test_emoji_routes_use_snowflake() -> None:
    """The emoji routes must be called with a real app id, never '@me'.

    Discord rejects '@me' on /applications/{id}/emojis with 400
    ("Value \"@me\" is not snowflake"), which silently produced an empty map.
    """
    import asyncio

    from dankfarm import upload_emojis as U

    class _Resp:
        def __init__(self, status, payload):
            self.status = status
            self._payload = payload

        async def json(self):
            return self._payload

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

    class _Session:
        def __init__(self):
            self.urls: list[str] = []

        def get(self, url):
            self.urls.append(url)
            if "oauth2/applications" in url:
                return _Resp(200, {"id": "1570854901846900766"})
            return _Resp(200, {"items": [{"name": "dk_coin", "id": "111", "animated": True}]})

    session = _Session()
    mapping = asyncio.run(U.fetch_map_with_session(session))
    check("emoji: emoji route uses the snowflake",
          any("/applications/1570854901846900766/emojis" in u for u in session.urls))
    check("emoji: emoji route never uses @me",
          not any("/applications/@me/emojis" in u for u in session.urls))
    eq("emoji: animated flag preserved", mapping, {"dk_coin": "<a:dk_coin:111>"})


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
        test_extract_reply_text,
        test_view_navigation,
        test_auto_start_default_off,
        test_loot_fallback_unknown,
        test_reply_reference_gate,
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
        test_emoji_recovery,
        test_emoji_routes_use_snowflake,
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
