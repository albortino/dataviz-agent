---
name: predictive-forecast
runtime: dataviz-agent-only
title: Predictive Forecast & Anomalies
icon: fa-solid fa-chart-line
badge: Forward Horizon & Anomaly Pinning
description: Project future trends with statistical confidence intervals, detect trajectory inflections, and isolate anomaly bounds.
capabilities: ["Trend Extrapolation", "95% Confidence Corridor", "Inflection Detection", "Z-Score/IQR Outliers"]
---

# Predictive Forecast & Anomalies Skill

> Runtime-only for dataviz-agent.

## Purpose & USP
Standard data charts look backward at historical facts. This skill equips the agent to look forward and uncover non-obvious statistical irregularities:
1. **Forward Trend Extrapolation**: For sequential or time-series metrics, fit trend trajectories (+N future steps) using polynomial regression (`np.polyfit`), exponential smoothing, or rolling momentum without external dependencies.
2. **Confidence Corridors**: Compute prediction intervals (standard error / 95% CI) and render shaded uncertainty corridors using `ax.fill_between(future_x, lower_ci, upper_ci, alpha=0.15, color=VK_PRIMARY)`.
3. **Trajectory Inflection Points**: Identify where the second derivative changes sign (acceleration vs deceleration) and highlight the turning point.
4. **Statistical Anomaly Pinning**: Calculate dynamic outlier thresholds (Z-score |z| > 2.5 or IQR 1.5x) and flag anomalies with distinct callout pins on the plot.

## Visualization Requirements
- Historical data plotted as a solid line (`sns.lineplot`).
- Projected forecast plotted as a distinct dashed line (`linestyle='--'`).
- Shaded confidence corridor via `ax.fill_between`.
- Outlier points or inflection moments pinned with `VK_ACCENT` scatter markers or callout arrows.
- Subtitle must explicitly state: `Projection horizon: +N periods, 95% confidence corridor`.
