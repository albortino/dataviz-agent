/**
 * SandDance Manager Module
 * Handles WebGL unit-visualization via Microsoft SandDance and Vega.
 * Supports particle unrolling/disaggregation, axis/color mapping, and PNG export.
 */

import { detectType } from './data-transform.js';

export class SandDanceManager {
    constructor(options = {}) {
        this.getData = options.getData || (() => []);
        this.viewer = null;

        // DOM elements
        this.root = document.getElementById('sanddance-root');
        this.container = document.getElementById('sanddance-container');
        this.toolbar = document.getElementById('sanddance-toolbar');
        this.chartSelect = document.getElementById('sanddance-chart-type');
        this.xSelect = document.getElementById('sanddance-x-axis');
        this.ySelect = document.getElementById('sanddance-y-axis');
        this.colorSelect = document.getElementById('sanddance-color');
        this.sortSelect = document.getElementById('sanddance-sort');
        this.facetSelect = document.getElementById('sanddance-facet');
        this.disaggregateCheck = document.getElementById('sanddance-disaggregate-check');
        this.disaggregateContainer = document.getElementById('sanddance-disaggregate-container');
        this.disaggregateCol = document.getElementById('sanddance-disaggregate-col');
        this.disaggregateInfo = document.getElementById('sanddance-disaggregate-info');
        this.totalStyleSelect = document.getElementById('sanddance-total-style');
        this.totalStyleGroup = document.getElementById('sanddance-total-style-group');
        this.xLabel = document.getElementById('sanddance-x-label');
        this.yLabel = document.getElementById('sanddance-y-label');
        this.xGroup = document.getElementById('sanddance-x-group');
        this.yGroup = document.getElementById('sanddance-y-group');
        this.chartHint = document.getElementById('sanddance-chart-hint');
        this.exportBtn = document.getElementById('sanddance-export-btn');
        this.collapseBtn = document.getElementById('sanddance-controls-collapse-btn');
        this.expandBtn = document.getElementById('sanddance-controls-expand-btn');
        this.canvasWrapper = document.getElementById('sanddance-canvas-wrapper');
        this.panelContainer = document.getElementById('sanddance-panel-container');
        this.panelGroup = document.getElementById('sanddance-panel-group');
        this.tooltipCheck = document.getElementById('sanddance-tooltip-check');
        this.tooltipsEnabled = true;
        this.mutationObserver = null;
        this.resizeObserver = null;
        this.resizeTimeout = null;
        this.hasRenderedData = false;
    }

    init() {
        this.initViewer();
        this.setupPanelObserver();
        this.setupResizeObserver();
        this.updateLabelsForChartType();
        this.updateTotalStyleVisibility();
        this.initCollapseState();
        this.bindEvents();
    }

    initCollapseState() {
        if (window.innerWidth < 900) {
            this.setToolbarCollapsed(true);
        }
    }

    setToolbarCollapsed(collapsed) {
        if (!this.toolbar) return;
        this.toolbar.classList.toggle('collapsed', collapsed);
        if (this.expandBtn) {
            this.expandBtn.classList.toggle('hidden', !collapsed);
        }
        setTimeout(() => {
            this.scheduleResize();
        }, 300);
    }

    relocatePanel() {
        if (!this.panelContainer) return;
        let panel = (this.root && this.root.querySelector('.sanddance-panel')) ||
            (this.canvasWrapper && this.canvasWrapper.querySelector('.sanddance-panel')) ||
            document.querySelector('#sanddance-container .sanddance-panel') ||
            document.querySelector('.sanddance-panel');

        if (!panel && this.viewer && this.viewer.presenter) {
            try {
                const prefix = (this.viewer.presenter.style && this.viewer.presenter.style.cssPrefix) || 'sanddance-';
                panel = document.createElement('div');
                panel.className = `${prefix}panel`;
                const vegaControls = document.createElement('div');
                vegaControls.className = `${prefix}vegaControls`;
                const legend = document.createElement('div');
                legend.className = `${prefix}legend`;
                panel.appendChild(vegaControls);
                panel.appendChild(legend);
                this.panelContainer.appendChild(panel);
            } catch (e) {
                console.warn('Could not ensure sanddance-panel:', e);
            }
        }

        if (panel) {
            if (panel.parentElement !== this.panelContainer) {
                this.panelContainer.appendChild(panel);
            }
            if (this.panelGroup) {
                this.panelGroup.classList.remove('hidden');
            }
        }
    }

    setupPanelObserver() {
        if (this.mutationObserver || !this.root) return;
        this.mutationObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.classList && (node.classList.contains('sanddance-panel') || node.classList.contains('sanddance-vegaControls') || node.classList.contains('vega-bind'))) {
                            this.relocatePanel();
                            return;
                        }
                        if (node.querySelector && node.querySelector('.sanddance-panel, .sanddance-vegaControls, .vega-bind')) {
                            this.relocatePanel();
                            return;
                        }
                    }
                }
            }
        });
        this.mutationObserver.observe(this.root, { childList: true, subtree: true });
        if (this.canvasWrapper && this.canvasWrapper !== this.root) {
            this.mutationObserver.observe(this.canvasWrapper, { childList: true });
        }
        if (this.panelContainer) {
            this.mutationObserver.observe(this.panelContainer, { childList: true, subtree: true });
        }
    }

    setupResizeObserver() {
        if (this.resizeObserver || !this.canvasWrapper || typeof ResizeObserver === 'undefined') return;
        this.resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 50 && height > 50 && this.hasRenderedData && this.container && !this.container.classList.contains('hidden')) {
                    this.scheduleResize();
                }
            }
        });
        this.resizeObserver.observe(this.canvasWrapper);
    }

    scheduleResize() {
        if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
        this.resizeTimeout = setTimeout(() => {
            this.resize();
        }, 80);
    }

    resize() {
        if (!this.viewer || !this.hasRenderedData || !this.container || this.container.classList.contains('hidden')) {
            return;
        }
        this.render();
    }

    initViewer() {
        if (!this.viewer && window.SandDance && window.vega && this.root) {
            try {
                SandDance.use(vega);
                if (SandDance.VegaMorphCharts && SandDance.VegaMorphCharts.Presenter) {
                    const proto = SandDance.VegaMorphCharts.Presenter.prototype;
                    if (!proto._origGetElement) {
                        proto._origGetElement = proto.getElement;
                        proto.getElement = function (type) {
                            let el = this._origGetElement(type);
                            if (!el && typeof document !== 'undefined') {
                                const typeName = typeof type === 'number'
                                    ? (SandDance.VegaMorphCharts.PresenterElement[type] || '')
                                    : (typeof type === 'string' ? type : '');
                                const prefix = (this.style && this.style.cssPrefix) || 'sanddance-';
                                if (typeName) {
                                    el = document.querySelector(`.${prefix}${typeName}`) ||
                                         document.querySelector(`[class*="${typeName}"]`);
                                }
                                if (!el && (type === 2 || type === 'panel')) {
                                    el = document.querySelector('.sanddance-panel') ||
                                         document.getElementById('sanddance-panel-container');
                                }
                            }
                            return el;
                        };
                    }
                }
                this.viewer = new SandDance.Viewer(this.root, {
                    onError: (errs) => {
                        console.error("SandDance Viewer internal errors:", Array.isArray(errs) ? errs.join("; ") : errs);
                    },
                    tooltipOptions: {
                        create: (props) => {
                            if (!this.tooltipsEnabled) {
                                return { destroy: () => { } };
                            }
                            return this.createTooltip(props);
                        }
                    }
                });
                this.relocatePanel();
            } catch (err) {
                console.error("SandDance initialization error:", err);
            }
        }
        return this.viewer;
    }

    createTooltip(props) {
        if (!props) return { destroy: () => { } };
        const data = props.dataItem || props.datum;
        if (!data || typeof data !== 'object') return { destroy: () => { } };

        if (this.activeTooltipEl && this.activeTooltipEl.parentElement) {
            this.activeTooltipEl.parentElement.removeChild(this.activeTooltipEl);
            this.activeTooltipEl = null;
        }

        const entries = Object.entries(data).filter(([key]) => {
            const lk = key.toLowerCase();
            return !key.startsWith('__') && !key.startsWith('GL_') && lk !== 'id' && !lk.includes('sanddance');
        });

        if (entries.length === 0) return { destroy: () => { } };

        const tooltipEl = document.createElement('div');
        tooltipEl.className = 'sanddance-custom-tooltip';

        const escapeHtml = (str) => {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        };

        let html = '<div class="sanddance-tooltip-header"><i class="fa-solid fa-circle-info" style="font-size: 0.7rem;"></i><span>Data Point</span></div><div class="sanddance-tooltip-grid">';
        for (const [key, val] of entries) {
            let displayVal = '-';
            if (val !== null && val !== undefined && val !== '') {
                if (typeof val === 'number') {
                    displayVal = Number.isInteger(val) ? val.toLocaleString() : val.toLocaleString(undefined, { maximumFractionDigits: 3 });
                } else {
                    displayVal = String(val);
                }
            }
            html += `<span class="sanddance-tooltip-key">${escapeHtml(key)}:</span><span class="sanddance-tooltip-val">${escapeHtml(displayVal)}</span>`;
        }
        html += '</div>';
        tooltipEl.innerHTML = html;

        document.body.appendChild(tooltipEl);
        this.activeTooltipEl = tooltipEl;

        const e = props.event;
        const src = (e && e.srcEvent) || e || {};
        const clientX = src.clientX ?? (e && e.x) ?? (e && e.center && e.center.x) ?? 0;
        const clientY = src.clientY ?? (e && e.y) ?? (e && e.center && e.center.y) ?? 0;
        const offset = 14;
        const rect = tooltipEl.getBoundingClientRect();
        let left = clientX + offset;
        let top = clientY + offset;

        if (left + rect.width > window.innerWidth - 12) {
            left = Math.max(10, clientX - rect.width - offset);
        }
        if (top + rect.height > window.innerHeight - 12) {
            top = Math.max(10, clientY - rect.height - offset);
        }

        tooltipEl.style.left = `${left}px`;
        tooltipEl.style.top = `${top}px`;

        return {
            destroy: () => {
                if (tooltipEl && tooltipEl.parentElement) {
                    tooltipEl.parentElement.removeChild(tooltipEl);
                }
                if (this.activeTooltipEl === tooltipEl) {
                    this.activeTooltipEl = null;
                }
            }
        };
    }

    reset() {
        if (this.activeTooltipEl && this.activeTooltipEl.parentElement) {
            this.activeTooltipEl.parentElement.removeChild(this.activeTooltipEl);
            this.activeTooltipEl = null;
        }
        if (this.viewer && this.hasRenderedData) {
            try {
                if (typeof this.viewer.reset === 'function') {
                    const p = this.viewer.reset();
                    if (p && typeof p.catch === 'function') {
                        p.catch(() => { });
                    }
                }
            } catch (e) { }
        }
        this.hasRenderedData = false;
        if (this.chartSelect) this.chartSelect.value = 'density';
        if (this.totalStyleSelect) this.totalStyleSelect.value = '';
        [this.xSelect, this.ySelect, this.colorSelect, this.sortSelect, this.facetSelect, this.disaggregateCol].forEach(el => {
            if (el) {
                el.value = '';
                el.innerHTML = '';
            }
        });
        if (this.disaggregateCheck) this.disaggregateCheck.checked = false;
        if (this.disaggregateContainer) this.disaggregateContainer.classList.add('hidden');
        if (this.disaggregateInfo) this.disaggregateInfo.textContent = 'Unrolls rows by numerical count';
        if (this.panelGroup) this.panelGroup.classList.add('hidden');
        this.updateLabelsForChartType();
        this.updateTotalStyleVisibility();
    }

    updateLabelsForChartType() {
        const chartType = (this.chartSelect && this.chartSelect.value) || 'density';
        if (!this.xLabel || !this.yLabel) return;

        if (chartType === 'treemap') {
            this.xLabel.textContent = 'Group By (Category)';
            this.yLabel.textContent = 'Size By (Measure)';
            if (this.chartHint) {
                this.chartHint.style.display = 'block';
                this.chartHint.textContent = 'Treemap tiles are grouped by Category and sized by Measure.';
            }
        } else if (chartType === 'strips') {
            this.xLabel.textContent = 'X Axis (Unused for Strips)';
            this.yLabel.textContent = 'Size By (Measure)';
            if (this.chartHint) {
                this.chartHint.style.display = 'block';
                this.chartHint.textContent = 'Strips packs units into a continuous ribbon. Use Color By or Facet By for grouping.';
            }
        } else if (chartType === 'grid') {
            this.xLabel.textContent = 'X Axis (Unused for Grid)';
            this.yLabel.textContent = 'Y Axis (Unused for Grid)';
            if (this.chartHint) {
                this.chartHint.style.display = 'block';
                this.chartHint.textContent = 'Grid organizes all units into a regular matrix. Use Color By or Sort By.';
            }
        } else if (chartType === 'barchart' || chartType === 'barchartV') {
            this.xLabel.textContent = 'Category (X Axis)';
            this.yLabel.textContent = 'Measure / Height (Y Axis)';
            if (this.chartHint) this.chartHint.style.display = 'none';
        } else if (chartType === 'barchartH') {
            this.xLabel.textContent = 'Measure / Length (X Axis)';
            this.yLabel.textContent = 'Category (Y Axis)';
            if (this.chartHint) this.chartHint.style.display = 'none';
        } else {
            this.xLabel.textContent = 'X Axis';
            this.yLabel.textContent = 'Y Axis';
            if (this.chartHint) this.chartHint.style.display = 'none';
        }
    }

    ensureValidColumnsForChartType() {
        const currentData = this.getData();
        if (!currentData || currentData.length === 0) return;
        const chartType = (this.chartSelect && this.chartSelect.value) || 'density';
        const totalStyle = (this.totalStyleSelect && this.totalStyleSelect.value) || '';

        const isColNumeric = (colName) => {
            if (!colName) return false;
            for (let r = 0; r < Math.min(currentData.length, 30); r++) {
                const v = currentData[r][colName];
                if (v !== null && v !== undefined && v !== '') {
                    return detectType(v) === 'Number';
                }
            }
            return false;
        };

        const cols = Object.keys(currentData[0]);
        const numericCols = cols.filter(c => isColNumeric(c));
        const categoricalCols = cols.filter(c => !isColNumeric(c));

        if (chartType === 'treemap') {
            // Ensure Group By is preferably categorical and Size By is numeric
            if (this.xSelect && !this.xSelect.value && categoricalCols.length > 0) {
                this.xSelect.value = categoricalCols[0];
            }
            if (this.ySelect && (!this.ySelect.value || !isColNumeric(this.ySelect.value)) && numericCols.length > 0) {
                this.ySelect.value = numericCols[0];
            }
        } else if (chartType === 'strips') {
            if (this.ySelect && (!this.ySelect.value || !isColNumeric(this.ySelect.value)) && numericCols.length > 0) {
                this.ySelect.value = numericCols[0];
            }
            // If color is not set, set default color to first categorical column for rich visual distinction
            if (this.colorSelect && !this.colorSelect.value && categoricalCols.length > 0) {
                this.colorSelect.value = categoricalCols[0];
            }
        } else if (chartType.startsWith('bar') && totalStyle.startsWith('sum')) {
            const targetSelect = chartType === 'barchartH' ? this.xSelect : this.ySelect;
            if (targetSelect && (!targetSelect.value || !isColNumeric(targetSelect.value)) && numericCols.length > 0) {
                targetSelect.value = numericCols[0];
            }
        }
    }

    updateTotalStyleVisibility() {
        if (!this.totalStyleGroup) return;
        const chartType = (this.chartSelect && this.chartSelect.value) || '';
        if (chartType.startsWith('bar')) {
            this.totalStyleGroup.classList.remove('hidden');
        } else {
            this.totalStyleGroup.classList.add('hidden');
        }
    }

    getDisaggregatedData() {
        const currentData = this.getData();
        if (!currentData || currentData.length === 0) return [];
        if (!this.disaggregateCheck || !this.disaggregateCheck.checked) {
            return currentData.map(r => ({ ...r }));
        }

        const disaggCol = this.disaggregateCol ? this.disaggregateCol.value : '';
        if (!disaggCol) return currentData.map(r => ({ ...r }));

        const maxTotalPoints = 60000;
        let totalCount = 0;
        let isCapped = false;
        const unrolled = [];

        for (let i = 0; i < currentData.length; i++) {
            const row = currentData[i];
            let rawVal = row[disaggCol];
            let count = 1;
            if (rawVal !== undefined && rawVal !== null) {
                const parsed = parseInt(rawVal, 10);
                if (!isNaN(parsed) && parsed > 0) {
                    count = parsed;
                }
            }

            if (totalCount + count > maxTotalPoints) {
                count = Math.max(0, maxTotalPoints - totalCount);
                isCapped = true;
            }

            for (let c = 0; c < count; c++) {
                const item = { ...row, _unit_id: totalCount + c + 1 };
                unrolled.push(item);
            }
            totalCount += count;
            if (isCapped) break;
        }

        if (this.disaggregateInfo) {
            if (isCapped) {
                this.disaggregateInfo.textContent = `Expanded to ${unrolled.length.toLocaleString()} points (capped at ${maxTotalPoints.toLocaleString()})`;
            } else {
                this.disaggregateInfo.textContent = `Expanded to ${unrolled.length.toLocaleString()} individual points`;
            }
        }

        return unrolled;
    }

    updateOptions() {
        const currentData = this.getData();
        if (!currentData || currentData.length === 0) return;
        const columns = Object.keys(currentData[0]);
        const selects = [this.xSelect, this.ySelect, this.colorSelect, this.sortSelect, this.facetSelect];

        selects.forEach((sel, index) => {
            if (!sel) return;
            const currentVal = sel.value;
            sel.innerHTML = '';
            if (index >= 2) {
                const noneOpt = document.createElement('option');
                noneOpt.value = "";
                noneOpt.textContent = "None";
                sel.appendChild(noneOpt);
            }

            columns.forEach(col => {
                const opt = document.createElement('option');
                opt.value = col;
                opt.textContent = col;
                sel.appendChild(opt);
            });
            if (currentVal && columns.includes(currentVal)) sel.value = currentVal;
            else if (index === 0 && columns.length > 0) sel.value = columns[0];
            else if (index === 1 && columns.length > 1) sel.value = columns[1];
            else sel.value = "";
        });

        if (this.disaggregateCol) {
            const currentDisagg = this.disaggregateCol.value;
            this.disaggregateCol.innerHTML = '';

            const numericCols = columns.filter(col => {
                for (let r = 0; r < Math.min(currentData.length, 50); r++) {
                    const v = currentData[r][col];
                    if (v !== null && v !== undefined && v !== '') {
                        return detectType(v) === 'Number';
                    }
                }
                return false;
            });

            const colsToUse = numericCols.length > 0 ? numericCols : columns;
            colsToUse.forEach(col => {
                const opt = document.createElement('option');
                opt.value = col;
                opt.textContent = col;
                this.disaggregateCol.appendChild(opt);
            });

            if (currentDisagg && colsToUse.includes(currentDisagg)) {
                this.disaggregateCol.value = currentDisagg;
            } else if (colsToUse.length > 0) {
                const matchName = colsToUse.find(c => /qty|quantity|count|amount|total|volume/i.test(c));
                this.disaggregateCol.value = matchName || colsToUse[0];
            }
        }
    }

    render() {
        const currentData = this.getData();
        if (!currentData || currentData.length === 0) return;

        const viewer = this.initViewer();
        if (!viewer) {
            console.warn("SandDance viewer could not be initialized");
            return;
        }

        const renderData = this.getDisaggregatedData();
        if (!renderData || renderData.length === 0) return;

        const colorColumn = this.colorSelect ? this.colorSelect.value : '';
        let scheme = undefined;
        if (colorColumn && renderData[0] && renderData[0][colorColumn] !== undefined) {
            const val = renderData[0][colorColumn];
            const type = detectType(val);
            scheme = (type === 'Number' || type === 'Date' || type === 'DateTime') ? 'viridis' : 'category10';
        }

        // Determine available render dimensions based on actual canvas wrapper viewport
        const wrapper = this.canvasWrapper || document.getElementById('sanddance-canvas-wrapper');
        const wrapperRect = wrapper ? wrapper.getBoundingClientRect() : { width: 0, height: 0 };
        const containerRect = this.container ? this.container.getBoundingClientRect() : { width: 0, height: 0 };

        const isCollapsed = this.toolbar && this.toolbar.classList.contains('collapsed');
        const toolbarWidth = isCollapsed ? 0 : 270;

        const availWidth = Math.floor(
            (wrapper && wrapper.clientWidth > 0 ? wrapper.clientWidth : 0) ||
            wrapperRect.width ||
            (containerRect.width > toolbarWidth ? containerRect.width - toolbarWidth : 0) ||
            (window.innerWidth > toolbarWidth + 60 ? window.innerWidth - toolbarWidth - 60 : 600)
        );

        const availHeight = Math.floor(
            (wrapper && wrapper.clientHeight > 0 ? wrapper.clientHeight : 0) ||
            wrapperRect.height ||
            (containerRect.height > 100 ? containerRect.height - 100 : 0) ||
            Math.max(window.innerHeight - 210, 400)
        );

        const width = Math.max(availWidth, 300);
        const height = Math.max(availHeight, 300);

        const chartType = (this.chartSelect && this.chartSelect.value) || 'density';
        const xVal = (this.xSelect && this.xSelect.value) || undefined;
        const yVal = (this.ySelect && this.ySelect.value) || undefined;
        const totalStyle = (this.totalStyleSelect && this.totalStyleSelect.value) || undefined;

        const isColNumeric = (colName) => {
            if (!colName || !renderData || renderData.length === 0) return false;
            for (let r = 0; r < Math.min(renderData.length, 50); r++) {
                const v = renderData[r][colName];
                if (v !== null && v !== undefined && v !== '') {
                    return detectType(v) === 'Number';
                }
            }
            return false;
        };

        const numericCols = Object.keys(renderData[0] || {}).filter(c => isColNumeric(c));
        const categoricalCols = Object.keys(renderData[0] || {}).filter(c => !isColNumeric(c));

        let sizeCol = undefined;
        let groupCol = undefined;

        if (chartType === 'treemap') {
            groupCol = xVal || categoricalCols[0] || undefined;
            sizeCol = isColNumeric(yVal) ? yVal : (numericCols[0] || undefined);
        } else if (chartType === 'strips') {
            sizeCol = isColNumeric(yVal) ? yVal : (numericCols[0] || undefined);
        } else if (chartType === 'barchart' || chartType === 'barchartV') {
            if (totalStyle && totalStyle.startsWith('sum')) {
                sizeCol = isColNumeric(yVal) ? yVal : (numericCols[0] || undefined);
            }
        } else if (chartType === 'barchartH') {
            if (totalStyle && totalStyle.startsWith('sum')) {
                sizeCol = isColNumeric(xVal) ? xVal : (numericCols[0] || undefined);
            }
        }

        const insight = {
            chart: chartType,
            columns: {
                x: xVal,
                y: yVal,
                group: groupCol,
                size: sizeCol,
                color: colorColumn || undefined,
                sort: (this.sortSelect && this.sortSelect.value) || undefined,
                facet: (this.facetSelect && this.facetSelect.value) || undefined,
            },
            scheme: scheme,
            size: {
                height: height,
                width: width,
            }
        };

        if (chartType.startsWith('bar') && totalStyle) {
            insight.totalStyle = totalStyle;
        }

        try {
            const p = viewer.render({ insight }, renderData);
            if (p && typeof p.then === 'function') {
                p.then(() => {
                    this.hasRenderedData = true;
                    this.relocatePanel();
                }).catch(renderErr => {
                    console.warn("SandDance render notice:", renderErr);
                });
            } else {
                this.hasRenderedData = true;
                this.relocatePanel();
            }
        } catch (renderErr) {
            console.error("SandDance render error:", renderErr);
        }
    }

    bindEvents() {
        [this.chartSelect, this.totalStyleSelect, this.xSelect, this.ySelect, this.colorSelect, this.sortSelect, this.facetSelect].forEach(el => {
            if (el) {
                el.addEventListener('change', () => {
                    if (el === this.chartSelect) {
                        this.updateLabelsForChartType();
                        this.updateTotalStyleVisibility();
                        this.ensureValidColumnsForChartType();
                    } else if (el === this.totalStyleSelect) {
                        this.ensureValidColumnsForChartType();
                    }
                    if (this.container && !this.container.classList.contains('hidden')) {
                        this.render();
                    }
                });
            }
        });

        if (this.disaggregateCheck) {
            this.disaggregateCheck.addEventListener('change', () => {
                if (this.disaggregateContainer) {
                    if (this.disaggregateCheck.checked) {
                        this.disaggregateContainer.classList.remove('hidden');
                    } else {
                        this.disaggregateContainer.classList.add('hidden');
                    }
                }
                if (this.container && !this.container.classList.contains('hidden')) {
                    this.render();
                }
            });
        }

        if (this.disaggregateCol) {
            this.disaggregateCol.addEventListener('change', () => {
                if (this.disaggregateCheck && this.disaggregateCheck.checked && this.container && !this.container.classList.contains('hidden')) {
                    this.render();
                }
            });
        }

        if (this.tooltipCheck) {
            this.tooltipCheck.addEventListener('change', () => {
                this.tooltipsEnabled = !!this.tooltipCheck.checked;
            });
        }

        if (this.collapseBtn) {
            this.collapseBtn.addEventListener('click', () => this.setToolbarCollapsed(true));
        }
        if (this.expandBtn) {
            this.expandBtn.addEventListener('click', () => this.setToolbarCollapsed(false));
        }

        if (this.exportBtn) {
            this.exportBtn.addEventListener('click', () => {
                const canvas = this.root?.querySelector('canvas');
                if (canvas) {
                    const link = document.createElement('a');
                    link.download = 'sanddance-export.png';
                    link.href = canvas.toDataURL('image/png');
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                } else {
                    alert('No chart to export.');
                }
            });
        }
    }

    exportState() {
        return {
            chart: (this.chartSelect && this.chartSelect.value) || 'density',
            x: (this.xSelect && this.xSelect.value) || '',
            y: (this.ySelect && this.ySelect.value) || '',
            color: (this.colorSelect && this.colorSelect.value) || '',
            sort: (this.sortSelect && this.sortSelect.value) || '',
            facet: (this.facetSelect && this.facetSelect.value) || '',
            totalStyle: (this.totalStyleSelect && this.totalStyleSelect.value) || '',
            disaggregate: !!(this.disaggregateCheck && this.disaggregateCheck.checked),
            disaggregateCol: (this.disaggregateCol && this.disaggregateCol.value) || '',
            tooltips: this.tooltipsEnabled
        };
    }

    importState(state) {
        if (!state) return;
        this.updateOptions();
        if (state.chart && this.chartSelect) this.chartSelect.value = state.chart;
        if (state.x && this.xSelect) this.xSelect.value = state.x;
        if (state.y && this.ySelect) this.ySelect.value = state.y;
        if (state.color !== undefined && this.colorSelect) this.colorSelect.value = state.color;
        if (state.sort !== undefined && this.sortSelect) this.sortSelect.value = state.sort;
        if (state.facet !== undefined && this.facetSelect) this.facetSelect.value = state.facet;
        if (state.totalStyle !== undefined && this.totalStyleSelect) this.totalStyleSelect.value = state.totalStyle;
        if (this.disaggregateCheck) {
            this.disaggregateCheck.checked = !!state.disaggregate;
            if (this.disaggregateContainer) {
                this.disaggregateContainer.classList.toggle('hidden', !state.disaggregate);
            }
        }
        if (state.disaggregateCol && this.disaggregateCol) {
            this.disaggregateCol.value = state.disaggregateCol;
        }
        if (state.tooltips !== undefined && this.tooltipCheck) {
            this.tooltipsEnabled = !!state.tooltips;
            this.tooltipCheck.checked = !!state.tooltips;
        }
        this.updateLabelsForChartType();
        this.updateTotalStyleVisibility();
        this.render();
    }
}
