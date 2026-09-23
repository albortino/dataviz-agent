# Exploration Style Mode (Diagnostic Discovery & Hypothesis Validation)

- **Objective**: Rapid, high-density statistical inspection of distributions, bivariate correlations, and anomaly identification.
- **Visual Archetype**:
  - Small multiples / facet grids (`sns.FacetGrid(df, col='group', col_wrap=3)`)
  - Distribution shapes: `sns.histplot(data=df, x=..., kde=True, color=VK_PRIMARY)` or `sns.ecdfplot(data=df, x=..., color=VK_PRIMARY)`
  - Outliers & group variance: `sns.boxplot(data=df, x=..., y=..., color=VK_PRIMARY)` combined with `sns.stripplot(..., alpha=0.3)`
  - Multidimensional relations: `sns.scatterplot(data=df, x=..., y=..., alpha=0.6, color=VK_PRIMARY)` with `sns.regplot(..., scatter=False)`
- **Color & Ink**: Uniform functional tone (`VK_PRIMARY`) or continuous sequential palette (e.g. `cmap="Blues"`).
- **Typography & Labels**:
  - Exploratory descriptive titles naming variables, sample sizes, and distributions (e.g. `Distribution of Unit Margins by Region (N=1,450)`).
  - Ticks and labels formatted legibly for statistical interpretation.
- **Workflow**: Generate diagnostic visualization, compute underlying summary statistics (medians, IQR, effect sizes), and state whether assumptions (normality, skewness, variance homogeneity) hold.
