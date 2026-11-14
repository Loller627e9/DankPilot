# AGENTS.md — Dank Farm (Python rewrite)

## What this is
Multi-account Dank Memer automation panel. Selfbot accounts run on
`discord.py-self`; the admin bot runs on `disnake`.

## Hard constraints (learned the hard way)
- **`discord.py-self` is user-token only.** Its `http.static_login` sends the
  token with no `Bot ` prefix, so a bot token gets a 401. The admin bot must use
  a different library.
- **`discord.py` and `discord.py-self` both install the `discord` package.**
  They cannot coexist in one interpreter. `disnake`/`nextcord` install under
  their own names, so they do coexist — that is why the admin bot uses disnake.
- **`discord.py-self` has no `View`/button/component-send support** and no
  `app_commands`. Interactive buttons therefore live only on the disnake side.
- discord.py-self fetches the live client build number / browser version at
  login via `cordapi.dolfi.es`, falling back to a hardcoded build number. That
  is the library's own anti-detection, not ours.

## Commands
- `python -m dankfarm` — run everything (health server + grinder + admin bot)
- `python -m dankfarm.upload_emojis` — one-shot emoji upload
- `python tests/run_tests.py` — tests, no extra dependency (93 checks)
- `ruff check dankfarm tests` — lint (config in pyproject.toml)

## Conventions
- `parsing.py` must stay free of Discord imports so it stays unit-testable.
- `store.write_json` is atomic (temp file + `os.replace`); keep it that way.
- A token that fails to log in is deactivated, not retried forever, so the
  watchdog cannot spin on a bad token.
- Broad `except Exception` is intentional and globally ignored in ruff
  (`BLE001`): one bad reply must never kill the process.
