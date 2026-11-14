"""Pillow banner renderer.

Renders the branded cards used in the admin bot's replies. Everything is
optional: if Pillow is unavailable or a font is missing, :func:`available`
returns ``False`` and callers fall back to plain embeds.
"""

from __future__ import annotations

import io
from pathlib import Path

from . import config

try:  # Pillow is a soft dependency.
    from PIL import Image, ImageDraw, ImageFont

    _PIL = True
except ImportError:  # pragma: no cover - exercised only without Pillow
    _PIL = False

_FONT_FILES = {
    "bold": "DejaVuSans-Bold.ttf",
    "regular": "DejaVuSans.ttf",
    "mono": "DejaVuSansMono.ttf",
}

_font_cache: dict[tuple[str, int], object] = {}


def available() -> bool:
    return _PIL


def _font(kind: str, size: int):
    key = (kind, size)
    if key in _font_cache:
        return _font_cache[key]
    path = Path(config.FONT_DIR) / _FONT_FILES.get(kind, _FONT_FILES["regular"])
    font = None
    if path.exists():
        try:
            font = ImageFont.truetype(str(path), size)
        except OSError:
            font = None
    if font is None:  # pragma: no cover - only when fonts are missing
        font = ImageFont.load_default()
    _font_cache[key] = font
    return font


def _background(width: int, height: int, top: tuple, bottom: tuple):
    """Vertical gradient background."""
    base = Image.new("RGB", (width, height), top)
    draw = ImageDraw.Draw(base)
    for y in range(height):
        t = y / max(1, height - 1)
        color = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        draw.line([(0, y), (width, y)], fill=color)
    return base


def _glow_text(draw, xy, text, font, fill, glow, spread: int = 3) -> None:
    """Draws text with a soft outer glow for a neon look."""
    x, y = xy
    for dx in range(-spread, spread + 1):
        for dy in range(-spread, spread + 1):
            if dx * dx + dy * dy <= spread * spread:
                draw.text((x + dx, y + dy), text, font=font, fill=glow)
    draw.text(xy, text, font=font, fill=fill)


def _centered(draw, text, font, width, y, fill, glow=None) -> None:
    length = draw.textlength(text, font=font)
    x = max(0, (width - length) / 2)
    if glow:
        _glow_text(draw, (x, y), text, font, fill, glow)
    else:
        draw.text((x, y), text, font=font, fill=fill)


def render_banner(
    title: str | None = None,
    subtitle: str | None = None,
    *,
    width: int = 1000,
    height: int = 260,
    accent: tuple = (120, 80, 255),
    accent2: tuple = (0, 200, 255),
) -> bytes | None:
    """Renders a branded banner and returns PNG bytes (or ``None``)."""
    if not _PIL:
        return None

    img = _background(width, height, (18, 16, 38), (34, 22, 66))
    draw = ImageDraw.Draw(img)

    # Accent frame.
    for i in range(4):
        draw.rectangle([i, i, width - 1 - i, height - 1 - i], outline=accent)

    brand_font = _font("bold", 74)
    tag_font = _font("regular", 26)

    brand = title or config.BRAND_NAME
    _centered(draw, brand, brand_font, width, 52, (255, 255, 255), glow=accent)

    # Underline accent bar.
    bar_w = min(width - 160, int(draw.textlength(brand, font=brand_font)) + 60)
    bx = (width - bar_w) / 2
    draw.rectangle([bx, 146, bx + bar_w, 151], fill=accent2)

    _centered(draw, subtitle or config.BRAND_TAGLINE, tag_font, width, 168, (215, 210, 240))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def render_account_card(
    name: str,
    *,
    index: int | None = None,
    running: bool = False,
    coins: int = 0,
    animals: int = 0,
    items: int = 0,
    commands: int = 0,
    failures: int = 0,
    width: int = 1000,
    height: int = 420,
) -> bytes | None:
    """Renders a single account's stats card."""
    if not _PIL:
        return None

    accent = (60, 200, 120) if running else (120, 120, 140)
    img = _background(width, height, (16, 18, 34), (28, 20, 54))
    draw = ImageDraw.Draw(img)
    for i in range(4):
        draw.rectangle([i, i, width - 1 - i, height - 1 - i], outline=accent)

    # Header strip.
    draw.rectangle([4, 4, width - 5, 96], fill=(24, 22, 50))
    head_font = _font("bold", 44)
    small = _font("regular", 24)
    label_font = _font("bold", 28)
    value_font = _font("bold", 46)

    heading = f"#{index}  {name}" if index is not None else name
    draw.text((36, 22), heading, font=head_font, fill=(255, 255, 255))

    status = "FARMING" if running else "STOPPED"
    sw = draw.textlength(status, font=small)
    draw.rounded_rectangle([width - sw - 76, 34, width - 36, 78], radius=18, fill=accent)
    draw.text((width - sw - 56, 40), status, font=small, fill=(10, 10, 20))

    # Metric grid (2 columns).
    metrics = [
        ("Coins earned", f"{coins:,}"),
        ("Animals caught", f"{animals:,}"),
        ("Items found", f"{items:,}"),
        ("Commands sent", f"{commands:,}"),
    ]
    col_w = (width - 96) // 2
    for i, (label, value) in enumerate(metrics):
        col, row = i % 2, i // 2
        x = 48 + col * col_w
        y = 150 + row * 130
        draw.text((x, y), label.upper(), font=label_font, fill=accent)
        draw.text((x, y + 42), value, font=value_font, fill=(255, 255, 255))

    draw.text((48, height - 52), f"failures: {failures}", font=small, fill=(150, 145, 175))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def render_overview(
    totals: dict,
    *,
    accounts: int = 0,
    running: int = 0,
    width: int = 1000,
    height: int = 420,
) -> bytes | None:
    """Renders the all-accounts overview card."""
    if not _PIL:
        return None

    accent = (120, 80, 255)
    img = _background(width, height, (18, 16, 38), (34, 22, 66))
    draw = ImageDraw.Draw(img)
    for i in range(4):
        draw.rectangle([i, i, width - 1 - i, height - 1 - i], outline=accent)

    title_font = _font("bold", 52)
    label_font = _font("bold", 26)
    value_font = _font("bold", 52)
    small = _font("regular", 24)

    draw.text((48, 34), f"{config.BRAND_NAME} — OVERVIEW", font=title_font, fill=(255, 255, 255))
    draw.rectangle([48, 104, 48 + 360, 110], fill=(0, 200, 255))

    metrics = [
        ("Total coins", f"{totals.get('coins', 0):,}"),
        ("Animals", f"{totals.get('animals', 0):,}"),
        ("Items", f"{totals.get('items', 0):,}"),
        ("Commands", f"{totals.get('commands', 0):,}"),
    ]
    col_w = (width - 96) // 2
    for i, (label, value) in enumerate(metrics):
        col, row = i % 2, i // 2
        x = 48 + col * col_w
        y = 150 + row * 130
        draw.text((x, y), label.upper(), font=label_font, fill=accent)
        draw.text((x, y + 40), value, font=value_font, fill=(255, 255, 255))

    draw.text((48, height - 52), f"{running}/{accounts} accounts farming", font=small, fill=(180, 175, 210))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
