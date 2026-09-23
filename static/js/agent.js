/**
 * Agent Manager Module
 * Handles AI Data Agent communication, local chat persistence, markdown rendering,
 * chart/diagram integration, preview table updates, and fast-path client analytical tools.
 */

import { ClientDataTools } from './data-transform.js';
import { fetchAgentSkills, getActiveSkills, setActiveSkills, renderSkillsModal } from './agent-skills.js';

export const CHAT_STORAGE_KEY = 'ai_agent_chat_history_v1';

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export class AgentManager {
    constructor(options = {}) {
        this.getData = options.getData || (() => []);
        this.onOpenMermaid = options.onOpenMermaid || (() => { });
        this.onOpenVega = options.onOpenVega || (() => { });
        this.agentAvailable = false;
        this.activeModel = 'Unknown';

        // DOM elements
        this.container = document.getElementById('agent-container');
        this.chatInput = document.getElementById('chat-input');
        this.sendBtn = document.getElementById('chat-send-btn');
        this.chatClearBtn = document.getElementById('chat-clear-btn');
        this.messagesContainer = document.getElementById('chat-messages');
        this.previewEl = document.getElementById('agent-data-preview');
        this.previewWrapper = document.getElementById('agent-preview-wrapper');
        this.previewHeaderBar = document.getElementById('agent-preview-header-bar');
        this.togglePreviewBtn = document.getElementById('agent-toggle-preview-btn');
        this.toggleIcon = document.getElementById('agent-toggle-icon');
        this.toggleLabel = document.getElementById('agent-toggle-label');
        this.dataCountBadge = document.getElementById('agent-data-count-badge');
        this.errorMessage = '';
        this.skillsBtn = document.getElementById('agent-skills-btn');
        this.skillsLabel = document.getElementById('agent-skills-label');
        this.skillsModal = document.getElementById('agent-skills-modal');
        this.skillsList = document.getElementById('agent-skills-list');
        this.skillsConfirmBtn = document.getElementById('confirm-agent-skills-btn');
        this.skillsCancelBtn = document.getElementById('cancel-agent-skills-btn');
        this.allSkills = [];
    }

    init() {
        this.bindEvents();
        this.initPreviewCollapseState();
        this.renderStoredMessages();
        this.checkAvailability();
        this.initSkills();
    }

    async initSkills() {
        this.allSkills = await fetchAgentSkills();
        this.updateSkillsLabel();
    }

    updateSkillsLabel() {
        if (!this.skillsLabel || !this.allSkills.length) return;
        const active = getActiveSkills(this.allSkills);
        this.skillsLabel.textContent = `Skills (${active.length}/${this.allSkills.length})`;
    }

    openSkillsModal() {
        if (!this.skillsModal || !this.skillsList) return;
        renderSkillsModal(this.skillsList, this.allSkills, getActiveSkills(this.allSkills));
        this.skillsModal.classList.remove('hidden');
    }

    closeSkillsModal(save) {
        if (!this.skillsModal) return;
        if (save && this.skillsList) {
            const ids = [...this.skillsList.querySelectorAll('input[data-skill-id]:checked')]
                .map(el => el.dataset.skillId);
            setActiveSkills(ids);
            this.updateSkillsLabel();
        }
        this.skillsModal.classList.add('hidden');
    }

    async checkAvailability(timeout = 7000) {
        const statusMsg = document.getElementById('agent-status-msg');
        const userModel = (localStorage.getItem('ai_model') || '').trim();
        const apiKey = (localStorage.getItem('ai_api_key') || '').trim();
        const baseUrl = (localStorage.getItem('ai_base_url') || '').trim();

        if (statusMsg) {
            statusMsg.classList.remove('agent-error-state');
            statusMsg.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-primary-icon"></i> Checking API key and agent connection...`;
        }

        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);
            const resp = await fetch('/validate_key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api_key: apiKey || undefined,
                    base_url: baseUrl || undefined,
                    model: userModel || undefined
                }),
                signal: controller.signal
            });
            clearTimeout(id);

            if (!resp.ok) {
                this.agentAvailable = false;
                this.errorMessage = `Server returned error (${resp.status})`;
            } else {
                const data = await resp.json();
                this.agentAvailable = Boolean(data.valid);
                this.activeModel = data.model || userModel || 'LLM Agent';
                this.errorMessage = data.error || '';
                this.usesServerKey = Boolean(data.uses_server_key);
            }
        } catch (e) {
            this.agentAvailable = false;
            this.errorMessage = e.name === 'AbortError'
                ? 'API key validation timed out'
                : (e.message || 'Cannot reach backend server');
        }

        this.updateUIState();
        return this.agentAvailable;
    }

    openSettingsModal() {
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal) settingsModal.classList.remove('hidden');
    }

    setChatBusy(isBusy) {
        if (this.chatInput) this.chatInput.disabled = isBusy;
        if (this.sendBtn) this.sendBtn.disabled = isBusy;
        if (!isBusy) {
            if (this.chatInput) this.chatInput.focus();
            this.scrollChatToBottom();
        }
    }

    getWelcomeMessageHtml() {
        const keySource = this.usesServerKey ? ' (Server Environment)' : '';
        const modelBadge = this.activeModel ? `Online (${this.activeModel}${keySource})` : 'Online';
        return `
            <div class="agent-welcome">
                <p>
                    I am your autonomous data science assistant. I can analyze your dataset, write and execute Python code, create custom charts, and generate interactive diagrams:
                </p>
                <ul>
                    <li><b>Statistical Analysis & Insights:</b> Ask questions in plain language (e.g. summary stats, correlation matrices, distributions, or anomalies).</li>
                    <li><b>Automated Charts & Plots:</b> Request custom Python charts (Matplotlib / Seaborn scatter plots, bar charts, box plots, histograms).</li>
                    <li><b>Diagrams & Flows:</b> Generate interactive Mermaid diagrams (flowcharts, sequence flows, ER models, and architecture).</li>
                    <li><b>Data Transformations:</b> Filter, sort, or reshape tabular data for downstream workbench views.</li>
                </ul>
            </div>
        `;
    }

    updateUIState() {
        const statusMsg = document.getElementById('agent-status-msg');
        if (!statusMsg) return;
        this.setChatBusy(false);

        if (!this.agentAvailable) {
            const err = this.errorMessage || 'No valid API key configured or provider unreachable.';
            statusMsg.classList.add('agent-error-state');
            statusMsg.innerHTML = `<b>Agent Error:</b> ${err} <a href="#" id="agent-open-settings-link" class="agent-settings-link">Open Settings</a>`;
            const link = document.getElementById('agent-open-settings-link');
            if (link) {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.openSettingsModal();
                });
            }
        } else {
            statusMsg.classList.remove('agent-error-state');
            statusMsg.innerHTML = this.getWelcomeMessageHtml();
        }
    }

    renderPreviewTable(data) {
        if (!this.previewEl) return;
        if (!data || data.length === 0) {
            this.previewEl.innerHTML = '<p class="agent-empty-hint">No data returned.</p>';
            if (this.dataCountBadge) this.dataCountBadge.textContent = '0 rows';
            return;
        }
        const keys = Object.keys(data[0]);
        if (this.dataCountBadge) {
            this.dataCountBadge.textContent = `${data.length} preview row${data.length === 1 ? '' : 's'} (${keys.length} cols)`;
        }
        let html = '<table class="agent-table"><thead><tr>';
        keys.forEach(k => html += `<th>${k}</th>`);
        html += '</tr></thead><tbody>';
        data.forEach(row => {
            html += '<tr>' + keys.map(k => `<td>${row[k] !== null && row[k] !== undefined ? row[k] : ''}</td>`).join('') + '</tr>';
        });
        html += '</tbody></table>';
        this.previewEl.innerHTML = html;
    }

    resetPreview() {
        if (this.previewEl) {
            this.previewEl.innerHTML = '<p style="color: #64748b; font-style: italic; font-size: 0.8rem; margin: 0.5rem 0;">Dataframe state will appear here...</p>';
        }
        if (this.dataCountBadge) {
            this.dataCountBadge.textContent = '0 rows';
        }
    }

    setPreviewCollapsed(collapsed) {
        if (!this.previewWrapper) return;
        if (collapsed) {
            this.previewWrapper.classList.add('collapsed');
            if (this.toggleIcon) this.toggleIcon.className = 'fa-solid fa-chevron-up';
            if (this.toggleLabel) this.toggleLabel.textContent = 'Expand';
            if (this.togglePreviewBtn) this.togglePreviewBtn.title = 'Expand Live Data State';
        } else {
            this.previewWrapper.classList.remove('collapsed');
            if (this.toggleIcon) this.toggleIcon.className = 'fa-solid fa-chevron-down';
            if (this.toggleLabel) this.toggleLabel.textContent = 'Collapse';
            if (this.togglePreviewBtn) this.togglePreviewBtn.title = 'Collapse Live Data State';
        }
        try {
            localStorage.setItem('agent_preview_collapsed', collapsed ? 'true' : 'false');
        } catch (e) { }
    }

    togglePreview() {
        if (!this.previewWrapper) return;
        const isCollapsed = this.previewWrapper.classList.contains('collapsed');
        this.setPreviewCollapsed(!isCollapsed);
    }

    initPreviewCollapseState() {
        try {
            const savedState = localStorage.getItem('agent_preview_collapsed');
            this.setPreviewCollapsed(savedState !== 'false');
        } catch (e) {
            this.setPreviewCollapsed(true);
        }
    }

    saveChatHistory(history) {
        try {
            let trimmed = history.slice(-30);
            try {
                localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(trimmed));
            } catch (storageErr) {
                console.warn("Storage quota warning, trimming chat history:", storageErr);
                while (trimmed.length > 5) {
                    trimmed.shift();
                    try {
                        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(trimmed));
                        break;
                    } catch (e) { }
                }
            }
        } catch (err) {
            console.error("Failed to save chat history to browser cache:", err);
        }
    }

    getChatHistory() {
        try {
            const raw = localStorage.getItem(CHAT_STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (err) {
            console.warn("Error reading chat history from localStorage:", err);
            return [];
        }
    }

    renderMarkdownSafe(text) {
        if (!text) return '';
        try {
            if (window.marked && window.DOMPurify) {
                // Protect approximation tildes (e.g. ~32%, ~2.4M) from being parsed as strikethrough del tags
                const sanitizedText = text.replace(/(^|[\s\(\[\{])~([0-9\$\€\£\.\,\+\-])/g, '$1≈$2');
                const parsed = marked.parse(sanitizedText, { breaks: true, gfm: true });
                return DOMPurify.sanitize(parsed);
            }
        } catch (e) {
            console.warn("Markdown parse error, falling back:", e);
        }
        const div = document.createElement('div');
        div.textContent = text;
        return `<p>${div.innerHTML}</p>`;
    }

    scrollChatToBottom(smooth = true) {
        if (!this.messagesContainer) return;
        setTimeout(() => {
            this.messagesContainer.scrollTo({
                top: this.messagesContainer.scrollHeight,
                behavior: smooth ? 'smooth' : 'auto'
            });
        }, 30);
    }

    renderPlotCard(imgDataUrl, index = 1, code = '', cardId = null) {
        const id = cardId || `plot-card-${Date.now()}-${index}`;
        const hasCode = Boolean(code && code.trim());
        return `
        <div class="chat-plot-card" id="${id}">
          <div class="chat-plot-header">
            <span><i class="fa-solid fa-chart-line text-primary-icon"></i>Matplotlib Chart ${index > 1 ? '#' + index : ''}</span>
            <div class="chat-mermaid-actions">
              ${hasCode ? `
              <button class="button icon-button chat-edit-code-btn" id="toggle-code-${id}" data-card-id="${id}" title="View & Edit Python Code">
                <i class="fa-solid fa-code"></i> Edit Code
              </button>` : ''}
              <a href="${imgDataUrl}" download="plot-${Date.now()}.png" class="button icon-button chat-save-btn" title="Download PNG">
                <i class="fa-solid fa-download"></i> Save
              </a>
            </div>
          </div>
          <div class="chat-plot-body">
            <img src="${imgDataUrl}" id="img-${id}" class="chat-plot-img" alt="Matplotlib generated chart" onclick="window.open(this.src, '_blank')" title="Click to view full image in new tab">
          </div>
          ${hasCode ? `
          <div class="chat-plot-code-tray" id="tray-${id}" style="display: none;">
            <div class="chat-plot-code-tray-header">
              <span class="chat-plot-code-badge"><i class="fa-brands fa-python"></i> Python Sandbox</span>
              <button class="button icon-button" id="copy-code-${id}" title="Copy Code"><i class="fa-regular fa-copy"></i> Copy</button>
            </div>
            <textarea class="chat-plot-code-editor" id="editor-${id}" spellcheck="false">${escapeHtml(code)}</textarea>
            <div class="chat-plot-code-feedback" id="feedback-${id}" style="display: none;"></div>
            <div class="chat-plot-code-toolbar">
              <span class="chat-plot-code-hint"><kbd>⌘</kbd>+<kbd>Enter</kbd> to run</span>
              <div class="chat-plot-code-actions">
                <button class="button button-primary chat-plot-run-btn" id="run-${id}">
                  <i class="fa-solid fa-play"></i> Run Code
                </button>
              </div>
            </div>
          </div>` : ''}
        </div>`;
    }

    extractCodeBlocksFromLogs(logs) {
        if (!Array.isArray(logs)) return [];
        const blocks = [];
        for (const log of logs) {
            if (typeof log === 'string' && log.includes("execute_python_code")) {
                const match = log.match(/execute_python_code\(([\s\S]*?)\)/);
                if (match) {
                    try {
                        const parsed = JSON.parse(match[1]);
                        const code = parsed.code || parsed.script || parsed.python_code;
                        if (code) blocks.push(code);
                    } catch (e) { }
                }
            }
        }
        return blocks;
    }

    setupPlotCard(cardId, messageTimestamp, plotIndex) {
        const toggleBtn = document.getElementById(`toggle-code-${cardId}`);
        const tray = document.getElementById(`tray-${cardId}`);
        const editor = document.getElementById(`editor-${cardId}`);
        const runBtn = document.getElementById(`run-${cardId}`);
        const copyBtn = document.getElementById(`copy-code-${cardId}`);
        const feedbackEl = document.getElementById(`feedback-${cardId}`);
        const imgEl = document.getElementById(`img-${cardId}`);

        if (!tray || !editor || !runBtn) return;

        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const isOpen = tray.style.display !== 'none';
                tray.style.display = isOpen ? 'none' : 'flex';
                toggleBtn.classList.toggle('active', !isOpen);
                if (!isOpen) {
                    editor.focus();
                }
            });
        }

        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(editor.value).then(() => {
                    copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
                    setTimeout(() => { copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy'; }, 2000);
                });
            });
        }

        editor.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = editor.selectionStart;
                const end = editor.selectionEnd;
                editor.value = editor.value.substring(0, start) + "    " + editor.value.substring(end);
                editor.selectionStart = editor.selectionEnd = start + 4;
            } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                runBtn.click();
            }
        });

        runBtn.addEventListener('click', async () => {
            const currentCode = editor.value.trim();
            if (!currentCode) return;

            const originalBtnHtml = runBtn.innerHTML;
            runBtn.disabled = true;
            runBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Running...';
            if (feedbackEl) {
                feedbackEl.style.display = 'none';
                feedbackEl.className = 'chat-plot-code-feedback';
                feedbackEl.innerHTML = '';
            }

            try {
                const data = (this.getData && this.getData()) || [];
                const resp = await fetch('/execute_code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        code: currentCode,
                        data: data.slice(0, 1000)
                    })
                });

                if (!resp.ok) {
                    const errData = await resp.json().catch(() => ({}));
                    throw new Error(errData.detail || `Server returned ${resp.status}`);
                }

                const result = await resp.json();
                const isError = Boolean(result.error || (result.output && (result.output.includes("Execution error:") || result.output.startsWith("Error:"))));
                const hasImages = Array.isArray(result.images) && result.images.length > 0;

                if (isError || !hasImages) {
                    const errText = result.error || result.output || 'No chart was produced by the code.';
                    feedbackEl.className = 'chat-plot-code-feedback error';
                    feedbackEl.style.display = 'block';
                    feedbackEl.innerHTML = `
                        <div class="chat-plot-code-error-box">
                          <div class="chat-plot-code-error-msg"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(errText)}</div>
                          <button class="chat-plot-ask-fix-btn" id="ask-fix-${cardId}">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> Ask Agent to Fix
                          </button>
                        </div>
                    `;
                    const fixBtn = document.getElementById(`ask-fix-${cardId}`);
                    if (fixBtn) {
                        fixBtn.addEventListener('click', () => {
                            this.askAgentToFix(currentCode, errText);
                        });
                    }
                } else {
                    const newImgUrl = result.images[0];
                    if (imgEl) {
                        imgEl.src = newImgUrl;
                    }
                    const downloadBtn = document.querySelector(`#${cardId} .chat-save-btn`);
                    if (downloadBtn) {
                        downloadBtn.href = newImgUrl;
                    }

                    const lintNotes = (result.output && result.output.includes("LINT [")) ? result.output : null;
                    if (lintNotes) {
                        feedbackEl.className = 'chat-plot-code-feedback warning';
                        feedbackEl.style.display = 'block';
                        feedbackEl.innerHTML = `<div><i class="fa-solid fa-triangle-exclamation"></i> <b>Chart updated with linter notices:</b><pre class="chat-plot-code-error-msg">${escapeHtml(lintNotes)}</pre></div>`;
                    } else {
                        feedbackEl.className = 'chat-plot-code-feedback success';
                        feedbackEl.style.display = 'block';
                        feedbackEl.innerHTML = `<span><i class="fa-solid fa-check"></i> Chart updated successfully.</span>`;
                        setTimeout(() => {
                            if (feedbackEl.classList.contains('success')) {
                                feedbackEl.style.display = 'none';
                            }
                        }, 3000);
                    }

                    this.updatePlotInHistory(messageTimestamp, plotIndex, currentCode, newImgUrl);
                }
            } catch (err) {
                feedbackEl.className = 'chat-plot-code-feedback error';
                feedbackEl.style.display = 'block';
                feedbackEl.innerHTML = `
                    <div class="chat-plot-code-error-box">
                      <div class="chat-plot-code-error-msg"><i class="fa-solid fa-triangle-exclamation"></i> Execution failed: ${escapeHtml(err.message || String(err))}</div>
                      <button class="chat-plot-ask-fix-btn" id="ask-fix-${cardId}">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> Ask Agent to Fix
                      </button>
                    </div>
                `;
                const fixBtn = document.getElementById(`ask-fix-${cardId}`);
                if (fixBtn) {
                    fixBtn.addEventListener('click', () => {
                        this.askAgentToFix(currentCode, err.message || String(err));
                    });
                }
            } finally {
                runBtn.disabled = false;
                runBtn.innerHTML = originalBtnHtml;
            }
        });
    }

    askAgentToFix(code, errorMsg) {
        const query = `Please fix this Python chart code which produced an error:\n\n\`\`\`python\n${code}\n\`\`\`\n\nError:\n${errorMsg}`;
        if (this.chatInput) {
            this.chatInput.value = query;
            this.handleSend();
        }
    }

    updatePlotInHistory(messageTimestamp, plotIndex, code, newImageUrl) {
        if (!messageTimestamp) return;
        try {
            const history = this.getChatHistory();
            const msg = history.find(m => m.timestamp === messageTimestamp);
            if (msg) {
                if (Array.isArray(msg.images) && msg.images[plotIndex] !== undefined) {
                    msg.images[plotIndex] = newImageUrl;
                }
                if (!Array.isArray(msg.codeBlocks)) {
                    msg.codeBlocks = [];
                }
                msg.codeBlocks[plotIndex] = code;
                this.saveChatHistory(history);
            }
        } catch (e) {
            console.warn("Failed to update plot in localStorage:", e);
        }
    }

    renderToolLogs(logs) {
        if (!Array.isArray(logs) || logs.length === 0) return '';
        const logItems = logs.map(l =>
            `<div class="chat-tool-log-item">${l}</div>`
        ).join('');
        return `<details class="chat-tool-logs-details"><summary class="chat-tool-logs-summary">View Tool Execution Steps (${logs.length})</summary>${logItems}</details>`;
    }

    renderMermaidCard(chartId) {
        return `
        <div class="chat-mermaid-card">
          <div class="chat-mermaid-header">
            <span><i class="fa-solid fa-code-fork chat-mermaid-title-icon"></i>Mermaid Diagram</span>
            <div class="chat-mermaid-actions">
              <button class="button icon-button" id="copy-${chartId}" title="Copy Mermaid Syntax"><i class="fa-regular fa-copy"></i> Copy</button>
              <button class="button icon-button" id="open-${chartId}" title="Open in Mermaid Workbench"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open</button>
            </div>
          </div>
          <div class="chat-mermaid-body" id="${chartId}">
            <div class="chat-rendering-notice">Rendering diagram...</div>
          </div>
        </div>`;
    }

    renderVegaCard(chartId) {
        return `
        <div class="chat-mermaid-card chat-vega-card">
          <div class="chat-mermaid-header chat-vega-header">
            <span><i class="fa-solid fa-chart-line chat-mermaid-title-icon"></i>Vega Chart</span>
            <div class="chat-mermaid-actions chat-vega-actions">
              <button class="button icon-button" id="copy-${chartId}" title="Copy Vega-Lite JSON"><i class="fa-regular fa-copy"></i> Copy</button>
              <button class="button icon-button" id="open-${chartId}" title="Open in Vega Studio"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open</button>
            </div>
          </div>
          <div class="chat-mermaid-body chat-vega-body" id="${chartId}">
            <div class="chat-rendering-notice">Rendering chart...</div>
          </div>
        </div>`;
    }

    initMermaidDiagram(chartId, code) {
        if (!code || !window.mermaid) return;
        setTimeout(async () => {
            const targetEl = document.getElementById(chartId);
            if (targetEl) {
                try {
                    const { svg } = await mermaid.render(`svg-${chartId}`, code);
                    targetEl.innerHTML = svg;
                } catch (e) {
                    console.warn("Mermaid render error:", e);
                    targetEl.innerHTML = `<div class="chat-diagram-render-error">Diagram rendering error: ${e.message || String(e)}</div>`;
                }
            }
            this.setupMermaidButtons(chartId, code);
            this.scrollChatToBottom();
        }, 50);
    }

    initVegaDiagram(chartId, specString) {
        if (!specString || !window.vegaEmbed) return;
        setTimeout(async () => {
            const targetEl = document.getElementById(chartId);
            if (targetEl) {
                try {
                    let spec = typeof specString === 'string' ? JSON.parse(specString) : specString;
                    if (!spec.data || !spec.data.values || spec.data.values.length === 0) {
                        spec = JSON.parse(JSON.stringify(spec));
                        spec.data = { values: this.getData() || [] };
                    }
                    targetEl.innerHTML = '';
                    await window.vegaEmbed(targetEl, spec, { actions: false, renderer: 'svg', mode: 'vega-lite' });
                } catch (e) {
                    console.warn("Vega render error:", e);
                    targetEl.innerHTML = `<div class="chat-diagram-render-error">Vega rendering error: ${e.message || String(e)}</div>`;
                }
            }
            this.setupVegaButtons(chartId, specString);
            this.scrollChatToBottom();
        }, 50);
    }

    setupVegaButtons(chartId, specString) {
        const copyBtn = document.getElementById(`copy-${chartId}`);
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(specString).then(() => {
                    copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
                    setTimeout(() => { copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy'; }, 2000);
                });
            });
        }

        const openBtn = document.getElementById(`open-${chartId}`);
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                this.onOpenVega(specString);
            });
        }
    }

    renderAgentMessageContent({ content, images = [], codeBlocks = [], plots = [], mermaidCode = null, chartId = null, vegaSpec = null, vegaId = null, logs = [] }) {
        let finalPlots = plots;
        if ((!finalPlots || finalPlots.length === 0) && Array.isArray(images) && images.length > 0) {
            finalPlots = images.map((img, idx) => ({
                id: `plot-${Date.now()}-${idx}`,
                image: img,
                code: (codeBlocks && codeBlocks[idx]) || ''
            }));
        }
        const plotsHtml = (finalPlots || []).map((p, idx) => this.renderPlotCard(p.image, idx + 1, p.code, p.id)).join('');
        const mermaidHtml = (mermaidCode && chartId) ? this.renderMermaidCard(chartId) : '';
        const vegaHtml = (vegaSpec && vegaId) ? this.renderVegaCard(vegaId) : '';
        const logsHtml = this.renderToolLogs(logs);

        return `
            <div class="markdown-content">${this.renderMarkdownSafe(content)}</div>
            ${plotsHtml}
            ${mermaidHtml}
            ${vegaHtml}
            ${logsHtml}
        `;
    }

    renderStoredMessages() {
        const history = this.getChatHistory();
        if (!history || history.length === 0) return;

        const statusMsg = document.getElementById('agent-status-msg');
        if (statusMsg) statusMsg.remove();

        history.forEach(item => {
            if (item.role === 'user') {
                const uMsg = document.createElement('div');
                uMsg.className = 'message user';
                uMsg.textContent = item.content;
                this.messagesContainer.appendChild(uMsg);
            } else if (item.role === 'agent') {
                const aMsg = document.createElement('div');
                aMsg.className = 'message agent';
                const chartId = item.mermaidId || (item.mermaidCode ? `hist-mermaid-${Date.now()}-${Math.floor(Math.random() * 1000)}` : null);
                const vegaId = item.vegaId || (item.vegaSpec ? `hist-vega-${Date.now()}-${Math.floor(Math.random() * 1000)}` : null);
                
                let codeBlocks = item.codeBlocks;
                if ((!codeBlocks || codeBlocks.length === 0) && item.logs) {
                    codeBlocks = this.extractCodeBlocksFromLogs(item.logs);
                }

                const itemPlots = (item.images || []).map((img, idx) => ({
                    id: `hist-plot-${item.timestamp || Date.now()}-${idx}`,
                    image: img,
                    code: (codeBlocks && codeBlocks[idx]) || ''
                }));

                aMsg.innerHTML = this.renderAgentMessageContent({
                    content: item.content,
                    plots: itemPlots,
                    mermaidCode: item.mermaidCode,
                    chartId: chartId,
                    vegaSpec: item.vegaSpec,
                    vegaId: vegaId,
                    logs: item.logs
                });
                this.messagesContainer.appendChild(aMsg);

                if (item.mermaidCode && chartId) {
                    this.initMermaidDiagram(chartId, item.mermaidCode);
                }
                if (item.vegaSpec && vegaId) {
                    this.initVegaDiagram(vegaId, item.vegaSpec);
                }

                itemPlots.forEach((p, idx) => {
                    this.setupPlotCard(p.id, item.timestamp, idx);
                });
            }
        });
        this.scrollChatToBottom(false);
    }

    setupMermaidButtons(chartId, code) {
        const copyBtn = document.getElementById(`copy-${chartId}`);
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(code).then(() => {
                    copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
                    setTimeout(() => { copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy'; }, 2000);
                });
            });
        }

        const openBtn = document.getElementById(`open-${chartId}`);
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                this.onOpenMermaid(code);
            });
        }
    }

    async handleSend() {
        const text = this.chatInput?.value?.trim();
        if (!text || this.chatInput.disabled) return;

        const data = this.getData() || [];

        // User Message Element
        const userMsg = document.createElement('div');
        userMsg.className = 'message user';
        userMsg.textContent = text;
        this.messagesContainer.appendChild(userMsg);

        // Agent Placeholder Element
        const agentMsg = document.createElement('div');
        agentMsg.className = 'message agent';
        agentMsg.innerHTML = '<div class="chat-analyzing-indicator"><i class="fa-solid fa-spinner fa-spin text-primary-icon"></i><span>Analyzing data and executing tools...</span></div>';
        this.messagesContainer.appendChild(agentMsg);
        this.scrollChatToBottom();

        this.chatInput.value = '';
        this.setChatBusy(true);

        const history = this.getChatHistory();
        history.push({ role: 'user', content: text, timestamp: Date.now() });
        this.saveChatHistory(history);

        if (!data || data.length === 0) {
            agentMsg.innerHTML = '<div class="markdown-content"><p>Please upload a CSV or generate demo data first so I can analyze it!</p></div>';
            this.setChatBusy(false);
            return;
        }

        const apiKey = localStorage.getItem('ai_api_key') || undefined;
        const baseUrl = localStorage.getItem('ai_base_url') || undefined;
        const model = localStorage.getItem('ai_model') || undefined;

        // Client-side quick response check & SQL execution via DuckDB-Wasm
        const lowerText = text.toLowerCase().trim();
        let clientAnswer = null;
        let clientLog = null;

        if (/^select\s+/i.test(lowerText) && window.duckdbEngine && window.duckdbEngine.isReady()) {
            try {
                const rows = await window.duckdbEngine.queryRows(text.trim(), 25);
                if (rows && rows.length > 0) {
                    clientAnswer = `### SQL Query Result (${rows.length} rows via DuckDB-Wasm)\n\`\`\`json\n${JSON.stringify(rows, null, 2)}\n\`\`\``;
                    clientLog = `DuckDB-Wasm Engine: ${text.trim()}`;
                } else {
                    clientAnswer = `### SQL Query Executed (DuckDB-Wasm)\n0 rows returned.`;
                    clientLog = `DuckDB-Wasm Engine: ${text.trim()}`;
                }
            } catch (sqlErr) {
                clientAnswer = `**SQL Execution Error:** ${sqlErr.message}`;
                clientLog = `DuckDB-Wasm Error: ${sqlErr.message}`;
            }
        } else if (/^(columns|list columns|what are the columns|show columns)\??$/i.test(lowerText)) {
            clientAnswer = ClientDataTools.listColumns(data);
            clientLog = `Client-Side Tool: listColumns() -> ${clientAnswer}`;
        } else if (/^(info|dataset info|get info|describe dataset|shape)\??$/i.test(lowerText)) {
            clientAnswer = `\`\`\`text\n${ClientDataTools.getInfo(data)}\n\`\`\``;
            clientLog = `Client-Side Tool: getInfo()`;
        }

        if (clientAnswer) {
            agentMsg.innerHTML = this.renderAgentMessageContent({
                content: clientAnswer,
                logs: [clientLog]
            });
            const updatedHistory = this.getChatHistory();
            updatedHistory.push({
                role: 'agent',
                content: clientAnswer,
                logs: [clientLog],
                timestamp: Date.now()
            });
            this.saveChatHistory(updatedHistory);
            this.setChatBusy(false);
            return;
        }

        const isLocal = baseUrl && (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1'));
        if (!apiKey && !isLocal && !this.agentAvailable && !this.usesServerKey) {
            agentMsg.innerHTML = '<div class="markdown-content"><p><b>No API Key configured.</b> Please open <a href="#" id="agent-chat-settings-link" class="agent-settings-link">Settings (⚙️)</a> and enter your API key to use the AI Agent.</p></div>';
            const link = document.getElementById('agent-chat-settings-link');
            if (link) {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.openSettingsModal();
                });
            }
            this.setChatBusy(false);
            return;
        }

        try {
            const hasDuckDB = window.duckdbEngine && window.duckdbEngine.isReady();
            const totalRowCount = hasDuckDB ? await window.duckdbEngine.getRowCount() : data.length;
            const datasetProfile = hasDuckDB ? await window.duckdbEngine.summarizeDataset() : null;
            const previewData = data.slice(0, 50);

            let chatPayload = {
                message: text,
                data: previewData,
                row_count: totalRowCount,
                dataset_profile: datasetProfile,
                api_key: apiKey || undefined,
                base_url: baseUrl || undefined,
                model: model || undefined,
                active_skills: this.allSkills.length ? getActiveSkills(this.allSkills) : undefined
            };

            let result = null;
            let currentLogs = [];

            while (true) {
                const response = await fetch('/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(chatPayload)
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    const errDetail = errData.detail || 'Agent service returned an error';
                    if (response.status === 400 && errDetail.includes("No API Key")) {
                        agentMsg.innerHTML = '<div class="markdown-content"><p><b>No API Key configured.</b> Please open <a href="#" id="agent-chat-settings-link" class="agent-settings-link">Settings (⚙️)</a> and enter your API key to use the AI Agent.</p></div>';
                        const link = document.getElementById('agent-chat-settings-link');
                        if (link) {
                            link.addEventListener('click', (e) => {
                                e.preventDefault();
                                this.openSettingsModal();
                            });
                        }
                        this.setChatBusy(false);
                        return;
                    }
                    throw new Error(errDetail);
                }

                result = await response.json();
                if (result.logs && result.logs.length > 0) {
                    currentLogs = currentLogs.concat(result.logs);
                }

                if (result.status === 'requires_action' && result.tool_calls && result.tool_calls.length > 0) {
                    const toolNames = result.tool_calls.map(t => t.name).join(', ');
                    agentMsg.innerHTML = `<div class="chat-analyzing-indicator"><i class="fa-solid fa-bolt text-primary-icon"></i><span>Executing in-browser analytical query (${toolNames}) via DuckDB-Wasm...</span></div>`;
                    this.scrollChatToBottom();

                    const toolResults = [];
                    for (const tc of result.tool_calls) {
                        const callName = tc.name;
                        const callArgs = tc.arguments || {};
                        let outputStr = '';
                        try {
                            if (window.duckdbEngine && window.duckdbEngine.isReady()) {
                                if (callName === 'execute_sql') {
                                    const query = callArgs.query || callArgs.sql || '';
                                    outputStr = await window.duckdbEngine.executeSQL(query);
                                } else if (callName === 'audit_dataset') {
                                    outputStr = await window.duckdbEngine.auditDataset();
                                } else if (callName === 'summarize_dataset') {
                                    outputStr = await window.duckdbEngine.summarizeDataset();
                                } else if (callName === 'get_statistics') {
                                    const stats = await window.duckdbEngine.getStatistics(callArgs.columns || (callArgs.column ? [callArgs.column] : null));
                                    outputStr = JSON.stringify(stats, null, 2);
                                } else if (callName === 'calculate_correlation') {
                                    const corr = await window.duckdbEngine.calculateCorrelation(callArgs.col_a, callArgs.col_b);
                                    outputStr = JSON.stringify(corr, null, 2);
                                } else if (callName === 'get_unique_values') {
                                    const col = callArgs.column || (callArgs.columns && callArgs.columns[0]);
                                    if (col) {
                                        const rows = await window.duckdbEngine.queryRows(`SELECT DISTINCT "${col}" FROM dataset WHERE "${col}" IS NOT NULL LIMIT 50;`);
                                        outputStr = JSON.stringify(rows.map(r => r[col]), null, 2);
                                    } else {
                                        outputStr = 'Error: column not specified';
                                    }
                                } else if (callName === 'calculate_sum') {
                                    const col = callArgs.column || (callArgs.columns && callArgs.columns[0]);
                                    const rows = await window.duckdbEngine.queryRows(`SELECT SUM("${col}") AS total FROM dataset;`);
                                    outputStr = JSON.stringify(rows[0] || {}, null, 2);
                                } else if (callName === 'calculate_mean') {
                                    const col = callArgs.column || (callArgs.columns && callArgs.columns[0]);
                                    const rows = await window.duckdbEngine.queryRows(`SELECT AVG("${col}") AS mean FROM dataset;`);
                                    outputStr = JSON.stringify(rows[0] || {}, null, 2);
                                } else if (callName === 'get_group_summary') {
                                    const grp = callArgs.group_col || callArgs.group;
                                    const aggCol = callArgs.agg_col || callArgs.column;
                                    const func = (callArgs.agg_func || 'mean').toUpperCase() === 'MEAN' ? 'AVG' : (callArgs.agg_func || 'sum').toUpperCase();
                                    const rows = await window.duckdbEngine.queryRows(`SELECT "${grp}", ${func}("${aggCol}") AS metric FROM dataset GROUP BY "${grp}" ORDER BY metric DESC LIMIT 25;`);
                                    outputStr = JSON.stringify(rows, null, 2);
                                } else if (callName === 'list_columns') {
                                    const schema = await window.duckdbEngine.getSchema();
                                    outputStr = JSON.stringify(schema.map(c => c.name));
                                } else if (callName === 'get_info') {
                                    const cnt = await window.duckdbEngine.getRowCount();
                                    const schema = await window.duckdbEngine.getSchema();
                                    outputStr = `Table: dataset (${cnt} rows, ${schema.length} columns)\n` + schema.map(c => `${c.name}: ${c.type}`).join('\n');
                                } else {
                                    outputStr = `Executed ${callName} on client.`;
                                }
                            } else {
                                outputStr = 'Error: DuckDB engine not ready on client.';
                            }
                        } catch (execErr) {
                            outputStr = `Client Execution Error: ${execErr.message}`;
                        }

                        toolResults.push({
                            tool_call_id: tc.id,
                            content: outputStr
                        });
                    }

                    chatPayload = {
                        messages: result.messages,
                        tool_results: toolResults,
                        data: previewData,
                        row_count: totalRowCount,
                        dataset_profile: datasetProfile,
                        api_key: apiKey || undefined,
                        base_url: baseUrl || undefined,
                        model: model || undefined,
                        active_skills: this.allSkills.length ? getActiveSkills(this.allSkills) : undefined
                    };
                } else {
                    result.logs = currentLogs;
                    break;
                }
            }
            let rawAnswer = result.answer || '';
            let mermaidCode = null;
            let vegaSpec = null;

            const match = rawAnswer.match(/```mermaid\s*([\s\S]*?)\s*```/i);
            if (match) {
                mermaidCode = match[1].trim();
                rawAnswer = rawAnswer.replace(/```mermaid\s*[\s\S]*?\s*```/i, '').trim();
            } else {
                for (const log of (result.logs || [])) {
                    const logMatch = log.match(/Observation:\s*```mermaid\s*([\s\S]*?)\s*```/i);
                    if (logMatch) {
                        mermaidCode = logMatch[1].trim();
                        break;
                    }
                }
            }

            const vegaMatch = rawAnswer.match(/```(?:vega-lite|vega)\s*([\s\S]*?)\s*```/i);
            if (vegaMatch) {
                vegaSpec = vegaMatch[1].trim();
                rawAnswer = rawAnswer.replace(/```(?:vega-lite|vega)\s*[\s\S]*?\s*```/i, '').trim();
            }

            const images = result.images || [];
            let codeBlocks = result.code_blocks || [];
            if ((!codeBlocks || codeBlocks.length === 0) && result.logs) {
                codeBlocks = this.extractCodeBlocksFromLogs(result.logs);
            }
            const msgTimestamp = Date.now();
            const plots = images.map((img, idx) => ({
                id: `chat-plot-${msgTimestamp}-${idx}`,
                image: img,
                code: codeBlocks[idx] || ''
            }));

            const chartId = mermaidCode ? `chat-mermaid-${msgTimestamp}-${Math.floor(Math.random() * 1000)}` : null;
            const vegaId = vegaSpec ? `chat-vega-${msgTimestamp}-${Math.floor(Math.random() * 1000)}` : null;
            const displayMarkdown = rawAnswer || (images.length > 0 ? 'Here is the chart based on your data analysis:' : (mermaidCode ? 'Here is the diagram based on your data:' : (vegaSpec ? 'Here is the Vega chart based on your data:' : 'Analysis complete.')));

            agentMsg.innerHTML = this.renderAgentMessageContent({
                content: displayMarkdown,
                plots: plots,
                images: images,
                codeBlocks: codeBlocks,
                mermaidCode: mermaidCode,
                chartId: chartId,
                vegaSpec: vegaSpec,
                vegaId: vegaId,
                logs: result.logs || []
            });

            if (mermaidCode && chartId) {
                this.initMermaidDiagram(chartId, mermaidCode);
            }
            if (vegaSpec && vegaId) {
                this.initVegaDiagram(vegaId, vegaSpec);
            }

            plots.forEach((p, idx) => {
                this.setupPlotCard(p.id, msgTimestamp, idx);
            });

            if (result.df_head) this.renderPreviewTable(result.df_head);

            const updatedHistory = this.getChatHistory();
            updatedHistory.push({
                role: 'agent',
                content: displayMarkdown,
                images: images,
                codeBlocks: codeBlocks,
                mermaidCode: mermaidCode,
                mermaidId: chartId,
                vegaSpec: vegaSpec,
                vegaId: vegaId,
                logs: result.logs || [],
                timestamp: msgTimestamp
            });
            this.saveChatHistory(updatedHistory);

        } catch (error) {
            agentMsg.innerHTML = `<div class="chat-message-error"><i class="fa-solid fa-triangle-exclamation"></i><span>Error: ${error.message || String(error)}</span></div>`;
        } finally {
            this.setChatBusy(false);
        }
    }

    bindEvents() {
        if (this.previewHeaderBar) {
            this.previewHeaderBar.addEventListener('click', () => this.togglePreview());
        }

        if (this.togglePreviewBtn) {
            this.togglePreviewBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePreview();
            });
        }

        if (this.chatClearBtn) {
            this.chatClearBtn.addEventListener('click', () => {
                if (confirm("Start a new chat? Your current conversation history will be deleted.")) {
                    localStorage.removeItem(CHAT_STORAGE_KEY);
                    this.messagesContainer.innerHTML = '';
                    const welcome = document.createElement('div');
                    welcome.className = 'message agent';
                    welcome.id = 'agent-status-msg';
                    welcome.innerHTML = this.getWelcomeMessageHtml();
                    this.messagesContainer.appendChild(welcome);
                }
            });
        }

        if (this.sendBtn) this.sendBtn.addEventListener('click', () => this.handleSend());
        if (this.chatInput) this.chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.handleSend(); });

        if (this.skillsBtn) this.skillsBtn.addEventListener('click', () => this.openSkillsModal());
        if (this.skillsConfirmBtn) this.skillsConfirmBtn.addEventListener('click', () => this.closeSkillsModal(true));
        if (this.skillsCancelBtn) this.skillsCancelBtn.addEventListener('click', () => this.closeSkillsModal(false));
        if (this.skillsModal) this.skillsModal.addEventListener('click', (e) => {
            if (e.target === this.skillsModal) this.closeSkillsModal(false);
        });
    }

    exportState() {
        let skills = [];
        if (this.allSkills && this.allSkills.length) {
            skills = getActiveSkills(this.allSkills);
        } else {
            try {
                const raw = localStorage.getItem('agent_active_skills_v1');
                if (raw) skills = JSON.parse(raw);
            } catch (_) {}
        }
        return {
            history: this.getChatHistory(),
            activeSkills: skills
        };
    }

    importState(state) {
        if (!state) return;
        if (Array.isArray(state.history)) {
            this.saveChatHistory(state.history);
            if (this.messagesContainer) {
                this.messagesContainer.innerHTML = '';
                this.renderStoredMessages();
            }
        }
        if (Array.isArray(state.activeSkills)) {
            setActiveSkills(state.activeSkills);
            this.updateSkillsLabel();
        }
    }
}
