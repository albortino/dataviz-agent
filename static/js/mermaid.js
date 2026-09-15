/**
 * Mermaid Integration Module
 * Handles presets, UI controls, deterministic diagram generation from data,
 * AI diagram generation via backend agent, live rendering, zoom, and exports.
 */

import { aggregateValues } from './data-transform.js';
import {
    SHARED_CONFIG_OPTIONS,
    MERMAID_CONFIG_OPTIONS,
    splitFrontmatter,
    serializeFrontmatter,
    getPath,
    setPath,
    deletePath
} from './mermaid-config.js';

export const MERMAID_DEMOS = {
    sankey: `sankey-beta

Agricultural 'waste',Bio-conversion,124.729
Bio-conversion,Liquid,0.597
Bio-conversion,Solid,110.11
Bio-conversion,Gas,28.297
Biofuels,Liquid,35
Biomass,Solid,280
Coal,Solid,150
Solid,Direct firing,400
Liquid,Transportation,35.597
Gas,Power generation,28.297`,
    radar: `radar-beta
    title Performance Evaluation
    axis quality["Quality"], speed["Speed"], reliability["Reliability"], innovation["Innovation"], efficiency["Efficiency"]
    curve alpha["Team Alpha"]{85, 70, 90, 60, 80}
    curve beta["Team Beta"]{65, 95, 75, 90, 85}
    max 100
    min 0
    graticule polygon
    ticks 5
    showLegend true`,
    treemap: `treemap-beta
    "Organization Budget"
        "Engineering"
            "Infrastructure": 220
            "Mobile": 140
            "Web": 90
        "Marketing"
            "Advertising": 160
            "Content": 90
        "Sales"
            "Enterprise": 250
            "SMB": 130`,
    flowchart: `flowchart TD
    subgraph Ingestion["1 · Ingestion"]
        A([Upload CSV]) --> B{Header valid?}
        B -- No --> C[/Log formatting error/]
        B -- Yes --> D[(Parse rows)]
    end
    subgraph Analysis["2 · Analysis"]
        D --> E[Detect column types]
        E --> F(Aggregate groups)
        F --> G{{Compute metrics}}
    end
    G --> H[Render visualizations]
    C --> H
    H --> I([Publish dashboards])
    classDef error fill:#fee2e2,stroke:#dc2626,color:#991b1b
    classDef done fill:#dcfce7,stroke:#16a34a,color:#166534
    class C error
    class I done
    linkStyle 0 stroke:#94a3b8,stroke-width:2px`,
    pie: `pie showData title Regional Revenue Distribution
    "North America" : 85
    "EMEA" : 64
    "APAC" : 52
    "LATAM" : 28`,
    xychart: `xychart-beta
    title "Department Headcount and Hiring"
    x-axis ["Engineering", "Marketing", "Sales", "Product", "Support"]
    y-axis "Headcount"
    bar [45, 25, 38, 20, 15]
    line [6, 3, 5, 2, 1]`,
    sequence: `sequenceDiagram
    autonumber
    participant C as Client
    participant A as API
    participant G as Agent
    participant T as Tools
    C->>A: POST /chat {message, data}
    activate A
    A->>G: Run ReAct analysis
    loop up to 5 iterations
        G->>T: execute_tool(schema)
        T-->>G: Observation result
    end
    alt valid mermaid code
        G-->>A: Final answer + diagram
    else invalid syntax
        G-->>A: Fallback preset
    end
    deactivate A
    A-->>C: Render diagram in UI
    Note over C,T: Live preview refreshes on every edit`,
    erDiagram: `erDiagram
    DEPARTMENT ||--o{ PROJECT : manages
    PROJECT ||--|{ EMPLOYEE : assigns
    EMPLOYEE }o--|| DEPARTMENT : belongs_to
    DEPARTMENT {
        string name PK
        int headcount
        float budget_k
    }
    PROJECT {
        string id PK
        string region
        float budget_k
    }
    EMPLOYEE {
        string id PK
        string name
        string role
    }
`
};

export const MERMAID_PRESETS = MERMAID_DEMOS;

export class MermaidManager {
    constructor(options = {}) {
        this.getData = options.getData || (() => []);
        this.zoomLevel = 1.75;
        this.renderTimeout = null;

        // DOM elements
        this.sidebar = document.getElementById('mermaid-sidebar');
        this.collapseBtn = document.getElementById('mermaid-collapse-btn');
        this.expandBtn = document.getElementById('mermaid-expand-btn');
        this.textEditor = document.getElementById('mermaid-text-editor');
        this.presetSelect = document.getElementById('mermaid-chart-preset');
        this.chartTitleInput = document.getElementById('mermaid-chart-title');
        this.titleGroup = document.getElementById('mermaid-title-group');
        this.sourceCol = document.getElementById('mermaid-source-col');
        this.targetCol = document.getElementById('mermaid-target-col');
        this.curvesGroup = document.getElementById('mermaid-curves-group');
        this.curvesList = document.getElementById('mermaid-curves-list');
        this.curvesSelectAllBtn = document.getElementById('mermaid-curves-select-all');
        this.curvesClearBtn = document.getElementById('mermaid-curves-clear');
        this.valCol = document.getElementById('mermaid-val-col');
        this.aggFunc = document.getElementById('mermaid-agg-func');
        this.demoBtn = document.getElementById('mermaid-demo-btn');
        this.aiBtn = document.getElementById('mermaid-ai-btn');
        this.configPanel = document.getElementById('mermaid-config-panel');
        this.configGroup = document.getElementById('mermaid-config-group');
        this.col1Group = document.getElementById('mermaid-col1-group');
        this.col2Group = document.getElementById('mermaid-col2-group');
        this.valGroup = document.getElementById('mermaid-val-group');
        this.aggGroup = document.getElementById('mermaid-agg-group');
        this.sourceLabel = document.getElementById('mermaid-source-label');
        this.targetLabel = document.getElementById('mermaid-target-label');
        this.valLabel = document.getElementById('mermaid-val-label');
        this.renderOutput = document.getElementById('mermaid-render-output');
        this.errorNotice = document.getElementById('mermaid-error-notice');
        this.zoomInBtn = document.getElementById('mermaid-zoom-in');
        this.zoomOutBtn = document.getElementById('mermaid-zoom-out');
        this.zoomResetBtn = document.getElementById('mermaid-zoom-reset');
        this.exportPngBtn = document.getElementById('mermaid-export-png-btn');
        this.exportSvgBtn = document.getElementById('mermaid-export-svg-btn');
        this.controlsSidebar = document.getElementById('mermaid-controls-sidebar');
        this.controlsCollapseBtn = document.getElementById('mermaid-controls-collapse-btn');
        this.controlsExpandBtn = document.getElementById('mermaid-controls-expand-btn');
        this.aiModal = document.getElementById('mermaid-ai-modal');
        this.aiModalPrompt = document.getElementById('mermaid-ai-prompt-input');
        this.aiModalCloseBtn = document.getElementById('close-mermaid-ai-modal-btn');
        this.aiModalCancelBtn = document.getElementById('cancel-mermaid-ai-modal-btn');
        this.aiModalSubmitBtn = document.getElementById('confirm-mermaid-ai-modal-btn');
    }

    init() {
        if (window.mermaid) {
            try {
                mermaid.initialize({
                    startOnLoad: false,
                    theme: 'default',
                    securityLevel: 'loose',
                    fontFamily: 'Inter, -apple-system, sans-serif'
                });
            } catch (e) {
                console.warn("Mermaid init notice:", e);
            }
        }

        this.initCollapseState();
        this.bindEvents();
        this.updateColumnOptions();
        this.updateUIControls();

        const currentData = this.getData();
        if (currentData && currentData.length > 0) {
            this.generateFromData();
        } else {
            if (this.textEditor) this.textEditor.value = '';
            this.renderConfigPanel();
            this.renderChart();
        }
    }

    reset() {
        [this.sourceCol, this.targetCol, this.valCol].forEach(el => {
            if (el) {
                el.value = '';
                el.innerHTML = '';
            }
        });
        if (this.presetSelect) this.presetSelect.value = 'xychart';
        this.updateColumnOptions();
        this.updateUIControls();

        const currentData = this.getData();
        if (currentData && currentData.length > 0) {
            this.generateFromData();
        } else {
            if (this.textEditor) this.textEditor.value = '';
            this.renderConfigPanel();
            this.renderChart();
        }
    }

    showDemo(preset) {
        const p = preset || this.presetSelect?.value || 'xychart';
        const demo = MERMAID_DEMOS[p] || MERMAID_DEMOS.xychart;
        if (this.textEditor) {
            this.textEditor.value = demo;
        }
        this.renderConfigPanel();
        this.renderChart();
    }

    initCollapseState() {
        if (window.innerWidth < 900) {
            this.setControlsCollapsed(true);
        }
    }

    setControlsCollapsed(collapsed) {
        if (!this.controlsSidebar) return;
        this.controlsSidebar.classList.toggle('collapsed', collapsed);
        if (this.controlsExpandBtn) {
            this.controlsExpandBtn.classList.toggle('hidden', !collapsed);
        }
    }

    setSidebarCollapsed(collapsed) {
        if (!this.sidebar) return;
        this.sidebar.classList.toggle('collapsed', collapsed);
        if (this.expandBtn) {
            this.expandBtn.classList.toggle('hidden', !collapsed);
        }
    }

    updateUIControls() {
        if (!this.presetSelect) return;
        const preset = this.presetSelect.value;
        const currentData = this.getData();
        const hasData = currentData && currentData.length > 0;

        const isAggregatable = ['sankey', 'radar', 'treemap', 'xychart', 'pie', 'flowchart'].includes(preset);

        if (this.titleGroup) this.titleGroup.style.display = 'flex';

        if (preset === 'sankey') {
            if (this.col1Group) this.col1Group.style.display = 'flex';
            if (this.col2Group) this.col2Group.style.display = 'flex';
            if (this.curvesGroup) this.curvesGroup.style.display = 'none';
            if (this.valGroup) this.valGroup.style.display = 'flex';
            if (this.aggGroup) this.aggGroup.style.display = 'flex';
            if (this.sourceLabel) this.sourceLabel.textContent = 'Source Column';
            if (this.targetLabel) this.targetLabel.textContent = 'Target Column';
            if (this.valLabel) this.valLabel.textContent = 'Value Column';
        } else if (preset === 'radar') {
            if (this.col1Group) this.col1Group.style.display = 'flex';
            if (this.col2Group) this.col2Group.style.display = 'none';
            if (this.curvesGroup) this.curvesGroup.style.display = 'flex';
            if (this.valGroup) this.valGroup.style.display = 'none';
            if (this.aggGroup) this.aggGroup.style.display = 'flex';
            if (this.sourceLabel) this.sourceLabel.textContent = 'Axis / Dimension Column';
        } else if (preset === 'treemap') {
            if (this.col1Group) this.col1Group.style.display = 'flex';
            if (this.col2Group) this.col2Group.style.display = 'flex';
            if (this.curvesGroup) this.curvesGroup.style.display = 'none';
            if (this.valGroup) this.valGroup.style.display = 'flex';
            if (this.aggGroup) this.aggGroup.style.display = 'flex';
            if (this.sourceLabel) this.sourceLabel.textContent = 'Category (Level 1)';
            if (this.targetLabel) this.targetLabel.textContent = 'Subcategory (Level 2)';
            if (this.valLabel) this.valLabel.textContent = 'Value Column';
        } else if (preset === 'xychart') {
            if (this.col1Group) this.col1Group.style.display = 'flex';
            if (this.col2Group) this.col2Group.style.display = 'flex';
            if (this.curvesGroup) this.curvesGroup.style.display = 'none';
            if (this.valGroup) this.valGroup.style.display = 'none';
            if (this.aggGroup) this.aggGroup.style.display = 'flex';
            if (this.sourceLabel) this.sourceLabel.textContent = 'Category (X-Axis)';
            if (this.targetLabel) this.targetLabel.textContent = 'Value (Y-Axis Metric)';
        } else if (preset === 'pie') {
            if (this.col1Group) this.col1Group.style.display = 'flex';
            if (this.col2Group) this.col2Group.style.display = 'flex';
            if (this.curvesGroup) this.curvesGroup.style.display = 'none';
            if (this.valGroup) this.valGroup.style.display = 'none';
            if (this.aggGroup) this.aggGroup.style.display = 'flex';
            if (this.sourceLabel) this.sourceLabel.textContent = 'Category Slices';
            if (this.targetLabel) this.targetLabel.textContent = 'Value (Metric)';
        } else if (preset === 'flowchart') {
            if (this.col1Group) this.col1Group.style.display = 'flex';
            if (this.col2Group) this.col2Group.style.display = 'flex';
            if (this.curvesGroup) this.curvesGroup.style.display = 'none';
            if (this.valGroup) this.valGroup.style.display = 'none';
            if (this.aggGroup) this.aggGroup.style.display = 'flex';
            if (this.sourceLabel) this.sourceLabel.textContent = 'Source Node';
            if (this.targetLabel) this.targetLabel.textContent = 'Target Node';
        } else {
            if (this.col1Group) this.col1Group.style.display = 'none';
            if (this.col2Group) this.col2Group.style.display = 'none';
            if (this.curvesGroup) this.curvesGroup.style.display = 'none';
            if (this.valGroup) this.valGroup.style.display = 'none';
            if (this.aggGroup) this.aggGroup.style.display = 'none';
        }



        if (this.demoBtn) {
            this.demoBtn.disabled = false;
            this.demoBtn.title = `Show sample ${preset} diagram`;
        }

        if (this.aiBtn) {
            if (hasData) {
                this.aiBtn.disabled = false;
                this.aiBtn.title = `Generate ${preset} with AI agent using dataset`;
            } else {
                this.aiBtn.disabled = true;
                this.aiBtn.title = 'Please load a CSV dataset or dummy data first';
            }
        }
    }

    /** Rebuild the per-chart config toggle panel from the diagram's frontmatter. */
    renderConfigPanel() {
        if (!this.configPanel || !this.presetSelect) return;
        const options = MERMAID_CONFIG_OPTIONS[this.presetSelect.value] || [];
        const { config } = splitFrontmatter(this.textEditor ? this.textEditor.value : '');

        this.configPanel.innerHTML = '';
        if (options.length === 0) {
            this.configPanel.innerHTML = '<span class="mermaid-config-hint">No tunable options for this diagram.</span>';
            return;
        }

        [...SHARED_CONFIG_OPTIONS, ...options].forEach(opt => {
            const current = getPath(config, opt.path);
            const item = document.createElement('div');
            item.className = 'mermaid-config-item';
            item.dataset.path = opt.path.join('.');
            item.dataset.type = opt.type;
            item.dataset.key = opt.key;

            if (opt.type === 'toggle') {
                const head = document.createElement('label');
                head.className = 'mermaid-config-option';
                const control = document.createElement('input');
                control.type = 'checkbox';
                control.className = 'cfg-control';
                if (opt.key === 'yAxisZero') {
                    const yMatch = (this.textEditor ? this.textEditor.value : '').match(/^\s*y-axis\s*(?:"([^"]*)")?\s*(?:(-?\d+(?:\.\d+)?)\s*-->\s*(-?\d+(?:\.\d+)?))?/m);
                    if (yMatch) {
                        control.checked = yMatch[2] !== undefined ? Number(yMatch[2]) === 0 : false;
                    } else {
                        control.checked = false;
                    }
                } else {
                    control.checked = current !== undefined ? Boolean(current) : false;
                }
                control.addEventListener('change', () => this.applyConfig());

                head.appendChild(control);
                head.appendChild(document.createTextNode(opt.label));
                item.appendChild(head);
            } else {
                const head = document.createElement('label');
                head.className = 'mermaid-config-option';
                const enable = document.createElement('input');
                enable.type = 'checkbox';
                enable.className = 'cfg-enable';
                enable.checked = current !== undefined;

                const control = this.buildConfigControl(opt, current !== undefined ? current : opt.default);
                control.disabled = !enable.checked;
                enable.addEventListener('change', () => {
                    control.disabled = !enable.checked;
                    this.applyConfig();
                });
                control.addEventListener('change', () => this.applyConfig());

                head.appendChild(enable);
                head.appendChild(document.createTextNode(opt.label));
                item.appendChild(head);
                item.appendChild(control);
            }
            this.configPanel.appendChild(item);
        });
    }

    /** Build the value widget for a config option based on its declared type. */
    buildConfigControl(opt, value) {
        let el;
        if (opt.type === 'select') {
            el = document.createElement('select');
            opt.options.forEach(o => {
                const option = document.createElement('option');
                option.value = o;
                option.textContent = o;
                el.appendChild(option);
            });
            el.value = String(value);
        } else {
            el = document.createElement('input');
            el.type = opt.type === 'number' ? 'number' : 'text';
            if (opt.step) el.step = String(opt.step);
            el.value = value === undefined || value === null ? '' : String(value);
        }
        el.classList.add('cfg-control');
        return el;
    }

    /**
     * Write enabled toggles into the diagram's frontmatter config and re-render.
     * Unchecked options are removed so the panel stays in sync with the code.
     */
    applyConfig() {
        if (!this.textEditor) return;
        const { frontmatter, body } = splitFrontmatter(this.textEditor.value);
        const config = frontmatter.config && typeof frontmatter.config === 'object' ? frontmatter.config : {};
        frontmatter.config = config;
        let updatedBody = body;

        this.configPanel?.querySelectorAll('.mermaid-config-item').forEach(item => {
            const path = item.dataset.path.split('.');
            const type = item.dataset.type;
            const key = item.dataset.key;

            if (type === 'toggle') {
                const control = item.querySelector('.cfg-control');
                if (control) {
                    if (key === 'yAxisZero') {
                        const yAxisRegex = /^([ \t]*y-axis\s*(?:"([^"]*)")?\s*)(?:(-?\d+(?:\.\d+)?)\s*-->\s*(-?\d+(?:\.\d+)?))?/m;
                        const yMatch = updatedBody.match(yAxisRegex);
                        if (yMatch) {
                            const titlePart = yMatch[2] !== undefined ? `"${yMatch[2]}"` : '';
                            if (control.checked) {
                                let maxVal = yMatch[4] !== undefined ? yMatch[4] : '';
                                if (!maxVal) {
                                    const numbers = Array.from(updatedBody.matchAll(/(?:bar|line)\s*(?:"[^"]*")?\s*\[([0-9.,\s-]+)\]/g))
                                        .flatMap(m => m[1].split(',').map(Number))
                                        .filter(n => !isNaN(n));
                                    const maxFound = numbers.length > 0 ? Math.max(...numbers) : 10;
                                    maxVal = maxFound > 0 ? String(Math.ceil(maxFound * 1.15)) : '10';
                                }
                                const newLine = `y-axis ${titlePart} 0 --> ${maxVal}`.replace(/\s+/g, ' ').trim();
                                updatedBody = updatedBody.replace(yAxisRegex, `    ${newLine}`);
                            } else {
                                const newLine = `y-axis ${titlePart}`.trim();
                                updatedBody = updatedBody.replace(yAxisRegex, `    ${newLine}`);
                            }
                        }
                    } else {
                        if (control.checked) {
                            setPath(config, path, true);
                        } else {
                            deletePath(config, path);
                        }
                    }
                }
                return;
            }

            const enable = item.querySelector('.cfg-enable');
            const control = item.querySelector('.cfg-control');
            if (!enable.checked) {
                deletePath(config, path);
                return;
            }
            let value = control.value;
            if (value === '') {
                deletePath(config, path);
                return;
            }
            if (control.type === 'number') value = Number(value);
            setPath(config, path, value);
        });
        // Drop an empty config subtree so no dangling `config:` key is emitted.
        if (Object.keys(config).length === 0) delete frontmatter.config;
        this.textEditor.value = serializeFrontmatter(frontmatter) + updatedBody;
        this.renderChart();
    }

    updateColumnOptions() {
        const currentData = this.getData();
        if (!currentData || currentData.length === 0) return;
        const columns = Object.keys(currentData[0]);

        [this.sourceCol, this.targetCol, this.valCol].forEach((sel, idx) => {
            if (!sel) return;
            const currentVal = sel.value;
            sel.innerHTML = '';

            if (idx === 2) {
                const countOpt = document.createElement('option');
                countOpt.value = '';
                countOpt.textContent = 'Row Count (1 per row)';
                sel.appendChild(countOpt);
            }

            columns.forEach(col => {
                const opt = document.createElement('option');
                opt.value = col;
                opt.textContent = col;
                sel.appendChild(opt);
            });

            if (currentVal && (columns.includes(currentVal) || (idx === 2 && currentVal === ''))) {
                sel.value = currentVal;
            } else if (idx === 0 && columns.length > 0) {
                sel.value = columns[0];
            } else if (idx === 1 && columns.length > 1) {
                sel.value = columns[1];
            } else if (idx === 2) {
                const numCol = columns.find(c => {
                    const sample = currentData.find(r => r[c] !== null && r[c] !== undefined)?.[c];
                    return typeof sample === 'number' || (!isNaN(parseFloat(sample)) && isFinite(sample));
                });
                sel.value = numCol || '';
            }
        });

        if (this.curvesList) {
            const numericCols = columns.filter(c => currentData.some(r => r[c] !== null && r[c] !== undefined && !isNaN(parseFloat(r[c]))));
            const prevChecked = Array.from(this.curvesList.querySelectorAll('input:checked')).map(i => i.value);
            this.curvesList.innerHTML = '';
            if (numericCols.length === 0) {
                this.curvesList.innerHTML = '<span class="curves-empty-hint">No numeric columns found</span>';
            } else {
                numericCols.forEach((col, cIdx) => {
                    const label = document.createElement('label');
                    label.className = 'curves-checkbox-item';
                    const chk = document.createElement('input');
                    chk.type = 'checkbox';
                    chk.value = col;
                    chk.checked = prevChecked.length > 0 ? prevChecked.includes(col) : true;
                    chk.addEventListener('change', () => {
                        if (this.presetSelect && this.presetSelect.value === 'radar') {
                            this.generateFromData();
                        }
                    });
                    label.appendChild(chk);
                    label.appendChild(document.createTextNode(col));
                    this.curvesList.appendChild(label);
                });
            }
        }

        this.updateUIControls();
    }

    generateFromData() {
        const currentData = this.getData();
        if (!currentData || currentData.length === 0) return;
        const preset = this.presetSelect?.value || 'xychart';
        const userTitle = this.chartTitleInput ? this.chartTitleInput.value.trim() : '';
        const col1 = this.sourceCol ? this.sourceCol.value : '';
        const col2 = this.targetCol ? this.targetCol.value : '';
        const valCol = this.valCol ? this.valCol.value : '';
        const aggFunc = this.aggFunc ? this.aggFunc.value : 'sum';

        if (preset === 'sankey') {
            if (!col1 || !col2 || col1 === col2) {
                this.textEditor.value = '';
                this.renderConfigPanel();
                this.renderChart();
                return;
            }

            const srcValues = new Set();
            const tgtValues = new Set();
            currentData.forEach(r => {
                const s = String(r[col1] !== undefined && r[col1] !== null ? r[col1] : '').trim();
                const t = String(r[col2] !== undefined && r[col2] !== null ? r[col2] : '').trim();
                if (s) srcValues.add(s);
                if (t) tgtValues.add(t);
            });
            const hasOverlap = Array.from(srcValues).some(v => tgtValues.has(v));

            const flowAgg = {};
            currentData.forEach(r => {
                let s = String(r[col1] !== undefined && r[col1] !== null ? r[col1] : '').trim();
                let t = String(r[col2] !== undefined && r[col2] !== null ? r[col2] : '').trim();
                if (!s || !t) return;

                if (hasOverlap) {
                    s = `${s} (${col1})`;
                    t = `${t} (${col2})`;
                }

                const key = `${s}___${t}`;
                let v = 1;
                if (valCol && r[valCol] !== undefined && r[valCol] !== null) {
                    const parsed = parseFloat(r[valCol]);
                    v = isNaN(parsed) ? 1 : Math.max(0, parsed);
                }
                if (!flowAgg[key]) flowAgg[key] = [];
                flowAgg[key].push(v);
            });

            const topFlows = Object.entries(flowAgg).map(([k, vals]) => {
                let computed = aggFunc === 'none' ? (vals.length > 0 ? vals[0] : 1) : aggregateValues(vals, aggFunc);
                return [k, Math.round(computed * 100) / 100];
            }).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 35);

            if (topFlows.length === 0) {
                this.textEditor.value = '';
                this.renderConfigPanel();
                this.renderChart();
                return;
            }

            const toAsciiSafe = (str) => {
                return String(str ?? '')
                    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
                    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
                    .replace(/ß/g, 'ss')
                    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    .replace(/[^\x20-\x7E]/g, '')
                    .trim();
            };

            const formatNode = (name) => {
                const safe = toAsciiSafe(name).replace(/"/g, "'");
                return `"${safe || 'Unknown'}"`;
            };

            let code = `sankey-beta\n`;
            topFlows.forEach(([key, value]) => {
                const [s, t] = key.split('___');
                code += `${formatNode(s)},${formatNode(t)},${value}\n`;
            });
            this.textEditor.value = code;

        } else if (preset === 'radar') {
            const selectedCurves = this.curvesList
                ? Array.from(this.curvesList.querySelectorAll('input:checked')).map(i => i.value)
                : [];

            if (!col1 || selectedCurves.length === 0) {
                this.textEditor.value = '';
                this.renderConfigPanel();
                this.renderChart();
                return;
            }

            const axisGroups = {};
            currentData.forEach(r => {
                const ax = String(r[col1] !== undefined && r[col1] !== null ? r[col1] : '').trim();
                if (!ax) return;
                if (!axisGroups[ax]) axisGroups[ax] = [];
                axisGroups[ax].push(r);
            });

            const topAxes = Object.keys(axisGroups).slice(0, 8);
            if (topAxes.length < 3) {
                this.textEditor.value = '';
                this.renderConfigPanel();
                this.renderChart();
                return;
            }

            const cleanAxes = topAxes.map((ax, idx) => {
                const safeLabel = String(ax ?? '').replace(/"/g, "'").replace(/[\[\]]/g, '');
                return `ax_${idx + 1}["${safeLabel}"]`;
            });
            const titleStr = userTitle || `Comparison by ${col1}`;
            let code = `radar-beta\n`;
            code += `    title ${titleStr}\n`;
            code += `    axis ${cleanAxes.join(', ')}\n`;

            selectedCurves.forEach((curveCol, cIdx) => {
                const curveId = `curve_${cIdx + 1}`;
                const curveLabel = String(curveCol ?? '').replace(/"/g, "'").replace(/[\[\]]/g, '');
                const valList = [];
                topAxes.forEach(ax => {
                    const rows = axisGroups[ax];
                    const vals = rows.map(r => r[curveCol]).filter(v => v !== undefined && v !== null);
                    const computed = aggregateValues(vals, aggFunc);
                    valList.push(Math.round(computed * 100) / 100);
                });
                code += `    curve ${curveId}["${curveLabel}"]{${valList.join(', ')}}\n`;
            });
            code += `    showLegend true\n`;
            this.textEditor.value = code;

        } else if (preset === 'treemap') {
            if (!col1) {
                this.textEditor.value = '';
                this.renderConfigPanel();
                this.renderChart();
                return;
            }

            const rootTitle = userTitle || `${col1} Distribution`;
            const tree = {};

            currentData.forEach(r => {
                const c1 = String(r[col1] !== undefined && r[col1] !== null ? r[col1] : 'Other').trim() || 'Other';
                const c2 = col2 && col2 !== col1
                    ? String(r[col2] !== undefined && r[col2] !== null ? r[col2] : 'Detail').trim() || 'Detail'
                    : null;

                let v = 1;
                if (valCol && r[valCol] !== undefined && r[valCol] !== null) {
                    const p = parseFloat(r[valCol]);
                    v = isNaN(p) ? 1 : Math.max(0, p);
                }

                if (!tree[c1]) tree[c1] = {};
                if (c2) {
                    if (!tree[c1][c2]) tree[c1][c2] = [];
                    tree[c1][c2].push(v);
                } else {
                    if (!tree[c1]['__self__']) tree[c1]['__self__'] = [];
                    tree[c1]['__self__'].push(v);
                }
            });

            let code = `treemap-beta\n`;
            code += `    "${rootTitle.replace(/"/g, "'")}"\n`;

            const topC1 = Object.entries(tree).slice(0, 10);
            topC1.forEach(([c1Name, subMap]) => {
                const subEntries = Object.entries(subMap);
                if (subEntries.length === 1 && subEntries[0][0] === '__self__') {
                    const totalVal = Math.round(aggregateValues(subEntries[0][1], aggFunc) * 100) / 100;
                    code += `        "${c1Name.replace(/"/g, "'")}": ${totalVal}\n`;
                } else {
                    code += `        "${c1Name.replace(/"/g, "'")}"\n`;
                    subEntries.slice(0, 8).forEach(([c2Name, vals]) => {
                        const leafVal = Math.round(aggregateValues(vals, aggFunc) * 100) / 100;
                        if (leafVal > 0) {
                            code += `            "${c2Name.replace(/"/g, "'")}": ${leafVal}\n`;
                        }
                    });
                }
            });
            this.textEditor.value = code;

        } else if (preset === 'pie') {
            const groups = {};
            currentData.forEach(r => {
                const cat = String(r[col1] !== undefined && r[col1] !== null ? r[col1] : 'Unknown').trim() || 'Empty';
                if (!groups[cat]) groups[cat] = [];
                if (aggFunc === 'count') {
                    groups[cat].push(1);
                } else if (col2 && r[col2] !== undefined && r[col2] !== null) {
                    groups[cat].push(r[col2]);
                } else {
                    groups[cat].push(1);
                }
            });

            const aggregated = Object.entries(groups).map(([k, vals]) => {
                const res = aggregateValues(vals, aggFunc);
                return [k, Math.round(res * 100) / 100];
            }).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 10);

            const title = userTitle ? userTitle : `Distribution of ${col1} (${aggFunc === 'none' ? (col2 || 'First') : `${aggFunc.toUpperCase()} ${col2 || 'rows'}`})`;
            let code = `pie title ${title}\n`;
            aggregated.forEach(([k, v]) => {
                code += `    "${k.replace(/"/g, "'")}" : ${v}\n`;
            });
            this.textEditor.value = code;

        } else if (preset === 'flowchart') {
            const pairs = {};
            currentData.forEach(r => {
                const s = String(r[col1] || '').trim();
                const t = String(r[col2] || '').trim();
                if (s && t) {
                    const key = `${s}__${t}`;
                    if (!pairs[key]) pairs[key] = [];
                    pairs[key].push(1);
                }
            });
            const topPairs = Object.entries(pairs).map(([k, vals]) => [k, aggFunc === 'none' ? 1 : vals.length])
                .sort((a, b) => b[1] - a[1]).slice(0, 16);

            let code = `flowchart LR\n`;
            if (userTitle) code += `    %% Title: ${userTitle}\n`;
            const nodeMap = {};
            let nodeIdx = 1;
            const getNodeId = (name) => {
                if (!nodeMap[name]) nodeMap[name] = `node_${nodeIdx++}`;
                return nodeMap[name];
            };
            topPairs.forEach(([k, count]) => {
                const [s, t] = k.split('___');
                const sId = getNodeId(s);
                const tId = getNodeId(t);
                code += `    ${sId}["${s.replace(/"/g, "'")}"] -->|"${count}"| ${tId}["${t.replace(/"/g, "'")}"]\n`;
            });
            this.textEditor.value = code;

        } else if (preset === 'xychart') {
            const groups = {};
            currentData.forEach(r => {
                const k = String(r[col1] !== undefined && r[col1] !== null ? r[col1] : 'Unknown').trim() || 'Empty';
                if (!groups[k]) groups[k] = [];
                if (aggFunc === 'count') {
                    groups[k].push(1);
                } else if (col2 && r[col2] !== undefined && r[col2] !== null) {
                    groups[k].push(r[col2]);
                } else {
                    groups[k].push(1);
                }
            });

            const topGroups = Object.entries(groups).map(([k, vals]) => {
                const res = aggregateValues(vals, aggFunc);
                return [k, Math.round(res * 100) / 100];
            }).slice(0, 10);

            const xLabels = topGroups.map(([k]) => `"${k.substring(0, 14).replace(/"/g, "'")}"`);
            const yVals = topGroups.map(([, val]) => val);
            const yLabel = aggFunc === 'none' ? (col2 || 'Value') : `${aggFunc.toUpperCase()} ${col2 || 'Count'}`;
            const title = userTitle ? userTitle : `${col1} (${yLabel})`;
            const maxVal = yVals.length > 0 ? Math.max(...yVals) : 10;
            const minVal = yVals.length > 0 ? Math.min(...yVals) : 0;
            const yMin = minVal < 0 ? Math.floor(minVal * 1.1) : 0;
            const yMax = maxVal > 0 ? Math.ceil(maxVal * 1.15) : 10;
            let code = `xychart-beta\n`;
            code += `    title "${title.replace(/"/g, "'")}"\n`;
            code += `    x-axis [${xLabels.join(', ')}]\n`;
            code += `    y-axis "${yLabel}" ${yMin} --> ${yMax}\n`;
            code += `    bar [${yVals.join(', ')}]\n`;
            this.textEditor.value = code;

        } else {
            this.textEditor.value = '';
        }

        this.renderConfigPanel();
        this.renderChart();
    }

    async generateWithAI(customPrompt = '') {
        const currentData = this.getData();
        if (!currentData || currentData.length === 0) {
            alert("Please upload a dataset or load dummy data first.");
            return;
        }

        const apiKey = (localStorage.getItem('ai_api_key') || '').trim();
        const baseUrl = (localStorage.getItem('ai_base_url') || '').trim();
        const model = (localStorage.getItem('ai_model') || '').trim();

        const preset = this.presetSelect?.value || 'xychart';
        const col1 = this.sourceCol ? this.sourceCol.value : '';
        const col2 = this.targetCol ? this.targetCol.value : '';
        const agg = this.aggFunc ? this.aggFunc.value : '';

        let prompt = `Create a clean, syntactically valid Mermaid diagram of type '${preset}' based on the active dataset.`;
        if (preset === 'sankey') {
            const valCol = this.valCol ? this.valCol.value : '';
            prompt = `Create a clean, syntactically valid Mermaid sankey-beta diagram based on the active dataset.`;
            prompt += ` Use valid 'sankey-beta' syntax where each line is formatted as: "Source","Target",Value.`;
            if (col1 && col2) {
                prompt += ` Connect source column '${col1}' to target column '${col2}' measuring '${valCol || 'frequency count'}' with '${agg}' aggregation.`;
            }
        } else if (preset === 'radar') {
            const selectedCurves = this.curvesList
                ? Array.from(this.curvesList.querySelectorAll('input:checked')).map(i => i.value)
                : [];
            prompt = `Create a clean, syntactically valid Mermaid radar-beta chart based on the active dataset.`;
            prompt += ` Use syntax: radar-beta\n title <Title>\n axis ax_1["Axis1"], ax_2["Axis2"], ...\n curve id1["CurveName"]{val1, val2, ...}\n showLegend true.`;
            if (col1) prompt += ` Categorical axis column: '${col1}'.`;
            if (selectedCurves.length > 0) prompt += ` Metric curve columns: ${selectedCurves.join(', ')}.`;
            prompt += ` Aggregation method: '${agg}'.`;
        } else if (preset === 'treemap') {
            const valCol = this.valCol ? this.valCol.value : '';
            prompt = `Create a clean, syntactically valid Mermaid treemap-beta diagram based on the active dataset.`;
            prompt += ` Use syntax: treemap-beta\n "Root"\n "Branch"\n "Leaf": value.`;
            if (col1) prompt += ` Category column: '${col1}'.`;
            if (col2 && col2 !== col1) prompt += ` Subcategory column: '${col2}'.`;
            if (valCol) prompt += ` Value/metric column: '${valCol}'.`;
            prompt += ` Aggregation: '${agg}'.`;
        } else if (preset === 'erDiagram') {
            prompt += ` Model the entities, relationships, attributes and primary keys suggested by the columns in the dataset.`;
        } else if (preset === 'sequence') {
            prompt += ` Illustrate a realistic process or interaction sequence using the domain and attributes of this dataset.`;
        } else if (col1 && col2) {
            prompt += ` Focus on category '${col1}' and metric/target '${col2}' with '${agg}' aggregation.`;
        }

        if (customPrompt) {
            prompt += `\nAdditional user formatting instructions: ${customPrompt}`;
        }

        prompt += ` Output ONLY the valid Mermaid diagram code enclosed in \`\`\`mermaid ... \`\`\` code fence. Do not include conversational markdown outside the code fence.`;

        const originalText = this.aiBtn.innerHTML;
        this.aiBtn.disabled = true;
        this.aiBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Generating...</span>`;

        try {
            const sampleData = currentData.slice(0, 20);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 45000);

            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    message: prompt,
                    data: sampleData,
                    api_key: apiKey || undefined,
                    base_url: baseUrl || undefined,
                    model: model || undefined
                })
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const errDetail = errData.detail || `Server returned ${response.status}`;
                if (response.status === 400 && errDetail.includes("No API Key")) {
                    alert("No AI API Key configured. Please enter your API key in Settings first.");
                    const settingsModal = document.getElementById('settings-modal');
                    if (settingsModal) settingsModal.classList.remove('hidden');
                    return;
                }
                if (response.status === 504) {
                    throw new Error("Server gateway timed out (504). The AI model took too long to reply. Please check your API key, model selection, or network connection.");
                }
                throw new Error(errDetail);
            }

            const res = await response.json();
            let rawCode = '';

            const match = (res.answer || '').match(/```mermaid\s*([\s\S]*?)\s*```/i);
            if (match) {
                rawCode = match[1].trim();
            } else {
                for (const log of (res.logs || [])) {
                    const logMatch = log.match(/```mermaid\s*([\s\S]*?)\s*```/i);
                    if (logMatch) {
                        rawCode = logMatch[1].trim();
                        break;
                    }
                }
            }

            if (!rawCode && res.answer && (
                res.answer.startsWith('flowchart') ||
                res.answer.startsWith('pie') ||
                res.answer.startsWith('erDiagram') ||
                res.answer.startsWith('sequenceDiagram') ||
                res.answer.startsWith('xychart') ||
                res.answer.startsWith('radar') ||
                res.answer.startsWith('treemap') ||
                res.answer.startsWith('sankey')
            )) {
                rawCode = res.answer.trim();
            }

            if (rawCode) {
                this.textEditor.value = rawCode;
                this.renderConfigPanel();
                this.renderChart();
            } else {
                alert("AI response did not contain a valid Mermaid diagram code fence. Please check AI settings or try again.");
            }
        } catch (err) {
            console.error("Mermaid AI generation error:", err);
            if (err.name === 'AbortError') {
                alert("AI generation request timed out after 45s. Please check your AI provider connection.");
            } else {
                alert(`AI generation failed: ${err.message}`);
            }
        } finally {
            this.aiBtn.innerHTML = originalText;
            this.aiBtn.disabled = false;
        }
    }

    async renderChart() {
        if (!this.textEditor || !this.renderOutput) return;
        const code = this.textEditor.value.trim();
        if (!code) {
            this.renderOutput.innerHTML = '<p class="mermaid-placeholder-text">Load a dataset and click "Generate Chart", or click "Show Demo" to see a sample chart.</p>';
            if (this.errorNotice) this.errorNotice.classList.add('hidden');
            return;
        }

        try {
            if (this.errorNotice) {
                this.errorNotice.classList.add('hidden');
                this.errorNotice.textContent = '';
            }
            if (!window.mermaid) {
                this.renderOutput.innerHTML = '<p class="mermaid-error-text">Mermaid library not loaded.</p>';
                return;
            }
            const uniqueId = `mermaid-svg-${Date.now()}`;
            const { svg } = await mermaid.render(uniqueId, code);
            this.renderOutput.innerHTML = svg;
            this.applyZoom();
        } catch (err) {
            console.warn("Mermaid render error:", err);
            const stray = document.querySelectorAll(`[id^="dmermaid-svg-"], [id^="mermaid-svg-"]`);
            stray.forEach(el => {
                if (el !== this.renderOutput && !this.renderOutput.contains(el)) el.remove();
            });
            if (this.errorNotice) {
                this.errorNotice.classList.remove('hidden');
                this.errorNotice.textContent = `Syntax error: ${err.message || String(err)}`;
            }
        }
    }

    applyZoom() {
        if (this.renderOutput) {
            this.renderOutput.style.transform = `scale(${this.zoomLevel})`;
        }
    }

    bindEvents() {
        if (this.collapseBtn) this.collapseBtn.addEventListener('click', () => this.setSidebarCollapsed(true));
        if (this.expandBtn) this.expandBtn.addEventListener('click', () => this.setSidebarCollapsed(false));
        if (this.controlsCollapseBtn) this.controlsCollapseBtn.addEventListener('click', () => this.setControlsCollapsed(true));
        if (this.controlsExpandBtn) this.controlsExpandBtn.addEventListener('click', () => this.setControlsCollapsed(false));

        if (this.presetSelect) {
            this.presetSelect.addEventListener('change', () => {
                const p = this.presetSelect.value;
                this.updateUIControls();
                const currentData = this.getData();
                if (currentData && currentData.length > 0 && ['xychart', 'pie', 'sankey', 'radar', 'treemap', 'flowchart'].includes(p)) {
                    this.generateFromData();
                } else {
                    if (this.textEditor) this.textEditor.value = '';
                    this.renderConfigPanel();
                    this.renderChart();
                }
            });
        }

        if (this.demoBtn) this.demoBtn.addEventListener('click', () => this.showDemo());
        
        if (this.aiBtn) {
            this.aiBtn.addEventListener('click', () => {
                if (this.aiModal) {
                    if (this.aiModalPrompt) this.aiModalPrompt.value = '';
                    this.aiModal.classList.remove('hidden');
                    if (this.aiModalPrompt) this.aiModalPrompt.focus();
                } else {
                    this.generateWithAI('');
                }
            });
        }

        if (this.aiModalCloseBtn) {
            this.aiModalCloseBtn.addEventListener('click', () => {
                if (this.aiModal) this.aiModal.classList.add('hidden');
            });
        }

        if (this.aiModalCancelBtn) {
            this.aiModalCancelBtn.addEventListener('click', () => {
                if (this.aiModal) this.aiModal.classList.add('hidden');
            });
        }

        if (this.aiModalSubmitBtn) {
            this.aiModalSubmitBtn.addEventListener('click', () => {
                const customPrompt = this.aiModalPrompt ? this.aiModalPrompt.value.trim() : '';
                if (this.aiModal) this.aiModal.classList.add('hidden');
                this.generateWithAI(customPrompt);
            });
        }

        if (this.curvesSelectAllBtn) {
            this.curvesSelectAllBtn.addEventListener('click', () => {
                if (this.curvesList) {
                    const chks = this.curvesList.querySelectorAll('input[type="checkbox"]');
                    chks.forEach(chk => { chk.checked = true; });
                    if (this.presetSelect && this.presetSelect.value === 'radar') {
                        this.generateFromData();
                    }
                }
            });
        }

        if (this.curvesClearBtn) {
            this.curvesClearBtn.addEventListener('click', () => {
                if (this.curvesList) {
                    const chks = this.curvesList.querySelectorAll('input[type="checkbox"]');
                    chks.forEach(chk => { chk.checked = false; });
                    if (this.presetSelect && this.presetSelect.value === 'radar') {
                        this.generateFromData();
                    }
                }
            });
        }

        [this.sourceCol, this.targetCol, this.valCol, this.aggFunc].forEach(el => {
            if (el) {
                el.addEventListener('change', () => {
                    this.generateFromData();
                });
            }
        });

        if (this.chartTitleInput) {
            this.chartTitleInput.addEventListener('input', () => {
                clearTimeout(this.renderTimeout);
                this.renderTimeout = setTimeout(() => {
                    this.generateFromData();
                }, 300);
            });
        }

        if (this.textEditor) {
            this.textEditor.addEventListener('input', () => {
                clearTimeout(this.renderTimeout);
                this.renderTimeout = setTimeout(() => {
                    this.renderConfigPanel();
                    this.renderChart();
                }, 350);
            });
        }

        if (this.zoomInBtn) {
            this.zoomInBtn.addEventListener('click', () => {
                this.zoomLevel = Math.min(3.0, this.zoomLevel + 0.15);
                this.applyZoom();
            });
        }

        if (this.zoomOutBtn) {
            this.zoomOutBtn.addEventListener('click', () => {
                this.zoomLevel = Math.max(0.4, this.zoomLevel - 0.15);
                this.applyZoom();
            });
        }

        if (this.zoomResetBtn) {
            this.zoomResetBtn.addEventListener('click', () => {
                this.zoomLevel = 1.75;
                this.applyZoom();
            });
        }

        if (this.exportPngBtn) {
            this.exportPngBtn.addEventListener('click', () => {
                const svgEl = this.renderOutput?.querySelector('svg');
                if (!svgEl) return alert('No chart to export.');
                const serializer = new XMLSerializer();
                const svgString = serializer.serializeToString(svgEl);
                const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
                const URL = window.URL || window.webkitURL || window;
                const blobURL = URL.createObjectURL(svgBlob);

                const image = new Image();
                image.onload = () => {
                    const canvas = document.createElement('canvas');
                    const rect = svgEl.getBoundingClientRect();
                    canvas.width = Math.max(800, rect.width * 2);
                    canvas.height = Math.max(600, rect.height * 2);
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

                    const pngLink = document.createElement('a');
                    pngLink.download = 'mermaid-chart.png';
                    pngLink.href = canvas.toDataURL('image/png');
                    document.body.appendChild(pngLink);
                    pngLink.click();
                    document.body.removeChild(pngLink);
                };
                image.src = blobURL;
            });
        }

        if (this.exportSvgBtn) {
            this.exportSvgBtn.addEventListener('click', () => {
                const svgEl = this.renderOutput?.querySelector('svg');
                if (!svgEl) return alert('No chart to export.');
                const serializer = new XMLSerializer();
                const svgString = serializer.serializeToString(svgEl);
                const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
                const link = document.createElement('a');
                link.download = 'mermaid-chart.svg';
                link.href = URL.createObjectURL(blob);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            });
        }
    }
}
