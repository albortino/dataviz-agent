# Editorial Style Mode (Journalistic Synthesis & Minimalist Clarity)

- **Objective**: Deliver high-integrity, uncluttered visual reporting inspired by world-class data journalism standards.
- **Seaborn Idiom**: `sns.barplot(data=df_sorted, x=..., y=..., ax=ax, color=VK_PRIMARY)` or `sns.lineplot(data=df, x=..., y=..., hue=..., ax=ax, palette=VK_palette(k))`.
- **Canvas & Frame**: Pure white canvas background; completely remove top, right, and left spines (`sns.despine(ax=ax, top=True, right=True, left=True, bottom=False)`); bottom x-axis spine in subtle muted tone (0.8pt).
- **Grid Architecture**: Horizontal grid lines only (`#E5E5E5`, 0.7pt); strictly no vertical grid lines; set `ax.set_axisbelow(True)` so grid remains beneath data marks.
- **Color Discipline**:
  - Single series: uniform neutral blue (`VK_PRIMARY`).
  - Multi-series comparisons: max 2–4 harmonious categorical hues via `VK_palette(k)`.
  - Never map distinct random colors to categories on a single bar chart.
- **Sorting & Orientation**: Categorical data must be value-sorted; horizontal bars (`y=category, x=metric`) whenever $k > 5$ or category labels exceed 8 characters.
- **Typography & Headline**:
  - Left-aligned bold 13pt title stating the takeaway with concrete metrics (e.g. *"Clean Energy investments surged 34% to $1.8T in 2023"*).
  - Contextual 9.5pt muted subtitle defining units, aggregation method, and timeframe (e.g. *"USD billions, annual total, 2018–2023"*).
  - Footnote provenance: `Source: <dataset>` (8pt muted text).
- **Direct Notation**:
  - Use `ax.bar_label(ax.containers[0], fmt="%.1f")` for direct bar numbers.
  - Apply `VK_direct_label_last(ax)` to anchor line labels at series endpoints instead of detached legends.
- **Layout Helper**: `VK_apply_clean_layout(ax, title, subtitle, source)`


