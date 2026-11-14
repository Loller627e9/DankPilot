"""The admin bot: commands and the paginated stats panel.

Uses ``disnake`` (not ``discord.py``) because ``discord.py-self`` owns the
``discord`` package name; two forks that both install ``discord`` cannot coexist
in one interpreter, but ``disnake`` installs under its own name.
"""

from __future__ import annotations

import contextlib
import io
import logging

import disnake
from disnake.ext import commands

from . import banner, config, store, ui
from . import emojis as E

log = logging.getLogger("dankfarm.bot")


def has_permission(user_id: int) -> bool:
    access = store.load_access()
    if user_id == access.get("ownerId") or user_id == config.OWNER_ID:
        return True
    return user_id in access.get("authorizedUsers", [])


class StatsView(disnake.ui.View):
    """Pagination + actions for the per-account stats panel."""

    def __init__(self, bot: DankFarmBot, invoker_id: int, page: int = -1) -> None:
        super().__init__(timeout=180)
        self.bot = bot
        self.invoker_id = invoker_id
        self.page = page  # -1 == overview
        self._sync()

    # -- rendering ------------------------------------------------------------
    def _accounts(self) -> list[dict]:
        return store.load_tokens().get("tokens", [])

    def _stats(self) -> dict:
        return store.load_stats().get("stats", {})

    def render(self) -> tuple[disnake.Embed, disnake.File | None]:
        tokens = self._accounts()
        stats = self._stats()
        active = self.bot.grinder.running_tokens()

        if not tokens or self.page < 0:
            embed = ui.overview_embed(stats, tokens, active, self.bot.use_custom)
            file = None
            if banner.available():
                totals = {
                    "coins": sum(s.get("coins", 0) for s in stats.values()),
                    "animals": sum(s.get("animals", 0) for s in stats.values()),
                    "items": sum(s.get("items", 0) for s in stats.values()),
                    "commands": sum(s.get("commands", 0) for s in stats.values()),
                }
                png = banner.render_overview(totals, accounts=len(tokens), running=len(active))
                if png:
                    file = disnake.File(io.BytesIO(png), filename="overview.png")
                    embed.set_image(url="attachment://overview.png")
            return embed, file

        self.page = max(0, min(self.page, len(tokens) - 1))
        entry = tokens[self.page]
        stat = stats.get(entry["token"], store.blank_stats("unknown"))
        running = entry["token"] in active
        embed = ui.account_embed(self.page, entry, stat, running, len(tokens), self.bot.use_custom)
        file = None
        if banner.available():
            png = banner.render_account_card(
                stat.get("name") or "unknown",
                index=self.page,
                running=running,
                coins=stat.get("coins", 0),
                animals=stat.get("animals", 0),
                items=stat.get("items", 0),
                commands=stat.get("commands", 0),
                failures=stat.get("failures", 0),
            )
            if png:
                file = disnake.File(io.BytesIO(png), filename="account.png")
                embed.set_image(url="attachment://account.png")
        return embed, file

    def _sync(self) -> None:
        total = len(self._accounts())
        at_overview = self.page < 0
        self.prev.disabled = at_overview
        self.next.disabled = at_overview or self.page >= total - 1
        self.overview.disabled = at_overview
        self.toggle.disabled = at_overview or total == 0

    async def _refresh(self, interaction: disnake.MessageInteraction) -> None:
        self._sync()
        embed, file = self.render()
        # Always pass attachments so a page without a banner clears the previous
        # page's image instead of leaving it on screen.
        await interaction.response.edit_message(
            embed=embed, view=self, attachments=[file] if file else []
        )

    # -- checks ---------------------------------------------------------------
    async def interaction_check(self, interaction: disnake.MessageInteraction) -> bool:
        if interaction.author.id != self.invoker_id and not has_permission(interaction.author.id):
            await interaction.response.send_message("This panel is not yours.", ephemeral=True)
            return False
        return True

    # -- buttons --------------------------------------------------------------
    @disnake.ui.button(label="Prev", emoji="◀️", style=disnake.ButtonStyle.secondary)
    async def prev(self, button: disnake.ui.Button, interaction: disnake.MessageInteraction) -> None:
        self.page -= 1
        await self._refresh(interaction)

    @disnake.ui.button(label="Next", emoji="▶️", style=disnake.ButtonStyle.secondary)
    async def next(self, button: disnake.ui.Button, interaction: disnake.MessageInteraction) -> None:
        self.page += 1
        await self._refresh(interaction)

    @disnake.ui.button(label="Overview", emoji="🚜", style=disnake.ButtonStyle.primary)
    async def overview(self, button: disnake.ui.Button, interaction: disnake.MessageInteraction) -> None:
        self.page = -1
        await self._refresh(interaction)

    @disnake.ui.button(label="Refresh", emoji="🔄", style=disnake.ButtonStyle.success)
    async def refresh(self, button: disnake.ui.Button, interaction: disnake.MessageInteraction) -> None:
        await self._refresh(interaction)

    @disnake.ui.button(label="Start/Stop", emoji="⏯️", style=disnake.ButtonStyle.danger)
    async def toggle(self, button: disnake.ui.Button, interaction: disnake.MessageInteraction) -> None:
        res = await self.bot.grinder.toggle(self.page)
        if not res.get("ok"):
            await interaction.response.send_message(
                f"Could not toggle account: {res.get('error') or 'unknown error'}", ephemeral=True
            )
            return
        await self._refresh(interaction)


class DankFarmBot(commands.Bot):
    def __init__(self, grinder) -> None:
        intents = disnake.Intents.default()
        intents.message_content = True
        super().__init__(command_prefix=config.COMMAND_PREFIX, intents=intents)
        self.grinder = grinder
        self.use_custom = True

    # -- lifecycle ------------------------------------------------------------
    async def on_ready(self) -> None:
        log.info("Admin bot ready as %s", self.user)
        log.info("In %d guild(s): %s", len(self.guilds), ", ".join(g.name for g in self.guilds) or "(none)")
        await self.change_presence(activity=disnake.Activity(type=disnake.ActivityType.watching, name="the Dank Farm"))

    # -- prefix commands ------------------------------------------------------
    async def on_message(self, message: disnake.Message) -> None:
        if message.author.bot or not message.content.startswith(config.COMMAND_PREFIX):
            return
        if not has_permission(message.author.id):
            await message.reply(embed=ui.status_embed("error", "You do not have permission to use this bot.", True))
            return
        try:
            await self._handle(message)
        except Exception:  # pragma: no cover - defensive
            log.exception("Command failed")
            with contextlib.suppress(disnake.HTTPException):
                await message.reply(embed=ui.status_embed("error", "Internal error. Check the console log.", True))

    async def _handle(self, message: disnake.Message) -> None:
        args = message.content[len(config.COMMAND_PREFIX):].strip().split()
        if not args:
            return
        cmd = args.pop(0).lower()
        prefix = config.COMMAND_PREFIX

        async def reply(kind: str, text: str) -> None:
            await message.reply(embed=ui.status_embed(kind, text, True))

        if cmd == "help":
            await message.reply(embed=ui.help_embed(True))
        elif cmd == "stats":
            await self._send_stats(message)
        elif cmd == "ping":
            await reply("success", f"Pong! `{round(self.latency * 1000)}ms`")
        elif cmd == "add-token":
            await self._cmd_add_token(args, prefix, reply)
        elif cmd == "remove-token":
            if not args or not args[0].isdigit():
                await reply("error", f"Usage: `{prefix}remove-token <index>`")
                return
            ok = await self.grinder.remove_token(int(args[0]))
            await reply("success" if ok else "error", "Removed." if ok else "No such account.")
        elif cmd == "toggle":
            if not args or not args[0].isdigit():
                await reply("error", f"Usage: `{prefix}toggle <index>`")
                return
            res = await self.grinder.toggle(int(args[0]))
            if not res.get("ok"):
                await reply("error", f"Toggle failed: {res.get('error')}")
                return
            await reply("success", "Account activated." if res["active"] else "Account stopped.")
        elif cmd == "start-all":
            await reply("success", f"Started {await self.grinder.start_all()} client(s).")
        elif cmd == "stop-all":
            await reply("success", f"Stopped {await self.grinder.stop_all()} client(s).")
        elif cmd in {"grant", "revoke"}:
            await self._cmd_access(cmd, args, prefix, reply)
        elif cmd == "emojis-reload":
            E.reload()
            await reply("success", f"Reloaded emojis ({E.count_custom()} active).")
        elif cmd == "reset-stats":
            ok = self.grinder.reset_stats()
            await reply("success" if ok else "error", "Stats reset." if ok else "Reset failed.")
        elif cmd == "export-stats":
            path = self.grinder.export_stats()
            await reply("success" if path else "error", f"Exported to `{path}`" if path else "Export failed.")
        else:
            await reply("error", f"Unknown command. Use `{prefix}help`.")

    async def _send_stats(self, message: disnake.Message) -> None:
        view = StatsView(self, message.author.id)
        embed, file = view.render()
        if file:
            await message.reply(embed=embed, file=file, view=view)
        else:
            await message.reply(embed=embed, view=view)

    async def _cmd_add_token(self, args, prefix, reply) -> None:
        if len(args) < 2:
            await reply("error", f"Usage: `{prefix}add-token <token> <channelId>`")
            return
        token, channel_id = args[0], args[1]
        if not channel_id.isdigit():
            await reply("error", "Channel ID must be numeric.")
            return
        if not self.grinder.add_token(token, int(channel_id)):
            await reply("error", "That token is already registered.")
            return
        index = len(store.load_tokens()["tokens"]) - 1
        masked = f"{token[:4]}...{token[-4:]}"
        await reply("success", f"Added `{masked}` as **#{index}** (inactive). Start with `{prefix}toggle {index}`.")

    async def _cmd_access(self, cmd, args, prefix, reply) -> None:
        if not args:
            await reply("error", f"Usage: `{prefix}{cmd} <@user|id>`")
            return
        target = args[0].strip("<@!>")
        if not target.isdigit():
            await reply("error", "Provide a user mention or ID.")
            return
        access = store.load_access()
        users = access["authorizedUsers"]
        if cmd == "grant":
            if target not in users:
                users.append(target)
            text = f"Granted access to <@{target}>"
        else:
            if target in users:
                users.remove(target)
            text = f"Revoked access from <@{target}>"
        store.save_access(access)
        await reply("success", text)

    # -- slash commands -------------------------------------------------------
    @commands.slash_command(description="Show the paginated stats panel")
    async def stats(self, inter: disnake.ApplicationCommandInteraction) -> None:
        if not has_permission(inter.author.id):
            await inter.response.send_message("You do not have permission.", ephemeral=True)
            return
        view = StatsView(self, inter.author.id)
        embed, file = view.render()
        if file:
            await inter.response.send_message(embed=embed, file=file, view=view)
        else:
            await inter.response.send_message(embed=embed, view=view)

    @commands.slash_command(description="Ping the bot")
    async def ping(self, inter: disnake.ApplicationCommandInteraction) -> None:
        latency = round(self.latency * 1000)
        await inter.response.send_message(embed=ui.status_embed("success", f"Pong! `{latency}ms`", True))

    @commands.slash_command(description="Show the command list")
    async def help(self, inter: disnake.ApplicationCommandInteraction) -> None:
        await inter.response.send_message(embed=ui.help_embed(True))


async def run(grinder) -> None:
    """Constructs and runs the admin bot until cancelled."""
    bot = DankFarmBot(grinder)
    try:
        await bot.start(config.BOT_TOKEN)
    finally:
        await bot.close()
