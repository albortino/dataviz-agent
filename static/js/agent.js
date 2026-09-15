/**
 * Agent Manager Module
 * Handles AI Data Agent communication, local chat persistence, markdown rendering,
 * chart/diagram integration, preview table updates, and fast-path client analytical tools.
 */

import { ClientDataTools } from './data-transform.js';

export const CHAT_STORAGE_KEY = 'ai_agent_chat_history_v1';

export class AgentManager {
    constructor(options = {}) {
        this.getData = options.getData || (() => []);
        this.onOpenMermaid = options.onOpenMermaid || (() => { });
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
    }

    init() {
        this.bindEvents();
        this.initPreviewCollapseState();
        this.renderStoredMessages();
        this.checkAvailability();
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
                const parsed = marked.parse(text, { breaks: true, gfm: true });
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

    renderPlotCard(imgDataUrl, index = 1) {
        return `
        <div class="chat-plot-card">
          <div class="chat-plot-header">
            <span><i class="fa-solid fa-chart-line text-primary-icon"></i>Matplotlib Chart ${index > 1 ? '#' + index : ''}</span>
            <div class="chat-mermaid-actions">
              <a href="${imgDataUrl}" download="plot-${Date.now()}.png" class="button icon-button chat-save-btn" title="Download PNG">
                <i class="fa-solid fa-download"></i> Save
              </a>
            </div>
          </div>
          <div class="chat-plot-body">
            <img src="${imgDataUrl}" class="chat-plot-img" alt="Matplotlib generated chart" onclick="window.open('${imgDataUrl}', '_blank')" title="Click to view full image in new tab">
          </div>
        </div>`;
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

    renderAgentMessageContent({ content, images = [], mermaidCode = null, chartId = null, logs = [] }) {
        const plotsHtml = (images || []).map((img, idx) => this.renderPlotCard(img, idx + 1)).join('');
        const mermaidHtml = (mermaidCode && chartId) ? this.renderMermaidCard(chartId) : '';
        const logsHtml = this.renderToolLogs(logs);

        return `
            <div class="markdown-content">${this.renderMarkdownSafe(content)}</div>
            ${plotsHtml}
            ${mermaidHtml}
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
                aMsg.innerHTML = this.renderAgentMessageContent({
                    content: item.content,
                    images: item.images,
                    mermaidCode: item.mermaidCode,
                    chartId: chartId,
                    logs: item.logs
                });
                this.messagesContainer.appendChild(aMsg);

                if (item.mermaidCode && chartId) {
                    this.initMermaidDiagram(chartId, item.mermaidCode);
                }
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

        // Client-side quick response check
        const lowerText = text.toLowerCase().trim();
        let clientAnswer = null;
        let clientLog = null;

        if (/^(columns|list columns|what are the columns|show columns)\??$/i.test(lowerText)) {
            clientAnswer = ClientDataTools.listColumns(data);
            clientLog = `Client-Side JS Tool: listColumns() -> ${clientAnswer}`;
        } else if (/^(info|dataset info|get info|describe dataset|shape)\??$/i.test(lowerText)) {
            clientAnswer = `\`\`\`text\n${ClientDataTools.getInfo(data)}\n\`\`\``;
            clientLog = `Client-Side JS Tool: getInfo()`;
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
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    data: data.slice(0, 1000),
                    api_key: apiKey || undefined,
                    base_url: baseUrl || undefined,
                    model: model || undefined
                })
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

            const result = await response.json();
            let rawAnswer = result.answer || '';
            let mermaidCode = null;

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

            const images = result.images || [];
            const chartId = mermaidCode ? `chat-mermaid-${Date.now()}-${Math.floor(Math.random() * 1000)}` : null;
            const displayMarkdown = rawAnswer || (images.length > 0 ? 'Here is the chart based on your data analysis:' : (mermaidCode ? 'Here is the diagram based on your data:' : 'Analysis complete.'));

            agentMsg.innerHTML = this.renderAgentMessageContent({
                content: displayMarkdown,
                images: images,
                mermaidCode: mermaidCode,
                chartId: chartId,
                logs: result.logs || []
            });

            if (mermaidCode && chartId) {
                this.initMermaidDiagram(chartId, mermaidCode);
            }

            if (result.df_head) this.renderPreviewTable(result.df_head);

            const updatedHistory = this.getChatHistory();
            updatedHistory.push({
                role: 'agent',
                content: displayMarkdown,
                images: images,
                mermaidCode: mermaidCode,
                mermaidId: chartId,
                logs: result.logs || [],
                timestamp: Date.now()
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
    }
}
