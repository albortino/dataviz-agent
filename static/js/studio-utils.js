/**
 * Shared Studio Utilities
 * Minimalist, concrete helpers for collapsible panels, SVG/PNG exports,
 * AI diagram generation, and column dropdown populations.
 */

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
            const match = answer.match(codeRegex);
            if (match) return match[1].trim();

            for (const log of (res.logs || [])) {
                const logMatch = log.match(codeRegex);
                if (logMatch) return logMatch[1].trim();
            }
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
 */
export function populateColumnSelects(selectElements, columns, emptyOptionText = '(None)') {
    const validCols = (columns || []).filter(c =>
        c && c !== 'GL_ORDINAL' && c !== '_unit_id' && !c.startsWith('__')
    );

    selectElements.forEach(select => {
        if (!select) return;
        const currentVal = select.value;
        const opts = emptyOptionText !== null ? [`<option value="">${emptyOptionText}</option>`] : [];
        validCols.forEach(col => {
            opts.push(`<option value="${col}">${col}</option>`);
        });
        select.innerHTML = opts.join('');
        if (currentVal && validCols.includes(currentVal)) {
            select.value = currentVal;
        }
    });
}
