/**
 * Shared Studio Utilities
 * Minimalist, concrete helpers for collapsible panels, SVG/PNG exports,
 * AI diagram generation, and column dropdown populations.
 */

/** Shared categorical color palette across studio charts. */
export const CHART_CATEGORICAL = [
    '#0072B2', '#D55E00', '#009E73', '#CC79A7',
    '#56B4E9', '#E69F00', '#999999'
];

/**
 * Binds sidebar toggle buttons and persists collapse state in localStorage.
 */
export function bindCollapsibleSidebar({ sidebar, collapseBtn, expandBtn, storageKey, onToggle }) {
    if (!sidebar) return { setCollapsed: () => {} };

    const setCollapsed = (collapsed) => {
        sidebar.classList.toggle('collapsed', collapsed);
        if (expandBtn) {
            expandBtn.classList.toggle('active', !collapsed);
            expandBtn.setAttribute('aria-pressed', !collapsed ? 'true' : 'false');
        }
        if (storageKey) {
            localStorage.setItem(storageKey, collapsed ? 'true' : 'false');
        }
        if (typeof onToggle === 'function') {
            onToggle(collapsed);
        }
        window.dispatchEvent(new CustomEvent('sidebar-collapsed-change', { detail: { sidebar, collapsed } }));
    };

    if (storageKey && localStorage.getItem(storageKey) === 'true') {
        setCollapsed(true);
    } else {
        const isCollapsed = sidebar.classList.contains('collapsed');
        if (expandBtn) {
            expandBtn.classList.toggle('active', !isCollapsed);
            expandBtn.setAttribute('aria-pressed', !isCollapsed ? 'true' : 'false');
        }
    }

    if (collapseBtn) {
        collapseBtn.addEventListener('click', () => setCollapsed(true));
    }
    if (expandBtn) {
        expandBtn.addEventListener('click', () => {
            const isCurrentlyCollapsed = sidebar.classList.contains('collapsed');
            setCollapsed(!isCurrentlyCollapsed);
        });
    }

    return { setCollapsed };
}

/**
 * Exports an SVG element as either SVG or PNG image download.
 */
export function exportSvg(svgEl, format = 'png', filename = 'chart') {
    if (!svgEl) {
        alert('No chart to export.');
        return;
    }

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgEl);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const URL = window.URL || window.webkitURL || window;
    const blobURL = URL.createObjectURL(svgBlob);

    if (format === 'svg') {
        const link = document.createElement('a');
        link.download = `${filename}.svg`;
        link.href = blobURL;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(blobURL), 1000);
        return;
    }

    const exportW = parseInt(svgEl.getAttribute('width'), 10) || svgEl.clientWidth || 800;
    const exportH = parseInt(svgEl.getAttribute('height'), 10) || svgEl.clientHeight || 600;

    const image = new Image();
    image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(800, exportW * 2);
        canvas.height = Math.max(600, exportH * 2);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        const pngLink = document.createElement('a');
        pngLink.download = `${filename}.png`;
        pngLink.href = canvas.toDataURL('image/png');
        document.body.appendChild(pngLink);
        pngLink.click();
        document.body.removeChild(pngLink);
        setTimeout(() => URL.revokeObjectURL(blobURL), 1000);
    };
    image.src = blobURL;
}

/**
 * Sends a structured prompt to /chat with timeout and code block extraction.
 */
export async function fetchAiDiagram({ systemPrompt, sampleData = [], codeRegex, timeoutMs = 45000 }) {
    const apiKey = (localStorage.getItem('ai_api_key') || '').trim();
    const baseUrl = (localStorage.getItem('ai_base_url') || '').trim();
    const model = (localStorage.getItem('ai_model') || '').trim();
    const apiVersion = (localStorage.getItem('ai_api_version') || '').trim();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                message: systemPrompt,
                data: sampleData.slice(0, 20),
                api_key: apiKey || undefined,
                base_url: baseUrl || undefined,
                model: model || undefined,
                api_version: apiVersion || undefined
            })
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const errDetail = errData.detail || `Server returned ${response.status}`;
            if (response.status === 401 || response.status === 403) {
                const settingsModal = document.getElementById('settings-modal');
                if (settingsModal) settingsModal.classList.remove('hidden');
            }
            throw new Error(errDetail);
        }

        const res = await response.json();
        const answer = res.answer || '';

        if (codeRegex) {
            const extracted = extractCodeFence(answer, res.logs || [], codeRegex);
            if (extracted) return extracted;
        }

        return answer.trim();
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw new Error('AI generation request timed out after 45s. Check network or AI provider.');
        }
        throw err;
    }
}

/**
 * Populates select dropdown elements with dataset column names, preserving selection.
 * Supports passing either an HTMLSelectElement or an object { select, includeNone, noneText, defaultVal, defaultIndex }.
 */
export function populateColumnSelects(selectConfigs, columns, defaultIncludeNone = false) {
    const isInternalCol = c => c === 'GL_ORDINAL' || c === '_unit_id' || (typeof c === 'string' && c.startsWith('__'));
    const validCols = (columns || []).filter(c => c && !isInternalCol(c));

    (selectConfigs || []).forEach(item => {
        const select = item?.nodeType ? item : item?.select;
        if (!select) return;

        const includeNone = item?.includeNone !== undefined ? Boolean(item.includeNone) : Boolean(defaultIncludeNone);
        const noneText = item?.noneText || '(None)';
        const currentVal = select.value;

        const opts = includeNone ? [`<option value="">${noneText}</option>`] : [];
        validCols.forEach(col => {
            opts.push(`<option value="${col}">${col}</option>`);
        });
        select.innerHTML = opts.join('');

        if (currentVal && (validCols.includes(currentVal) || (includeNone && currentVal === ''))) {
            select.value = currentVal;
        } else if (item?.defaultVal && validCols.includes(item.defaultVal)) {
            select.value = item.defaultVal;
        } else if (item?.defaultIndex !== undefined && validCols[item.defaultIndex]) {
            select.value = validCols[item.defaultIndex];
        }
    });
}

/**
 * Binds AI diagram/chart prompt modal events (open, close, submit, keydown).
 */
export function bindAiModal({ aiBtn, modal, input, closeBtn, cancelBtn, submitBtn, onSubmit }) {
    const open = () => {
        if (!modal) {
            if (typeof onSubmit === 'function') onSubmit('');
            return;
        }
        if (input) input.value = '';
        modal.classList.remove('hidden');
        input?.focus();
    };

    const close = () => {
        if (modal) modal.classList.add('hidden');
    };

    const submit = () => {
        const prompt = input?.value?.trim() || '';
        close();
        if (typeof onSubmit === 'function') onSubmit(prompt);
    };

    if (aiBtn) aiBtn.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (cancelBtn) cancelBtn.addEventListener('click', close);
    if (submitBtn) submitBtn.addEventListener('click', submit);
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
            } else if (e.key === 'Escape') {
                close();
            }
        });
    }

    return { open, close, submit };
}

/**
 * Extracts a code fence matching regex from markdown or log traces
 */
export function extractCodeFence(text, logs = [], regex) {
    if (!regex) return (text || '').trim();
    if (text) {
        const match = text.match(regex);
        if (match) return match[1].trim();
    }
    for (const log of logs) {
        if (typeof log === 'string') {
            const logMatch = log.match(regex);
            if (logMatch) return logMatch[1].trim();
        }
    }
    return null;
}

/**
 * Copies text to clipboard with temporary button checkmark feedback
 */
export function copyToClipboard(text, btn) {
    if (!text) return Promise.resolve();
    return navigator.clipboard.writeText(text).then(() => {
        if (!btn) return;
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
        setTimeout(() => { btn.innerHTML = orig; }, 2000);
    });
}

/**
 * Wraps an async operation with button spinner and disabled state
 */
export async function withButtonSpinner(btn, asyncFn) {
    if (!btn) return asyncFn();
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Generating...</span>`;
    try {
        return await asyncFn();
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}
