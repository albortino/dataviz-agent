# Banned & Discouraged Patterns

- **Coordinate Mismatches on Direct Labels**: Swapping X and Y in manual `ax.text()` calls (e.g. putting metric value as X on a vertical bar chart, causing labels to fly off to the right into empty white space); always use `VK_label_bars(ax)` or `ax.bar_label(c)` instead.
- **Harsh Black Borders**: Adding `edgecolor='black'` to bars/patches; use clean borderless fills (`edgecolor='none'`) adhering to the minimalist design system.
- **Duplicate Title Collisions**: Calling `ax.set_title()` manually while also calling `VK_apply_clean_layout` or `VK_apply_narrative_layout` (causes overlapping double titles).
- **Floating Text Boxes & Coordinate Hacks**: Using `ax.text()` with arbitrary relative/negative coordinates (e.g. `ax.text(0.5, -0.15, ...)`); use `VK_*` helpers or `VK_label_bars` instead.
- **Layer Hacking**: Painting over Seaborn charts with raw `ax.barh(0, ...)`; use `palette=[VK_ACCENT if c == driver else VK_GRAY for c in ...]` directly in `sns.barplot`.
- **Contradictory / Unverified Titles**: Making claims in the title or callout that contradict the actual data shown (e.g. labeling rural districts as urban).
- **Color Overuse**: Rainbow palettes or unique colors per bar when a single hue suffices; unmotivated color schemes.
- **Unsorted Categories**: Leaving categorical bars/groups in arbitrary or alphabetical order rather than sorted by value (LINT [sorting]).
- **Bar Axis Baseline**: Bar/column charts with axes not starting at 0 (LINT [baseline]).
- **Angled / Truncated Labels**: Vertical bars with slanted/rotated x-labels when k>5; must use horizontal bars instead.
- **Detached Legends**: Separate legends for 1 or 2 series; use direct line labels or title context instead (LINT [legend]).
- **Passive / Generic Titles**: Topic titles like "Revenue by Product" or "Plot of X"; require active verb + takeaway numbers (LINT [title]).
- **Missing Notations**: Raw large floating point numbers (e.g. 1423859.32) without units/format ($1.4M) on annotations or axes.
- **Chartjunk**: 3D effects, pie charts with >4 slices, dual non-standard axes, and dynamite plots (bar + error whiskers).
- **Unsorted Heatmaps**: Unordered correlation matrices without hierarchical or value-based clustering.


