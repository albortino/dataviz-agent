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
    try {
        const raw = localStorage.getItem(AGENT_SKILLS_STORAGE_KEY);
        if (!raw) return allSkills.filter(s => Boolean(s.default_on)).map(s => s.id);
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('invalid stored skills');
        const known = new Set(allSkills.map(s => s.id));
        return parsed.filter(id => known.has(id));
    } catch (e) {
        console.warn('Error reading active skills, falling back to defaults:', e);
        return allSkills.filter(s => Boolean(s.default_on)).map(s => s.id);
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

    const updateCounterAndStates = () => {
        const checkedBoxes = listEl.querySelectorAll('input[data-skill-id]:checked');
        const count = checkedBoxes.length;
        const total = allSkills.length;
        const counterEl = document.getElementById('agent-skills-active-count');
        if (counterEl) {
            counterEl.textContent = `${count} of ${total} skills active`;
        }
        listEl.querySelectorAll('.skill-card').forEach(card => {
            const box = card.querySelector('input[data-skill-id]');
            if (box && box.checked) {
                card.classList.add('active');
            } else {
                card.classList.remove('active');
            }
        });
    };

    allSkills.forEach(skill => {
        const isActive = activeIds.includes(skill.id);
        const card = document.createElement('div');
        card.className = `skill-card ${isActive ? 'active' : ''}`;
        card.dataset.skillId = skill.id;

        const capabilities = Array.isArray(skill.capabilities) ? skill.capabilities : [];
        const capsHtml = capabilities.length > 0
            ? `<div class="skill-caps">${capabilities.map(c => `<span class="skill-cap-tag"><i class="fa-solid fa-check"></i>${escapeHtml(c)}</span>`).join('')}</div>`
            : '';

        const badgeHtml = skill.badge
            ? `<span class="skill-usp-badge">${escapeHtml(skill.badge)}</span>`
            : '';

        const defaultBadgeHtml = skill.default_on
            ? `<span class="skill-default-badge" title="Default Core Skill"><i class="fa-solid fa-bolt"></i> Default Core</span>`
            : `<span class="skill-opt-badge" title="Specialized Add-on"><i class="fa-solid fa-plus"></i> Add-on</span>`;

        card.innerHTML = `
            <div class="skill-card-header">
                <div class="skill-card-icon">
                    <i class="${escapeHtml(skill.icon || 'fa-solid fa-cube')}"></i>
                </div>
                <div class="skill-card-titles">
                    <div class="skill-name-row">
                        <span class="skill-name">${escapeHtml(skill.title || skill.id)}</span>
                        <code class="skill-slug">${escapeHtml(skill.id)}</code>
                    </div>
                    <div class="skill-badge-row">
                        ${badgeHtml}
                        ${defaultBadgeHtml}
                    </div>
                </div>
                <div class="skill-switch-container">
                    <label class="skill-switch" title="Toggle ${escapeHtml(skill.title || skill.id)}">
                        <input type="checkbox" data-skill-id="${escapeHtml(skill.id)}" ${isActive ? 'checked' : ''} class="skill-checkbox-input" />
                        <span class="skill-switch-slider"></span>
                    </label>
                </div>
            </div>
            <p class="skill-description">${escapeHtml(skill.description || '')}</p>
            ${capsHtml}
        `;

        const box = card.querySelector('input[data-skill-id]');
        if (box) {
            box.addEventListener('change', () => updateCounterAndStates());
        }

        card.addEventListener('click', (e) => {
            if (e.target.closest('.skill-switch') || e.target.tagName === 'INPUT') return;
            if (box) {
                box.checked = !box.checked;
                updateCounterAndStates();
            }
        });

        listEl.appendChild(card);
    });

    const resetBtn = document.getElementById('agent-skills-reset-btn');
    if (resetBtn) {
        resetBtn.onclick = () => {
            allSkills.forEach(s => {
                const box = listEl.querySelector(`input[data-skill-id="${s.id}"]`);
                if (box) {
                    box.checked = Boolean(s.default_on);
                }
            });
            updateCounterAndStates();
        };
    }

    updateCounterAndStates();
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
