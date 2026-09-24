/**
 * Settings Manager Module (Concept 1: Context-Aware Card)
 * Manages Provider Presets, API Base URL, Model Name, API Key, and Execution Routing.
 * Dynamically adapts UI fields according to the selected provider (hiding API Version & Base URL for standard providers).
 */

import { validateBrowserDirectConnection } from './browser-agent.js';

export class SettingsManager {
    constructor(options = {}) {
        this.onSettingsSaved = options.onSettingsSaved || (() => { });
        this.presets = {};
        this.defaultPresetId = 'deepseek-flash';

        this.settingsBtn = document.getElementById('settings-btn');
        this.settingsModal = document.getElementById('settings-modal');
        this.closeSettingsModalBtn = document.getElementById('close-settings-modal-btn');
        this.cancelSettingsModalBtn = document.getElementById('cancel-settings-modal-btn');
        this.saveSettingsBtn = document.getElementById('save-settings-btn');

        this.presetSelect = document.getElementById('ai-preset-select');
        this.baseUrlInput = document.getElementById('ai-base-url');
        this.advBaseUrlInput = document.getElementById('ai-adv-base-url');
        this.advBaseUrlGroup = document.getElementById('ai-adv-base-url-group');
        this.endpointGroup = document.getElementById('ai-endpoint-group');
        this.endpointLabel = document.getElementById('ai-endpoint-label');
        this.endpointHelp = document.getElementById('ai-endpoint-help');

        this.modelNameInput = document.getElementById('ai-model-name');
        this.modelNameLabel = document.getElementById('ai-model-name-label');
        this.apiVersionGroup = document.getElementById('ai-api-version-group');
        this.apiVersionInput = document.getElementById('ai-api-version');
        this.apiKeyInput = document.getElementById('ai-api-key');

        this.routeSwitcher = document.getElementById('ai-route-switcher');
        this.routeHint = document.getElementById('ai-route-hint');

        this.advTrigger = document.getElementById('ai-adv-trigger');
        this.advContent = document.getElementById('ai-adv-content');
        this.advSection = document.getElementById('ai-advanced-section');

        this.testConnectionBtn = document.getElementById('test-connection-btn');
        this.pingStatus = document.getElementById('ai-ping-status');
    }

    async init() {
        await this.fetchPresets();
        this.loadSavedSettings();
        this.bindEvents();
    }

    async fetchPresets() {
        try {
            const resp = await fetch('/models');
            if (resp.ok) {
                const data = await resp.json();
                this.serverSettings = data;
                if (Array.isArray(data.presets)) {
                    this.presets = {};
                    if (this.presetSelect) this.presetSelect.innerHTML = '';

                    data.presets.forEach(p => {
                        const id = p.id || p.model || p.name;
                        this.presets[id] = {
                            id,
                            name: p.name,
                            model: p.model,
                            baseUrl: p.base_url || p.baseUrl,
                            apiVersion: p.api_version || p.apiVersion || ''
                        };
                        if (p.default) this.defaultPresetId = id;

                        if (this.presetSelect) {
                            const opt = document.createElement('option');
                            opt.value = id;
                            opt.textContent = p.name;
                            this.presetSelect.appendChild(opt);
                        }
                    });

                    if (this.presetSelect) {
                        const customOpt = document.createElement('option');
                        customOpt.value = 'custom';
                        customOpt.textContent = 'Custom Configuration';
                        this.presetSelect.appendChild(customOpt);
                    }
                }
            }
        } catch (e) {
            console.warn("Could not fetch model presets from backend:", e);
        }
    }

    setRouteMode(mode, updateStorage = false) {
        if (!this.routeSwitcher) return;
        const serverBtn = this.routeSwitcher.querySelector('[data-mode="server"]');
        const browserBtn = this.routeSwitcher.querySelector('[data-mode="browser"]');

        if (serverBtn) serverBtn.classList.toggle('active', mode === 'server');
        if (browserBtn) browserBtn.classList.toggle('active', mode === 'browser');

        if (this.routeHint) {
            this.routeHint.textContent = mode === 'browser'
                ? 'No external server; limited functionality'
                : 'More functionality; server processes data';
        }

        if (updateStorage) {
            localStorage.setItem('ai_direct_browser', mode === 'browser' ? 'true' : 'false');
        }
    }

    getRouteMode() {
        if (!this.routeSwitcher) {
            return localStorage.getItem('ai_direct_browser') === 'true' ? 'browser' : 'server';
        }
        const activeBtn = this.routeSwitcher.querySelector('.route-segmented-btn.active, .route-pill-opt.active');
        return activeBtn ? activeBtn.dataset.mode : 'server';
    }

    updateContextualFields() {
        const preset = this.presetSelect ? this.presetSelect.value : '';
        const isAzure = preset === 'azure-openai' || preset.includes('azure');
        const isCustom = preset === 'custom';

        // Advanced parameters drawer is available for all configurations
        if (this.advSection) this.advSection.style.display = 'block';

        if (isAzure) {
            if (this.endpointGroup) this.endpointGroup.style.display = 'flex';
            if (this.endpointLabel) this.endpointLabel.textContent = 'Endpoint Hostname';
            if (this.baseUrlInput) this.baseUrlInput.placeholder = 'my-resource.openai.azure.com';
            if (this.modelNameLabel) this.modelNameLabel.textContent = 'Deployment Name';
            if (this.advBaseUrlGroup) this.advBaseUrlGroup.style.display = 'none';
            if (this.apiVersionGroup) this.apiVersionGroup.style.display = 'flex';
        } else if (isCustom) {
            if (this.endpointGroup) this.endpointGroup.style.display = 'flex';
            if (this.endpointLabel) this.endpointLabel.textContent = 'API Base URL';
            if (this.baseUrlInput) this.baseUrlInput.placeholder = 'https://api.openai.com/v1';
            if (this.modelNameLabel) this.modelNameLabel.textContent = 'Model / Deployment Name';
            if (this.advBaseUrlGroup) this.advBaseUrlGroup.style.display = 'none';
            if (this.apiVersionGroup) this.apiVersionGroup.style.display = 'flex';
        } else {
            // Standard presets (DeepSeek, OpenAI, OpenRouter, Claude, Gemini, etc.)
            if (this.endpointGroup) this.endpointGroup.style.display = 'none';
            if (this.modelNameLabel) this.modelNameLabel.textContent = 'Model';
            if (this.advBaseUrlGroup) this.advBaseUrlGroup.style.display = 'flex';
            if (this.apiVersionGroup) this.apiVersionGroup.style.display = 'flex';
            if (this.advBaseUrlInput && this.baseUrlInput) {
                this.advBaseUrlInput.value = this.baseUrlInput.value;
            }
        }
    }

    loadSavedSettings() {
        const savedPreset = localStorage.getItem('ai_preset') || this.defaultPresetId;
        const currentPresetConfig = this.presets[savedPreset];

        const fallbackBaseUrl = (this.serverSettings?.server_settings_valid && this.serverSettings?.default_base_url)
            || (currentPresetConfig ? currentPresetConfig.baseUrl : 'https://api.deepseek.com');
        const fallbackModel = (this.serverSettings?.server_settings_valid && this.serverSettings?.default_model)
            || (currentPresetConfig ? currentPresetConfig.model : 'deepseek-flash');

        const savedBaseUrl = localStorage.getItem('ai_base_url') || fallbackBaseUrl;
        const savedModel = localStorage.getItem('ai_model') || fallbackModel;
        const savedApiVersion = localStorage.getItem('ai_api_version') || (currentPresetConfig ? currentPresetConfig.apiVersion : '') || '2024-10-21';
        const savedApiKey = localStorage.getItem('ai_api_key') || '';
        const savedDirect = localStorage.getItem('ai_direct_browser') === 'true';

        if (this.presetSelect) this.presetSelect.value = savedPreset;
        if (this.baseUrlInput) this.baseUrlInput.value = savedBaseUrl;
        if (this.advBaseUrlInput) this.advBaseUrlInput.value = savedBaseUrl;
        if (this.modelNameInput) this.modelNameInput.value = savedModel;
        if (this.apiVersionInput) this.apiVersionInput.value = savedApiVersion;
        if (this.apiKeyInput) {
            this.apiKeyInput.value = savedApiKey;
            if (this.serverSettings?.has_server_key && !savedApiKey) {
                this.apiKeyInput.placeholder = "(Configured on server)";
            } else {
                this.apiKeyInput.placeholder = "sk-...";
            }
        }

        this.setRouteMode(savedDirect ? 'browser' : 'server');
        this.updateContextualFields();

        if (this.pingStatus) {
            this.pingStatus.style.display = 'none';
            this.pingStatus.className = 'ping-status-bar';
        }
    }

    saveSettings() {
        const preset = this.presetSelect ? this.presetSelect.value : '';
        const isAzure = preset === 'azure-openai' || preset.includes('azure');
        const isCustom = preset === 'custom';

        let targetBaseUrl = this.baseUrlInput ? this.baseUrlInput.value.trim() : '';
        if (!isAzure && !isCustom && this.advBaseUrlInput && this.advBaseUrlInput.value.trim()) {
            targetBaseUrl = this.advBaseUrlInput.value.trim();
        }

        if (this.presetSelect) localStorage.setItem('ai_preset', preset);
        if (targetBaseUrl) localStorage.setItem('ai_base_url', targetBaseUrl);
        if (this.modelNameInput) localStorage.setItem('ai_model', this.modelNameInput.value.trim());
        if (this.apiVersionInput) localStorage.setItem('ai_api_version', this.apiVersionInput.value.trim());
        if (this.apiKeyInput) localStorage.setItem('ai_api_key', this.apiKeyInput.value.trim());

        const routeMode = this.getRouteMode();
        localStorage.setItem('ai_direct_browser', routeMode === 'browser' ? 'true' : 'false');

        if (this.settingsModal) this.settingsModal.classList.add('hidden');
        this.onSettingsSaved();
    }

    async testConnection() {
        if (!this.pingStatus) return;
        this.pingStatus.className = 'ping-status-bar testing';
        this.pingStatus.style.display = 'flex';
        this.pingStatus.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Waiting...</span>';

        const preset = this.presetSelect ? this.presetSelect.value : '';
        const isAzure = preset === 'azure-openai' || preset.includes('azure');
        const isCustom = preset === 'custom';

        let targetBaseUrl = (this.baseUrlInput ? this.baseUrlInput.value : '').trim();
        if (!isAzure && !isCustom && this.advBaseUrlInput && this.advBaseUrlInput.value.trim()) {
            targetBaseUrl = this.advBaseUrlInput.value.trim();
        }

        const apiKey = (this.apiKeyInput ? this.apiKeyInput.value : '').trim();
        const model = (this.modelNameInput ? this.modelNameInput.value : '').trim();
        const apiVersion = (this.apiVersionInput ? this.apiVersionInput.value : '').trim();
        const routeMode = this.getRouteMode();
        const start = performance.now();

        try {
            if (routeMode === 'browser') {
                const res = await validateBrowserDirectConnection({
                    apiKey,
                    baseUrl: targetBaseUrl,
                    model,
                    apiVersion,
                    timeout: 2000
                });
                const latency = Math.round(performance.now() - start);

                if (res.valid) {
                    this.pingStatus.className = 'ping-status-bar success';
                    this.pingStatus.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>Ping: ${latency}ms</span>`;
                } else {
                    this.pingStatus.className = 'ping-status-bar error';
                    this.pingStatus.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> <span>Failed: ${res.error || 'Connection failed'}</span>`;
                }
            } else {
                const controller = new AbortController();
                const timeoutTimer = setTimeout(() => controller.abort(), 2000);

                const resp = await fetch('/validate_key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        api_key: apiKey || undefined,
                        base_url: targetBaseUrl || undefined,
                        model: model || undefined,
                        api_version: apiVersion || undefined
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeoutTimer);

                const latency = Math.round(performance.now() - start);

                if (resp.ok) {
                    const data = await resp.json();
                    if (data.valid) {
                        this.pingStatus.className = 'ping-status-bar success';
                        this.pingStatus.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>Ping: ${latency}ms</span>`;
                    } else {
                        this.pingStatus.className = 'ping-status-bar error';
                        this.pingStatus.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> <span>Failed: ${data.error || 'Validation error'}</span>`;
                    }
                } else {
                    this.pingStatus.className = 'ping-status-bar error';
                    this.pingStatus.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> <span>Failed: Server returned error (${resp.status})</span>`;
                }
            }
        } catch (e) {
            const isTimeout = e.name === 'AbortError';
            this.pingStatus.className = 'ping-status-bar error';
            this.pingStatus.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> <span>Failed: ${isTimeout ? 'Timeout after 2s' : (e.message || 'Network error')}</span>`;
        }
    }

    bindEvents() {
        if (this.presetSelect) {
            this.presetSelect.addEventListener('change', () => {
                const preset = this.presetSelect.value;
                if (this.presets[preset] && preset !== 'custom') {
                    if (this.baseUrlInput) this.baseUrlInput.value = this.presets[preset].baseUrl;
                    if (this.advBaseUrlInput) this.advBaseUrlInput.value = this.presets[preset].baseUrl;
                    if (this.modelNameInput) this.modelNameInput.value = this.presets[preset].model;
                    if (this.apiVersionInput && this.presets[preset].apiVersion) {
                        this.apiVersionInput.value = this.presets[preset].apiVersion;
                    }
                    if (preset === 'azure-openai') {
                        // Azure corporate endpoints default to Direct Browser for VPN compatibility
                        this.setRouteMode('browser', true);
                    }
                }
                this.updateContextualFields();
                if (this.pingStatus) this.pingStatus.style.display = 'none';
            });
        }

        if (this.routeSwitcher) {
            this.routeSwitcher.querySelectorAll('.route-segmented-btn, .route-pill-opt').forEach(btn => {
                btn.addEventListener('click', () => {
                    const mode = btn.dataset.mode;
                    this.setRouteMode(mode, true);
                    if (this.pingStatus) this.pingStatus.style.display = 'none';
                });
            });
        }

        if (this.advTrigger && this.advContent) {
            this.advTrigger.addEventListener('click', () => {
                this.advTrigger.classList.toggle('open');
                this.advContent.classList.toggle('open');
            });
        }

        if (this.testConnectionBtn) {
            this.testConnectionBtn.addEventListener('click', () => this.testConnection());
        }

        if (this.settingsBtn) {
            this.settingsBtn.addEventListener('click', () => {
                this.loadSavedSettings();
                if (this.settingsModal) this.settingsModal.classList.remove('hidden');
            });
        }

        if (this.closeSettingsModalBtn) {
            this.closeSettingsModalBtn.addEventListener('click', () => {
                if (this.settingsModal) this.settingsModal.classList.add('hidden');
            });
        }

        if (this.cancelSettingsModalBtn) {
            this.cancelSettingsModalBtn.addEventListener('click', () => {
                if (this.settingsModal) this.settingsModal.classList.add('hidden');
            });
        }

        if (this.saveSettingsBtn) {
            this.saveSettingsBtn.addEventListener('click', () => this.saveSettings());
        }
    }
}
