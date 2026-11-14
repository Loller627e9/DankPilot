# Deploying to bot-hosting.net

## 1. Create the deployment

In the panel: **New Deployment** → type **Application** → source **GitHub**
(public repo) or **Archive** (upload `dankfarm-python.zip`).

If you upload an archive, extract it and make sure the project files sit in the
**root** of the deployment — not inside an extra `dankfarm/` folder. Archives
often extract into a nested directory; drag the files out one level if so.

## 2. Entry file (STARTUP_FILE)

Open **Startup** and set the entry file to:

```
main.py
```

`main.py` at the repo root is the plain-script entry point. Alternatively set it
to `dankfarm/__main__.py` and start with `python -m dankfarm` — but `main.py` is
simpler.

## 3. Dependencies

bot-hosting.net installs from `requirements.txt` automatically on start. It is
already in the repo:

```
discord.py-self==2.1.0
disnake==2.12.2
Pillow==13.0.0
aiohttp==3.14.5
```

Do **not** upload `.cache` or `.local`.

## 4. Environment variables

Add these in the **Environment** tab. Same names as Render — only two are
required.

| Variable | Required | Value |
| --- | --- | --- |
| `BOT_TOKEN` | yes | your Discord bot token |
| `OWNER_ID` | yes | your Discord user ID |
| `FARM_ACCOUNTS` | recommended | `token:channelId,token:channelId` |
| `AUTO_START` | no | `true` (default) |
| `KEEP_ALIVE` | no | `false` on bot-hosting.net (see below) |
| `DATA_DIR` | no | `data` |
| `BRAND_NAME` | no | `DANK FARM` |

Everything else has a working default (see `.env.example`).

### FARM_ACCOUNTS — why stats show 0

The free plans have no persistent disk. `data/tokens.json` is deleted on every
restart or redeploy, so accounts you added with `$add-token` are gone and
nothing farms — the stats panel then shows every account at 0 coins.

Set `FARM_ACCOUNTS` to re-register them on each boot:

```
FARM_ACCOUNTS=TOKEN_ONE:111111111111111111,TOKEN_TWO:222222222222222222
```

Each entry is `token:channelId`, separated by commas (newlines also work). The
accounts are marked active, so with `AUTO_START=true` farming resumes on its
own. Entries that are already registered are left alone.

Stats themselves still reset on restart, because the counters live in the same
ephemeral `data/` directory. Totals are recomputed from live Dank Memer replies
as farming continues.

### KEEP_ALIVE on bot-hosting.net

Set `KEEP_ALIVE=false`. bot-hosting.net keeps the process running 24/7 and
reserves the network port itself, so the built-in health server is unnecessary.
If it is left on and the port is taken, the bot logs a warning and keeps
running — it does not crash — but there is no reason to run it.

## 5. Start and check the console

Start the deployment. A healthy boot looks like:

```
Starting DANK FARM v3 ...
Resumed 0 active account(s)
```

If you see `ModuleNotFoundError: No module named 'discord'`, `requirements.txt`
did not install — check the Packages tab and reinstall.

If you see `Invalid Token has been provided / TOKEN_INVALID`, `BOT_TOKEN` is
wrong or has a stray space/newline. Re-copy it from the Developer Portal.

## Notes

- bot-hosting.net gives the process no persistent disk. `DATA_DIR=data` lives on
  ephemeral storage and resets when the deployment restarts, so re-add accounts
  after a restart.
- Only `BOT_TOKEN` and `OWNER_ID` differ from the Render setup; the rest of the
  variables are identical.
