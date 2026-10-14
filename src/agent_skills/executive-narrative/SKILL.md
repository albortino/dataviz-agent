---
name: executive-narrative
runtime: dataviz-agent-only
title: Executive Narrative
icon: fa-solid fa-briefcase
badge: C-Suite Decision Framework
description: Synthesize findings into Minto Pyramid decision memos with BLUF, Pareto root drivers, and strategic action matrices.
capabilities: ["BLUF Synthesis", "Driver Decomposition", "Action Matrix", "Callout Annotations"]
---

# Executive Narrative Skill

> Runtime-only for dataviz-agent.

## Purpose & USP
Standard data tools describe what is in the data. The Executive Narrative skill shifts the agent from descriptive analysis to strategic decision memos using the Minto Pyramid framework:
1. **BLUF (Bottom-Line Up Front)**: 1 definitive takeaway sentence stating the primary metric outcome, magnitude, and business impact with exact figures.
2. **Driver Decomposition**: Root-cause attribution answering *why* this occurred. Focus on the 20% of segments or levers driving 80% of variance (MECE partitioning).
3. **Strategic Action Matrix**: 2-3 concrete, prioritized next steps with owner/timeframe, expected upside, and trade-off or risk.

## Visualization Requirements
- Mandatory `narrative` mode using `VK_apply_narrative_layout(ax, action_title, callout)`.
- Baseline or comparison categories in neutral gray (`VK_GRAY`); highlight the single primary driver in vivid accent (`VK_ACCENT`).
- In-plot callout box explaining the catalyst or critical inflection.
- Direct bar or line endpoint annotations with exact values.

## Output Shape
Always present the final response with three clear sections:
- **Bottom-Line Up Front**: Immediate quantified takeaway.
- **Key Drivers & Variance**: Attribution breakdown.
- **Strategic Next Steps**: Actionable matrix.
