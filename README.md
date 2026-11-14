# 🚜 Dank Farm

A Discord admin bot that runs several Dank Memer accounts from one place, with a
styled dashboard, per-account stats, and the buttons and artwork that make it
pleasant to look at.

- **Admin bot** (`discord.js`) — `$help`, `$stats`, token management, access control.
- **Farming accounts** (`discord.js-selfbot-v13`) — send the commands on a loop
  and read the replies back into per-account stats.
- **Styled UI** — dashboard, help panel and status cards built from the bundled
  artwork, with custom animated emojis.
- **Free-host ready** — answers on `$PORT`, self-pings to stay awake, and
  re-registers accounts from `FARM_ACCOUNTS` after a restart.

## Quick start

```bash
npm install
cp .env.example .env          # then fill in BOT_TOKEN and OWNER_ID
npm start
```

Or with `config.json` (the file the original bot used):

```bash
cp config.example.json config.json   # then edit it
npm start
```

Environment variables win over `config.json`, so a host's dashboard settings are
never silently overridden.

### Getting the two required values

1. **BOT_TOKEN** — [Developer Portal](https://discord.com/developers/applications) →
   your app → **Bot** → *Reset Token*. Enable **Message Content Intent**.
2. **OWNER_ID** — Discord → Settings → Advanced → **Developer Mode**, then
   right-click your own name → **Copy ID**.

## Commands

All commands use the `$` prefix and are owner-only unless granted.

| Command | What it does |
| --- | --- |
| `$help` | Show the command panel |
| `$stats` | Show the dashboard with per-account totals |
| `$add-token <token> <channelId>` | Verify a token by logging in, then register it |
| `$remove-token <index>` | Remove an account and its stats |
| `$toggle <index>` | Start or stop one account |
| `$start-all` / `$stop-all` | Start or stop every active account |
| `$grant <@user>` / `$revoke <@user>` | Let someone else use the commands |
| `$reset-stats` / `$export-stats` | Zero the counters / write them to a file |

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `BOT_TOKEN` | — | **Required.** Admin bot token |
| `OWNER_ID` | — | **Required.** Your Discord user id |
| `FARM_ACCOUNTS` | *(empty)* | `token:channelId` pairs re-registered on boot |
| `DATA_DIR` | `storage` | Where the JSON state lives |
| `COMMAND_INTERVAL` | `3000` | Delay between commands (ms) |
| `CYCLE_INTERVAL` | `45000` | Delay between cycles (ms) |
| `FARM_COMMANDS` | `pls beg,pls hunt,pls dig,pls bal` | Commands sent each cycle |
| `BRAND_NAME` | `DANK FARM` | Banner and embed title |
| `COMMAND_PREFIX` | `$` | Command prefix |
| `PORT` | *(unset)* | Health-server port; unset disables it |

### Why `FARM_ACCOUNTS` matters

Free hosts wipe the working directory on every restart. `storage/tokens.json` is
deleted with it, so accounts added through `$add-token` disappear and nothing
farms — which is what makes the dashboard show `0` for everything.

`FARM_ACCOUNTS` re-registers them at boot:

```
FARM_ACCOUNTS=TOKEN_ONE:111111111111111111,TOKEN_TWO:222222222222222222
```

Separate entries with commas or newlines. Already-registered accounts are left
alone, so running twice is safe.

## Custom emojis and artwork

The bot ships with a dashboard background, help banner, status cards and nine
animated emojis. Upload the emojis once so the embeds use them:

```bash
npm run upload-emojis
```

This uploads `emojis/*` as *application emojis* owned by the bot and writes the
resulting tags to `storage/emojis.json`. Until you run it, the embeds fall back
to normal unicode emojis, so nothing ever renders as a broken `:name:`.

## Deploying

**Render (free)** — push the repo, then **New → Blueprint** and point it at the
repo; `render.yaml` is picked up. Set `BOT_TOKEN`, `OWNER_ID` and
`FARM_ACCOUNTS` in the dashboard.

**Docker** — `docker build -t dank-farm .` then run it with a volume on `/data`
so the stats survive a restart.

**Any Node host** — `npm ci --omit=dev && node index.js`.

## Development

```bash
npm test      # 90+ tests, no network access required
npm run lint  # syntax check every file
```

Tests run against a throwaway `DATA_DIR`, so they never touch real storage.

## License

MIT
