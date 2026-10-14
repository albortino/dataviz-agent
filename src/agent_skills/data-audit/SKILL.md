---
name: data-audit
runtime: dataviz-agent-only
title: Data Health Audit
icon: fa-solid fa-shield-halved
badge: Pre-Flight Health Gate
description: Pre-flight dataset sanity check screening for missingness, skew, high cardinality, and constant or ID columns.
capabilities: ["Missingness Screen", "Numeric Skew Gate", "Cardinality Check", "ID-Column Protection"]
---

# Data Audit Skill (P0, pandas only, no scipy)

> Runtime-only for dataviz-agent. Coding agents must ignore
> `src/agent_skills/`.

Call `audit_dataset` first on the eda-path or when results look suspect.

Checks (all pandas/numpy, no new deps):
- Shape, missing % per column; flag columns >30% missing.
- Numeric skew via `(mean-median)/std`; |skew|>1 suggests log or median.
- Cardinality of object columns; k>50 warns about high-cardinality grouping.
- Id-like columns (name contains id/code/zip/phone or all-unique ints):
  never aggregate with mean/sum.
- Constant columns (nunique<=1); drop from encodings.

Return as compact `DataHealthReport` text; state the assumed definition
of ambiguous metrics (e.g. "active = rows with events>0") and ask only if
the definition changes the answer.
