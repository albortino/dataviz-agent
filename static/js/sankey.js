/**
 * Sankey Manager Module
 * Handles SankeyMatic DSL parsing, tabular CSV-to-flow transformation,
 * D3 interactive graph layout, node dragging, dynamic colors, annotations, and exports.
 */

import { aggregateValues, detectType } from './data-transform.js';

export const PALETTES = {
    category10: d3.schemeCategory10,
    tableau10: d3.schemeTableau10,
    set2: d3.schemeSet2,
    dark2: d3.schemeDark2,
    warm: ['#f97316', '#ef4444', '#eab308', '#f43f5e', '#d97706', '#fb923c'],
    cool: ['#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#14b8a6', '#06b6d4']
};

export class SankeyManager {
    constructor(options = {}) {
        this.getData = options.getData || (() => []);
        this.customNodeColors = {};
        this.annotations = [];
        this.selectedNode = null;
        this.graphData = { nodes: [], links: [] };

        // DOM Elements
        this.sidebar = document.getElementById('sankey-sidebar');
        this.collapseBtn = document.getElementById('sankey-collapse-btn');
        this.expandBtn = document.getElementById('sankey-expand-btn');
        this.textEditor = document.getElementById('sankey-text-editor');
        this.sourceCol = document.getElementById('sankey-source-col');
        this.targetCol = document.getElementById('sankey-target-col');
        this.valCol = document.getElementById('sankey-value-col');
        this.aggFunc = document.getElementById('sankey-agg-func');
        this.disambiguateNodes = document.getElementById('sankey-disambiguate-nodes');
        this.palette = document.getElementById('sankey-palette');
        this.nodeAlign = document.getElementById('sankey-node-align');
        this.selectedColor = document.getElementById('sankey-selected-color');
        this.selectedNodeName = document.getElementById('sankey-selected-node-name');
        this.autoFitCheckbox = document.getElementById('sankey-autofit');
        this.customWidthInput = document.getElementById('sankey-custom-width');
        this.customHeightInput = document.getElementById('sankey-custom-height');
        this.addTextBtn = document.getElementById('sankey-add-text-btn');
        this.exportPngBtn = document.getElementById('sankey-export-png-btn');
        this.exportSvgBtn = document.getElementById('sankey-export-svg-btn');
        this.controlsSidebar = document.getElementById('sankey-controls-sidebar');
        this.controlsCollapseBtn = document.getElementById('sankey-controls-collapse-btn');
        this.controlsExpandBtn = document.getElementById('sankey-controls-expand-btn');
        this.svg = d3.select('#sankey-svg');
        this.resizeTimeout = null;
    }

    init() {
        this.initCollapseState();
        this.bindEvents();
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
        setTimeout(() => this.renderChart(), 230);
    }

    reset() {
        this.customNodeColors = {};
        this.annotations = [];
        this.selectedNode = null;
        if (this.selectedNodeName) this.selectedNodeName.textContent = '(Select node)';
        if (this.textEditor) this.textEditor.value = '';
        if (this.sourceCol) this.sourceCol.value = '';
        if (this.targetCol) this.targetCol.value = '';
        if (this.valCol) this.valCol.value = '';
    }

    setSidebarCollapsed(collapsed) {
        if (!this.sidebar) return;
        this.sidebar.classList.toggle('collapsed', collapsed);
        if (this.expandBtn) {
            this.expandBtn.classList.toggle('hidden', !collapsed);
        }
        setTimeout(() => this.renderChart(), 230);
    }

    parseSankeyMaticText(text) {
        const lines = text.split('\n');
        const flowRegex = /^\s*(.+?)\s*\[\s*([\d\.,]+)\s*\]\s*(.+?)(?:\s*(#[0-9a-fA-F]{3,6}))?\s*$/;
        const nodeColorRegex = /^\s*:(.+?)\s+(#[0-9a-fA-F]{3,6})\s*$/;

        const nodesMap = new Map();
        const links = [];
        const colors = { ...this.customNodeColors };

        lines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('//')) return;

            const nodeColorMatch = trimmed.match(nodeColorRegex);
            if (nodeColorMatch) {
                const nodeName = nodeColorMatch[1].trim();
                const colorVal = nodeColorMatch[2].trim();
                colors[nodeName] = colorVal;
                return;
            }

            const match = trimmed.match(flowRegex);
            if (match) {
                const source = match[1].trim();
                let valStr = match[2].trim().replace(/,/g, '');
                const value = parseFloat(valStr) || 1;
                const target = match[3].trim();
                const linkColor = match[4] ? match[4].trim() : null;

                if (!nodesMap.has(source)) nodesMap.set(source, { name: source, id: source });
                if (!nodesMap.has(target)) nodesMap.set(target, { name: target, id: target });

                links.push({
                    source,
                    target,
                    value,
                    color: linkColor
                });
            }
        });

        return {
            nodes: Array.from(nodesMap.values()),
            links,
            colors
        };
    }

    generateFromCSV() {
        const currentData = this.getData();
        if (!currentData || currentData.length === 0) return '';
        const srcCol = this.sourceCol?.value;
        const tgtCol = this.targetCol?.value;
        const valCol = this.valCol?.value;
        const aggFunc = this.aggFunc ? this.aggFunc.value : 'sum';
        const disambiguate = this.disambiguateNodes ? this.disambiguateNodes.checked : true;

        if (!srcCol || !tgtCol || srcCol === tgtCol) {
            return `// SankeyMatic Flow Example\nRevenue [120] Operating Expenses\nRevenue [80] Profit\nOperating Expenses [50] Salaries\nOperating Expenses [40] Marketing\nOperating Expenses [30] R&D\nProfit [20] Taxes\nProfit [60] Net Income\n:Revenue #2563eb\n:Profit #16a34a`;
        }

        const srcValues = new Set();
        const tgtValues = new Set();
        currentData.forEach(row => {
            const s = String(row[srcCol] || '').trim();
            const t = String(row[tgtCol] || '').trim();
            if (s) srcValues.add(s);
            if (t) tgtValues.add(t);
        });

        const hasOverlap = Array.from(srcValues).some(v => tgtValues.has(v));
        const shouldDisambiguate = disambiguate && hasOverlap;

        const flowAgg = {};
        currentData.forEach(row => {
            let s = String(row[srcCol] || '').trim();
            let t = String(row[tgtCol] || '').trim();
            if (!s || !t) return;

            if (shouldDisambiguate) {
                s = `${s} (${srcCol})`;
                t = `${t} (${tgtCol})`;
            }

            const key = `${s}___${t}`;
            let val = 1;
            if (valCol && row[valCol] !== undefined && row[valCol] !== null) {
                const parsed = parseFloat(row[valCol]);
                val = isNaN(parsed) ? 1 : Math.max(0, parsed);
            }
            if (!flowAgg[key]) flowAgg[key] = [];
            flowAgg[key].push(val);
        });

        let text = `// Generated from ${srcCol} -> ${tgtCol} (${aggFunc.toUpperCase()} ${valCol || 'rows'})\n`;
        Object.entries(flowAgg).forEach(([key, vals]) => {
            const [s, t] = key.split('___');
            let computedVal;
            if (aggFunc === 'none') {
                computedVal = vals.length > 0 ? vals[0] : 1;
            } else {
                computedVal = aggregateValues(vals, aggFunc);
            }
            if (computedVal > 0) {
                text += `${s} [${Math.round(computedVal * 100) / 100}] ${t}\n`;
            }
        });

        return text;
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
                countOpt.value = "";
                countOpt.textContent = "Row Count (1 per row)";
                sel.appendChild(countOpt);
            }
            columns.forEach(col => {
                const opt = document.createElement('option');
                opt.value = col;
                opt.textContent = col;
                sel.appendChild(opt);
            });

            if (currentVal && columns.includes(currentVal)) {
                sel.value = currentVal;
            } else if (idx === 0 && columns.length > 0) {
                sel.value = columns[0];
            } else if (idx === 1 && columns.length > 1) {
                sel.value = columns[1];
            } else if (idx === 2) {
                const numCol = columns.find(c => detectType(currentData[0][c]) === 'Number');
                sel.value = numCol || "";
            }
        });
    }

    renderChart() {
        if (!window.d3 || !d3.sankey) return;

        let text = this.textEditor ? this.textEditor.value.trim() : '';
        if (!text) {
            text = this.generateFromCSV();
            if (this.textEditor) this.textEditor.value = text;
        }

        const parsed = this.parseSankeyMaticText(text);
        if (!parsed.nodes.length || !parsed.links.length) {
            this.svg.selectAll('*').remove();
            this.svg.append('text')
                .attr('x', '50%')
                .attr('y', '50%')
                .attr('text-anchor', 'middle')
                .attr('fill', '#94a3b8')
                .text('No valid Sankey flow. Upload CSV or enter "Source [Value] Target" syntax in editor.');
            return;
        }

        let width = Math.max(this.canvasWrapper ? this.canvasWrapper.clientWidth : 600, 600);
        let height = Math.min(Math.max(this.canvasWrapper ? this.canvasWrapper.clientHeight : 450, 450), 700);

        const isAutoFit = this.autoFitCheckbox ? this.autoFitCheckbox.checked : false;
        if (!isAutoFit) {
            const customW = parseInt(this.customWidthInput?.value, 10);
            const customH = parseInt(this.customHeightInput?.value, 10);
            if (customW && customW >= 100) width = customW;
            if (customH && customH >= 100) height = customH;
        } else {
            if (this.customWidthInput && (!this.customWidthInput.value || document.activeElement !== this.customWidthInput)) {
                this.customWidthInput.value = Math.round(width);
            }
            if (this.customHeightInput && (!this.customHeightInput.value || document.activeElement !== this.customHeightInput)) {
                this.customHeightInput.value = Math.round(height);
            }
        }

        const margin = { top: 25, right: 120, bottom: 25, left: 120 };

        this.svg.selectAll('*').remove();
        this.svg.attr('viewBox', `0 0 ${width} ${height}`);
        this.svg.attr('width', isAutoFit ? '100%' : width);
        this.svg.attr('height', isAutoFit ? '100%' : height);
        this.svg.style('width', isAutoFit ? '100%' : `${width}px`);
        this.svg.style('height', isAutoFit ? '100%' : `${height}px`);
        this.svg.style('max-width', isAutoFit ? '100%' : 'none');
        this.svg.style('max-height', isAutoFit ? '100%' : 'none');

        const alignMap = {
            justify: d3.sankeyJustify,
            left: d3.sankeyLeft,
            right: d3.sankeyRight,
            center: d3.sankeyCenter
        };
        const alignFunc = alignMap[this.nodeAlign?.value] || d3.sankeyJustify;

        const nodesData = parsed.nodes.map(d => ({ ...d }));
        const linksData = parsed.links.map(d => ({ ...d }));

        const sankeyGen = d3.sankey()
            .nodeId(d => d.name)
            .nodeAlign(alignFunc)
            .nodeWidth(20)
            .nodePadding(18)
            .extent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]]);

        let graph;
        try {
            graph = sankeyGen({
                nodes: nodesData,
                links: linksData
            });
        } catch (err) {
            console.warn("Sankey layout error:", err);
            this.svg.append('text')
                .attr('x', '50%')
                .attr('y', '50%')
                .attr('text-anchor', 'middle')
                .attr('fill', '#ef4444')
                .text('Layout Error: Sankey diagram cannot contain circular loops.');
            return;
        }

        this.graphData = graph;

        const paletteName = this.palette?.value || 'category10';
        const colorScheme = PALETTES[paletteName] || d3.schemeCategory10;
        const colorScale = d3.scaleOrdinal(colorScheme);

        const getNodeColor = (d) => {
            if (parsed.colors[d.name]) return parsed.colors[d.name];
            if (this.customNodeColors[d.name]) return this.customNodeColors[d.name];
            return colorScale(d.name);
        };

        const g = this.svg.append('g');

        // Draw Links
        const link = g.append('g')
            .attr('class', 'links')
            .selectAll('.sankey-link')
            .data(graph.links)
            .enter().append('path')
            .attr('class', 'sankey-link')
            .attr('d', d3.sankeyLinkHorizontal())
            .attr('stroke', d => d.color || getNodeColor(d.source))
            .attr('stroke-width', d => Math.max(1, d.width))
            .style('stroke-opacity', 0.45);

        link.append('title')
            .text(d => `${d.source.name} → ${d.target.name}\nAmount: ${d.value.toLocaleString()}`);

        // Draw Nodes
        const self = this;
        const node = g.append('g')
            .attr('class', 'nodes')
            .selectAll('.sankey-node')
            .data(graph.nodes)
            .enter().append('g')
            .attr('class', d => `sankey-node${self.selectedNode && self.selectedNode.name === d.name ? ' selected' : ''}`)
            .attr('transform', d => `translate(${d.x0},${d.y0})`);

        const rect = node.append('rect')
            .attr('height', d => Math.max(1, d.y1 - d.y0))
            .attr('width', d => d.x1 - d.x0)
            .attr('fill', d => getNodeColor(d))
            .attr('rx', 3)
            .attr('ry', 3)
            .call(d3.drag()
                .subject(d => d)
                .on('start', function () {
                    this.parentNode.parentNode.appendChild(this.parentNode);
                })
                .on('drag', function (event, d) {
                    const nodeH = d.y1 - d.y0;
                    const nodeW = d.x1 - d.x0;
                    d.x0 = Math.max(margin.left, Math.min(width - margin.right - nodeW, event.x));
                    d.x1 = d.x0 + nodeW;
                    d.y0 = Math.max(margin.top, Math.min(height - margin.bottom - nodeH, event.y));
                    d.y1 = d.y0 + nodeH;

                    d3.select(this.parentNode).attr('transform', `translate(${d.x0},${d.y0})`);
                    sankeyGen.update(graph);
                    link.attr('d', d3.sankeyLinkHorizontal());
                })
            )
            .on('click', (event, d) => {
                event.stopPropagation();
                self.selectedNode = d;
                if (self.selectedColor) self.selectedColor.value = getNodeColor(d);
                if (self.selectedNodeName) self.selectedNodeName.textContent = `(${d.name})`;
                node.classed('selected', false);
                d3.select(event.currentTarget.parentNode).classed('selected', true);
            });

        rect.append('title')
            .text(d => `${d.name}\nTotal: ${d.value.toLocaleString()}`);

        node.append('text')
            .attr('x', d => d.x0 < width / 2 ? (d.x1 - d.x0) + 6 : -6)
            .attr('y', d => (d.y1 - d.y0) / 2)
            .attr('dy', '0.35em')
            .attr('text-anchor', d => d.x0 < width / 2 ? 'start' : 'end')
            .text(d => `${d.name} (${Math.round(d.value * 100) / 100})`);

        // Annotations
        const annotationGroup = g.append('g').attr('class', 'annotations');
        this.renderAnnotations(annotationGroup);
    }

    renderAnnotations(group) {
        group.selectAll('.sankey-annotation').remove();
        const self = this;

        const annSel = group.selectAll('.sankey-annotation')
            .data(this.annotations)
            .enter().append('g')
            .attr('class', 'sankey-annotation')
            .attr('transform', d => `translate(${d.x},${d.y})`)
            .call(d3.drag()
                .on('drag', function (event, d) {
                    d.x = event.x;
                    d.y = event.y;
                    d3.select(this).attr('transform', `translate(${d.x},${d.y})`);
                })
            );

        annSel.each(function (d) {
            const gEl = d3.select(this);
            const boxWidth = Math.max(70, (d.text.length * 7.5) + 36);
            const boxHeight = 26;

            gEl.append('rect')
                .attr('class', 'sankey-annotation-box')
                .attr('x', -10)
                .attr('y', -15)
                .attr('width', boxWidth)
                .attr('height', boxHeight);

            gEl.append('text')
                .attr('class', 'annotation-text')
                .attr('x', 0)
                .attr('y', 2)
                .text(d.text)
                .attr('title', 'Double-click to edit text')
                .on('dblclick', function (event) {
                    event.stopPropagation();
                    const newText = prompt('Edit annotation text (or leave blank to delete):', d.text);
                    if (newText !== null) {
                        if (newText.trim() === '') {
                            self.annotations = self.annotations.filter(a => a.id !== d.id);
                        } else {
                            d.text = newText.trim();
                        }
                        self.renderChart();
                    }
                });

            const deleteBtn = gEl.append('g')
                .attr('class', 'delete-btn-group')
                .attr('transform', `translate(${boxWidth - 18}, -2)`)
                .attr('title', 'Delete text box')
                .on('click', function (event) {
                    event.stopPropagation();
                    self.annotations = self.annotations.filter(a => a.id !== d.id);
                    self.renderChart();
                });

            deleteBtn.append('circle')
                .attr('r', 7)
                .attr('fill', '#fee2e2')
                .attr('stroke', '#fca5a5')
                .attr('stroke-width', 0.8);

            deleteBtn.append('text')
                .attr('text-anchor', 'middle')
                .attr('dy', '0.35em')
                .attr('font-size', '9px')
                .attr('font-weight', 'bold')
                .attr('fill', '#ef4444')
                .text('×');
        });
    }

    bindEvents() {
        if (this.collapseBtn) this.collapseBtn.addEventListener('click', () => this.setSidebarCollapsed(true));
        if (this.expandBtn) this.expandBtn.addEventListener('click', () => this.setSidebarCollapsed(false));
        if (this.controlsCollapseBtn) this.controlsCollapseBtn.addEventListener('click', () => this.setControlsCollapsed(true));
        if (this.controlsExpandBtn) this.controlsExpandBtn.addEventListener('click', () => this.setControlsCollapsed(false));

        [this.sourceCol, this.targetCol, this.valCol, this.aggFunc, this.disambiguateNodes].forEach(el => {
            if (el) {
                el.addEventListener('change', () => {
                    if (this.textEditor) this.textEditor.value = this.generateFromCSV();
                    this.renderChart();
                });
            }
        });

        if (this.palette) this.palette.addEventListener('change', () => this.renderChart());
        if (this.nodeAlign) this.nodeAlign.addEventListener('change', () => this.renderChart());
        if (this.textEditor) this.textEditor.addEventListener('input', () => this.renderChart());

        if (this.autoFitCheckbox) {
            this.autoFitCheckbox.addEventListener('change', () => {
                this.renderChart();
            });
        }

        [this.customWidthInput, this.customHeightInput].forEach(el => {
            if (el) {
                el.addEventListener('focus', () => {
                    if (this.autoFitCheckbox && this.autoFitCheckbox.checked) {
                        this.autoFitCheckbox.checked = false;
                    }
                });
                el.addEventListener('input', () => {
                    if (this.autoFitCheckbox && this.autoFitCheckbox.checked) {
                        this.autoFitCheckbox.checked = false;
                    }
                    clearTimeout(this.resizeTimeout);
                    this.resizeTimeout = setTimeout(() => this.renderChart(), 150);
                });
                el.addEventListener('change', () => {
                    if (this.autoFitCheckbox && this.autoFitCheckbox.checked) {
                        this.autoFitCheckbox.checked = false;
                    }
                    this.renderChart();
                });
            }
        });

        if (this.selectedColor) {
            this.selectedColor.addEventListener('input', (e) => {
                if (this.selectedNode) {
                    const color = e.target.value;
                    this.customNodeColors[this.selectedNode.name] = color;

                    let text = this.textEditor.value;
                    const nodeLineRegex = new RegExp(`^\\s*:${this.selectedNode.name}\\s+.*$`, 'm');
                    if (nodeLineRegex.test(text)) {
                        text = text.replace(nodeLineRegex, `:${this.selectedNode.name} ${color}`);
                    } else {
                        text += `\n:${this.selectedNode.name} ${color}`;
                    }
                    this.textEditor.value = text;
                    this.renderChart();
                }
            });
        }

        if (this.addTextBtn) {
            this.addTextBtn.addEventListener('click', () => {
                const text = prompt('Enter annotation text to place on chart:');
                if (text) {
                    this.annotations.push({
                        id: Date.now(),
                        text,
                        x: 150 + Math.random() * 200,
                        y: 100 + Math.random() * 150
                    });
                    this.renderChart();
                }
            });
        }

        if (this.exportPngBtn) {
            this.exportPngBtn.addEventListener('click', () => {
                const svgEl = document.getElementById('sankey-svg');
                if (!svgEl) return;
                const serializer = new XMLSerializer();
                const svgString = serializer.serializeToString(svgEl);
                const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
                const URL = window.URL || window.webkitURL || window;
                const blobURL = URL.createObjectURL(svgBlob);

                const exportW = parseInt(svgEl.getAttribute('width'), 10) || svgEl.clientWidth || 1000;
                const exportH = parseInt(svgEl.getAttribute('height'), 10) || svgEl.clientHeight || 600;

                const image = new Image();
                image.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = exportW * 2;
                    canvas.height = exportH * 2;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

                    const pngLink = document.createElement('a');
                    pngLink.download = 'sankey-chart.png';
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
                const svgEl = document.getElementById('sankey-svg');
                if (!svgEl) return;
                const serializer = new XMLSerializer();
                const svgString = serializer.serializeToString(svgEl);
                const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
                const link = document.createElement('a');
                link.download = 'sankey-chart.svg';
                link.href = URL.createObjectURL(blob);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            });
        }
    }
}
