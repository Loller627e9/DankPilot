"""Dank Farm — a multi-account Dank Memer automation panel.

Package layout:
    config     — environment-driven settings
    store      — tiny JSON persistence helpers
    emojis     — custom-emoji lookup with unicode fallback
    banner     — Pillow banner renderer
    grinder    — selfbot account lifecycle (login, farm loop, watchdog)
    parsing    — reply parsing + stats accounting (pure, unit-testable)
    ui         — embed / banner payload builders
    bot        — the admin bot (disnake): commands + paginated stats views
    keepalive  — aiohttp health server + self-ping for free hosts
"""

__version__ = "3.0.0"
__brand__ = "DANK FARM"
