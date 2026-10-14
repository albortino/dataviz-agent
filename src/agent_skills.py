"""Manifest of runtime agent skills for the dataviz-agent ReAct loop.

Why: the frontend needs a machine-readable list of available skills
(id, description, default state) to render toggles. Scans
src/agent_skills/*/SKILL.md frontmatter (name/description). No file
writes, no uploads. Coding agents must ignore this directory
(runtime: dataviz-agent-only).
"""
import os
from typing import Dict, List

SKILLS_DIR_CANDIDATES = (
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "agent_skills"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_skills"),
)

# Skills enabled unless the user opts out via active_skills.
DEFAULT_ON = ("dataviz", "data-audit")

# Metadata fallbacks if SKILL.md frontmatter is missing.
SKILL_METADATA = {
    "dataviz": {
        "title": "Data Visualization",
        "icon": "fa-solid fa-chart-pie",
        "badge": "Publication-Grade Visuals",
        "description": "High-density statistical charting with 3 style modes, takeaway headlines, Seaborn aesthetics, and zero chartjunk.",
        "capabilities": ["Seaborn Engine", "3 Style Modes", "Takeaway Titles", "Direct Bar/Line Labels"],
    },
    "data-audit": {
        "title": "Data Health Audit",
        "icon": "fa-solid fa-shield-halved",
        "badge": "Pre-Flight Health Gate",
        "description": "Pre-flight dataset sanity check screening for missingness, skew, high cardinality, and constant or ID columns.",
        "capabilities": ["Missingness Screen", "Numeric Skew Gate", "Cardinality Check", "ID-Column Protection"],
    },
    "executive-narrative": {
        "title": "Executive Narrative",
        "icon": "fa-solid fa-briefcase",
        "badge": "C-Suite Decision Framework",
        "description": "Synthesize findings into Minto Pyramid decision memos with BLUF, Pareto root drivers, and strategic action matrices.",
        "capabilities": ["BLUF Synthesis", "Driver Decomposition", "Action Matrix", "Callout Annotations"],
    },
    "predictive-forecast": {
        "title": "Predictive Forecast & Anomalies",
        "icon": "fa-solid fa-chart-line",
        "badge": "Forward Horizon & Anomaly Pinning",
        "description": "Project future trends with statistical confidence intervals, detect trajectory inflections, and isolate anomaly bounds.",
        "capabilities": ["Trend Extrapolation", "95% Confidence Corridor", "Inflection Detection", "Z-Score/IQR Outliers"],
    },
}

DESCRIPTIONS = {k: v["description"] for k, v in SKILL_METADATA.items()}


def _skills_dir() -> str:
    for cand in SKILLS_DIR_CANDIDATES:
        if os.path.isdir(cand):
            return cand
    return SKILLS_DIR_CANDIDATES[0]


def _parse_frontmatter(path: str) -> Dict[str, object]:
    """Parse minimal YAML frontmatter (name, title, icon, badge, description, capabilities)."""
    meta: Dict[str, object] = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read(3072)
        if not text.startswith("---"):
            return meta
        end = text.find("---", 3)
        block = text[3:end] if end != -1 else text[3:]
        for line in block.splitlines():
            line = line.strip()
            if not line or ":" not in line:
                continue
            key, val = line.split(":", 1)
            key = key.strip()
            val = val.strip()
            if val.startswith("[") and val.endswith("]"):
                items = [item.strip().strip("'\"") for item in val[1:-1].split(",") if item.strip()]
                meta[key] = items
            else:
                meta[key] = val.strip("'\"")
    except OSError:
        pass
    return meta


def list_skills() -> List[Dict[str, object]]:
    """Return [{id, title, icon, badge, description, capabilities, default_on}] sorted by id."""
    base = _skills_dir()
    found: Dict[str, Dict[str, object]] = {}
    try:
        entries = sorted(os.listdir(base))
    except OSError:
        entries = []
    for entry in entries:
        skill_file = os.path.join(base, entry, "SKILL.md")
        if not os.path.isfile(skill_file):
            continue
        meta = _parse_frontmatter(skill_file)
        skill_id = entry
        fallback = SKILL_METADATA.get(skill_id, {})
        title = meta.get("title") or fallback.get("title") or skill_id.replace("-", " ").title()
        icon = meta.get("icon") or fallback.get("icon") or "fa-solid fa-cube"
        badge = meta.get("badge") or fallback.get("badge") or "Specialized Module"
        desc = meta.get("description") or fallback.get("description") or ""
        capabilities = meta.get("capabilities") or fallback.get("capabilities") or []
        found[skill_id] = {
            "id": skill_id,
            "title": title,
            "icon": icon,
            "badge": badge,
            "description": desc,
            "capabilities": capabilities,
            "default_on": skill_id in DEFAULT_ON,
        }
    for skill_id, fallback in SKILL_METADATA.items():
        if skill_id not in found:
            found[skill_id] = {
                "id": skill_id,
                "title": fallback.get("title", skill_id),
                "icon": fallback.get("icon", "fa-solid fa-cube"),
                "badge": fallback.get("badge", "Module"),
                "description": fallback.get("description", ""),
                "capabilities": fallback.get("capabilities", []),
                "default_on": skill_id in DEFAULT_ON,
            }
    return [found[k] for k in sorted(found)]


def normalize_active_skills(active_skills) -> List[str]:
    """Validate requested skill ids; None means defaults on."""
    known = {s["id"] for s in list_skills()} | set(DEFAULT_ON)
    if active_skills is None:
        return sorted(DEFAULT_ON)
    if not isinstance(active_skills, (list, tuple, set)):
        return sorted(DEFAULT_ON)
    cleaned = sorted({s for s in active_skills if isinstance(s, str) and s in known})
    return cleaned
