# Perception & Communication Rules

## 1. Plotting with Seaborn & Matplotlib
- Prioritize Seaborn (`sns`) for all statistical charts (`sns.barplot`, `sns.lineplot`, `sns.scatterplot`, `sns.histplot`, `sns.boxplot`, `sns.heatmap`).
- Pass tidy DataFrames: `sns.barplot(data=df_sorted, x='revenue', y='product', color=VK_PRIMARY)`.
- Apply `VK_apply_clean_layout(ax, ...)` or `VK_apply_narrative_layout(ax, ...)` to strip chartjunk and set typography.

## 2. Color Discipline (Less Colors)
- **Single Series**: Use a single functional color (`VK_PRIMARY`). Never map distinct rainbow colors to categories when bar position already separates them.
- **Intentional Highlighting**: For focus/takeaway stories, color the single key driver in accent (`VK_ACCENT`) and render all comparison categories in neutral gray (`VK_GRAY`).
- **Multi-Series**: Use max 2-4 distinct hues (`VK_palette(k)`) only when encoding a second categorical dimension (`hue=...`).
- **Sequential / Heatmap**: Use a single-hue sequential colormap (e.g. `Blues` or `crest`), not diverging or rainbow palettes unless zero-centered.

## 3. Order in Charts (Sorting)
- **Categorical Data**: Always sort bars/categories by metric value (descending/ascending) before plotting so rankings and differences are immediately legible.
- **Natural Sequences**: Preserve natural chronological or ordinal orders (e.g. months, age brackets, survey likert scales).
- **Horizontal Orientation**: Default to horizontal bars (`y=category, x=metric`) whenever category count > 5 or category names are long (>8 chars) to avoid angled or truncated labels.

## 4. Notations & Direct Annotations
- **Takeaway Title**: Lead with an active sentence containing specific numbers (e.g., "Product X drove 52% ($1.4M) of total sales"). Avoid passive labels ("Sales by Product").
- **Direct Bar Labels**: Annotate bar values directly (`ax.bar_label(ax.containers[0], fmt='%.1f')`) so readers do not have to trace back to the axis.
- **Direct Line Endpoints**: Use `VK_direct_label_last(ax)` to put series names at line ends, avoiding disconnected legends.
- **In-Plot Callouts**: Add a callout box or arrow for critical inflection points or anomalies.
- **Units & Context Subtitle**: Always include units, timeframe, and aggregation in the subtitle (e.g., "USD thousands, monthly sum, 2023-2024").
- **Axis Titles on Continuous Dimensions**: Always explicitly label both axes on scatter plots (`ax.set_xlabel('...')`, `ax.set_ylabel('...')`) and continuous coordinate charts with metric name and units.

## 5. Visual Hierarchy & Encoding
- Length > 2D Position > Area > Color Saturation for quantitative accuracy.
- Zero baseline is strictly required for length marks (bars, lollipops).
- Never use 3D, dual unscaled axes, or unaggregated spaghetti plots.

