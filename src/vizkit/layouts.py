"""Minimal deterministic layouts for matplotlib Axes.

Why: replaces ad-hoc spine/grid/title boilerplate that drifts across
turns. Pure matplotlib (+ optional seaborn despine); no new deps.
"""
from typing import Optional
from .theme import TOKENS


def _despine(ax) -> None:
    try:
        import seaborn as sns
        sns.despine(ax=ax, top=True, right=True, left=True, bottom=False)
    except Exception:
        for side in ("top", "right", "left"):
            if side in ax.spines:
                ax.spines[side].set_visible(False)
    if "bottom" in ax.spines:
        ax.spines["bottom"].set_color(TOKENS["text_muted"])
        ax.spines["bottom"].set_linewidth(0.8)


def _base_grid(ax) -> None:
    ax.yaxis.grid(True, color=TOKENS["grid_line"], linewidth=0.7, zorder=0)
    ax.xaxis.grid(False)
    ax.set_axisbelow(True)
    ax.tick_params(colors=TOKENS["text_muted"], labelsize=8.5)
    # Subtly style existing axis labels without clearing them
    if ax.get_xlabel():
        ax.xaxis.label.set_color(TOKENS["text_muted"])
        ax.xaxis.label.set_fontsize(9)
    if ax.get_ylabel():
        ax.yaxis.label.set_color(TOKENS["text_muted"])
        ax.yaxis.label.set_fontsize(9)


def apply_clean_layout(ax, title: str, subtitle: str = "",
                       source: Optional[str] = None,
                       xlabel: Optional[str] = None,
                       ylabel: Optional[str] = None) -> None:
    """Neutral minimal layout: horizontal grid only, title + subtitle.

    Use for exploration summaries and general findings (mode=editorial
    or exploration). Title should state the takeaway, subtitle the
    units/aggregation/timeframe.
    """
    fig = ax.get_figure()
    fig.patch.set_facecolor(TOKENS["background"])
    ax.set_facecolor(TOKENS["background"])
    _despine(ax)
    _base_grid(ax)
    if xlabel is not None:
        ax.set_xlabel(xlabel)
    if ylabel is not None:
        ax.set_ylabel(ylabel)
    if ax.get_xlabel():
        ax.xaxis.label.set_color(TOKENS["text_muted"])
        ax.xaxis.label.set_fontsize(9)
    if ax.get_ylabel():
        ax.yaxis.label.set_color(TOKENS["text_muted"])
        ax.yaxis.label.set_fontsize(9)
    ax.margins(x=0.15)
    # Clear any center/right titles to prevent double-title collisions
    ax.set_title("", loc="center")
    ax.set_title("", loc="right")
    if subtitle:
        # Pad title generously above subtitle (placed at 1.02)
        ax.set_title(title, loc="left", fontsize=13, fontweight="bold",
                     color=TOKENS["text_dark"], pad=38)
        ax.text(0.0, 1.025, subtitle, transform=ax.transAxes, fontsize=9.5,
                color=TOKENS["text_muted"], ha="left", va="bottom")
    else:
        ax.set_title(title, loc="left", fontsize=13, fontweight="bold",
                     color=TOKENS["text_dark"], pad=18)
    if source:
        fig.text(0.01, 0.0, f"Source: {source}", fontsize=8,
                 color=TOKENS["text_muted"], ha="left")


def apply_narrative_layout(ax, action_title: str, callout: str = "",
                           xlabel: Optional[str] = None,
                           ylabel: Optional[str] = None) -> None:
    """Decision-oriented layout: full-sentence title + callout.

    Use when the chart supports a recommendation (mode=narrative).
    action_title must be a complete sentence with a number
    (e.g. "Segment A drove 68% of margin despite fewer customers").
    callout is placed neatly below the action title to prevent data-mark collisions.
    """
    apply_clean_layout(ax, title=action_title, subtitle=callout, xlabel=xlabel, ylabel=ylabel)


def label_bars(ax, fmt: str = "%.1f", color: Optional[str] = None) -> None:
    """Annotate values directly at bar ends with safe padding and visible text color."""
    text_color = color or TOKENS["text_dark"]
    try:
        for c in ax.containers:
            ax.bar_label(c, fmt=fmt, padding=4, fontsize=8.5, color=text_color)
        ax.margins(x=0.12, y=0.12)
    except Exception:
        pass


def direct_label_last(ax) -> None:
    """Label each line at its last point; hides legend if it exists.

    Why: end-point labels remove eye travel between legend and lines.
    Falls back silently if lines have no data.
    """
    try:
        for line in ax.get_lines():
            x, y = line.get_xdata(), line.get_ydata()
            if len(x) == 0:
                continue
            ax.text(x[-1], y[-1], f" {line.get_label()}",
                    color=line.get_color(), fontsize=8.5, va="center",
                    ha="left", clip_on=True)
        leg = ax.get_legend()
        if leg is not None:
            leg.remove()
    except Exception:
        pass


def sort_bars(ax, axis: str = "x") -> None:
    """Sort bar containers by value so rank order is explicit.

    Only affects axes with patches (bar charts). No-op otherwise.
    """
    try:
        patches = list(ax.patches)
        if not patches:
            return
        if axis == "x":
            ticks, vals = list(ax.get_xticks()), [p.get_height() for p in patches]
            order = sorted(range(len(vals)), key=lambda i: vals[i])
            ax.set_xticks([ticks[i] for i in order if i < len(ticks)])
            ax.set_xticklabels([t.get_text() for t in
                                [ax.xaxis.get_ticklabels()[i]
                                 for i in order if i < len(ax.xaxis.get_ticklabels())]])
        else:
            vals = [p.get_width() for p in patches]
            order = sorted(range(len(vals)), key=lambda i: vals[i])
            yticks = list(ax.get_yticks())
            ax.set_yticks([yticks[i] for i in order if i < len(yticks)])
    except Exception:
        pass
