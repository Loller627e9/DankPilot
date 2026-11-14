# 🚜 DANK FARM

**Multi-Account Automation Suite**

A control panel for running several Dank Memer farming accounts at once. You get
one clean Discord bot with prefix commands *and* slash commands, a paginated
stats panel with buttons, and image banners for every account.

> **Read this first.** The farming accounts are driven with **user tokens**
> (self-bots). Automating a user account breaks Discord's Terms of Service and
> can get those accounts banned. That risk is inherent to the tool and is not
> something the code can remove. Use accounts you are willing to lose.

---

## What's new in v3 (the Python rewrite)

- **Rewritten in Python.** Selfbot side runs on `discord.py-self`; the admin
  bot runs on `disnake`. They coexist because they install under different
  package names.
- **Per-account stats pages.** `/stats` opens a panel you page through with
  buttons (◀️ ▶️), plus Overview / Refresh / Start-Stop.
- **Image banners.** Every reply can carry a Pillow-rendered card with the
  **DANK FARM** brand name.
- **Reliability.** A watchdog restarts stalled accounts; drops recover with
  jittered exponential backoff; the farm loop can no longer die silently.

---

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env               # then edit .env (BOT_TOKEN, OWNER_ID)
python -m dankfarm
```

`python main.py` works identically if you prefer a plain script entry point, or
if your host expects a top-level `main.py`.

In the Discord Developer Portal, open your application → **Bot** and enable
**Message Content Intent**. The bot itself needs no privileged intents beyond
that.

### Upload the custom emojis (once)

```bash
python -m dankfarm.upload_emojis
```

This uploads everything in `emojis/` to your application and writes the
resulting `<:name:id>` strings to `data/emojis.json`. The UI uses them inside
your server and falls back to unicode everywhere else.

---

## Commands

| Command | What it does |
| --- | --- |
| `$help` | Command list |
| `$stats` | Paginated stats panel (buttons) |
| `$add-token <token> <channelId>` | Register an account (inactive) |
| `$remove-token <index>` | Delete an account |
| `$toggle <index>` | Start / stop one account |
| `$start-all` / `$stop-all` | Start / stop every account |
| `$grant <@user>` / `$revoke <@user>` | Manage who may use the bot |
| `$ping` | Latency |
| `$emojis-reload` | Rescan uploaded emojis |
| `$reset-stats` / `$export-stats` | Stats maintenance |

Slash commands: `/stats`, `/ping`, `/help`.

---

## The stats panel

`$stats` (or `/stats`) opens the overview. Buttons:

- **◀️ Prev / ▶️ Next** — move between accounts
- **🚜 Overview** — jump back to the all-accounts summary
- **🔄 Refresh** — re-read the numbers
- **⏯️ Start/Stop** — toggle the account you are looking at

Each account page shows coins earned, animals caught, items found, commands
sent, failures, and the masked token, with a matching banner image.

---

## Configuration

All settings are environment variables; see `.env.example` for the full list.
The important ones:

| Variable | Default | Meaning |
| --- | --- | --- |
| `BOT_TOKEN` | — | Admin bot token (required) |
| `OWNER_ID` | — | Your user ID (required) |
| `COMMAND_PREFIX` | `$` | Text command prefix |
| `COMMAND_INTERVAL` | `4000` | Delay between commands (ms) |
| `CYCLE_INTERVAL` | `65000` | Delay between cycles (ms) |
| `COMMAND_JITTER` / `CYCLE_JITTER` | `1500` / `20000` | Random spread (ms) |
| `WATCHDOG_INTERVAL_MS` | `60000` | How often the watchdog checks |
| `STALL_MS` | `180000` | Silence before an account is restarted |
| `DATA_DIR` | `data` | Where JSON state lives |
| `BRAND_NAME` / `BRAND_TAGLINE` | `DANK FARM` / … | Banner text |

---

## Deploying to Render (free)

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, point it at the repo. `render.yaml` is
   picked up automatically.
3. Set `BOT_TOKEN` and `OWNER_ID` in the dashboard when prompted.
4. The service binds to `$PORT` and answers `/health`, which the keep-alive
   server also self-pings so a free instance does not idle-sleep.

A disk is **not** configured in `render.yaml`, because Render's free plan does
not offer persistent disks. State lives on the ephemeral filesystem at
`DATA_DIR=data`, so it resets on every redeploy or restart — re-add accounts
with `$add-token` after a deploy. Free instances also sleep after ~15 minutes
of inactivity; the keep-alive server self-pings every 10 minutes to stay awake,
but a truly idle instance will still cold-start on the next request.

Prefer Docker? A `Dockerfile` is included, and it mounts a `/data` volume so
state survives container restarts.

### bot-hosting.net

Free 24/7 hosting. Set the entry file to `main.py` and add `BOT_TOKEN` and
`OWNER_ID`; the rest of the variables are the same as Render, except set
`KEEP_ALIVE=false` (the platform reserves the port itself). Full walkthrough:
[DEPLOY-BOT-HOSTING.md](DEPLOY-BOT-HOSTING.md).

---

## Project layout

```
dankfarm/
  config.py         environment-driven settings
  store.py          atomic JSON persistence
  parsing.py        reply parsing + stats (pure, tested)
  emojis.py         custom-emoji lookup with unicode fallback
  banner.py         Pillow banner renderer
  grinder.py        selfbot lifecycle, farm loop, watchdog
  ui.py             embed builders
  bot.py            admin bot: commands + paginated stats views
  keepalive.py      health server + self-ping
  upload_emojis.py  one-shot emoji uploader
tests/run_tests.py  test suite
```

## Tests

```bash
python tests/run_tests.py      # no extra dependency
# or
python -m pytest -q
```

## License

MIT — see `LICENSE`.
