/**
 * Settings Manager Module
 * Manages Provider Presets, API Base URL, Model Name, and API Key.
 * Dynamically loads presets from the backend /models endpoint (Single Source of Truth).
 */

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
        this.modelNameInput = document.getElementById('ai-model-name');
        this.apiVersionInput = document.getElementById('ai-api-version');
        this.apiKeyInput = document.getElementById('ai-api-key');
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

        if (this.presetSelect) this.presetSelect.value = savedPreset;
        if (this.baseUrlInput) this.baseUrlInput.value = savedBaseUrl;
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
    }

    saveSettings() {
        if (this.presetSelect) localStorage.setItem('ai_preset', this.presetSelect.value);
        if (this.baseUrlInput) localStorage.setItem('ai_base_url', this.baseUrlInput.value.trim());
        if (this.modelNameInput) localStorage.setItem('ai_model', this.modelNameInput.value.trim());
        if (this.apiVersionInput) localStorage.setItem('ai_api_version', this.apiVersionInput.value.trim());
        if (this.apiKeyInput) localStorage.setItem('ai_api_key', this.apiKeyInput.value.trim());

        if (this.settingsModal) this.settingsModal.classList.add('hidden');
        this.onSettingsSaved();
    }

    bindEvents() {
        if (this.presetSelect) {
            this.presetSelect.addEventListener('change', () => {
                const preset = this.presetSelect.value;
                if (this.presets[preset] && preset !== 'custom') {
                    if (this.baseUrlInput) this.baseUrlInput.value = this.presets[preset].baseUrl;
                    if (this.modelNameInput) this.modelNameInput.value = this.presets[preset].model;
                    if (this.apiVersionInput && this.presets[preset].apiVersion) {
                        this.apiVersionInput.value = this.presets[preset].apiVersion;
                    }
                }
            });
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

