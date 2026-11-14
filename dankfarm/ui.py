"""Embed builders for the admin bot.

Kept separate from :mod:`dankfarm.bot` so the message shapes can be reasoned
about (and reused) without dragging in the whole command layer.
"""

from __future__ import annotations

import disnake

from . import config
from . import emojis as E

COLOR_INFO = 0x7C5CFF
COLOR_OK = 0x3CC878
COLOR_ERR = 0xE5484D


def _icon(name: str, use_custom: bool) -> str:
    return E.get(name, use_custom)


def in_guild(message: disnake.Message) -> bool:
    """True when the message is in the guild that hosts the custom emojis."""
    return message.guild is not None


def status_embed(kind: str, text: str, use_custom: bool = True) -> disnake.Embed:
    icon = E.get("dk_sparkle", use_custom) if kind == "success" else E.get("dk_fail", use_custom)
    color = COLOR_OK if kind == "success" else COLOR_ERR
    return disnake.Embed(description=f"{icon} {text}", color=color)


def help_embed(use_custom: bool = True) -> disnake.Embed:
    prefix = config.COMMAND_PREFIX
    def e(name: str) -> str:
        return E.get(name, use_custom)
    embed = disnake.Embed(
        title=f"{E.get('dk_farm', use_custom)} {config.BRAND_NAME}",
        description=f"*{config.BRAND_TAGLINE}*",
        color=COLOR_INFO,
    )
    embed.add_field(
        name=f"{e('dk_cmds')} Accounts",
        value=(
            f"`{prefix}stats` — paginated stats panel\n"
            f"`{prefix}add-token <token> <channelId>` — register an account\n"
            f"`{prefix}remove-token <index>` — delete an account\n"
            f"`{prefix}toggle <index>` — start / stop one account\n"
            f"`{prefix}start-all` / `{prefix}stop-all` — every account"
        ),
        inline=False,
    )
    embed.add_field(
        name=f"{e('dk_sparkle')} Utility",
        value=(
            f"`{prefix}ping` — latency + uptime\n"
            f"`{prefix}emojis-reload` — rescan uploaded emojis\n"
            f"`{prefix}reset-stats` / `{prefix}export-stats`"
        ),
        inline=False,
    )
    embed.add_field(
        name=f"{e('dk_paw')} Access",
        value=(
            f"`{prefix}grant <@user>` / `{prefix}revoke <@user>`\n"
            f"Slash commands are also available."
        ),
        inline=False,
    )
    embed.set_footer(text=f"{config.BRAND_NAME} v3 · prefix {prefix}")
    return embed


def _totals(stats: dict) -> dict:
    return {
        "coins": sum(s.get("coins", 0) for s in stats.values()),
        "animals": sum(s.get("animals", 0) for s in stats.values()),
        "items": sum(s.get("items", 0) for s in stats.values()),
        "commands": sum(s.get("commands", 0) for s in stats.values()),
        "failures": sum(s.get("failures", 0) for s in stats.values()),
    }


def overview_embed(stats: dict, tokens: list[dict], active: set[str], use_custom: bool = True) -> disnake.Embed:
    def e(name: str) -> str:
        return E.get(name, use_custom)
    totals = _totals(stats)
    embed = disnake.Embed(
        title=f"{E.get('dk_farm', use_custom)} {config.BRAND_NAME} — Overview",
        description=f"*{config.BRAND_TAGLINE}*",
        color=COLOR_INFO,
    )
    embed.add_field(name=f"{e('dk_coin')} Total coins", value=f"**{totals['coins']:,}**", inline=True)
    embed.add_field(name=f"{e('dk_paw')} Animals", value=f"**{totals['animals']:,}**", inline=True)
    embed.add_field(name=f"{e('dk_gift')} Items", value=f"**{totals['items']:,}**", inline=True)
    embed.add_field(name=f"{e('dk_cmds')} Commands", value=f"**{totals['commands']:,}**", inline=True)
    embed.add_field(name=f"{e('dk_fail')} Failures", value=f"**{totals['failures']:,}**", inline=True)
    embed.add_field(name="Status", value=f"**{len(active)}/{len(tokens)}** farming", inline=True)

    lines = []
    for i, entry in enumerate(tokens):
        name = stats.get(entry["token"], {}).get("name") or "unknown"
        icon = e("dk_on") if entry["token"] in active else e("dk_off")
        lines.append(f"{icon} `#{i}` {name}")
    embed.add_field(name="Accounts", value="\n".join(lines[:20]) or "*(none registered)*", inline=False)
    embed.set_footer(text="Use the buttons below to page through accounts")
    return embed


def account_embed(
    index: int,
    entry: dict,
    stat: dict,
    running: bool,
    total_accounts: int,
    use_custom: bool = True,
) -> disnake.Embed:
    def e(name: str) -> str:
        return E.get(name, use_custom)
    name = stat.get("name") or "unknown"
    status = f"{e('dk_on')} Farming" if running else f"{e('dk_off')} Stopped"
    embed = disnake.Embed(
        title=f"{e('dk_farm')} {name}",
        description=f"Account **#{index}** · {status}",
        color=COLOR_OK if running else 0x808090,
    )
    embed.add_field(name=f"{e('dk_coin')} Coins earned", value=f"**{stat.get('coins', 0):,}**", inline=True)
    embed.add_field(name=f"{e('dk_paw')} Animals", value=f"**{stat.get('animals', 0):,}**", inline=True)
    embed.add_field(name=f"{e('dk_gift')} Items", value=f"**{stat.get('items', 0):,}**", inline=True)
    embed.add_field(name=f"{e('dk_cmds')} Commands", value=f"**{stat.get('commands', 0):,}**", inline=True)
    embed.add_field(name=f"{e('dk_fail')} Failures", value=f"**{stat.get('failures', 0):,}**", inline=True)
    embed.add_field(name="Token", value=f"`{entry['token'][:4]}...{entry['token'][-4:]}`", inline=True)
    embed.set_footer(text=f"Page {index + 1} of {total_accounts} · {config.BRAND_NAME} v3")
    return embed
