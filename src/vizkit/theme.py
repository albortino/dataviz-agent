"""Deterministic chart styling tokens and helpers.

Why this exists: LLM-generated matplotlib code drifts in colors, grids
and spines across turns. Central tokens keep every figure consistent
without adding dependencies. Palettes are colorblind-safe (Okabe-Ito
inspired) and use no vendor or publication branding.
"""
from typing import Dict, List

# Generic, neutral design tokens. No company or publication affiliation.
TOKENS: Dict[str, str] = {
    "accent": "#D55E00",       # vermillion: highlights the primary series only
    "primary": "#0072B2",      # blue: secondary series / comparison
    "secondary": "#009E73",    # teal-green: tertiary series
    "extra": "#CC79A7",        # pink: fourth series when needed
    "neutral_base": "#999999",  # mid gray: background categories
    "neutral_light": "#CCCCCC",  # light gray: grid-adjacent fills
    "text_dark": "#222222",
    "text_muted": "#68737D",
    "grid_line": "#E5E5E5",
    "background": "#FFFFFF",
}

# Colorblind-safe categorical order: accent first only when one series
# carries the message, otherwise start at primary.
CATEGORICAL: List[str] = [
    "#0072B2", "#D55E00", "#009E73", "#CC79A7",
    "#56B4E9", "#E69F00", "#999999",
]

SINGLE_SERIES_COLOR = "#0072B2"
HIGHLIGHT_COLOR = "#D55E00"
BASE_GRAY = "#999999"

MODES = ("exploration", "editorial", "narrative")


def palette(n: int) -> List[str]:
    """Return first n categorical colors (cycles if n exceeds length)."""
    if n <= 0:
        return []
    return [CATEGORICAL[i % len(CATEGORICAL)] for i in range(n)]
