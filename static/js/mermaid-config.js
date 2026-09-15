/**
 * Mermaid per-diagram configuration metadata + frontmatter helpers.
 * Pure data/functions only (no DOM) — the config panel UI lives in mermaid.js.
 *
 * Mermaid reads a `config:` block from the YAML frontmatter at the top of a
 * diagram. The config menu toggles individual keys of that block, so presets and
 * AI/manual output can all be tuned through the same mechanism.
 */

/** Options offered for every diagram type. */
export const SHARED_CONFIG_OPTIONS = [
    { key: 'theme', label: 'Theme', path: ['theme'], type: 'select', options: ['default', 'base', 'dark', 'forest', 'neutral'], default: 'default' },
    { key: 'fontFamily', label: 'Font family', path: ['fontFamily'], type: 'text', default: 'Inter, sans-serif' }
];

/**
 * Per-type option tables. `path` is the key path inside the `config:` object,
 * mirrored from the Mermaid docs (see concepts/MERMAID_PLAN.md).
 */
export const MERMAID_CONFIG_OPTIONS = {
    xychart: [
        { key: 'yAxisZero', label: 'Y-axis start at 0', path: ['xyChart', 'yAxis', 'startAtZero'], type: 'toggle', default: true },
        { key: 'orientation', label: 'Horizontal', path: ['xyChart', 'chartOrientation'], type: 'select', options: ['vertical', 'horizontal'], default: 'vertical' },
        { key: 'showDataLabel', label: 'Bar data labels', path: ['xyChart', 'showDataLabel'], type: 'toggle', default: true },
        { key: 'labelsOutside', label: 'Labels outside bar', path: ['xyChart', 'showDataLabelOutsideBar'], type: 'toggle', default: false },
        { key: 'legend', label: 'Legend', path: ['xyChart', 'showLegend'], type: 'toggle', default: true },
        { key: 'legendFontSize', label: 'Legend font size', path: ['xyChart', 'legendFontSize'], type: 'number', default: 14 },
        { key: 'labelRotation', label: 'X label rotation (deg)', path: ['xyChart', 'xAxis', 'labelRotation'], type: 'number', default: 0 },
        { key: 'showAxisLine', label: 'Axis lines', path: ['xyChart', 'yAxis', 'showAxisLine'], type: 'toggle', default: true },
        { key: 'showTicks', label: 'Axis ticks', path: ['xyChart', 'yAxis', 'showTick'], type: 'toggle', default: true },
        { key: 'showTitle', label: 'Show chart title', path: ['xyChart', 'showChartTitle'], type: 'toggle', default: true },
        { key: 'palette', label: 'Plot color palette', path: ['themeVariables', 'xyChart', 'plotColorPalette'], type: 'text', default: '#4f46e5, #06b6d4, #f59e0b' }
    ],
    radar: [
        { key: 'graticule', label: 'Graticule shape', path: ['radar', 'graticule'], type: 'select', options: ['circle', 'polygon'], default: 'polygon' },
        { key: 'ticks', label: 'Tick rings', path: ['radar', 'ticks'], type: 'number', default: 5 },
        { key: 'curveTension', label: 'Curve tension', path: ['radar', 'curveTension'], type: 'number', default: 0.17, step: 0.01 },
        { key: 'curveOpacity', label: 'Curve opacity', path: ['themeVariables', 'radar', 'curveOpacity'], type: 'number', default: 0.5, step: 0.1 },
        { key: 'curveStrokeWidth', label: 'Curve stroke width', path: ['themeVariables', 'radar', 'curveStrokeWidth'], type: 'number', default: 3 },
        { key: 'axisColor', label: 'Axis color', path: ['themeVariables', 'radar', 'axisColor'], type: 'text', default: '#334155' },
        { key: 'legendFontSize', label: 'Legend font size', path: ['themeVariables', 'radar', 'legendFontSize'], type: 'number', default: 14 }
    ],
    sankey: [
        { key: 'nodeAlignment', label: 'Node alignment', path: ['sankey', 'nodeAlignment'], type: 'select', options: ['justify', 'center', 'left', 'right'], default: 'justify' },
        { key: 'linkColor', label: 'Link color', path: ['sankey', 'linkColor'], type: 'select', options: ['source', 'target', 'gradient'], default: 'gradient' },
        { key: 'labelStyle', label: 'Label style', path: ['sankey', 'labelStyle'], type: 'select', options: ['legacy', 'outlined'], default: 'outlined' },
        { key: 'nodeWidth', label: 'Node width', path: ['sankey', 'nodeWidth'], type: 'number', default: 12 },
        { key: 'nodePadding', label: 'Node padding', path: ['sankey', 'nodePadding'], type: 'number', default: 14 },
        { key: 'width', label: 'Width', path: ['sankey', 'width'], type: 'number', default: 900 },
        { key: 'height', label: 'Height', path: ['sankey', 'height'], type: 'number', default: 500 }
    ],
    treemap: [
        { key: 'showValues', label: 'Show values', path: ['treemap', 'showValues'], type: 'toggle', default: true },
        { key: 'valueFormat', label: 'Value format', path: ['treemap', 'valueFormat'], type: 'select', options: [',', '$', '.1f', '.1%', '$,.2f'], default: ',' },
        { key: 'padding', label: 'Node padding', path: ['treemap', 'padding'], type: 'number', default: 10 },
        { key: 'diagramPadding', label: 'Diagram padding', path: ['treemap', 'diagramPadding'], type: 'number', default: 8 },
        { key: 'nodeHeight', label: 'Node height', path: ['treemap', 'nodeHeight'], type: 'number', default: 40 },
        { key: 'labelFontSize', label: 'Label font size', path: ['treemap', 'labelFontSize'], type: 'number', default: 14 }
    ],
    pie: [
        { key: 'donutHole', label: 'Donut hole (0-0.9)', path: ['pie', 'donutHole'], type: 'number', default: 0.4, step: 0.05 },
        { key: 'legendPosition', label: 'Legend position', path: ['pie', 'legendPosition'], type: 'select', options: ['right', 'top', 'bottom', 'left', 'center'], default: 'right' },
        { key: 'textPosition', label: 'Label position (0-1)', path: ['pie', 'textPosition'], type: 'number', default: 0.75, step: 0.05 },
        { key: 'highlightSlice', label: 'Highlight slice label', path: ['pie', 'highlightSlice'], type: 'text', default: '' }
    ],
    flowchart: [
        { key: 'curve', label: 'Edge curve', path: ['flowchart', 'curve'], type: 'select', options: ['basis', 'linear', 'cardinal', 'stepBefore', 'stepAfter'], default: 'basis' },
        { key: 'nodeSpacing', label: 'Node spacing', path: ['flowchart', 'nodeSpacing'], type: 'number', default: 50 },
        { key: 'rankSpacing', label: 'Rank spacing', path: ['flowchart', 'rankSpacing'], type: 'number', default: 50 },
        { key: 'diagramPadding', label: 'Diagram padding', path: ['flowchart', 'diagramPadding'], type: 'number', default: 8 },
        { key: 'htmlLabels', label: 'HTML labels', path: ['htmlLabels'], type: 'toggle', default: true }
    ],
    sequence: [
        { key: 'mirrorActors', label: 'Mirror actors', path: ['sequence', 'mirrorActors'], type: 'toggle', default: false },
        { key: 'wrap', label: 'Wrap messages', path: ['sequence', 'wrap'], type: 'toggle', default: false },
        { key: 'showNumbers', label: 'Sequence numbers', path: ['sequence', 'showSequenceNumbers'], type: 'toggle', default: true },
        { key: 'messageAlign', label: 'Message align', path: ['sequence', 'messageAlign'], type: 'select', options: ['left', 'center', 'right'], default: 'center' },
        { key: 'actorMargin', label: 'Actor margin', path: ['sequence', 'actorMargin'], type: 'number', default: 50 },
        { key: 'actorFontSize', label: 'Actor font size', path: ['sequence', 'actorFontSize'], type: 'number', default: 14 }
    ],
    erDiagram: [
        { key: 'minEntityWidth', label: 'Min entity width', path: ['er', 'minEntityWidth'], type: 'number', default: 100 },
        { key: 'minEntityHeight', label: 'Min entity height', path: ['er', 'minEntityHeight'], type: 'number', default: 75 },
        { key: 'entityPadding', label: 'Entity padding', path: ['er', 'entityPadding'], type: 'number', default: 15 },
        { key: 'fontSize', label: 'Font size', path: ['er', 'fontSize'], type: 'number', default: 12 },
        { key: 'stroke', label: 'Entity stroke', path: ['themeVariables', 'er', 'stroke'], type: 'text', default: '#334155' },
        { key: 'fill', label: 'Entity fill', path: ['themeVariables', 'er', 'fill'], type: 'text', default: '#e2e8f0' }
    ]
};

/** Read a nested value; returns undefined when any segment is missing. */
export function getPath(obj, path) {
    return path.reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), obj);
}

/** Create missing intermediate objects and assign a nested value. */
export function setPath(obj, path, value) {
    let node = obj;
    for (let i = 0; i < path.length - 1; i++) {
        if (typeof node[path[i]] !== 'object' || node[path[i]] === null) node[path[i]] = {};
        node = node[path[i]];
    }
    node[path[path.length - 1]] = value;
}

/** Remove a nested value and prune now-empty parent objects. */
export function deletePath(obj, path) {
    const parents = [obj];
    let node = obj;
    for (let i = 0; i < path.length - 1; i++) {
        node = node?.[path[i]];
        if (!node || typeof node !== 'object') return;
        parents.push(node);
    }
    delete node[path[path.length - 1]];
    for (let i = parents.length - 1; i > 0; i--) {
        if (Object.keys(parents[i]).length === 0) delete parents[i - 1][path[i - 1]];
    }
}

function parseScalar(raw) {
    const v = raw.trim();
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v === 'null' || v === '~') return null;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if (v.length > 1 && ((v[0] === "'" && v.endsWith("'")) || (v[0] === '"' && v.endsWith('"')))) {
        return v.slice(1, -1);
    }
    if (v.startsWith('[') && v.endsWith(']')) {
        return v.slice(1, -1).split(',').map(parseScalar).filter(s => s !== '');
    }
    return v;
}

/** Minimal indentation-based YAML reader for the config subset mermaid accepts. */
function parseYaml(text) {
    const root = {};
    const stack = [{ indent: -1, node: root }];
    text.split(/\r?\n/).forEach(line => {
        if (!line.trim() || line.trim().startsWith('#')) return;
        const indent = line.match(/^\s*/)[0].length;
        const match = line.trim().match(/^([^:]+):\s*(.*)$/);
        if (!match) return;
        while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
        const parent = stack[stack.length - 1].node;
        const key = match[1].trim().replace(/^["']|["']$/g, '');
        if (match[2].trim() === '') {
            parent[key] = {};
            stack.push({ indent, node: parent[key] });
        } else {
            parent[key] = parseScalar(match[2]);
        }
    });
    return root;
}

function yamlScalar(value) {
    if (typeof value !== 'string') return String(value);
    // Values with spaces, commas, colons or # must be quoted to stay parseable.
    return /^[A-Za-z0-9_.-]+$/.test(value) ? value : `'${value.replace(/'/g, "''")}'`;
}

function toYaml(node, depth) {
    return Object.entries(node).map(([key, value]) => {
        const pad = '  '.repeat(depth);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return `${pad}${key}:\n${toYaml(value, depth + 1)}`;
        }
        return `${pad}${key}: ${yamlScalar(value)}\n`;
    }).join('');
}

/**
 * Split a diagram into its frontmatter parts and the diagram body.
 * `config` is the `config:` subtree; `frontmatter` is the full root object so
 * unrelated keys (e.g. `title`) survive a rewrite. Tolerates diagrams with no
 * frontmatter and frontmatter without a config key.
 */
export function splitFrontmatter(code) {
    const match = /^\s*---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(code);
    if (!match) return { config: {}, frontmatter: {}, body: code };
    const frontmatter = parseYaml(match[1]);
    const config = frontmatter.config && typeof frontmatter.config === 'object' ? frontmatter.config : {};
    return { config, frontmatter, body: code.slice(match[0].length) };
}

/** Render a full frontmatter root (e.g. { title, config }) to a mermaid block. */
export function serializeFrontmatter(root) {
    return root && Object.keys(root).length > 0 ? `---\n${toYaml(root, 0)}---\n` : '';
}

/** Render a bare config object to a frontmatter block ('' when empty). */
export function serializeConfig(config) {
    return serializeFrontmatter(config && Object.keys(config).length > 0 ? { config } : {});
}

/** Deep-merge `updates` into the frontmatter config of `code`, keeping the body. */
export function mergeConfig(code, updates) {
    const { frontmatter, body } = splitFrontmatter(code);
    const config = frontmatter.config && typeof frontmatter.config === 'object' ? frontmatter.config : {};
    frontmatter.config = config;
    Object.entries(updates).forEach(([key, value]) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            config[key] = { ...(config[key] || {}), ...value };
        } else {
            config[key] = value;
        }
    });
    return serializeFrontmatter(frontmatter) + body;
}
