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

# Short UI descriptions (fallback if SKILL.md frontmatter is missing).
DESCRIPTIONS = {
    "dataviz": "Chart choice, takeaway titles, layout helpers",
    "data-audit": "Missingness / skew / id-column gate before analysis",
}


def _skills_dir() -> str:
    for cand in SKILLS_DIR_CANDIDATES:
        if os.path.isdir(cand):
            return cand
    return SKILLS_DIR_CANDIDATES[0]


def _parse_frontmatter(path: str) -> Dict[str, str]:
    """Parse minimal YAML frontmatter (name:, description:) without deps."""
    meta: Dict[str, str] = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read(2048)
        if not text.startswith("---"):
            return meta
        end = text.find("---", 3)
        block = text[3:end] if end != -1 else text[3:]
        for line in block.splitlines():
            if ":" not in line:
                continue
            key, val = line.split(":", 1)
            meta[key.strip()] = val.strip()
    except OSError:
        pass
    return meta


def list_skills() -> List[Dict[str, object]]:
    """Return [{id, description, default_on}] sorted by id."""
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
        desc = meta.get("description") or DESCRIPTIONS.get(skill_id, "")
        found[skill_id] = {
            "id": skill_id,
            "description": desc,
            "default_on": skill_id in DEFAULT_ON,
        }
    for skill_id in DEFAULT_ON:
        if skill_id not in found and skill_id in DESCRIPTIONS:
            found[skill_id] = {
                "id": skill_id,
                "description": DESCRIPTIONS[skill_id],
                "default_on": True,
            }
    return [found[k] for k in sorted(found)]


def normalize_active_skills(active_skills) -> List[str]:
    """Validate requested skill ids; None/empty means all defaults on."""
    known = {s["id"] for s in list_skills()} | set(DEFAULT_ON)
    if active_skills is None:
        return sorted(known)
    if not isinstance(active_skills, (list, tuple, set)):
        return sorted(known)
    cleaned = sorted({s for s in active_skills if isinstance(s, str) and s in known})
    return cleaned
