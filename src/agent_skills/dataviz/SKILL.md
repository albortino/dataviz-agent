---
name: dataviz
runtime: dataviz-agent-only
description: Select, generate, format, and verify statistical charts for exploration and summary reports.
modes: [exploration, editorial, narrative]
---

# Data Visualization Skill

## Principle: one chart, one checkable statement

No code before this sentence is filled: "This chart shows that [precise observation with numbers]."

## Plotting engine: Seaborn prioritized

Always use `seaborn` (`sns`) as primary plotting engine for statistical aesthetics, paired with `matplotlib.pyplot` (`plt`) and `VK_*` helpers.
- Ranking/Categorical: `sns.barplot(data=df_sorted, x=val, y=cat, color=VK_PRIMARY)`
- Trends/Time: `sns.lineplot(data=df, x=time_col, y=val, hue=series, palette=VK_palette(k))`
- Distributions: `sns.histplot(data=df, x=col, kde=True, color=VK_PRIMARY)`
- Relationships: `sns.scatterplot(data=df, x=x_col, y=y_col, alpha=0.7, color=VK_PRIMARY)` + `sns.regplot(..., scatter=False, ax=ax)`
- Group comparison: `sns.boxplot(data=df, x=cat, y=val, color=VK_PRIMARY)`
- Correlation: `sns.heatmap(corr_matrix, cmap="Blues", annot=True, fmt=".2f", cbar=False)`

## Core communication guidelines

1. **Color restraint (less colors)**:
   - Single series: use 1 uniform color (`color=VK_PRIMARY`). Never assign arbitrary random colors to categories. If context allows, add suitable colors for aesthetics and better understanding.
   - Highlighting: color only the key driver in accent (`VK_ACCENT`), paint all other categories in muted gray (`VK_GRAY`).
   - Categorical hue: maximum 2-4 distinct colors only when comparing separate series (`palette=VK_palette(n)`).
2. **Chart ordering**:
   - Always sort categorical bars/groups by metric value (descending/ascending) before plotting; never leave unsorted or alphabetical unless natural time/ordinal sequence.
   - Use horizontal orientation (`y=cat, x=val`) whenever categories > 5 or names are long to prevent angled/overlapping labels.
3. **Notations & Direct labels**:
   - Takeaway title: full active sentence with numbers (e.g. "Segment A drove 68% of total margin"), not passive labels ("Sales by Segment").
   - Direct bar labels: use `VK_label_bars(ax, fmt="%.1f")` or `VK_label_bars(ax, fmt="%d")` for safe, visible direct annotations.
   - Direct line labeling: label line endpoints via `VK_direct_label_last(ax)` instead of detached legends.
   - Subtitles & units: specify timeframe, units, and aggregation in subtitle (e.g. `USD thousands, sum, Q1-Q4 2024`).
   - Axis labels: Always explicitly label both axes on scatter plots (`ax.set_xlabel('...')`, `ax.set_ylabel('...')`) and continuous dimensions with variable name and units. Categorical bar charts may omit redundant labels if categories are self-evident.

## Style modes (select one per visualization)

### 1. `editorial` mode (Journalistic Synthesis & Minimalist Clarity)
- **Goal**: Clean, objective presentation of findings with maximum data-to-ink ratio and zero chartjunk.
- **Canvas & Grid**: White background, despine top/right/left borders (`sns.despine`), muted horizontal grid lines only (`#E5E5E5`), muted ticks.
- **Palette**: Restrained functional color. 1 uniform hue (`color=VK_PRIMARY`) or 2–4 categorical hues (`palette=VK_palette(k)`).
- **Typography & Layout**:
  - Left-aligned bold takeaway headline (13pt) with key metric or finding.
  - Contextual subtitle (9.5pt muted) specifying units, aggregation, and timeframe (e.g. `USD millions, annual sum, 2021–2024`).
  - Direct end-point labels on lines (`VK_direct_label_last`) and direct bar values (`ax.bar_label`) instead of detached legends.
- **Helper**: `VK_apply_clean_layout(ax, title, subtitle, source)`

### 2. `narrative` mode (Strategic Decision-Making & Value-Driver Storytelling)
- **Goal**: Persuasive executive argument supporting an actionable recommendation or causal hypothesis (Minto Pyramid).
- **Interpretive Ink & Palette**: Keep all comparison / baseline categories in neutral gray (`VK_GRAY`); highlight the single focal driver in vivid accent (`VK_ACCENT`).
- **Ordering & Partitioning**: MECE-partitioned categories strictly sorted by metric size so the focal driver's relative contribution is instantly evident.
- **Action Title & Annotations**:
  - Full-sentence Action Title stating the core thesis with exact numbers and subject (e.g. *"Enterprise tier drove 68% of margin despite representing only 18% of accounts"*).
  - In-plot callout box (`VK_apply_narrative_layout(ax, action_title, callout)`) explaining the driving catalyst or inflection point.
  - Direct bar labels (`ax.bar_label(ax.containers[0], fmt="%.1f")`).
- **Response Structure**: Strict 3-tier delivery: Observation (what + figures) / Driver (why / segments) / Next step (actionable recommendation).
- **Helper**: `VK_apply_narrative_layout(ax, action_title, callout)`

### 3. `exploration` mode (Diagnostic Discovery & Hypothesis Validation)
- **Goal**: High-density diagnostic inspection of unknown distributions, multi-dimensional structures, and statistical anomalies.
- **Visual Archetype**: Small multiples / faceted grids (`sns.FacetGrid`), distribution overlays (`sns.histplot` with KDE, or `sns.boxplot` with `sns.stripplot`), scatter matrices, and ECDF curves (`sns.ecdfplot`).
- **Formatting**: Dense data display, exploratory titles specifying variables and sample size (e.g. `Distribution of Revenue across Customer Tiers (N=4,200)`), neutral functional color (`VK_PRIMARY`).

## Two-track routing

- **fast-path** (explicit request: "bar chart of X by Y"):
  1. Default to `editorial` mode (or `narrative` if a specific comparison/driver is requested).
  2. Sort data, prioritize Seaborn (`sns.barplot(data=df_sorted, x=..., y=..., ax=ax, color=VK_PRIMARY)`), apply layout helper, and run `execute_python_code`.
- **eda-path** (vague request: "analyze revenue", "what drives churn"):
  1. Call `audit_dataset` (missingness, skew, cardinality, id-like columns).
  2. State 2-3 hypotheses as `VisualizationPlan` JSON with `intent` and `mode` (`exploration`, `editorial`, or `narrative`).
  3. Execute one plan at a time using appropriate Seaborn method and layout helper; report Observation / Driver / Next step.

## Selection matrix (see registry.yaml)

ranking -> sorted horizontal bars | trend -> line + end-point labels |
distribution N>500 -> histogram (Freedman-Diaconis) / ECDF | relation -> scatter
with alpha + trend line | part-to-whole k<=4 -> 100% stacked bar |
2-period change -> slope/dumbbell sketch via lines.

## Sandbox helpers (pre-loaded as VK_* globals, no imports needed)

`VK_apply_clean_layout`, `VK_apply_narrative_layout`, `VK_direct_label_last`,
`VK_label_bars`, `VK_palette(n)`, `VK_ACCENT`, `VK_PRIMARY`, `VK_GRAY`. Fix any `LINT:` warnings on re-run.
