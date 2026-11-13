# 🚀 Deploying on Render (free tier)

## 1. Push the code

Put this folder in a Git repo and push it to GitHub/GitLab. `config.json`,
`.env` and the `storage/*.json` files are git-ignored, so no secrets travel
with the code.

## 2. Create the service

Option A - Blueprint (recommended): **New + → Blueprint**, point it at the
repo. Render reads `render.yaml` and creates the web service for you.

Option B - manual: **New + → Web Service**, then set

| Field | Value |
| --- | --- |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/health` |
| Plan | Free |

## 3. Environment variables

Add these under **Environment** (never commit real values):

| Key | Value |
| --- | --- |
| `BOT_TOKEN` | your Discord **bot** token |
| `OWNER_ID` | your Discord user ID |
| `KEEP_ALIVE` | `true` |
| `SELF_URL` | your service URL, e.g. `https://dank-farm-bot.onrender.com` |

`SELF_URL` is optional on Render: the platform injects `RENDER_EXTERNAL_URL`
and the bot uses that automatically for the self-ping.

## 4. Keep the free instance awake

A free Render web service is stopped after 15 minutes without inbound traffic.
The bot runs a tiny web server and pings its own `/health` endpoint every 10
minutes, which counts as traffic and keeps it running. Set `SELF_URL` (or rely
on `RENDER_EXTERNAL_URL`) for this to work. `KEEP_ALIVE=false` disables it.

## 5. Data persistence

Render's free filesystem is **ephemeral**: `storage/*.json` is wiped on every
deploy or restart. That is fine for the emoji map (re-run `npm run upload-emojis`
after a deploy) but it means farming accounts and stats reset.

For durable data, add a Render **Disk** mounted at `/data` and set
`DATA_DIR=/data`. (Disks require a paid instance type.)

## 6. Custom emojis

The bot **uploads the bundled emojis automatically on startup**, so a fresh
deploy restores the custom set even though the free tier has no shell. Watch for
`🎨 Uploaded N custom emoji(s)` in the logs.

You can also do it manually with `npm run upload-emojis`. Until the upload
succeeds the embeds fall back to unicode emojis, so nothing breaks.
`$emojis-reload` re-reads the set without a restart.

## Notes

- Using user tokens with a selfbot violates Discord's Terms of Service. Use at
  your own risk.
- The admin bot needs the **Message Content** intent enabled in the Discord
  Developer Portal, plus permissions to read and send messages in your channel.
