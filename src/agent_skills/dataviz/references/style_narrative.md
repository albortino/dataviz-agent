# Narrative Style Mode (Strategic Decision-Making & Value-Driver Storytelling)

- **Objective**: Craft executive-ready, decision-focused visualizations structured around an active argumentative thesis (Minto Pyramid).
- **Seaborn Idiom**: `sns.barplot(data=df_sorted, x=..., y=..., ax=ax, palette=[VK_ACCENT if c == driver else VK_GRAY for c in df_sorted['cat']])`.
- **Interpretive Ink & Focus**:
  - Keep all comparison cohorts and baseline categories in muted neutral gray (`VK_GRAY`).
  - Highlight exclusively the single focal driver/segment in high-contrast accent (`VK_ACCENT`).
- **MECE Partitioning & Ordering**:
  - Ensure categorical decompositions are Mutually Exclusive and Collectively Exhaustive; label residuals explicitly (*"Other"*, *"Rest of World"*).
  - Categorical bars must be strictly ordered by metric magnitude so the focal driver's relative contribution is instantly evident.
- **Action Title (Declarative Thesis)**:
  - Formulate a full-sentence declarative statement containing exact numbers, direction, and subject.
  - *Bad*: "Margin by Customer Segment"
  - *Good*: "Enterprise tier generated 68% ($2.4M) of margin from only 18% of accounts"
- **In-Plot Callout Annotation**:
  - Add an in-plot explanation box or bracket (`VK_apply_narrative_layout(ax, action_title, callout)`) detailing the mechanism behind the driver.
- **Direct Notation**:
  - Direct bar value labels (`ax.bar_label(ax.containers[0], fmt="%.1f")`) placed immediately at the mark edges.
- **Verbal Response Structure (3-Tier Protocol)**:
  1. **Observation (What happened?)**: Quantitative facts and exact numbers.
  2. **Driver (Why did it happen?)**: Underlying segment drivers or covariates (use correlational verbs like *"associated with"*, *"co-occurs with"* unless a controlled trial was run).
  3. **Next Step (What should be checked next?)**: Actionable business implication or sensitivity query.
- **Layout Helper**: `VK_apply_narrative_layout(ax, action_title, callout)`


