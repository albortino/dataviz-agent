"""Deterministic visual helpers pre-loaded into the agent sandbox."""
from .theme import TOKENS, CATEGORICAL, SINGLE_SERIES_COLOR, HIGHLIGHT_COLOR, BASE_GRAY, MODES, palette
from .layouts import apply_clean_layout, apply_narrative_layout, direct_label_last, sort_bars, label_bars
from .linter import inspect

# Agent VK_* alias bindings
VK_TOKENS = TOKENS
VK_CATEGORICAL = CATEGORICAL
VK_PRIMARY = SINGLE_SERIES_COLOR
VK_ACCENT = HIGHLIGHT_COLOR
VK_GRAY = BASE_GRAY
VK_palette = palette
VK_apply_clean_layout = apply_clean_layout
VK_apply_narrative_layout = apply_narrative_layout
VK_direct_label_last = direct_label_last
VK_label_bars = label_bars

__all__ = [
    "TOKENS", "CATEGORICAL", "SINGLE_SERIES_COLOR", "HIGHLIGHT_COLOR",
    "BASE_GRAY", "MODES", "palette", "apply_clean_layout",
    "apply_narrative_layout", "direct_label_last", "sort_bars", "label_bars", "inspect",
    "VK_TOKENS", "VK_CATEGORICAL", "VK_PRIMARY", "VK_ACCENT", "VK_GRAY",
    "VK_palette", "VK_apply_clean_layout", "VK_apply_narrative_layout", "VK_direct_label_last", "VK_label_bars"
]
