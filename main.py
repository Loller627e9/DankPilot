#!/usr/bin/env python3
"""Root entry point for Dank Farm.

Run with ``python main.py`` from the repository root. The package entry point
``python -m dankfarm`` does the same thing; this file exists so hosts and
platforms that expect a ``main.py`` at the top level work without configuration.
"""

from __future__ import annotations

from dankfarm.__main__ import run

if __name__ == "__main__":
    run()
