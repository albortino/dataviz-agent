# Missingness & Integrity Heuristics (pandas only)

- Report missing % per column. If nulls in a metric cluster in one
  category/time window, say so; do not silently drop.
- Zero-inflation: if >20% of values are exactly 0, prefer median or
  two-part summary (share nonzero + median of nonzero).
- Capped values (many rows at round caps like 999, 100, 0): note possible
  truncation before charting means.
- Outliers: use median/IQR fences, not std (which outliers distort).
- Never average id-like columns (all-unique ints, names with id/code).
