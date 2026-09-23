/**
 * Visual Spec & Syntax Formatter
 * Formats Vega-Lite JSON specifications and diagram syntax with Prettier standalone
 * and intelligent semantic ordering for maximum visual appeal.
 */

const VEGA_KEY_ORDER = [
    '$schema',
    'title',
    'description',
    'width',
    'height',
    'autosize',
    'data',
    'transform',
    'mark',
    'encoding',
    'layer',
    'concat',
    'hconcat',
    'vconcat',
    'facet',
    'repeat',
    'resolve',
    'params',
    'config'
];

/**
 * Re-orders keys of an object to follow the canonical Vega-Lite specification structure.
 */
function sortVegaKeys(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const sorted = {};
    const keys = Object.keys(obj);

    VEGA_KEY_ORDER.forEach(k => {
        if (k in obj) sorted[k] = obj[k];
    });

    keys.forEach(k => {
        if (!(k in sorted)) sorted[k] = obj[k];
    });

    return sorted;
}

/**
 * Formats a Vega-Lite JSON specification into visually clean, appealing layout.
 * Uses Prettier standalone when available, with a resilient structural fallback.
 * 
 * @param {string|object} input - Spec string or object
 * @param {object} options - Formatting options (e.g. printWidth)
 * @returns {string} Formatted JSON string
 */
export function formatVegaSpec(input, options = {}) {
    if (!input) return '';
    const printWidth = options.maxWidth || options.printWidth || 35;
    const tabWidth = options.tabWidth || 2;
    let parsed = null;
    let rawStr = '';

    if (typeof input === 'object') {
        parsed = input;
        rawStr = JSON.stringify(input);
    } else {
        rawStr = input.trim();
        try {
            parsed = JSON.parse(rawStr);
        } catch (e) {
            // Loose JSON
        }
    }

    // Try Prettier standalone first
    if (window.prettier && window.prettierPlugins) {
        try {
            const plugins = Array.isArray(window.prettierPlugins)
                ? window.prettierPlugins
                : Object.values(window.prettierPlugins);
            if (parsed) {
                const ordered = sortVegaKeys(parsed);
                return window.prettier.format(JSON.stringify(ordered), {
                    parser: 'json',
                    plugins: plugins,
                    printWidth: printWidth,
                    tabWidth: tabWidth
                }).trim();
            }
            return window.prettier.format(rawStr, {
                parser: 'json5',
                plugins: plugins,
                printWidth: printWidth,
                tabWidth: tabWidth
            }).trim();
        } catch (err) {
            // Fall through to fallback
        }
    }

    // Fallback formatting: canonical keys order and 2-space indentation
    if (parsed) {
        const ordered = sortVegaKeys(parsed);
        return JSON.stringify(ordered, null, tabWidth);
    }

    return rawStr;
}

/**
 * Formats Mermaid diagram syntax with standardized indentation and trimmed lines.
 * 
 * @param {string} code - Raw Mermaid diagram text
 * @returns {string} Formatted Mermaid text
 */
export function formatMermaidSyntax(code) {
    if (!code) return '';
    const lines = code.split('\n');
    let indent = 0;
    const formattedLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
            if (formattedLines.length > 0 && formattedLines[formattedLines.length - 1] !== '') {
                formattedLines.push('');
            }
            continue;
        }

        if (line === 'end' || line.startsWith('}') || line.startsWith(']')) {
            indent = Math.max(0, indent - 1);
        }

        const prefix = '  '.repeat(indent);
        formattedLines.push(prefix + line);

        if (
            line.startsWith('subgraph') ||
            line.startsWith('rect ') ||
            line.endsWith('{') ||
            line.startsWith('alt ') ||
            line.startsWith('opt ') ||
            line.startsWith('loop ') ||
            line.startsWith('par ')
        ) {
            indent++;
        }
    }

    return formattedLines.join('\n').trim();
}

/**
 * Formats SankeyMatic syntax with clean spacing around [Value] blocks.
 * 
 * @param {string} code - Raw Sankey text
 * @returns {string} Formatted Sankey text
 */
export function formatSankeySyntax(code) {
    if (!code) return '';
    const lines = code.split('\n');
    const formatted = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            if (formatted.length > 0 && formatted[formatted.length - 1] !== '') {
                formatted.push('');
            }
            continue;
        }

        const match = line.match(/^(.+?)\s*\[\s*([0-9.]+)\s*\]\s*(.+)$/);
        if (match) {
            formatted.push(`${match[1].trim()} [${match[2].trim()}] ${match[3].trim()}`);
        } else {
            formatted.push(line);
        }
    }

    return formatted.join('\n').trim();
}
