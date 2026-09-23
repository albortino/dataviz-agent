/**
 * Main Application Orchestrator
 * Coordinates top-level navigation, data loading (CSV / demo data),
 * modal dialogs, and delegates visualization controls to modular sub-managers:
 *  - Data Transform & Analysis: ./js/data-transform.js
 *  - Mermaid Diagrams: ./js/mermaid.js
 *  - Sankey Visualizations: ./js/sankey.js
 *  - SandDance 3D Unit Vis: ./js/sanddance.js
 *  - AI ReAct Agent: ./js/agent.js
 *  - Provider Settings: ./js/settings.js
 */

import { detectType, parseValue, processFullCSV } from './js/data-transform.js';
import { duckdbEngine } from './js/duckdb-engine.js';
import { MermaidManager } from './js/mermaid.js';
import { SankeyManager } from './js/sankey.js';
import { VegaManager } from './js/vega.js';
import { SandDanceManager } from './js/sanddance.js';
import { GraphicWalkerManager } from './js/graphic-walker.js';
import { AgentManager } from './js/agent.js';
import { SettingsManager } from './js/settings.js';
import { exportSession, validateDatasetForSession, restoreSessionState } from './js/session.js';

const isInternalColumn = c => c === 'GL_ORDINAL' || c === '_unit_id' || (typeof c === 'string' && c.startsWith('__'));

window.duckdbEngine = duckdbEngine;

document.addEventListener('DOMContentLoaded', () => {
    // Navigation & Container Elements
    const showLineupBtn = document.getElementById('show-lineup-btn');
    const showGraphicwalkerBtn = document.getElementById('show-graphicwalker-btn');
    const showSanddanceBtn = document.getElementById('show-sanddance-btn');
    const plotsSplitHub = document.getElementById('plots-split-hub');
    const plotsPrimaryBtn = document.getElementById('plots-primary-btn');
    const plotsPrimaryIcon = document.getElementById('plots-primary-icon');
    const plotsPrimaryLabel = document.getElementById('plots-primary-label');
    const plotsMenuToggleBtn = document.getElementById('plots-menu-toggle-btn');
    const plotsPopoverMenu = document.getElementById('plots-popover-menu');
    const plotsItemVega = document.getElementById('plots-item-vega');
    const plotsItemSankey = document.getElementById('plots-item-sankey');
    const plotsItemMermaid = document.getElementById('plots-item-mermaid');
    const showAgentBtn = document.getElementById('show-agent-btn');
    const allViewButtons = [showLineupBtn, showGraphicwalkerBtn, showSanddanceBtn, plotsPrimaryBtn, plotsMenuToggleBtn, showAgentBtn];

    // Tool View Containers
    const lineupContainer = document.getElementById('lineup-container');
    const graphicwalkerContainer = document.getElementById('graphic-walker-container');
    const sanddanceContainer = document.getElementById('sanddance-container');
    const mermaidContainer = document.getElementById('mermaid-container');
    const sankeyContainer = document.getElementById('sankey-container');
    const vegaContainer = document.getElementById('vega-container');
    const agentContainer = document.getElementById('agent-container');
    const allContainers = [lineupContainer, graphicwalkerContainer, sanddanceContainer, mermaidContainer, sankeyContainer, vegaContainer, agentContainer];

    const emptyStateContainer = document.getElementById('empty-state-container');
    const emptySetDataBtn = document.getElementById('empty-set-data-btn');
    const emptyUploadBtn = document.getElementById('empty-upload-btn');
    const emptyClipboardBtn = document.getElementById('empty-clipboard-btn');
    const emptyDemoBtn = document.getElementById('empty-demo-btn');

    const lineupRoot = document.getElementById('lineup-root');

    // Top Controls & Categorized Dropdowns
    const fileInput = document.getElementById('csv-file-input');
    const dataDropdownBtn = document.getElementById('data-dropdown-btn');
    const dataDropdownMenu = document.getElementById('data-dropdown-menu');
    const dataFilenameChip = document.getElementById('data-filename-chip');
    const dataActiveDatasetText = document.getElementById('data-active-dataset-text');
    const sessionDropdownBtn = document.getElementById('session-dropdown-btn');
    const sessionDropdownMenu = document.getElementById('session-dropdown-menu');

    const setDataButton = document.getElementById('set-data-btn');
    const uploadButton = document.getElementById('upload-btn');
    const clipboardButton = document.getElementById('clipboard-btn');
    const dummyDataButton = document.getElementById('dummy-data-btn');
    const resetButton = document.getElementById('reset-btn');
    const exportSessionBtn = document.getElementById('export-session-btn');
    const loadSessionBtn = document.getElementById('load-session-btn');
    const emptyLoadSessionBtn = document.getElementById('empty-load-session-btn');

    // Dataset name tracking with first-k-characters truncation
    let currentDatasetName = null;
    const MAX_DATASET_NAME_CHARS = 12;

    const formatDatasetName = (name, k = MAX_DATASET_NAME_CHARS) => {
        if (!name) return '';
        return name.length > k ? name.slice(0, k) + '…' : name;
    };

    const updateDatasetIndicator = (name, rowCount = 0) => {
        currentDatasetName = name;
        if (name && dataFilenameChip) {
            dataFilenameChip.textContent = formatDatasetName(name);
            dataFilenameChip.title = `${name} (${rowCount ? rowCount.toLocaleString() : '0'} rows)`;
            dataFilenameChip.classList.remove('hidden');
        } else if (dataFilenameChip) {
            dataFilenameChip.textContent = '';
            dataFilenameChip.title = '';
            dataFilenameChip.classList.add('hidden');
        }

        if (dataActiveDatasetText) {
            if (name) {
                dataActiveDatasetText.textContent = `${name} (${rowCount ? rowCount.toLocaleString() : '0'} rows)`;
            } else {
                dataActiveDatasetText.textContent = 'No dataset loaded';
            }
        }
    };

    // Session Modal Controls
    const sessionModal = document.getElementById('session-modal');
    const sessionFileDropzone = document.getElementById('session-file-dropzone');
    const sessionFileInput = document.getElementById('session-file-input');
    const sessionFileInfo = document.getElementById('session-file-info');
    const sessionDatasetStep = document.getElementById('session-dataset-step');
    const sessionDatasetStatus = document.getElementById('session-dataset-status');
    const sessionDatasetUploadPrompt = document.getElementById('session-dataset-upload-prompt');
    const sessionDataDropzone = document.getElementById('session-data-dropzone');
    const sessionDataInput = document.getElementById('session-data-input');
    const cancelSessionBtn = document.getElementById('cancel-session-btn');
    const applySessionBtn = document.getElementById('apply-session-btn');

    // Load Data Modal Controls
    const setDataModal = document.getElementById('set-data-modal');
    const closeSetDataModalBtn = document.getElementById('close-set-data-modal-btn');
    const cancelSetDataBtn = document.getElementById('cancel-set-data-btn');
    const setDataTabUpload = document.getElementById('set-data-tab-upload');
    const setDataTabPaste = document.getElementById('set-data-tab-paste');
    const setDataPaneUpload = document.getElementById('set-data-pane-upload');
    const setDataPanePaste = document.getElementById('set-data-pane-paste');
    const setDataDropzone = document.getElementById('set-data-dropzone');
    const setDataPasteTextarea = document.getElementById('set-data-paste-textarea');
    const setDataClipboardBtn = document.getElementById('set-data-clipboard-btn');
    const confirmSetDataPasteBtn = document.getElementById('confirm-set-data-paste-btn');

    // Import Configuration Modal
    const importModal = document.getElementById('import-modal');
    const modalBody = document.getElementById('modal-body');
    const confirmImportBtn = document.getElementById('confirm-import-btn');
    const cancelImportBtn = document.getElementById('cancel-import-btn');

    // Global Data State
    let currentData = [];
    window.currentData = currentData;
    let lineupInstance = null;
    let pendingFile = null;

    const getData = () => currentData;

    // Instantiate Sub-Managers
    const mermaidMgr = new MermaidManager({
        getData
    });

    const sankeyMgr = new SankeyManager({
        getData
    });

    const vegaMgr = new VegaManager({
        getData
    });

    const sanddanceMgr = new SandDanceManager({
        getData
    });

    const graphicWalkerMgr = new GraphicWalkerManager({
        getData
    });

    const agentMgr = new AgentManager({
        getData,
        onOpenMermaid: (code) => {
            if (mermaidMgr.textEditor) mermaidMgr.textEditor.value = code;
            showMermaid();
        },
        onOpenVega: (spec) => {
            vegaMgr.loadSpec(spec);
            showVega();
        }
    });

    const settingsMgr = new SettingsManager({
        onSettingsSaved: () => {
            agentMgr.checkAvailability();
        }
    });

    // Initialize modules
    mermaidMgr.init();
    sankeyMgr.init();
    vegaMgr.init();
    sanddanceMgr.init();
    graphicWalkerMgr.init();
    agentMgr.init();
    settingsMgr.init();

    // Loading State Toggle
    const toggleLoading = (show) => {
        const buttons = [uploadButton, dummyDataButton, resetButton];
        buttons.forEach(btn => {
            if (btn) btn.disabled = show;
        });
    };

    // Plots Split Hub metadata
    const plotsConfig = {
        vega: { label: 'Vega', icon: 'fa-chart-simple', elem: plotsItemVega },
        sankey: { label: 'Sankey', icon: 'fa-diagram-project', elem: plotsItemSankey },
        mermaid: { label: 'Mermaid', icon: 'fa-code-fork', elem: plotsItemMermaid }
    };
    let activePlotType = 'vega';

    function updatePlotsHubState(plotType, isPlotsActive) {
        if (plotType && plotsConfig[plotType]) {
            activePlotType = plotType;
            if (plotsPrimaryLabel) plotsPrimaryLabel.textContent = plotsConfig[plotType].label;
            if (plotsPrimaryIcon) plotsPrimaryIcon.className = `fa-solid ${plotsConfig[plotType].icon}`;
            [plotsItemVega, plotsItemSankey, plotsItemMermaid].forEach(item => {
                if (item) item.classList.toggle('active', item.getAttribute('data-view') === plotType);
            });
        }
        if (plotsSplitHub) {
            plotsSplitHub.classList.toggle('active-group', isPlotsActive);
        }
    }

    // --- View Switcher ---
    function showEmptyState() {
        if (emptyStateContainer) emptyStateContainer.classList.remove('hidden');
        allContainers.forEach(c => c && c.classList.add('hidden'));

        allViewButtons.forEach(btn => {
            if (btn) {
                btn.classList.remove('active');
                btn.disabled = true;
            }
        });

        if (plotsSplitHub) {
            plotsSplitHub.classList.remove('open', 'active-group');
        }
        if (plotsMenuToggleBtn) {
            plotsMenuToggleBtn.setAttribute('aria-expanded', 'false');
        }

        if (resetButton) resetButton.disabled = true;
        if (exportSessionBtn) exportSessionBtn.disabled = true;
        updateDatasetIndicator(null);

        if (sanddanceMgr.toolbar) sanddanceMgr.toolbar.classList.add('hidden');
    }

    function setActiveView(targetContainer, targetButton) {
        if (emptyStateContainer) emptyStateContainer.classList.add('hidden');
        allContainers.forEach(c => {
            if (c === targetContainer) {
                c.classList.remove('hidden');
            } else if (c) {
                c.classList.add('hidden');
            }
        });

        const isPlotsTarget = (targetButton === plotsPrimaryBtn);
        allViewButtons.forEach(btn => {
            if (btn === targetButton) {
                btn.classList.add('active');
            } else if (btn) {
                btn.classList.remove('active');
            }
        });

        updatePlotsHubState(null, isPlotsTarget);

        // Free SVG DOM memory when leaving Sankey view
        if (targetContainer !== sankeyContainer && sankeyMgr) {
            sankeyMgr.teardown();
        }
    }

    let currentActiveView = 'lineup';

    function showLineup() {
        if (!currentData || currentData.length === 0) return;
        currentActiveView = 'lineup';
        setActiveView(lineupContainer, showLineupBtn);
        if (sanddanceMgr.toolbar) sanddanceMgr.toolbar.classList.add('hidden');
        if (lineupInstance) {
            try { lineupInstance.update(); } catch (e) { }
        }
    }

    function showGraphicWalker() {
        if (!currentData || currentData.length === 0) return;
        currentActiveView = 'graphic-walker';
        setActiveView(graphicwalkerContainer, showGraphicwalkerBtn);
        if (sanddanceMgr.toolbar) sanddanceMgr.toolbar.classList.add('hidden');
        setTimeout(() => {
            graphicWalkerMgr.render(currentData);
        }, 60);
    }

    function showSanddance() {
        if (!currentData || currentData.length === 0) return;
        currentActiveView = 'sanddance';
        setActiveView(sanddanceContainer, showSanddanceBtn);
        if (sanddanceMgr.toolbar) sanddanceMgr.toolbar.classList.remove('hidden');
        requestAnimationFrame(() => {
            sanddanceMgr.render();
            setTimeout(() => {
                sanddanceMgr.resize();
            }, 80);
        });
    }

    function showMermaid() {
        if (!currentData || currentData.length === 0) return;
        currentActiveView = 'mermaid';
        updatePlotsHubState('mermaid', true);
        setActiveView(mermaidContainer, plotsPrimaryBtn);
        if (sanddanceMgr.toolbar) sanddanceMgr.toolbar.classList.add('hidden');
        setTimeout(() => {
            mermaidMgr.updateColumnOptions();
            mermaidMgr.updateUIControls();
            mermaidMgr.renderChart();
        }, 100);
    }

    function showSankey() {
        if (!currentData || currentData.length === 0) return;
        currentActiveView = 'sankey';
        updatePlotsHubState('sankey', true);
        setActiveView(sankeyContainer, plotsPrimaryBtn);
        if (sanddanceMgr.toolbar) sanddanceMgr.toolbar.classList.add('hidden');
        setTimeout(() => {
            sankeyMgr.renderChart();
        }, 100);
    }

    function showVega() {
        if (!currentData || currentData.length === 0) return;
        currentActiveView = 'vega';
        updatePlotsHubState('vega', true);
        setActiveView(vegaContainer, plotsPrimaryBtn);
        if (sanddanceMgr.toolbar) sanddanceMgr.toolbar.classList.add('hidden');
        setTimeout(() => {
            vegaMgr.initCollapseState();
            vegaMgr.updateColumnOptions();
            vegaMgr.refreshEditor();
            if (!vegaMgr.getSpecText()?.trim()) {
                vegaMgr.loadSensibleDefaults();
            } else {
                vegaMgr.renderChart();
            }
        }, 100);
    }

    function showAgent() {
        if (!currentData || currentData.length === 0) return;
        currentActiveView = 'agent';
        setActiveView(agentContainer, showAgentBtn);
        if (sanddanceMgr.toolbar) sanddanceMgr.toolbar.classList.add('hidden');
        setTimeout(() => { if (agentMgr.chatInput) agentMgr.chatInput.focus(); }, 50);
    }

    function activateViewByName(viewName) {
        switch (viewName) {
            case 'graphic-walker':
            case 'graphicwalker':
                showGraphicWalker();
                break;
            case 'sanddance':
                showSanddance();
                break;
            case 'mermaid':
                showMermaid();
                break;
            case 'sankey':
                showSankey();
                break;
            case 'vega':
            case 'vega-lite':
            case 'vega-online':
                showVega();
                break;
            case 'agent':
                showAgent();
                break;
            case 'lineup':
            default:
                showLineup();
                break;
        }
    }

    function restoreLineupWithDump(dump) {
        if (!window.LineUpJS || !lineupRoot || !currentData || currentData.length === 0) return;
        try {
            if (lineupInstance) {
                try { lineupInstance.destroy(); } catch (e) { }
                lineupInstance = null;
            }
            if (lineupRoot) lineupRoot.innerHTML = '';

            lineupInstance = LineUpJS.asLineUp(lineupRoot, currentData);
            if (dump) {
                if (typeof lineupInstance.restore === 'function') {
                    lineupInstance.restore(dump);
                } else if (lineupInstance.data && typeof lineupInstance.data.restore === 'function') {
                    lineupInstance.data.restore(dump);
                }
            }
            if (lineupInstance && typeof lineupInstance.update === 'function') {
                lineupInstance.update();
            }
        } catch (err) {
            console.error("Failed to restore LineUp with dump:", err);
            try {
                if (lineupInstance) {
                    try { lineupInstance.destroy(); } catch (e) { }
                    lineupInstance = null;
                }
                if (lineupRoot) lineupRoot.innerHTML = '';
                lineupInstance = LineUpJS.asLineUp(lineupRoot, currentData);
            } catch (e) { }
        }
    }

    // View switcher button clicks
    if (showLineupBtn) showLineupBtn.addEventListener('click', () => { if (currentData && currentData.length > 0) showLineup(); });
    if (showGraphicwalkerBtn) showGraphicwalkerBtn.addEventListener('click', () => { if (currentData && currentData.length > 0) showGraphicWalker(); });
    if (showSanddanceBtn) showSanddanceBtn.addEventListener('click', () => { if (currentData && currentData.length > 0) showSanddance(); });
    if (plotsPrimaryBtn) {
        plotsPrimaryBtn.addEventListener('click', () => {
            if (!currentData || currentData.length === 0) return;
            if (activePlotType === 'sankey') {
                showSankey();
            } else if (activePlotType === 'mermaid') {
                showMermaid();
            } else {
                showVega();
            }
        });
    }
    if (plotsItemVega) {
        plotsItemVega.addEventListener('click', () => {
            closePlotsMenu();
            if (currentData && currentData.length > 0) showVega();
        });
    }
    if (plotsItemSankey) {
        plotsItemSankey.addEventListener('click', () => {
            closePlotsMenu();
            if (currentData && currentData.length > 0) showSankey();
        });
    }
    if (plotsItemMermaid) {
        plotsItemMermaid.addEventListener('click', () => {
            closePlotsMenu();
            if (currentData && currentData.length > 0) showMermaid();
        });
    }
    if (showAgentBtn) showAgentBtn.addEventListener('click', () => { if (currentData && currentData.length > 0) showAgent(); });

    // --- CSV Import Modal & Parsing ---
    const openImportModal = (file) => {
        pendingFile = file;
        Papa.parse(file, {
            header: true,
            preview: 5,
            skipEmptyLines: true,
            complete: (results) => {
                const columns = results.meta.fields || [];
                const sampleRow = results.data[0] || {};

                let html = `
                  <div class="import-config-section">
                      <div class="config-row">
                          <label for="csv-delimiter">Delimiter</label>
                          <select id="csv-delimiter" class="control-select">
                              <option value="">Auto-Detect</option>
                              <option value=",">Comma (,)</option>
                              <option value=";">Semicolon (;)</option>
                              <option value="\t">Tab</option>
                          </select>
                      </div>
                      <div class="config-row">
                          <label for="csv-decimal">Decimal Separator</label>
                          <select id="csv-decimal" class="control-select">
                              <option value="auto">Auto-Detect</option>
                              <option value=".">Dot (.)</option>
                              <option value=",">Comma (,)</option>
                          </select>
                      </div>
                  </div>
                  <div class="column-toolbar">
                      <h3 class="column-toolbar-title">Columns &amp; Types</h3>
                      <div class="column-toolbar-actions">
                          <button type="button" id="select-all-cols-btn" class="btn-pill">Select All</button>
                          <button type="button" id="deselect-all-cols-btn" class="btn-pill">Deselect All</button>
                      </div>
                  </div>
                  <div class="columns-list">
              `;

                columns.forEach((col, idx) => {
                    const detected = detectType(sampleRow[col]);
                    const checkId = `col-check-${idx}`;
                    const sampleVal = sampleRow[col] !== undefined && sampleRow[col] !== '' ? String(sampleRow[col]) : 'empty';
                    html += `
                      <div class="column-config" data-column="${col}">
                          <input type="checkbox" id="${checkId}" class="col-select-check" data-column="${col}" checked title="Include this column">
                          <label for="${checkId}" class="column-config-label" title="${col}">
                              <span class="column-name">${col}</span>
                              <span class="column-sample">(${sampleVal})</span>
                          </label>
                          <select class="column-type-select control-select" data-column="${col}">
                              <option value="String" ${detected === 'String' ? 'selected' : ''}>String</option>
                              <option value="Number" ${detected === 'Number' ? 'selected' : ''}>Number</option>
                              <option value="Date" ${detected === 'Date' ? 'selected' : ''}>Date</option>
                              <option value="DateTime" ${detected === 'DateTime' ? 'selected' : ''}>DateTime</option>
                              <option value="Time" ${detected === 'Time' ? 'selected' : ''}>Time</option>
                              <option value="Boolean" ${detected === 'Boolean' ? 'selected' : ''}>Boolean</option>
                          </select>
                      </div>
                  `;
                });
                html += '</div>';

                modalBody.innerHTML = html;

                const selectAllBtn = document.getElementById('select-all-cols-btn');
                const deselectAllBtn = document.getElementById('deselect-all-cols-btn');
                const checkboxes = modalBody.querySelectorAll('.col-select-check');

                checkboxes.forEach(chk => {
                    chk.addEventListener('change', () => {
                        const row = chk.closest('.column-config');
                        const sel = row.querySelector('.column-type-select');
                        if (chk.checked) {
                            row.classList.remove('deselected');
                            sel.disabled = false;
                        } else {
                            row.classList.add('deselected');
                            sel.disabled = true;
                        }
                    });
                });

                if (selectAllBtn) {
                    selectAllBtn.addEventListener('click', () => {
                        checkboxes.forEach(chk => {
                            chk.checked = true;
                            const row = chk.closest('.column-config');
                            row.classList.remove('deselected');
                            row.querySelector('.column-type-select').disabled = false;
                        });
                    });
                }

                if (deselectAllBtn) {
                    deselectAllBtn.addEventListener('click', () => {
                        checkboxes.forEach(chk => {
                            chk.checked = false;
                            const row = chk.closest('.column-config');
                            row.classList.add('deselected');
                            row.querySelector('.column-type-select').disabled = true;
                        });
                    });
                }

                if (importModal) importModal.classList.remove('hidden');
            }
        });
    };

    const processAndRenderData = (data, datasetName = null) => {
        currentData = data;
        window.currentData = data;
        if (datasetName) {
            currentDatasetName = datasetName;
        } else if (!currentDatasetName) {
            currentDatasetName = 'dataset.csv';
        }
        if (emptyStateContainer) emptyStateContainer.classList.add('hidden');

        allViewButtons.forEach(btn => {
            if (btn) btn.disabled = false;
        });

        if (resetButton) resetButton.disabled = false;
        if (exportSessionBtn) exportSessionBtn.disabled = false;
        updateDatasetIndicator(currentDatasetName, data ? data.length : 0);

        sanddanceMgr.updateOptions();
        sankeyMgr.updateColumnOptions();
        mermaidMgr.updateColumnOptions();
        vegaMgr.updateColumnOptions();

        if (sankeyMgr.textEditor) {
            sankeyMgr.textEditor.value = '';
        }
        if (mermaidMgr.presetSelect && mermaidMgr.presetSelect.value === 'xychart') {
            mermaidMgr.generateFromData();
        }
        if (!vegaMgr.getSpecText()?.trim()) {
            vegaMgr.loadSensibleDefaults();
        }

        if (data && data.length > 0) {
            agentMgr.renderPreviewTable(data.slice(0, 5));
            if (duckdbEngine) {
                if (window._duckdbLoadedFromCSV) {
                    window._duckdbLoadedFromCSV = false;
                } else {
                    duckdbEngine.loadJSON(data).catch(() => { });
                }
            }
        }

        allViewButtons.forEach(btn => {
            if (btn) btn.disabled = false;
        });

        setTimeout(() => {
            if (lineupInstance) {
                try { lineupInstance.destroy(); } catch (e) { }
            }
            if (lineupRoot) lineupRoot.innerHTML = '';
            try {
                if (window.LineUpJS && lineupRoot) {
                    lineupInstance = LineUpJS.asLineUp(lineupRoot, data);
                }
            } catch (err) {
                console.error("Failed to initialize LineUp:", err);
            }

            // Restore active view or default to LineUp
            if (showGraphicwalkerBtn && showGraphicwalkerBtn.classList.contains('active')) {
                showGraphicWalker();
            } else if (showSanddanceBtn && showSanddanceBtn.classList.contains('active')) {
                showSanddance();
            } else if (plotsPrimaryBtn && plotsPrimaryBtn.classList.contains('active')) {
                if (activePlotType === 'sankey') {
                    showSankey();
                } else if (activePlotType === 'mermaid') {
                    showMermaid();
                } else {
                    showVega();
                }
            } else if (showAgentBtn && showAgentBtn.classList.contains('active')) {
                showAgent();
            } else {
                showLineup();
            }

            toggleLoading(false);
        }, 50);
    };

    const renderDummyData = () => {
        toggleLoading(true);
        const data = [];
        const departments = ['Engineering', 'Marketing', 'Sales', 'Product', 'Support'];
        const projectTypes = ['Infrastructure', 'Growth', 'Enterprise', 'Retention', 'Mobile'];
        const regions = ['North America', 'EMEA', 'APAC', 'LATAM'];

        for (let i = 0; i < 250; i++) {
            data.push({
                department: departments[Math.floor(Math.random() * departments.length)],
                project: projectTypes[Math.floor(Math.random() * projectTypes.length)],
                region: regions[Math.floor(Math.random() * regions.length)],
                budget_k: Math.floor(Math.random() * 80) + 10,
                headcount: Math.floor(Math.random() * 15) + 1,
                active: Math.random() > 0.15
            });
        }
        processAndRenderData(data, 'demo_data.csv');
    };

    const resetView = () => {
        if (lineupInstance) {
            try { lineupInstance.destroy(); } catch (e) { }
            lineupInstance = null;
        }

        graphicWalkerMgr.reset();
        sanddanceMgr.reset();
        sankeyMgr.reset();
        mermaidMgr.reset();

        currentData = [];
        window.currentData = [];
        if (window.duckdbEngine) {
            window.duckdbEngine.clear().catch(() => { });
        }

        if (vegaMgr.textEditor) vegaMgr.textEditor.value = '';
        if (vegaMgr.renderOutput) vegaMgr.renderOutput.innerHTML = '';
        agentMgr.resetPreview();

        if (lineupRoot) lineupRoot.innerHTML = '';
        showEmptyState();
        toggleLoading(false);
    };

    const handleClipboardImport = async () => {
        let text = '';
        if (navigator.clipboard && navigator.clipboard.readText) {
            try {
                text = await navigator.clipboard.readText();
            } catch (err) {
                console.warn('Direct clipboard reading restricted by browser:', err);
            }
        }

        let trimmed = text ? text.trim() : '';
        if (!trimmed) {
            // Browser security restriction fallback (e.g., Safari): allow user to paste directly
            const pasted = window.prompt('Your browser restricted direct clipboard reading. Please paste (Cmd+V) your CSV data here:');
            trimmed = pasted ? pasted.trim() : '';
        }

        if (!trimmed) {
            return;
        }

        const file = new File([trimmed], 'clipboard.csv', { type: 'text/csv' });
        openImportModal(file);
    };

    // Quick action buttons
    if (emptyUploadBtn) emptyUploadBtn.addEventListener('click', () => { fileInput.click(); });
    if (emptyClipboardBtn) emptyClipboardBtn.addEventListener('click', handleClipboardImport);
    if (emptyDemoBtn) emptyDemoBtn.addEventListener('click', renderDummyData);

    // Load Data Modal Actions
    const openSetDataModal = () => {
        if (setDataModal) {
            setDataModal.classList.remove('hidden');
            // Reset to upload tab
            if (setDataTabUpload && setDataTabPaste && setDataPaneUpload && setDataPanePaste) {
                setDataTabUpload.classList.add('active');
                setDataTabPaste.classList.remove('active');
                setDataPaneUpload.classList.remove('hidden');
                setDataPanePaste.classList.add('hidden');
            }
            if (confirmSetDataPasteBtn) confirmSetDataPasteBtn.classList.add('hidden');
        }
    };

    const closeSetDataModal = () => {
        if (setDataModal) setDataModal.classList.add('hidden');
    };

    if (setDataButton) setDataButton.addEventListener('click', openSetDataModal);
    if (emptySetDataBtn) emptySetDataBtn.addEventListener('click', openSetDataModal);
    if (closeSetDataModalBtn) closeSetDataModalBtn.addEventListener('click', closeSetDataModal);
    if (cancelSetDataBtn) cancelSetDataBtn.addEventListener('click', closeSetDataModal);

    // Tab Switching in Load Data Modal
    if (setDataTabUpload) {
        setDataTabUpload.addEventListener('click', () => {
            setDataTabUpload.classList.add('active');
            if (setDataTabPaste) setDataTabPaste.classList.remove('active');
            if (setDataPaneUpload) setDataPaneUpload.classList.remove('hidden');
            if (setDataPanePaste) setDataPanePaste.classList.add('hidden');
            if (confirmSetDataPasteBtn) confirmSetDataPasteBtn.classList.add('hidden');
        });
    }

    if (setDataTabPaste) {
        setDataTabPaste.addEventListener('click', () => {
            setDataTabPaste.classList.add('active');
            if (setDataTabUpload) setDataTabUpload.classList.remove('active');
            if (setDataPanePaste) setDataPanePaste.classList.remove('hidden');
            if (setDataPaneUpload) setDataPaneUpload.classList.add('hidden');
            if (confirmSetDataPasteBtn) confirmSetDataPasteBtn.classList.remove('hidden');
            if (setDataPasteTextarea) setDataPasteTextarea.focus();
        });
    }

    // Dropzone for Load Data Modal
    if (setDataDropzone) {
        setDataDropzone.addEventListener('click', () => {
            if (fileInput) fileInput.click();
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            setDataDropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                setDataDropzone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            setDataDropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                setDataDropzone.classList.remove('drag-over');
            });
        });

        setDataDropzone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            if (dt && dt.files && dt.files.length > 0) {
                closeSetDataModal();
                openImportModal(dt.files[0]);
            }
        });
    }

    // Clipboard and paste in Load Data Modal
    if (setDataClipboardBtn) {
        setDataClipboardBtn.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (setDataPasteTextarea) {
                    setDataPasteTextarea.value = text;
                }
            } catch (err) {
                const pasted = window.prompt('Please paste your CSV data here:');
                if (pasted && setDataPasteTextarea) {
                    setDataPasteTextarea.value = pasted;
                }
            }
        });
    }

    if (confirmSetDataPasteBtn) {
        confirmSetDataPasteBtn.addEventListener('click', () => {
            const rawText = setDataPasteTextarea ? setDataPasteTextarea.value.trim() : '';
            if (!rawText) {
                alert('Please paste or enter tabular CSV text.');
                return;
            }
            closeSetDataModal();
            const file = new File([rawText], 'pasted_dataset.csv', { type: 'text/csv' });
            openImportModal(file);
        });
    }

    // Header Dropdown Menus (Variant 1)
    const allDropdownMenus = [dataDropdownMenu, sessionDropdownMenu];
    const allDropdownButtons = [dataDropdownBtn, sessionDropdownBtn];

    function closePlotsMenu() {
        if (plotsSplitHub) plotsSplitHub.classList.remove('open');
        if (plotsMenuToggleBtn) plotsMenuToggleBtn.setAttribute('aria-expanded', 'false');
    }

    function closeAllDropdowns() {
        allDropdownMenus.forEach(m => m && m.classList.remove('show'));
        allDropdownButtons.forEach(b => {
            if (b) {
                b.classList.remove('active');
                b.setAttribute('aria-expanded', 'false');
            }
        });
        closePlotsMenu();
    }

    function setupDropdown(triggerBtn, menuElem) {
        if (!triggerBtn || !menuElem) return;
        triggerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = menuElem.classList.contains('show');
            closeAllDropdowns();
            if (!isOpen) {
                menuElem.classList.add('show');
                triggerBtn.classList.add('active');
                triggerBtn.setAttribute('aria-expanded', 'true');
            }
        });
    }

    setupDropdown(dataDropdownBtn, dataDropdownMenu);
    setupDropdown(sessionDropdownBtn, sessionDropdownMenu);

    if (plotsMenuToggleBtn && plotsSplitHub) {
        plotsMenuToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = plotsSplitHub.classList.contains('open');
            closeAllDropdowns();
            if (!isOpen) {
                plotsSplitHub.classList.add('open');
                plotsMenuToggleBtn.setAttribute('aria-expanded', 'true');
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown-wrapper') && !e.target.closest('.split-hub-wrapper')) {
            closeAllDropdowns();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAllDropdowns();
        }
    });

    // Close dropdowns when clicking any item
    document.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            closeAllDropdowns();
        });
    });

    // Header buttons
    if (dummyDataButton) dummyDataButton.addEventListener('click', renderDummyData);
    if (uploadButton) uploadButton.addEventListener('click', () => { fileInput.click(); });
    if (clipboardButton) clipboardButton.addEventListener('click', handleClipboardImport);
    if (fileInput) {
        fileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (!file) return;
            closeSetDataModal();
            openImportModal(file);
            event.target.value = '';
        });
    }

    if (cancelImportBtn) {
        cancelImportBtn.addEventListener('click', () => {
            if (importModal) importModal.classList.add('hidden');
            pendingFile = null;
        });
    }

    if (confirmImportBtn) {
        confirmImportBtn.addEventListener('click', async () => {
            if (!pendingFile) return;
            const delimiterEl = document.getElementById('csv-delimiter');
            const decimalEl = document.getElementById('csv-decimal');
            const delimiter = delimiterEl ? delimiterEl.value : '';
            const decimalSeparator = decimalEl ? decimalEl.value : 'auto';

            const checkBoxes = document.querySelectorAll('.col-select-check');
            const selectedColumns = [];
            checkBoxes.forEach(chk => {
                if (chk.checked) {
                    selectedColumns.push(chk.dataset.column);
                }
            });

            if (selectedColumns.length === 0) {
                alert('Please select at least one column to import.');
                return;
            }

            const typeSelects = document.querySelectorAll('.column-type-select');
            const types = {};
            typeSelects.forEach(sel => {
                if (selectedColumns.includes(sel.dataset.column)) {
                    types[sel.dataset.column] = sel.value;
                }
            });

            if (importModal) importModal.classList.add('hidden');
            try {
                const filename = pendingFile ? pendingFile.name : 'dataset.csv';
                const data = await processFullCSV(pendingFile, { delimiter, decimalSeparator, types, selectedColumns }, toggleLoading);
                processAndRenderData(data, filename);
            } catch (error) {
                console.error(error);
                alert('Error processing file');
                toggleLoading(false);
            }
            pendingFile = null;
        });
    }

    if (dummyDataButton) dummyDataButton.addEventListener('click', renderDummyData);
    if (resetButton) resetButton.addEventListener('click', resetView);

    window.addEventListener('resize', () => {
        if (sanddanceContainer && !sanddanceContainer.classList.contains('hidden')) {
            sanddanceMgr.resize();
        } else if (sankeyContainer && !sankeyContainer.classList.contains('hidden')) {
            sankeyMgr.renderChart();
        }
    });

    // Recover visualization layout on browser tab switch and window focus
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            if (sanddanceContainer && !sanddanceContainer.classList.contains('hidden')) {
                sanddanceMgr.resize();
            }
        }
    });

    window.addEventListener('focus', () => {
        if (sanddanceContainer && !sanddanceContainer.classList.contains('hidden')) {
            sanddanceMgr.resize();
        }
    });

    // Guidelines Banner Toggle Accordions
    document.querySelectorAll('.tab-intro-toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const banner = e.currentTarget.closest('.tab-intro-banner');
            if (banner) {
                const isOpen = banner.classList.toggle('open');
                btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                if (sanddanceContainer && !sanddanceContainer.classList.contains('hidden')) {
                    setTimeout(() => sanddanceMgr.resize(), 160);
                }
            }
        });
    });

    // Overview & Description Toggle for Mobile Banners
    document.querySelectorAll('.tab-intro-info-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const banner = e.currentTarget.closest('.tab-intro-banner');
            if (banner) {
                const isOpen = banner.classList.toggle('info-open');
                btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                if (sanddanceContainer && !sanddanceContainer.classList.contains('hidden')) {
                    setTimeout(() => sanddanceMgr.resize(), 160);
                }
            }
        });
    });

    // Global paste handler to import tabular data directly with Ctrl+V / Cmd+V
    window.addEventListener('paste', (event) => {
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (activeTag === 'input' || activeTag === 'textarea' || document.activeElement?.isContentEditable) {
            return;
        }
        const pasteData = event.clipboardData ? event.clipboardData.getData('text') : '';
        if (pasteData && pasteData.trim() && pasteData.trim().includes('\n')) {
            event.preventDefault();
            const file = new File([pasteData.trim()], 'clipboard.csv', { type: 'text/csv' });
            openImportModal(file);
        }
    });

    // Generic Markdown Viewer Modal Helper
    const setupMarkdownModal = (modalId, bodyId, okBtnId, endpoint, label) => {
        const modal = document.getElementById(modalId);
        const modalBody = document.getElementById(bodyId);
        const okBtn = document.getElementById(okBtnId);

        if (okBtn) {
            okBtn.addEventListener('click', () => modal && modal.classList.add('hidden'));
        }

        const openModal = async () => {
            if (!modal) return;
            modal.classList.remove('hidden');
            if (modalBody) {
                modalBody.innerHTML = `
                    <div style="display: flex; align-items: center; justify-content: center; padding: 2rem; color: #64748b;">
                        <i class="fa-solid fa-spinner fa-spin" style="margin-right: 8px;"></i> Loading ${label}...
                    </div>`;
                try {
                    const resp = await fetch(endpoint);
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const data = await resp.json();
                    const rawMarkdown = data.content || `# No ${label} content found.`;
                    if (window.marked && window.DOMPurify) {
                        const sanitized = rawMarkdown.replace(/(^|[\s\(\[\{])~([0-9\$\€\£\.\,\+\-])/g, '$1≈$2');
                        const parsedHtml = DOMPurify.sanitize(marked.parse(sanitized, { breaks: true, gfm: true }));
                        modalBody.innerHTML = `<div class="docs-markdown-view">${parsedHtml}</div>`;
                    } else {
                        modalBody.innerHTML = `<pre style="white-space: pre-wrap; font-family: monospace;">${rawMarkdown}</pre>`;
                    }
                } catch (err) {
                    console.error(`Failed to load ${endpoint}:`, err);
                    modalBody.innerHTML = `
                        <div style="color: #ef4444; padding: 1rem;">
                            <p><b>Error loading content:</b> ${err.message || String(err)}</p>
                        </div>`;
                }
            }
        };

        return openModal;
    };

    // Docs / README Markdown Viewer Modal Logic
    const helpButton = document.getElementById('help-btn');
    const openDocsModal = setupMarkdownModal('docs-modal', 'docs-modal-body', 'ok-docs-modal-btn', '/readme', 'documentation');
    if (helpButton) helpButton.addEventListener('click', openDocsModal);

    // Privacy Policy Modal & Footer Link
    const privacyLink = document.getElementById('footer-privacy-link');
    const privacyDivider = document.getElementById('footer-privacy-divider');
    const openPrivacyModal = setupMarkdownModal('privacy-modal', 'privacy-modal-body', 'ok-privacy-modal-btn', '/privacy', 'Datenschutzerklärung');
    if (privacyLink) {
        privacyLink.addEventListener('click', (e) => {
            e.preventDefault();
            openPrivacyModal();
        });
    }

    // Imprint Modal & Footer Link
    const imprintLink = document.getElementById('footer-imprint-link');
    const imprintDivider = document.getElementById('footer-imprint-divider');
    const openImprintModal = setupMarkdownModal('imprint-modal', 'imprint-modal-body', 'ok-imprint-modal-btn', '/imprint', 'Imprint');
    if (imprintLink) {
        imprintLink.addEventListener('click', (e) => {
            e.preventDefault();
            openImprintModal();
        });
    }

    // Dynamic Footer Visibility for Privacy & Imprint
    const initFooterComplianceLinks = async () => {
        try {
            const [privResp, impResp] = await Promise.all([
                fetch('/privacy').then(r => r.ok ? r.json() : { available: false }).catch(() => ({ available: false })),
                fetch('/imprint').then(r => r.ok ? r.json() : { available: false }).catch(() => ({ available: false }))
            ]);

            if (privResp && privResp.available) {
                if (privacyLink) privacyLink.classList.remove('hidden');
                if (privacyDivider) privacyDivider.classList.remove('hidden');
            }
            if (impResp && impResp.available) {
                if (imprintLink) imprintLink.classList.remove('hidden');
                if (imprintDivider) imprintDivider.classList.remove('hidden');
            }
        } catch (e) {
            console.warn("Could not check footer compliance links:", e);
        }
    };
    initFooterComplianceLinks();

    // --- Session Export & Restore Logic ---
    let loadedSessionObj = null;
    let sessionCandidateData = null;

    function openSessionModal() {
        loadedSessionObj = null;
        sessionCandidateData = null;
        if (sessionFileInput) sessionFileInput.value = '';
        if (sessionDataInput) sessionDataInput.value = '';
        if (sessionFileInfo) {
            sessionFileInfo.classList.add('hidden');
            sessionFileInfo.innerHTML = '';
        }
        if (sessionDatasetStep) sessionDatasetStep.classList.add('hidden');
        if (sessionDatasetStatus) sessionDatasetStatus.innerHTML = '';
        if (sessionDatasetUploadPrompt) sessionDatasetUploadPrompt.classList.add('hidden');
        if (applySessionBtn) applySessionBtn.disabled = true;
        if (sessionModal) sessionModal.classList.remove('hidden');
    }

    function closeSessionModal() {
        if (sessionModal) sessionModal.classList.add('hidden');
        loadedSessionObj = null;
        sessionCandidateData = null;
    }

    function renderDatasetValidationResult(validation) {
        if (!sessionDatasetStatus) return;
        if (validation.valid) {
            sessionDatasetStatus.className = 'session-status-card valid';
            let rowNotice = '';
            if (validation.rowCountDiff > 0) {
                rowNotice = `<div style="margin-top: 4px; color: #b45309;"><i class="fa-solid fa-triangle-exclamation"></i> Row count notice: dataset has ${validation.actualRowCount.toLocaleString()} rows (saved with ${validation.expectedRowCount.toLocaleString()}).</div>`;
            }
            sessionDatasetStatus.innerHTML = `
                <div class="session-status-header">
                    <i class="fa-solid fa-circle-check"></i>
                    <span>Dataset Matches Session Schema</span>
                </div>
                <div>All required columns match (${validation.actualRowCount.toLocaleString()} rows ready).</div>
                ${rowNotice}
            `;
            if (sessionDatasetUploadPrompt) sessionDatasetUploadPrompt.classList.add('hidden');
            if (applySessionBtn) applySessionBtn.disabled = false;
        } else {
            sessionDatasetStatus.className = 'session-status-card invalid';
            const missing = (validation.missingColumns || []).join(', ');
            sessionDatasetStatus.innerHTML = `
                <div class="session-status-header">
                    <i class="fa-solid fa-circle-xmark"></i>
                    <span>Dataset Schema Mismatch</span>
                </div>
                <div>Missing columns required by session: <strong style="color: #dc2626;">${missing || 'Unknown'}</strong></div>
            `;
            if (sessionDatasetUploadPrompt) sessionDatasetUploadPrompt.classList.remove('hidden');
            if (applySessionBtn) applySessionBtn.disabled = true;
        }
    }

    function handleSessionFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const session = JSON.parse(e.target.result);
                if (!session || session.format !== 'dataviz-agent-session') {
                    alert('Invalid session file format. Expected "dataviz-agent-session".');
                    return;
                }
                loadedSessionObj = session;

                if (sessionFileInfo) {
                    const cleanCols = (session.datasetSchema?.columns || []).filter(c => !isInternalColumn(c));
                    const expCols = cleanCols.length;
                    const expRows = session.datasetSchema?.rowCount || 0;
                    const view = session.activeView || 'lineup';
                    sessionFileInfo.innerHTML = `
                        <div>
                            <strong>Session Loaded</strong>
                            <div style="font-size: 0.75rem; color: var(--color-text-secondary); margin-top: 2px;">
                                Target View: <strong>${view}</strong> | Required Columns: <strong>${expCols}</strong> | Saved Rows: <strong>${expRows.toLocaleString()}</strong>
                            </div>
                        </div>
                        <i class="fa-solid fa-circle-check" style="color: #10b981; font-size: 1.2rem;"></i>
                    `;
                    sessionFileInfo.classList.remove('hidden');
                }

                if (sessionDatasetStep) sessionDatasetStep.classList.remove('hidden');

                // Check if current workspace data satisfies session
                if (currentData && currentData.length > 0) {
                    const validation = validateDatasetForSession(loadedSessionObj, currentData);
                    renderDatasetValidationResult(validation);
                } else {
                    if (sessionDatasetUploadPrompt) sessionDatasetUploadPrompt.classList.remove('hidden');
                    if (sessionDatasetStatus) {
                        const cleanCols = (loadedSessionObj.datasetSchema?.columns || []).filter(c => !isInternalColumn(c));
                        sessionDatasetStatus.className = 'session-status-card';
                        sessionDatasetStatus.innerHTML = `
                            <div class="session-status-header">
                                <i class="fa-solid fa-circle-info" style="color: var(--color-primary);"></i>
                                <span>Dataset Required</span>
                            </div>
                            <div>Please upload the CSV dataset with columns: <code>${cleanCols.slice(0, 6).join(', ')}${cleanCols.length > 6 ? '...' : ''}</code></div>
                        `;
                    }
                    if (applySessionBtn) applySessionBtn.disabled = true;
                }
            } catch (err) {
                console.error('Error parsing session JSON:', err);
                alert('Could not parse session JSON file.');
            }
        };
        reader.readAsText(file);
    }

    async function handleSessionDataFile(file) {
        if (!file || !loadedSessionObj) return;
        toggleLoading(true);
        try {
            const data = await processFullCSV(file, { delimiter: '', decimalSeparator: 'auto' }, toggleLoading);
            if (!data || data.length === 0) {
                alert('Uploaded dataset is empty or unparseable.');
                toggleLoading(false);
                return;
            }
            sessionCandidateData = data;
            const validation = validateDatasetForSession(loadedSessionObj, data);
            renderDatasetValidationResult(validation);
        } catch (err) {
            console.error('Error parsing candidate dataset:', err);
            alert('Failed to parse dataset CSV: ' + err.message);
        } finally {
            toggleLoading(false);
        }
    }

    if (exportSessionBtn) {
        exportSessionBtn.addEventListener('click', () => {
            try {
                exportSession({
                    currentData,
                    datasetName: currentDatasetName,
                    activeView: currentActiveView,
                    managers: {
                        graphicWalker: graphicWalkerMgr,
                        sanddance: sanddanceMgr,
                        sankey: sankeyMgr,
                        mermaid: mermaidMgr,
                        vega: vegaMgr,
                        agent: agentMgr
                    },
                    lineupInstance
                });
            } catch (err) {
                alert(err.message || 'Failed to export session.');
            }
        });
    }

    if (loadSessionBtn) loadSessionBtn.addEventListener('click', openSessionModal);
    if (emptyLoadSessionBtn) emptyLoadSessionBtn.addEventListener('click', openSessionModal);
    if (cancelSessionBtn) cancelSessionBtn.addEventListener('click', closeSessionModal);

    if (sessionFileDropzone && sessionFileInput) {
        sessionFileDropzone.addEventListener('click', () => sessionFileInput.click());
        sessionFileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                handleSessionFile(e.target.files[0]);
            }
        });
        sessionFileDropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            sessionFileDropzone.classList.add('drag-over');
        });
        sessionFileDropzone.addEventListener('dragleave', () => sessionFileDropzone.classList.remove('drag-over'));
        sessionFileDropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            sessionFileDropzone.classList.remove('drag-over');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleSessionFile(e.dataTransfer.files[0]);
            }
        });
    }

    if (sessionDataDropzone && sessionDataInput) {
        sessionDataDropzone.addEventListener('click', () => sessionDataInput.click());
        sessionDataInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                handleSessionDataFile(e.target.files[0]);
            }
        });
        sessionDataDropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            sessionDataDropzone.classList.add('drag-over');
        });
        sessionDataDropzone.addEventListener('dragleave', () => sessionDataDropzone.classList.remove('drag-over'));
        sessionDataDropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            sessionDataDropzone.classList.remove('drag-over');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleSessionDataFile(e.dataTransfer.files[0]);
            }
        });
    }

    if (applySessionBtn) {
        applySessionBtn.addEventListener('click', () => {
            if (!loadedSessionObj) return;
            toggleLoading(true);
            try {
                if (sessionCandidateData && sessionCandidateData.length > 0) {
                    const sessionDatasetName = loadedSessionObj?.datasetSchema?.name || 'session_data.csv';
                    processAndRenderData(sessionCandidateData, sessionDatasetName);
                }
                setTimeout(() => {
                    restoreSessionState(loadedSessionObj, {
                        managers: {
                            graphicWalker: graphicWalkerMgr,
                            sanddance: sanddanceMgr,
                            sankey: sankeyMgr,
                            mermaid: mermaidMgr,
                            vega: vegaMgr,
                            agent: agentMgr
                        },
                        restoreLineup: restoreLineupWithDump,
                        activateView: activateViewByName
                    });
                    closeSessionModal();
                    toggleLoading(false);
                }, 150);
            } catch (err) {
                console.error('Error restoring session state:', err);
                alert('Failed to restore session: ' + err.message);
                toggleLoading(false);
            }
        });
    }

    // Initial state
    resetView();
});
