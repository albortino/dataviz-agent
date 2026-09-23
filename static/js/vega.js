/**
 * Vega Studio Manager
 * Spec-first Vega-Lite chart builder with 3-panel studio layout:
 * - Collapsible JSON spec editor (left)
 * - Live vegaEmbed preview with zoom/pan and PNG/SVG/JSON exports (center)
 * - Structured BASE property controls for rapid no-code prototyping (right)
 * - AI-assisted chart generation via /chat
 * - Two-way sync between form controls and the underlying Vega-Lite specification
 */

import { formatVegaSpec } from './spec-formatter.js';

export class VegaManager {
    constructor(options = {}) {
        this.getData = options.getData || (() => []);
        this.vegaView = null;
        this.zoomLevel = 1.0;
        this.isInternalUpdating = false;
        this.renderDebounceTimer = null;

        // Container & Sidebars
        this.container = document.getElementById('vega-container');
        this.sidebar = document.getElementById('vega-sidebar');
        this.collapseBtn = document.getElementById('vega-collapse-btn');
        this.expandBtn = document.getElementById('vega-expand-btn');
        this.formatBtn = document.getElementById('vega-format-btn');
        this.textEditor = document.getElementById('vega-text-editor');
        this.errorNotice = document.getElementById('vega-error-notice');
        this.cm = null;

        // Canvas & Output
        this.canvasWrapper = document.getElementById('vega-canvas-wrapper');
        this.renderOutput = document.getElementById('vega-render-output');
        this.controlsSidebar = document.getElementById('vega-controls-sidebar');
        this.controlsCollapseBtn = document.getElementById('vega-controls-collapse-btn');
        this.controlsExpandBtn = document.getElementById('vega-controls-expand-btn');

        // BASE Controls
        this.presetSelect = document.getElementById('vega-chart-preset');
        this.chartTitleInput = document.getElementById('vega-chart-title');
        this.xCol = document.getElementById('vega-x-col');
        this.yCol = document.getElementById('vega-y-col');
        this.colorCol = document.getElementById('vega-color-col');
        this.aggFunc = document.getElementById('vega-agg-func');
        this.aiBtn = document.getElementById('vega-ai-btn');
        this.demoBtn = document.getElementById('vega-demo-btn');

        // Chart Config Accordions & Elements
        this.dimensionsGroup = document.getElementById('vega-dimensions-group');
        this.autofitCheckbox = document.getElementById('vega-autofit');
        this.customWidthInput = document.getElementById('vega-custom-width');
        this.customHeightInput = document.getElementById('vega-custom-height');
        this.markFilledCheckbox = document.getElementById('vega-mark-filled');
        this.markOpacityInput = document.getElementById('vega-mark-opacity');
        this.markOpacityVal = document.getElementById('vega-mark-opacity-val');
        this.markShapeSelect = document.getElementById('vega-mark-shape');
        this.labelsToggle = document.getElementById('vega-labels-toggle');
        this.tooltipToggle = document.getElementById('vega-tooltip-toggle');
        this.xScaleSelect = document.getElementById('vega-x-scale');
        this.yScaleSelect = document.getElementById('vega-y-scale');
        this.zeroToggle = document.getElementById('vega-zero-toggle');
        this.sortOrderSelect = document.getElementById('vega-sort-order');
        this.xTitleInput = document.getElementById('vega-x-title');
        this.yTitleInput = document.getElementById('vega-y-title');
        this.domainMinInput = document.getElementById('vega-domain-min');
        this.domainMaxInput = document.getElementById('vega-domain-max');
        this.facetColSelect = document.getElementById('vega-facet-col');

        // Zoom & Export Controls
        this.zoomInBtn = document.getElementById('vega-zoom-in');
        this.zoomOutBtn = document.getElementById('vega-zoom-out');
        this.zoomResetBtn = document.getElementById('vega-zoom-reset');
        this.exportPngBtn = document.getElementById('vega-export-png-btn');
        this.exportSvgBtn = document.getElementById('vega-export-svg-btn');
        this.exportJsonBtn = document.getElementById('vega-export-json-btn');
        this.copyJsonBtn = document.getElementById('vega-copy-json-btn');

        // AI Modal
        this.aiModal = document.getElementById('vega-ai-modal');
        this.aiModalPrompt = document.getElementById('vega-ai-prompt-input');
        this.aiModalCloseBtn = document.getElementById('close-vega-ai-modal-btn');
        this.aiModalCancelBtn = document.getElementById('cancel-vega-ai-modal-btn');
        this.aiModalSubmitBtn = document.getElementById('confirm-vega-ai-modal-btn');
    }

    init() {
        this.initCodeMirror();
        this.initCollapseState();
        this.bindEvents();
        this.updateColumnOptions();
    }

    initCollapseState() {
        const isCollapsed = this.sidebar ? this.sidebar.classList.contains('collapsed') : false;
        if (this.expandBtn) {
            this.expandBtn.classList.toggle('hidden', !isCollapsed);
        }
        const isCtrlCollapsed = this.controlsSidebar ? this.controlsSidebar.classList.contains('collapsed') : false;
        if (this.controlsExpandBtn) {
            this.controlsExpandBtn.classList.toggle('hidden', !isCtrlCollapsed);
        }
    }

    initCodeMirror() {
        if (!window.CodeMirror || !this.textEditor) return;
        try {
            this.cm = CodeMirror.fromTextArea(this.textEditor, {
                mode: { name: 'javascript', json: true },
                lineNumbers: true,
                lineWrapping: true,
                tabSize: 2,
                indentUnit: 2,
                autofocus: false,
                viewportMargin: Infinity
            });

            this.cm.on('change', () => {
                if (this.isInternalUpdating) return;
                if (this.textEditor) {
                    this.textEditor.value = this.cm.getValue();
                }
                clearTimeout(this.renderDebounceTimer);
                this.renderDebounceTimer = setTimeout(() => {
                    this.renderChart();
                    this.syncControlsFromSpec();
                }, 300);
            });
        } catch (err) {
            console.warn('Failed to initialize CodeMirror for Vega:', err);
        }
    }

    getSpecText() {
        if (this.cm) return this.cm.getValue();
        return this.textEditor ? this.textEditor.value : '';
    }

    setSpecText(text) {
        this.isInternalUpdating = true;
        if (this.textEditor) this.textEditor.value = text;
        if (this.cm && this.cm.getValue() !== text) {
            this.cm.setValue(text);
        }
        this.isInternalUpdating = false;
    }

    refreshEditor() {
        if (this.cm) {
            this.cm.refresh();
        }
    }

    bindEvents() {
        // Sidebar Toggles
        if (this.collapseBtn && this.sidebar) {
            this.collapseBtn.addEventListener('click', () => this.toggleLeftSidebar(true));
        }
        if (this.expandBtn && this.sidebar) {
            this.expandBtn.addEventListener('click', () => this.toggleLeftSidebar(false));
        }
        if (this.controlsCollapseBtn && this.controlsSidebar) {
            this.controlsCollapseBtn.addEventListener('click', () => this.toggleRightSidebar(true));
        }
        if (this.controlsExpandBtn && this.controlsSidebar) {
            this.controlsExpandBtn.addEventListener('click', () => this.toggleRightSidebar(false));
        }

        // JSON Beautifier
        if (this.formatBtn) {
            this.formatBtn.addEventListener('click', () => this.formatJson());
        }

        // Fallback Textarea Input with Debounced Rendering (if CodeMirror is absent)
        if (this.textEditor && !this.cm) {
            this.textEditor.addEventListener('input', () => {
                if (this.isInternalUpdating) return;
                clearTimeout(this.renderDebounceTimer);
                this.renderDebounceTimer = setTimeout(() => {
                    this.renderChart();
                    this.syncControlsFromSpec();
                }, 300);
            });

            // Tab Key Indentation in Textarea
            this.textEditor.addEventListener('keydown', (e) => {
                if (e.key === 'Tab') {
                    e.preventDefault();
                    const start = this.textEditor.selectionStart;
                    const end = this.textEditor.selectionEnd;
                    this.textEditor.value = this.textEditor.value.substring(0, start) + '  ' + this.textEditor.value.substring(end);
                    this.textEditor.selectionStart = this.textEditor.selectionEnd = start + 2;
                }
            });
        }

        // Control Changes trigger Spec Regeneration
        const controlInputs = [this.presetSelect, this.chartTitleInput, this.xCol, this.yCol, this.colorCol, this.aggFunc];
        controlInputs.forEach(input => {
            if (input) {
                input.addEventListener('change', () => {
                    if (this.isInternalUpdating) return;
                    this.generateFromControls();
                });
            }
        });
        if (this.chartTitleInput) {
            this.chartTitleInput.addEventListener('input', () => {
                if (this.isInternalUpdating) return;
                clearTimeout(this.renderDebounceTimer);
                this.renderDebounceTimer = setTimeout(() => this.generateFromControls(), 300);
            });
        }

        // Dimensions Listeners (Matching Sankey Behavior)
        if (this.autofitCheckbox) {
            this.autofitCheckbox.addEventListener('change', () => {
                if (this.autofitCheckbox.checked) {
                    if (this.customWidthInput) this.customWidthInput.value = '';
                    if (this.customHeightInput) this.customHeightInput.value = '';
                }
                if (!this.isInternalUpdating) this.generateFromControls();
            });
        }
        [this.customWidthInput, this.customHeightInput].forEach(inp => {
            if (inp) {
                inp.addEventListener('focus', () => {
                    if (this.autofitCheckbox && this.autofitCheckbox.checked) {
                        this.autofitCheckbox.checked = false;
                    }
                });
                inp.addEventListener('input', () => {
                    if (this.autofitCheckbox && this.autofitCheckbox.checked) {
                        this.autofitCheckbox.checked = false;
                    }
                    if (this.isInternalUpdating) return;
                    clearTimeout(this.renderDebounceTimer);
                    this.renderDebounceTimer = setTimeout(() => this.generateFromControls(), 300);
                });
                inp.addEventListener('change', () => {
                    if (this.autofitCheckbox && this.autofitCheckbox.checked) {
                        this.autofitCheckbox.checked = false;
                    }
                    if (!this.isInternalUpdating) this.generateFromControls();
                });
            }
        });

        // Mark & Style Listeners
        if (this.markFilledCheckbox) {
            this.markFilledCheckbox.addEventListener('change', () => {
                if (!this.isInternalUpdating) this.generateFromControls();
            });
        }
        if (this.markOpacityInput) {
            this.markOpacityInput.addEventListener('input', () => {
                if (this.markOpacityVal) this.markOpacityVal.textContent = this.markOpacityInput.value;
                if (!this.isInternalUpdating) {
                    clearTimeout(this.renderDebounceTimer);
                    this.renderDebounceTimer = setTimeout(() => this.generateFromControls(), 150);
                }
            });
        }
        if (this.markShapeSelect) {
            this.markShapeSelect.addEventListener('change', () => {
                if (!this.isInternalUpdating) this.generateFromControls();
            });
        }
        if (this.labelsToggle) {
            this.labelsToggle.addEventListener('change', () => {
                if (!this.isInternalUpdating) this.generateFromControls();
            });
        }
        if (this.tooltipToggle) {
            this.tooltipToggle.addEventListener('change', () => {
                if (!this.isInternalUpdating) this.generateFromControls();
            });
        }

        // Axis, Scales & Facet Listeners
        [this.xScaleSelect, this.yScaleSelect, this.sortOrderSelect, this.facetColSelect].forEach(sel => {
            if (sel) {
                sel.addEventListener('change', () => {
                    if (!this.isInternalUpdating) this.generateFromControls();
                });
            }
        });
        if (this.zeroToggle) {
            this.zeroToggle.addEventListener('change', () => {
                if (!this.isInternalUpdating) this.generateFromControls();
            });
        }
        [this.xTitleInput, this.yTitleInput, this.domainMinInput, this.domainMaxInput].forEach(inp => {
            if (inp) {
                inp.addEventListener('input', () => {
                    if (this.isInternalUpdating) return;
                    clearTimeout(this.renderDebounceTimer);
                    this.renderDebounceTimer = setTimeout(() => this.generateFromControls(), 300);
                });
            }
        });

        // Demo & AI Buttons
        if (this.demoBtn) {
            this.demoBtn.addEventListener('click', () => this.loadSensibleDefaults());
        }
        if (this.aiBtn) {
            this.aiBtn.addEventListener('click', () => this.openAiModal());
        }

        // AI Modal Events
        if (this.aiModalCloseBtn) this.aiModalCloseBtn.addEventListener('click', () => this.closeAiModal());
        if (this.aiModalCancelBtn) this.aiModalCancelBtn.addEventListener('click', () => this.closeAiModal());
        if (this.aiModalSubmitBtn) {
            this.aiModalSubmitBtn.addEventListener('click', () => {
                const prompt = this.aiModalPrompt?.value?.trim() || '';
                this.closeAiModal();
                this.generateWithAI(prompt);
            });
        }

        // Zoom Controls
        if (this.zoomInBtn) this.zoomInBtn.addEventListener('click', () => this.setZoom(this.zoomLevel + 0.15));
        if (this.zoomOutBtn) this.zoomOutBtn.addEventListener('click', () => this.setZoom(this.zoomLevel - 0.15));
        if (this.zoomResetBtn) this.zoomResetBtn.addEventListener('click', () => this.setZoom(1.0));

        // Export Controls
        if (this.exportPngBtn) this.exportPngBtn.addEventListener('click', () => this.exportPng());
        if (this.exportSvgBtn) this.exportSvgBtn.addEventListener('click', () => this.exportSvg());
        if (this.exportJsonBtn) this.exportJsonBtn.addEventListener('click', () => this.exportJson());
        if (this.copyJsonBtn) this.copyJsonBtn.addEventListener('click', () => this.copyJson());

        // Keyboard Shortcut: Ctrl/Cmd + B collapses left spec sidebar
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && !this.container?.classList.contains('hidden')) {
                e.preventDefault();
                const isCollapsed = this.sidebar?.classList.contains('collapsed');
                this.toggleLeftSidebar(!isCollapsed);
            }
        });

        // Window resize re-renders chart if autofit is enabled
        window.addEventListener('resize', () => {
            if (!this.container?.classList.contains('hidden') && this.autofitCheckbox?.checked) {
                clearTimeout(this.renderDebounceTimer);
                this.renderDebounceTimer = setTimeout(() => this.renderChart(), 200);
            }
        });
    }

    toggleLeftSidebar(collapse) {
        if (!this.sidebar) return;
        if (collapse) {
            this.sidebar.classList.add('collapsed');
            if (this.expandBtn) this.expandBtn.classList.remove('hidden');
        } else {
            this.sidebar.classList.remove('collapsed');
            if (this.expandBtn) this.expandBtn.classList.add('hidden');
            if (this.cm) {
                setTimeout(() => this.cm.refresh(), 200);
            }
        }
    }

    toggleRightSidebar(collapse) {
        if (!this.controlsSidebar) return;
        if (collapse) {
            this.controlsSidebar.classList.add('collapsed');
            if (this.controlsExpandBtn) this.controlsExpandBtn.classList.remove('hidden');
        } else {
            this.controlsSidebar.classList.remove('collapsed');
            if (this.controlsExpandBtn) this.controlsExpandBtn.classList.add('hidden');
        }
    }

    setZoom(level) {
        this.zoomLevel = Math.max(0.3, Math.min(3.0, level));
        if (this.renderOutput) {
            this.renderOutput.style.transform = `scale(${this.zoomLevel})`;
        }
    }

    updateColumnOptions() {
        const data = this.getData() || [];
        if (!data || data.length === 0) return;

        const sample = data[0] || {};
        const isInternalCol = c => c === 'GL_ORDINAL' || c === '_unit_id' || (typeof c === 'string' && c.startsWith('__'));
        const columns = Object.keys(sample).filter(c => !isInternalCol(c));

        const populate = (select, includeNone = false, defaultVal = '') => {
            if (!select) return;
            const currentVal = select.value || defaultVal;
            select.innerHTML = '';
            if (includeNone) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = '(None)';
                select.appendChild(opt);
            }
            columns.forEach(col => {
                const opt = document.createElement('option');
                opt.value = col;
                opt.textContent = col;
                if (col === currentVal) opt.selected = true;
                select.appendChild(opt);
            });
        };

        populate(this.xCol, false);
        populate(this.yCol, false);
        populate(this.colorCol, true);
        populate(this.facetColSelect, true);
    }

    loadSensibleDefaults() {
        const data = this.getData() || [];
        if (!data || data.length === 0) return;

        this.updateColumnOptions();
        const sample = data[0] || {};
        const isInternalCol = c => c === 'GL_ORDINAL' || c === '_unit_id' || (typeof c === 'string' && c.startsWith('__'));
        const cols = Object.keys(sample).filter(c => !isInternalCol(c));

        let catCol = cols.find(c => typeof sample[c] === 'string') || cols[0];
        let numCol = cols.find(c => typeof sample[c] === 'number') || cols[1] || cols[0];

        if (this.presetSelect) this.presetSelect.value = 'bar';
        if (this.chartTitleInput) this.chartTitleInput.value = `${numCol} by ${catCol}`;
        if (this.xCol && catCol) this.xCol.value = catCol;
        if (this.yCol && numCol) this.yCol.value = numCol;
        if (this.colorCol) this.colorCol.value = '';
        if (this.aggFunc) this.aggFunc.value = typeof sample[numCol] === 'number' ? 'sum' : 'none';

        this.generateFromControls();
    }

    /**
     * Determines whether column values are quantitative, temporal, or nominal.
     */
    inferType(colName) {
        if (!colName) return 'nominal';
        const data = this.getData() || [];
        for (let i = 0; i < Math.min(20, data.length); i++) {
            const val = data[i][colName];
            if (val === null || val === undefined || val === '') continue;
            if (typeof val === 'number') return 'quantitative';
            if (typeof val === 'boolean') return 'nominal';
            if (typeof val === 'string') {
                if (!isNaN(Number(val)) && val.trim() !== '') return 'quantitative';
                if (/^\d{4}-\d{2}-\d{2}/.test(val)) return 'temporal';
            }
        }
        return 'nominal';
    }

    /**
     * Translates active controls into a Vega-Lite v5 specification using non-destructive patching.
     */
    generateFromControls() {
        const mark = this.presetSelect?.value || 'bar';
        const title = this.chartTitleInput?.value?.trim() || '';
        const xField = this.xCol?.value || '';
        const yField = this.yCol?.value || '';
        const colorField = this.colorCol?.value || '';
        const agg = this.aggFunc?.value || 'none';

        // Config options
        const isAutofit = this.autofitCheckbox ? this.autofitCheckbox.checked : true;
        const customW = parseInt(this.customWidthInput?.value, 10);
        const customH = parseInt(this.customHeightInput?.value, 10);
        const isFilled = this.markFilledCheckbox ? this.markFilledCheckbox.checked : true;
        const opacityVal = parseFloat(this.markOpacityInput?.value || '0.85');
        const shapeVal = this.markShapeSelect?.value || 'circle';
        const showLabels = this.labelsToggle ? this.labelsToggle.checked : false;
        const showTooltips = this.tooltipToggle ? this.tooltipToggle.checked : true;
        const xScale = this.xScaleSelect?.value || 'linear';
        const yScale = this.yScaleSelect?.value || 'linear';
        const startZero = this.zeroToggle ? this.zeroToggle.checked : true;
        const sortOrder = this.sortOrderSelect?.value || 'default';
        const xTitle = this.xTitleInput?.value?.trim() || '';
        const yTitle = this.yTitleInput?.value?.trim() || '';
        const domainMin = parseFloat(this.domainMinInput?.value);
        const domainMax = parseFloat(this.domainMaxInput?.value);
        const facetCol = this.facetColSelect?.value || '';

        // Surgical patch: try reading existing spec to preserve custom transforms/unmapped properties
        let spec = {};
        const existingText = this.getSpecText()?.trim();
        if (existingText) {
            try {
                spec = JSON.parse(existingText);
            } catch (e) {
                spec = {};
            }
        }

        spec.$schema = spec.$schema || "https://vega.github.io/schema/vega-lite/v5.json";
        if (title) {
            spec.title = title;
            spec.description = title;
        } else if (spec.title && !title) {
            delete spec.title;
        }

        // Dimensions
        if (isAutofit) {
            spec.width = "container";
            spec.height = 360;
            spec.autosize = { type: "pad", contains: "padding" };
        } else {
            if (customW && customW >= 100) spec.width = customW;
            if (customH && customH >= 100) spec.height = customH;
            spec.autosize = { type: "pad", contains: "padding" };
        }

        // Faceting
        if (facetCol) {
            spec.facet = { field: facetCol, type: this.inferType(facetCol), columns: 2 };
        } else {
            delete spec.facet;
        }

        // Mark definition
        const markDef = {
            type: mark,
            filled: isFilled,
            opacity: isNaN(opacityVal) ? 0.85 : opacityVal
        };
        if (mark === 'arc') {
            markDef.innerRadius = 30;
        }
        if (mark === 'point' || mark === 'circle') {
            markDef.shape = shapeVal;
        }

        // Encodings
        const encoding = {};

        if (mark === 'arc') {
            const thetaEnc = { field: yField || xField, type: 'quantitative' };
            if (agg !== 'none') thetaEnc.aggregate = agg;
            encoding.theta = thetaEnc;
            if (xField || yField) encoding.color = { field: xField || yField, type: 'nominal' };
        } else if (mark === 'boxplot') {
            if (xField) encoding.x = { field: xField, type: this.inferType(xField) };
            if (yField) encoding.y = { field: yField, type: 'quantitative' };
        } else {
            if (xField) {
                const xType = this.inferType(xField);
                const xEnc = { field: xField, type: xType };
                if (agg !== 'none' && xType === 'quantitative') xEnc.aggregate = agg;

                const xSc = {};
                if (xScale !== 'linear' && xScale !== 'default') xSc.type = xScale;
                if (!startZero && xType === 'quantitative') xSc.zero = false;
                if (Object.keys(xSc).length > 0) xEnc.scale = xSc;

                if (xTitle) xEnc.title = xTitle;
                if (sortOrder !== 'default') xEnc.sort = sortOrder;
                encoding.x = xEnc;
            }

            if (yField) {
                const yType = this.inferType(yField);
                const yEnc = { field: yField, type: yType };
                if (agg !== 'none' && yType === 'quantitative') yEnc.aggregate = agg;

                const ySc = {};
                if (yScale !== 'linear' && yScale !== 'default') ySc.type = yScale;
                if (!startZero && yType === 'quantitative') ySc.zero = false;
                if (!isNaN(domainMin) && !isNaN(domainMax) && domainMax > domainMin) {
                    ySc.domain = [domainMin, domainMax];
                }
                if (Object.keys(ySc).length > 0) yEnc.scale = ySc;

                if (yTitle) yEnc.title = yTitle;
                encoding.y = yEnc;
            }
        }

        if (colorField && mark !== 'arc') {
            encoding.color = { field: colorField, type: this.inferType(colorField) };
        }

        if (showTooltips && mark !== 'arc') {
            const tooltipFields = [];
            if (xField) tooltipFields.push({ field: xField, type: this.inferType(xField) });
            if (yField && yField !== xField) {
                const tipY = { field: yField, type: this.inferType(yField) };
                if (agg !== 'none') tipY.aggregate = agg;
                tooltipFields.push(tipY);
            }
            if (colorField && colorField !== xField && colorField !== yField) {
                tooltipFields.push({ field: colorField, type: this.inferType(colorField) });
            }
            if (tooltipFields.length > 0) encoding.tooltip = tooltipFields;
        }

        // Data Labels (Multi-layer compilation)
        if (showLabels && mark !== 'arc' && (xField || yField)) {
            const metricField = yField || xField;
            const textMark = {
                type: 'text',
                align: 'center',
                baseline: 'bottom',
                dy: -6,
                fontSize: 11
            };
            const textEnc = {
                x: encoding.x ? { ...encoding.x } : undefined,
                y: encoding.y ? { ...encoding.y } : undefined,
                text: { field: metricField, type: this.inferType(metricField) }
            };
            if (agg !== 'none' && textEnc.text.type === 'quantitative') {
                textEnc.text.aggregate = agg;
            }
            delete textEnc.tooltip;

            delete spec.mark;
            delete spec.encoding;
            spec.layer = [
                { mark: markDef, encoding: encoding },
                { mark: textMark, encoding: textEnc }
            ];
        } else {
            // Single layer
            delete spec.layer;
            spec.mark = markDef;
            spec.encoding = encoding;
        }

        const formatted = formatVegaSpec(spec);
        this.setSpecText(formatted);
        this.renderChart(spec);
    }

    /**
     * Inspects active spec and synchronizes matching BASE & Chart Config controls.
     */
    syncControlsFromSpec() {
        const text = this.getSpecText()?.trim();
        if (!text) return;
        try {
            const spec = JSON.parse(text);
            this.isInternalUpdating = true;

            // Dimensions
            if (spec.width === 'container' || (!spec.width && !spec.height)) {
                if (this.autofitCheckbox) this.autofitCheckbox.checked = true;
                if (this.customWidthInput) this.customWidthInput.value = '';
                if (this.customHeightInput) this.customHeightInput.value = '';
            } else {
                if (this.autofitCheckbox) this.autofitCheckbox.checked = false;
                if (this.customWidthInput) {
                    this.customWidthInput.value = typeof spec.width === 'number' ? spec.width : '';
                }
                if (this.customHeightInput) {
                    this.customHeightInput.value = typeof spec.height === 'number' ? spec.height : '';
                }
            }

            // Inspect mark and encoding either at top-level or from first layer
            const targetSpec = (Array.isArray(spec.layer) && spec.layer.length > 0) ? spec.layer[0] : spec;
            const markObj = typeof targetSpec.mark === 'string' ? { type: targetSpec.mark } : (targetSpec.mark || {});
            const markType = markObj.type;

            if (markType && this.presetSelect) {
                const option = Array.from(this.presetSelect.options).find(o => o.value === markType);
                if (option) this.presetSelect.value = markType;
            }

            if (this.markFilledCheckbox) {
                this.markFilledCheckbox.checked = markObj.filled !== false;
            }
            if (this.markOpacityInput && markObj.opacity !== undefined) {
                this.markOpacityInput.value = markObj.opacity;
                if (this.markOpacityVal) this.markOpacityVal.textContent = markObj.opacity;
            }
            if (this.markShapeSelect && markObj.shape) {
                this.markShapeSelect.value = markObj.shape;
            }

            // Data labels detection (second layer with mark.type === 'text')
            const hasDataLabels = Array.isArray(spec.layer) && spec.layer.some(l => {
                const t = typeof l.mark === 'string' ? l.mark : l.mark?.type;
                return t === 'text';
            });
            if (this.labelsToggle) {
                this.labelsToggle.checked = hasDataLabels;
            }

            // Title
            if (spec.title && this.chartTitleInput) {
                this.chartTitleInput.value = typeof spec.title === 'string' ? spec.title : (spec.title.text || '');
            } else if (!spec.title && this.chartTitleInput) {
                this.chartTitleInput.value = '';
            }

            // Encodings
            const enc = targetSpec.encoding || {};
            if (enc.x?.field && this.xCol) this.xCol.value = enc.x.field;
            if (enc.y?.field && this.yCol) this.yCol.value = enc.y.field;
            if (enc.color?.field && this.colorCol) this.colorCol.value = enc.color.field;

            // Aggregation
            const agg = enc.y?.aggregate || enc.x?.aggregate || enc.theta?.aggregate;
            if (agg && this.aggFunc) {
                const opt = Array.from(this.aggFunc.options).find(o => o.value === agg);
                if (opt) this.aggFunc.value = agg;
            } else if (this.aggFunc) {
                this.aggFunc.value = 'none';
            }

            // Scales & Axis
            if (this.xScaleSelect) this.xScaleSelect.value = enc.x?.scale?.type || 'linear';
            if (this.yScaleSelect) this.yScaleSelect.value = enc.y?.scale?.type || 'linear';
            if (this.zeroToggle) {
                const zeroDisabled = enc.y?.scale?.zero === false || enc.x?.scale?.zero === false;
                this.zeroToggle.checked = !zeroDisabled;
            }
            if (this.sortOrderSelect) {
                this.sortOrderSelect.value = typeof enc.x?.sort === 'string' ? enc.x.sort : 'default';
            }
            if (this.xTitleInput) this.xTitleInput.value = enc.x?.title || '';
            if (this.yTitleInput) this.yTitleInput.value = enc.y?.title || '';
            if (this.domainMinInput && Array.isArray(enc.y?.scale?.domain)) {
                this.domainMinInput.value = enc.y.scale.domain[0] ?? '';
                if (this.domainMaxInput) this.domainMaxInput.value = enc.y.scale.domain[1] ?? '';
            } else if (this.domainMinInput) {
                this.domainMinInput.value = '';
                if (this.domainMaxInput) this.domainMaxInput.value = '';
            }

            // Tooltips
            if (this.tooltipToggle) {
                this.tooltipToggle.checked = enc.tooltip !== undefined && enc.tooltip !== null;
            }

            // Facet
            if (this.facetColSelect) {
                this.facetColSelect.value = spec.facet?.field || '';
            }
        } catch (e) {
            // Non-fatal if spec is currently being typed
        } finally {
            this.isInternalUpdating = false;
        }
    }

    /**
     * Compiles and renders the Vega-Lite specification via vegaEmbed.
     */
    async renderChart(specObj = null) {
        if (!this.renderOutput) return;

        if (!window.vegaEmbed || !window.vega) {
            setTimeout(() => {
                if (window.vegaEmbed && window.vega) {
                    this.renderChart(specObj);
                } else {
                    this.showError('Vega libraries are still loading or unavailable. Please check your network connection.');
                }
            }, 300);
            return;
        }

        let spec = specObj;
        if (!spec) {
            const raw = this.getSpecText()?.trim();
            if (!raw) return;
            try {
                spec = JSON.parse(raw);
            } catch (err) {
                this.showError(`JSON Syntax Error: ${err.message}`);
                return;
            }
        }

        // Deep clone spec to inject workspace dataset without bloating editor JSON
        const runtimeSpec = JSON.parse(JSON.stringify(spec));
        if (!runtimeSpec.data || !runtimeSpec.data.values || runtimeSpec.data.values.length === 0) {
            const data = this.getData() || [];
            runtimeSpec.data = { values: data };
        }

        // Resolve container width to concrete pixel width to avoid 0-width flex collapse
        const wrapperW = this.canvasWrapper?.clientWidth || this.renderOutput?.parentElement?.clientWidth || 750;
        const availableW = Math.max(320, wrapperW - 80);

        if (runtimeSpec.width === 'container' || !runtimeSpec.width) {
            runtimeSpec.width = Math.min(850, availableW);
        } else if (typeof runtimeSpec.width === 'number') {
            runtimeSpec.width = Math.max(100, runtimeSpec.width);
        }

        if (runtimeSpec.height === 'container' || !runtimeSpec.height) {
            runtimeSpec.height = 360;
        } else if (typeof runtimeSpec.height === 'number') {
            runtimeSpec.height = Math.max(100, runtimeSpec.height);
        }

        runtimeSpec.autosize = { type: 'pad', contains: 'padding' };

        try {
            this.clearError();
            const res = await window.vegaEmbed(this.renderOutput, runtimeSpec, {
                actions: false,
                renderer: 'svg',
                mode: 'vega-lite',
                vega: window.vega,
                vegaLite: window.vl || window.vegaLite
            });
            this.vegaView = res.view;
            this.setZoom(this.zoomLevel);
        } catch (err) {
            console.warn('VegaEmbed compilation error:', err);
            this.showError(`Vega Error: ${err.message || String(err)}`);
        }
    }

    loadSpec(spec) {
        if (!spec) return;
        const text = formatVegaSpec(spec);
        this.setSpecText(text);
        this.syncControlsFromSpec();
        this.renderChart();
    }

    formatJson() {
        const raw = this.getSpecText()?.trim();
        if (!raw) return;
        try {
            const formatted = formatVegaSpec(raw);
            this.setSpecText(formatted);
            this.clearError();
        } catch (err) {
            this.showError(`Cannot format spec: ${err.message}`);
        }
    }

    showError(msg) {
        if (this.errorNotice) {
            this.errorNotice.textContent = msg;
            this.errorNotice.classList.remove('hidden');
        }
    }

    clearError() {
        if (this.errorNotice) {
            this.errorNotice.textContent = '';
            this.errorNotice.classList.add('hidden');
        }
    }

    openAiModal() {
        if (this.aiModal) {
            if (this.aiModalPrompt) this.aiModalPrompt.value = '';
            this.aiModal.classList.remove('hidden');
            this.aiModalPrompt?.focus();
        }
    }

    closeAiModal() {
        if (this.aiModal) this.aiModal.classList.add('hidden');
    }

    async generateWithAI(customPrompt = '') {
        const data = this.getData() || [];
        if (!data || data.length === 0) {
            alert('Please load a dataset or demo data first.');
            return;
        }

        const apiKey = (localStorage.getItem('ai_api_key') || '').trim();
        const baseUrl = (localStorage.getItem('ai_base_url') || '').trim();
        const model = (localStorage.getItem('ai_model') || '').trim();

        const mark = this.presetSelect?.value || 'bar';
        const cols = Object.keys(data[0] || {}).filter(c => c !== 'GL_ORDINAL' && c !== '_unit_id' && !c.startsWith('__'));
        const sampleRows = data.slice(0, 20);

        let systemPrompt = `Create a clean, syntactically valid Vega-Lite v5 specification JSON for this dataset.\n`;
        systemPrompt += `Columns: ${cols.join(', ')}\n`;
        systemPrompt += `Preferred mark type: ${mark}\n`;
        if (customPrompt) systemPrompt += `User Instructions: ${customPrompt}\n`;
        systemPrompt += `IMPORTANT: Output ONLY the valid Vega-Lite specification JSON enclosed in \`\`\`vega-lite ... \`\`\` code fence. Do NOT embed full data rows; use "data": { "name": "source" } or omit data so the client injects the dataset. Do NOT include conversational commentary outside the fence.`;

        const originalBtnHtml = this.aiBtn ? this.aiBtn.innerHTML : '';
        if (this.aiBtn) {
            this.aiBtn.disabled = true;
            this.aiBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Generating...</span>`;
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 45000);

            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    message: systemPrompt,
                    data: sampleRows,
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
                    throw new Error("Server gateway timed out (504). The AI model took too long to reply.");
                }
                throw new Error(errDetail);
            }

            const result = await response.json();
            const answer = result.answer || '';
            let specJson = '';

            const match = answer.match(/```(?:vega-lite|vega|json)?\s*([\s\S]*?)\s*```/i);
            if (match) {
                specJson = match[1].trim();
            } else {
                for (const log of (result.logs || [])) {
                    const logMatch = log.match(/```(?:vega-lite|vega|json)?\s*([\s\S]*?)\s*```/i);
                    if (logMatch) {
                        specJson = logMatch[1].trim();
                        break;
                    }
                }
            }

            if (!specJson && answer.trim().startsWith('{') && answer.trim().endsWith('}')) {
                specJson = answer.trim();
            }

            if (specJson) {
                this.loadSpec(specJson);
            } else {
                alert('AI did not return a valid Vega-Lite specification code block.');
            }
        } catch (err) {
            console.error('Vega AI error:', err);
            alert(`AI generation failed: ${err.message}`);
        } finally {
            if (this.aiBtn) {
                this.aiBtn.disabled = false;
                this.aiBtn.innerHTML = originalBtnHtml;
            }
        }
    }

    async exportPng() {
        if (!this.vegaView) return;
        try {
            const url = await this.vegaView.toImageURL('png', 2);
            const a = document.createElement('a');
            a.href = url;
            a.download = `vega-chart-${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (err) {
            alert(`Failed to export PNG: ${err.message}`);
        }
    }

    async exportSvg() {
        if (!this.vegaView) return;
        try {
            const svgStr = await this.vegaView.toSVG();
            const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `vega-chart-${Date.now()}.svg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            alert(`Failed to export SVG: ${err.message}`);
        }
    }

    exportJson() {
        const text = this.getSpecText() || '{}';
        const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vega-spec-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    copyJson() {
        const text = this.getSpecText() || '';
        navigator.clipboard.writeText(text).then(() => {
            if (this.copyJsonBtn) {
                const orig = this.copyJsonBtn.innerHTML;
                this.copyJsonBtn.innerHTML = `<i class="fa-solid fa-check"></i><span>Copied</span>`;
                setTimeout(() => { this.copyJsonBtn.innerHTML = orig; }, 2000);
            }
        });
    }

    exportState() {
        return {
            spec: this.getSpecText(),
            preset: this.presetSelect?.value || 'bar',
            title: this.chartTitleInput?.value || '',
            xCol: this.xCol?.value || '',
            yCol: this.yCol?.value || '',
            colorCol: this.colorCol?.value || '',
            aggFunc: this.aggFunc?.value || 'none',
            zoomLevel: this.zoomLevel || 1.0,
            leftCollapsed: this.sidebar?.classList.contains('collapsed') ?? true,
            rightCollapsed: this.controlsSidebar?.classList.contains('collapsed') ?? false,
            // Config options
            isAutofit: this.autofitCheckbox ? this.autofitCheckbox.checked : true,
            customWidth: this.customWidthInput?.value || '',
            customHeight: this.customHeightInput?.value || '',
            isFilled: this.markFilledCheckbox ? this.markFilledCheckbox.checked : true,
            opacity: this.markOpacityInput?.value || '0.85',
            shape: this.markShapeSelect?.value || 'circle',
            showLabels: this.labelsToggle ? this.labelsToggle.checked : false,
            showTooltips: this.tooltipToggle ? this.tooltipToggle.checked : true,
            xScale: this.xScaleSelect?.value || 'linear',
            yScale: this.yScaleSelect?.value || 'linear',
            startZero: this.zeroToggle ? this.zeroToggle.checked : true,
            sortOrder: this.sortOrderSelect?.value || 'default',
            xTitle: this.xTitleInput?.value || '',
            yTitle: this.yTitleInput?.value || '',
            domainMin: this.domainMinInput?.value || '',
            domainMax: this.domainMaxInput?.value || '',
            facetCol: this.facetColSelect?.value || ''
        };
    }

    importState(state) {
        if (!state) return;
        this.updateColumnOptions();
        if (state.preset && this.presetSelect) this.presetSelect.value = state.preset;
        if (state.title !== undefined && this.chartTitleInput) this.chartTitleInput.value = state.title;
        if (state.xCol && this.xCol) this.xCol.value = state.xCol;
        if (state.yCol && this.yCol) this.yCol.value = state.yCol;
        if (state.colorCol !== undefined && this.colorCol) this.colorCol.value = state.colorCol;
        if (state.aggFunc && this.aggFunc) this.aggFunc.value = state.aggFunc;
        if (typeof state.zoomLevel === 'number') this.setZoom(state.zoomLevel);

        if (state.leftCollapsed !== undefined) this.toggleLeftSidebar(state.leftCollapsed);
        if (state.rightCollapsed !== undefined) this.toggleRightSidebar(state.rightCollapsed);

        // Restore Config options
        if (state.isAutofit !== undefined && this.autofitCheckbox) {
            this.autofitCheckbox.checked = state.isAutofit;
            if (this.customWidthInput) this.customWidthInput.disabled = state.isAutofit;
            if (this.customHeightInput) this.customHeightInput.disabled = state.isAutofit;
        }
        if (state.customWidth && this.customWidthInput) this.customWidthInput.value = state.customWidth;
        if (state.customHeight && this.customHeightInput) this.customHeightInput.value = state.customHeight;
        if (state.isFilled !== undefined && this.markFilledCheckbox) this.markFilledCheckbox.checked = state.isFilled;
        if (state.opacity && this.markOpacityInput) {
            this.markOpacityInput.value = state.opacity;
            if (this.markOpacityVal) this.markOpacityVal.textContent = state.opacity;
        }
        if (state.shape && this.markShapeSelect) this.markShapeSelect.value = state.shape;
        if (state.showLabels !== undefined && this.labelsToggle) this.labelsToggle.checked = state.showLabels;
        if (state.showTooltips !== undefined && this.tooltipToggle) this.tooltipToggle.checked = state.showTooltips;
        if (state.xScale && this.xScaleSelect) this.xScaleSelect.value = state.xScale;
        if (state.yScale && this.yScaleSelect) this.yScaleSelect.value = state.yScale;
        if (state.startZero !== undefined && this.zeroToggle) this.zeroToggle.checked = state.startZero;
        if (state.sortOrder && this.sortOrderSelect) this.sortOrderSelect.value = state.sortOrder;
        if (state.xTitle !== undefined && this.xTitleInput) this.xTitleInput.value = state.xTitle;
        if (state.yTitle !== undefined && this.yTitleInput) this.yTitleInput.value = state.yTitle;
        if (state.domainMin !== undefined && this.domainMinInput) this.domainMinInput.value = state.domainMin;
        if (state.domainMax !== undefined && this.domainMaxInput) this.domainMaxInput.value = state.domainMax;
        if (state.facetCol && this.facetColSelect) this.facetColSelect.value = state.facetCol;

        if (state.spec) {
            this.setSpecText(state.spec);
            this.renderChart();
        } else {
            this.generateFromControls();
        }
    }
}
