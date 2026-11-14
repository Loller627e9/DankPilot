# 🚜 Dank Farm Bot

A Discord **admin bot** (discord.js v14) that drives a fleet of Dank Memer
farming accounts through `discord.js-selfbot-v13`, with a polished embed UI,
custom animated emojis, and one-command deploy to Render.

## ✨ Features

- **Multi-account farming** — automate `pls beg/hunt/dig/bal` across many tokens
- **Live dashboard** — coins, animals, items, commands and failures per account
- **Custom emoji UI** — bundled animated emojis + banner art, with a unicode
  fallback so nothing ever renders broken
- **Access control** — owner plus a grantable allow-list
- **Safe storage** — atomic JSON writes, per-file write queue, token masking
- **Keep-alive server** — `/health` endpoint + self-ping so a Render free
  Web Service does not idle-sleep
- **Env-first config** — `BOT_TOKEN` / `OWNER_ID` from environment variables,
  with `config.json` as a local fallback

## 📦 Quick start (local)

```bash
npm install
cp .env.example .env      # then fill in BOT_TOKEN and OWNER_ID
npm start
```

Prefer a file? Create `config.json`:

```json
{ "botToken": "YOUR_BOT_TOKEN", "ownerId": "YOUR_USER_ID" }
```

Run the checks and smoke tests:

```bash
npm run check   # syntax-check every file
npm test        # dependency-free behaviour tests
```

## 🎨 Custom emojis and art

`assets/` holds the embed banners. `emojis/` holds the animated emojis.

```bash
npm run upload-emojis   # manual: uploads emojis/ as application emojis
```

The bot also **auto-uploads any missing emojis on startup**, so a fresh Render
deploy restores the custom set with no shell needed. Until the upload succeeds
the bot uses unicode emojis, so it always works. `$emojis-reload` re-reads the
file at runtime.

## 🤖 Commands

| Command | What it does |
| --- | --- |
| `$help` | Command center embed |
| `$stats` | Farm dashboard with per-account totals |
| `$ping` | Latency and uptime |
| `$add-token <token> <channelId>` | Validate + register an account (added **inactive**) |
| `$remove-token <index>` | Remove an account |
| `$toggle <index>` | Start/stop one account and persist its state |
| `$start-all` | Start every registered account (marks them active) |
| `$stop-all` | Stop every account and clear their active state |
| `$grant <@user>` / `$revoke <@user>` | Manage the allow-list |
| `$reset-stats` | Clear all statistics |
| `$export-stats` | Write a timestamped stats file |
| `$emojis-reload` | Reload the custom emoji set |

## ⚙️ Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOT_TOKEN` | — | Discord **bot** token (required) |
| `OWNER_ID` | — | Your Discord user ID (required) |
| `COMMAND_PREFIX` | `$` | Command prefix |
| `FARM_COMMANDS` | `pls beg,pls hunt,pls dig,pls bal` | Commands sent each cycle |
| `DEBUG_STATS` | `false` | Log every stat update to the console |
| `COMMAND_JITTER` | `1500` | Random extra ms added to each command gap |
| `CYCLE_JITTER` | `15000` | Random extra ms added between cycles |
| `WATCHDOG_INTERVAL` | `60000` | ms between liveness checks |
| `STALL_MS` | `90000` | Silence before a client is restarted |
| `LOGIN_RETRIES` | `3` | Login attempts before giving up |
| `MAX_BACKOFF` | `300000` | Max ms between restart attempts |
| `CLIENT_BUILD_NUMBER` | `455964` | Discord client build sent on connect (keep in sync with the selfbot lib) |
| `CLIENT_VERSION` | `1.0.9210` | Discord client version sent on connect |
| `DATA_DIR` | `storage` | Where the JSON files live |
| `COMMAND_INTERVAL` | `3000` | ms between farming commands |
| `CYCLE_INTERVAL` | `45000` | ms between farming cycles |
| `KEEP_ALIVE` | `true` | Run the health server + self-ping |
| `PORT` | `3000` | Health server port |
| `SELF_URL` | `RENDER_EXTERNAL_URL` | URL the self-ping targets |
| `SELF_PING_MS` | `600000` | Self-ping interval |

## 📁 Structure

```
.
├── index.js            # entry point: Discord client + lifecycle
├── config.js           # env-first configuration
├── store.js            # atomic JSON persistence
├── keepalive.js        # health server + self-ping
├── grinder.js          # selfbot farming logic
├── handlers.js         # admin command handlers
├── ui.js               # embed builders
├── emojis.js           # custom emoji lookup + fallback
├── upload-emojis.js    # one-time emoji uploader
├── assets/             # embed banners
├── emojis/             # animated emoji images
├── storage/            # tokens.json, stats.json, access.json, emojis.json
└── test/               # dependency-free tests
```

## 🌐 Deploy on Render

See [DEPLOY.md](DEPLOY.md). In short: push the repo, create a **Web Service**
(or apply `render.yaml`), set `BOT_TOKEN` and `OWNER_ID`, and let the built-in
keep-alive server hold the free instance open.

## ⚠️ Disclaimer

Driving user accounts with a selfbot violates Discord's Terms of Service and
can get accounts banned. This project is for educational use only. You are
responsible for how you run it.
