/**
 * Agent Skills Module
 * Fetches the runtime skill manifest from the backend, renders the
 * toggle modal, and persists per-user selection in browser localStorage.
 * Server stores nothing per user; skills are prompt-context filters only.
 */

export const AGENT_SKILLS_STORAGE_KEY = 'agent_active_skills_v1';

const FALLBACK_SKILLS = [
    { id: 'dataviz', description: 'Chart choice, takeaway titles, layout helpers', default_on: true },
    { id: 'data-audit', description: 'Missingness / skew / id-column gate before analysis', default_on: true },
];

export async function fetchAgentSkills() {
    try {
        const resp = await fetch('/agent_skills');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (Array.isArray(data.skills) && data.skills.length > 0) return data.skills;
    } catch (e) {
        console.warn('Agent skills manifest unavailable, using fallback:', e);
    }
    return FALLBACK_SKILLS;
}

export function getActiveSkills(allSkills) {
    try {
        const raw = localStorage.getItem(AGENT_SKILLS_STORAGE_KEY);
        if (!raw) return allSkills.filter(s => s.default_on !== false).map(s => s.id);
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('invalid stored skills');
        const known = new Set(allSkills.map(s => s.id));
        return parsed.filter(id => known.has(id));
    } catch (e) {
        console.warn('Error reading active skills, defaulting to all-on:', e);
        return allSkills.map(s => s.id);
    }
}

export function setActiveSkills(ids) {
    try {
        localStorage.setItem(AGENT_SKILLS_STORAGE_KEY, JSON.stringify(ids));
    } catch (e) {
        console.warn('Could not persist active skills:', e);
    }
}

export function renderSkillsModal(listEl, allSkills, activeIds) {
    if (!listEl) return;
    listEl.innerHTML = '';
    allSkills.forEach(skill => {
        const label = document.createElement('label');
        label.className = 'curves-checkbox-item';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = activeIds.includes(skill.id);
        box.dataset.skillId = skill.id;
        const text = document.createElement('span');
        text.innerHTML = `<b>${skill.id}</b> — ${skill.description || ''}`;
        label.appendChild(box);
        label.appendChild(text);
        listEl.appendChild(label);
    });
}
