# 🚜 Dank Farm

A Discord admin bot that runs several Dank Memer accounts from one place, with a
styled dashboard, per-account stats, and the buttons and artwork that make it
pleasant to look at.

- **Admin bot** (`discord.js`) — `$help`, `$stats`, token management, access control.
- **Farming accounts** (`discord.js-selfbot-v13`) — send the commands on a loop
  and read the replies back into per-account stats.
- **Styled UI** — a paginated panel: an overview page plus one page per
  account, browsable with buttons, built from the bundled artwork and custom
  animated emojis.
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
| `$stats` | Show the paginated dashboard: overview, then one page per account |
| `$add-token <token> <channelId>` | Verify a token by logging in, then register it |
| `$remove-token <index>` | Remove an account and its stats |
| `$toggle <index>` | Start or stop one account |
| `$start-all` / `$stop-all` | Start or stop every active account |
| `$grant <@user>` / `$revoke <@user>` | Let someone else use the commands |
| `$reset-stats` / `$export-stats` | Zero the counters / write them to a file |

## What the panel tracks

Each account page shows coins earned, current balance, commands sent, animals
caught, items dug, hunts/digs that came back empty, hit rate and errors.

Tracking is driven by the reply text, matched to the command that produced it.
Both shapes the bot has used are read:

| Reply | Counted as |
| --- | --- |
| `You went hunting and brought back a **Frog**` | animal caught |
| `You dug in the dirt and brought back a **Rock**` | item dug |
| `**1 <:Frog:123> Frog**` (numbered list) | animal caught |
| `You found nothing while digging` | a miss, which is how hit rate is computed |
| `<:Coin:1> 1,850,722` + `<:Bank:2> 0 / 50,000` | balance, and coins earned |
| `You're on a cooldown, try again in 30 seconds` | an error |

Other currencies in the balance reply (gems, fish tokens, skin fragments) are
recorded too, under **Other**. `pls beg` is not tracked on its own — it only
adds coins, and the next `pls bal` picks that up.

### When nothing is counted

Every inbound message in the farm channel is recorded, whether or not it is
understood, so a reply that reads as zero can be inspected instead of guessed
at. Two ways to look:

- In Discord, run `$debug`. It lists the accounts and the last few inbound
  messages, with their text and any emoji names.
- Over HTTP, open `/debug` on the service. It returns the same thing as JSON,
  including the live stats. Set `DEBUG_KEY` to require `?key=...`, which you
  should do on a public host.

Each reply also logs one line per match, with the delta it caused, so a read
that changes nothing is visible as no change rather than silence.

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
