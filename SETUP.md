# 🚀 Quick setup

## 1. Install

```bash
npm install
```

## 2. Configure

Either copy `.env.example` to `.env` and fill it in:

```
BOT_TOKEN=your_discord_bot_token
OWNER_ID=your_discord_user_id
```

or edit `config.json`:

```json
{ "botToken": "YOUR_BOT_TOKEN", "ownerId": "YOUR_USER_ID" }
```

Get the bot token from the
[Discord Developer Portal](https://discord.com/developers/applications)
(Application → Bot → Reset Token). Enable the **Message Content** intent.
Get your user ID by enabling Developer Mode and right-clicking your profile →
Copy ID.

## 3. Invite the bot

Replace `CLIENT_ID` with your application's client ID:

```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=274877908992&scope=bot
```

## 4. Run

```bash
npm start
```

## 5. Add farming accounts

In a channel the bot can see:

```
$add-token USER_TOKEN CHANNEL_ID
```

The token is validated immediately and the account is added **inactive**. Start it
explicitly — this is what makes the start/stop state predictable:

```
$toggle 0        # start account #0
$stats           # confirm it shows as running
$toggle 0        # stop it again
$start-all       # or start every registered account at once
$stop-all        # stop everything
```

Accounts marked active are restarted automatically when the bot boots; accounts
left inactive stay off.

## 6. Optional: custom emojis

```bash
npm run upload-emojis
```

## 🆘 Help

- `npm run check` — syntax-check the code
- `npm test` — run the smoke tests
- `$help` in Discord — command list
- See [README.md](README.md) and [DEPLOY.md](DEPLOY.md)