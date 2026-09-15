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
        this.hasRenderedData = false;
    }

    init() {
        this.initViewer();
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
    }

    initViewer() {
        if (!this.viewer && window.SandDance && window.vega && this.root) {
            try {
                SandDance.use(vega);
                this.viewer = new SandDance.Viewer(this.root);
            } catch (err) {
                console.error("SandDance initialization error:", err);
            }
        }
        return this.viewer;
    }

    reset() {
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
            return currentData;
        }

        const disaggCol = this.disaggregateCol ? this.disaggregateCol.value : '';
        if (!disaggCol) return currentData;

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

        const rootRect = this.root ? this.root.getBoundingClientRect() : { width: 0, height: 0 };
        const containerRect = this.container ? this.container.getBoundingClientRect() : { width: 0, height: 0 };
        const width = Math.max(Math.floor(rootRect.width || (containerRect.width ? containerRect.width - 270 : 0) || window.innerWidth - 334), 400);
        const height = Math.max(Math.floor(rootRect.height || containerRect.height || window.innerHeight - 200), 400);

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
                }).catch(renderErr => {
                    console.warn("SandDance render notice:", renderErr);
                });
            } else {
                this.hasRenderedData = true;
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
}
