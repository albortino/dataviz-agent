/**
 * Agent Skills Module
 * Fetches the runtime skill manifest from the backend, renders the
 * interactive skill cards, and persists per-user selection in browser localStorage.
 * Server stores nothing per user; skills are prompt-context filters only.
 */

export const AGENT_SKILLS_STORAGE_KEY = 'agent_active_skills_v1';

const FALLBACK_SKILLS = [
    {
        id: 'dataviz',
        title: 'Data Visualization',
        icon: 'fa-solid fa-chart-pie',
        badge: 'Publication-Grade Visuals',
        description: 'High-density statistical charting with 3 style modes, takeaway headlines, Seaborn aesthetics, and zero chartjunk.',
        capabilities: ['Seaborn Engine', '3 Style Modes', 'Takeaway Titles', 'Direct Bar/Line Labels'],
        default_on: true
    },
    {
        id: 'data-audit',
        title: 'Data Health Audit',
        icon: 'fa-solid fa-shield-halved',
        badge: 'Pre-Flight Health Gate',
        description: 'Pre-flight dataset sanity check screening for missingness, skew, high cardinality, and constant or ID columns.',
        capabilities: ['Missingness Screen', 'Numeric Skew Gate', 'Cardinality Check', 'ID-Column Protection'],
        default_on: true
    },
    {
        id: 'executive-narrative',
        title: 'Executive Narrative',
        icon: 'fa-solid fa-briefcase',
        badge: 'C-Suite Decision Framework',
        description: 'Synthesize findings into Minto Pyramid decision memos with BLUF, Pareto root drivers, and strategic action matrices.',
        capabilities: ['BLUF Synthesis', 'Driver Decomposition', 'Action Matrix', 'Callout Annotations'],
        default_on: false
    },
    {
        id: 'predictive-forecast',
        title: 'Predictive Forecast & Anomalies',
        icon: 'fa-solid fa-chart-line',
        badge: 'Forward Horizon & Anomaly Pinning',
        description: 'Project future trends with statistical confidence intervals, detect trajectory inflections, and isolate anomaly bounds.',
        capabilities: ['Trend Extrapolation', '95% Confidence Corridor', 'Inflection Detection', 'Z-Score/IQR Outliers'],
        default_on: false
    }
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
    return (allSkills || []).map(s => s.id);
}

export function setActiveSkills(ids) {
    try {
        localStorage.setItem(AGENT_SKILLS_STORAGE_KEY, JSON.stringify(ids));
    } catch (e) {
        console.warn('Could not persist active skills:', e);
    }
}

export function renderSkillsModal(listEl, allSkills) {
    if (!listEl) return;
    listEl.innerHTML = '';

    const counterEl = document.getElementById('agent-skills-active-count');
    if (counterEl) {
        counterEl.textContent = `${allSkills.length} skills active`;
    }

    allSkills.forEach(skill => {
        const card = document.createElement('div');
        card.className = 'skill-card';
        card.dataset.skillId = skill.id;

        card.innerHTML = `
            <div class="skill-card-icon">
                <i class="${escapeHtml(skill.icon || 'fa-solid fa-cube')}"></i>
            </div>
            <div class="skill-card-body">
                <span class="skill-name">${escapeHtml(skill.title || skill.id)}</span>
                <p class="skill-description">${escapeHtml(skill.description || '')}</p>
            </div>
        `;

        listEl.appendChild(card);
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
