/**
 * Shared Studio Utilities
 * Minimalist, concrete helpers for collapsible panels, SVG/PNG exports,
 * AI diagram generation, and column dropdown populations.
 */

import { detectType } from './data-transform.js';

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
 * Analyzes dataset columns to determine initial categorical and numeric axis selections,
 * and detects whether any unique ID column exists (distinct values = total rows).
 */
export function getInitialViewColumns(data) {
    if (!data || data.length === 0) {
        return {
            hasIdColumn: false,
            idColumns: [],
            categoricalCol: '',
            numericCol: '',
            categoricalCols: [],
            numericCols: []
        };
    }

    const totalRows = data.length;
    const isInternalCol = c => c === 'GL_ORDINAL' || c === '_unit_id' || (typeof c === 'string' && c.startsWith('__'));
    const cols = Object.keys(data[0] || {}).filter(c => !isInternalCol(c));

    if (cols.length === 0) {
        return {
            hasIdColumn: false,
            idColumns: [],
            categoricalCol: '',
            numericCol: '',
            categoricalCols: [],
            numericCols: []
        };
    }

    const idCols = [];
    const colDistinctCounts = {};
    const colTypes = {};

    const isIdName = c => /^(id|_id|uuid|guid|pk|index|row_id|key|code)$/i.test(c) || /(_id|Id|ID)$/.test(c);
    const isMeasureName = c => /qty|quantity|count|amount|total|volume|sales|revenue|profit|salary|price|cost|weight|height|duration|rate|percent|score|value|val|sum/i.test(c);

    cols.forEach(col => {
        let isUnique = totalRows > 1;
        const seen = new Set();
        for (let i = 0; i < totalRows; i++) {
            const v = data[i][col];
            if (v === null || v === undefined || v === '') {
                isUnique = false;
            } else if (seen.has(v)) {
                isUnique = false;
            } else {
                seen.add(v);
            }
        }
        colDistinctCounts[col] = seen.size;

        for (let r = 0; r < Math.min(totalRows, 50); r++) {
            const val = data[r][col];
            if (val !== null && val !== undefined && val !== '') {
                colTypes[col] = detectType(val);
                break;
            }
        }
        if (!colTypes[col]) colTypes[col] = 'String';

        const isNumeric = colTypes[col] === 'Number';
        const isStrictId = isUnique && seen.size === totalRows && (
            isIdName(col) ||
            (!isNumeric && !isMeasureName(col)) ||
            (isNumeric && isIdName(col))
        );

        if (isStrictId) {
            idCols.push(col);
        }
    });

    const hasIdColumn = idCols.length > 0;
    const numericCols = cols.filter(c => colTypes[c] === 'Number');

    const nonIdCols = cols.filter(c => !idCols.includes(c));

    const scoredCategoricals = (nonIdCols.length > 0 ? nonIdCols : cols).map(c => {
        const type = colTypes[c];
        const distinct = colDistinctCounts[c] || 0;
        let score = 0;

        if (type === 'String' || type === 'Boolean') {
            score += 100;
            if (distinct >= 2 && distinct <= 30) score += 50;
            else if (distinct <= 100) score += 25;
            else if (distinct > 500) score -= 30;
        } else if (type === 'Date' || type === 'DateTime' || type === 'Time') {
            score += 60;
            if (distinct <= 50) score += 20;
        } else if (type === 'Number') {
            if (distinct >= 2 && distinct <= 20 && distinct < totalRows) {
                score += 40;
            } else {
                score -= 50;
            }
        }

        if (isIdName(c)) score -= 60;
        if (idCols.includes(c)) score -= 200;

        return { col: c, score, distinct, type };
    });

    scoredCategoricals.sort((a, b) => b.score - a.score);

    const categoricalCol = scoredCategoricals[0]?.col || cols[0];

    const validNumeric = numericCols.filter(c => !idCols.includes(c) || numericCols.length === 1);
    let numericCol = validNumeric.find(c => c !== categoricalCol) || validNumeric[0];
    if (!numericCol) {
        numericCol = cols.find(c => c !== categoricalCol && !idCols.includes(c)) || cols.find(c => c !== categoricalCol) || cols[0];
    }

    return {
        hasIdColumn,
        idColumns: idCols,
        categoricalCol,
        numericCol,
        categoricalCols: scoredCategoricals.map(s => s.col),
        numericCols
    };
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

/**
 * Extracts, isolates, and sanitizes an SVG element into a standalone vector XML string.
 * Inlines critical computed styles to prevent black silhouettes and CSS bleed when pinned.
 * @param {SVGElement|HTMLElement} svgElement - Root SVG or container element
 * @returns {string} - Clean sanitized SVG XML string
 */
export function extractStandaloneSvg(svgElement) {
    if (!svgElement) return '';

    const targetSvg = svgElement.tagName?.toLowerCase() === 'svg'
        ? svgElement
        : (svgElement.querySelector?.('svg') || svgElement);

    if (!targetSvg || targetSvg.tagName?.toLowerCase() !== 'svg') {
        return '';
    }

    const clone = targetSvg.cloneNode(true);

    // Inline critical computed CSS properties from host DOM
    const CRITICAL_STYLES = ['fill', 'stroke', 'stroke-width', 'font-family', 'font-size'];
    const origElements = [targetSvg, ...targetSvg.querySelectorAll('*')];
    const cloneElements = [clone, ...clone.querySelectorAll('*')];
    const elementCount = Math.min(origElements.length, cloneElements.length);

    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        for (let i = 0; i < elementCount; i++) {
            const origEl = origElements[i];
            const cloneEl = cloneElements[i];
            try {
                const computed = window.getComputedStyle(origEl);
                if (computed) {
                    for (const prop of CRITICAL_STYLES) {
                        const val = computed.getPropertyValue(prop);
                        if (val) {
                            cloneEl.style.setProperty(prop, val);
                        }
                    }
                }
            } catch (err) {
                // Ignore errors for unattached or non-stylable elements
            }
        }
    }

    // Read bounding box with fallback for disconnected/hidden elements
    let bbox = null;
    try {
        if (typeof targetSvg.getBBox === 'function') {
            bbox = targetSvg.getBBox();
        }
    } catch (err) {
        bbox = null;
    }

    let x = 0;
    let y = 0;
    let width = 0;
    let height = 0;

    if (bbox && bbox.width > 0 && bbox.height > 0) {
        x = bbox.x;
        y = bbox.y;
        width = bbox.width;
        height = bbox.height;
    }

    const existingViewBox = targetSvg.getAttribute('viewBox');
    if (existingViewBox) {
        const parts = existingViewBox.trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
            if (!width || !height) {
                [x, y, width, height] = parts;
            }
        }
    }

    if (!width || !height) {
        width = parseFloat(targetSvg.getAttribute('width')) || targetSvg.clientWidth || 800;
        height = parseFloat(targetSvg.getAttribute('height')) || targetSvg.clientHeight || 600;
    }

    const finalViewBox = existingViewBox || `${x} ${y} ${width} ${height}`;
    clone.setAttribute('viewBox', finalViewBox);
    clone.setAttribute('width', `${width}`);
    clone.setAttribute('height', `${height}`);

    // Ensure standard SVG namespace
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    // Serialize node to XML string
    let serializedString = '';
    if (typeof XMLSerializer !== 'undefined') {
        const serializer = new XMLSerializer();
        serializedString = serializer.serializeToString(clone);
    } else {
        serializedString = clone.outerHTML || '';
    }

    // Sanitize serialized SVG
    const domPurify = (typeof window !== 'undefined' && window.DOMPurify)
        || (typeof DOMPurify !== 'undefined' ? DOMPurify : null);

    if (domPurify && typeof domPurify.sanitize === 'function') {
        return domPurify.sanitize(serializedString, { USE_PROFILES: { svg: true } });
    }

    return serializedString;
}
