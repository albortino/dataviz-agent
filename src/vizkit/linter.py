"""Deterministic pre-render checks for matplotlib Axes.

Why: catches integrity violations (truncated bars, pie overload,
redundant legends, missing takeaway titles) before PNG export so the
agent can self-correct. Returns warnings; never raises.
"""
from typing import List


def inspect(ax, chart_intent: str = "") -> List[str]:
    """Audit one Axes object. chart_intent hints at length encoding."""
    findings: List[str] = []
    try:
        # 1. Zero-baseline integrity for length-encoded marks.
        if chart_intent in ("magnitude", "ranking", "comparison_discrete", "bar", ""):
            if len(getattr(ax, "patches", [])) > 0:
                orientation = _bar_orientation(ax)
                if orientation == "vertical":
                    ymin, _ = ax.get_ylim()
                    if ymin > 0.0:
                        findings.append(
                            "LINT [baseline]: vertical bar axis starts above 0; "
                            "set ylim lower bound to 0.")
                elif orientation == "horizontal":
                    xmin, _ = ax.get_xlim()
                    if xmin > 0.0:
                        findings.append(
                            "LINT [baseline]: horizontal bar axis starts above 0; "
                            "set xlim lower bound to 0.")
        # 2. Pie-slice overload (perceptually unreliable beyond few slices).
        try:
            texts = ax.texts
            if len(ax.patches) >= 6 and "pie" in str(type(ax)).lower():
                findings.append(
                    "LINT [pie]: 6+ slices detected; use sorted bar chart instead.")
            elif len(ax.patches) >= 6 and chart_intent == "part_whole":
                findings.append(
                    "LINT [pie]: 6+ categories in part-to-whole; use 100% "
                    "stacked bar or top-N + Other bar instead.")
        except Exception:
            pass
        # 3. Redundant legend for a single series.
        try:
            legend = ax.get_legend()
            if legend is not None:
                labels = [t.get_text() for t in legend.get_texts()
                          if not t.get_text().startswith("_")]
                if len(labels) <= 1:
                    findings.append(
                        "LINT [legend]: single-series legend is redundant; "
                        "remove it and label directly.")
        except Exception:
            pass
        # 4. Title must state a takeaway, not a generic label.
        # Note: layouts use loc="left", while get_title() defaults to
        # loc="center", so all locations must be checked.
        try:
            title = (
                (ax.get_title(loc="left") or "").strip()
                or (ax.get_title(loc="center") or "").strip()
                or (ax.get_title(loc="right") or "").strip()
            )
            if not title:
                findings.append(
                    "LINT [title]: missing title; add an analytical takeaway "
                    "title (what changed, by how much, for whom).")
            elif _is_generic_title(title):
                findings.append(
                    "LINT [title]: generic label detected ('%s'); rewrite as "
                    "a takeaway sentence with a number." % title)
        except Exception:
            pass
        # 5. Continuous coordinate / scatter axis label check.
        try:
            has_scatter = any(
                "pathcollection" in type(c).__name__.lower()
                for c in getattr(ax, "collections", [])
            )
            if has_scatter or chart_intent in ("relation", "correlation", "scatter"):
                x_lbl = (ax.get_xlabel() or "").strip()
                y_lbl = (ax.get_ylabel() or "").strip()
                if not x_lbl or not y_lbl:
                    findings.append(
                        "LINT [axis]: scatter/relationship plot is missing axis labels; "
                        "set both ax.set_xlabel() and ax.set_ylabel() with variable name and units."
                    )
        except Exception:
            pass
    except Exception:
        pass
    return findings


def _bar_orientation(ax) -> str:
    """Infer bar orientation from patch geometry."""
    try:
        patches = list(ax.patches)
        if not patches:
            return ""
        xs = [p.get_x() for p in patches]
        ys = [p.get_y() for p in patches]
        widths = [p.get_width() for p in patches]
        heights = [p.get_height() for p in patches]

        # Horizontal bars: categories distributed on y-axis, all start at same x origin
        x_origin_same = (max(xs) - min(xs)) < 1e-4
        y_origin_same = (max(ys) - min(ys)) < 1e-4

        if x_origin_same and not y_origin_same:
            return "horizontal"
        if y_origin_same and not x_origin_same:
            return "vertical"

        # Fallback to dimension variance
        if (max(heights) - min(heights)) < 1e-4 and (max(widths) - min(widths)) >= 1e-4:
            return "horizontal"
        if (max(widths) - min(widths)) < 1e-4 and (max(heights) - min(heights)) >= 1e-4:
            return "vertical"

        return "horizontal" if max(widths) > max(heights) else "vertical"
    except Exception:
        return ""


_GENERIC_PREFIXES = ("revenue by", "sales by", "count of", "distribution of",
                     "plot of", "chart of", "value by", "number of")


def _is_generic_title(title: str) -> bool:
    """Flag short 'X by Y' labels without verb or number."""
    t = title.lower().strip()
    has_number = any(ch.isdigit() for ch in t)
    has_verb = any(w in t for w in ("rose", "fell", "grew", "dropped", "drove",
                                    "increased", "decreased", "led", "shifted",
                                    "outpaced", "declined", "recovered", "shows",
                                    "up ", "down "))
    if has_number or has_verb:
        return False
    return t.startswith(_GENERIC_PREFIXES) or len(t.split()) <= 3
