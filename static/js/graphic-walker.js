/**
 * Graphic-Walker Manager Module
 * Embeds Tableau / Voyager-style automated visual data exploration
 * via @kanaries/graphic-walker with full drag-and-drop shelves,
 * data aggregations, and visual chart building.
 */

export class GraphicWalkerManager {
    constructor(options = {}) {
        this.getData = options.getData || (() => []);
        this.container = document.getElementById('graphic-walker-container');
        this.root = document.getElementById('graphic-walker-root');
        this.loadingEl = document.getElementById('graphic-walker-loading');
        this.embedModule = null;
        this.instance = null;
        this.isLoading = false;
        this.hasRenderedData = false;
        this.lastDataRef = null;
        this.lastDataLength = 0;
    }

    init() {
        // Prepare DOM containers if needed
    }

    /**
     * Dynamically inject a script tag and wait for it to load
     */
    loadScript(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing) {
                if (existing.dataset.loaded === 'true') {
                    return resolve();
                }
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', (err) => reject(err), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = src;
            script.async = false;
            script.onload = () => {
                script.dataset.loaded = 'true';
                resolve();
            };
            script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.head.appendChild(script);
        });
    }

    /**
     * Load the GraphicWalker UMD bundle and dependencies on demand
     */
    async loadModule() {
        // Ensure window.process is polyfilled before loading any UMD scripts
        window.process = window.process || { env: { NODE_ENV: 'production' } };
        if (!window.process.env) window.process.env = { NODE_ENV: 'production' };

        if (window.GraphicWalker && (window.GraphicWalker.embedGraphicWalker || typeof window.GraphicWalker === 'function')) {
            this.embedModule = window.GraphicWalker.embedGraphicWalker || window.GraphicWalker;
            return this.embedModule;
        }
        this.showLoading(true);
        try {
            // Load UMD dependency chain sequentially to avoid jsdelivr +esm link preload 404s and blob worker errors
            await this.loadScript('https://cdn.jsdelivr.net/npm/react@18.2.0/umd/react.production.min.js');
            await this.loadScript('https://cdn.jsdelivr.net/npm/react-dom@18.2.0/umd/react-dom.production.min.js');
            await this.loadScript('https://cdn.jsdelivr.net/npm/react-is@18.2.0/umd/react-is.production.min.js');
            await this.loadScript('https://cdn.jsdelivr.net/npm/styled-components@5.3.11/dist/styled-components.min.js');
            await this.loadScript('https://cdn.jsdelivr.net/npm/@kanaries/graphic-walker@0.4.61/dist/graphic-walker.umd.js');

            const gw = window.GraphicWalker || window.GraphicWalkerReact;
            if (gw) {
                this.embedModule = gw.embedGraphicWalker || (typeof gw === 'function' ? gw : (gw.default && gw.default.embedGraphicWalker));
                if (this.embedModule) {
                    return this.embedModule;
                }
            }
            throw new Error('GraphicWalker global not found after loading UMD scripts');
        } catch (err) {
            console.error('Failed to load Graphic-Walker from CDN:', err);
            this.showError('Failed to load Graphic-Walker visualization library. Please check your internet connection.');
            throw err;
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * Sanitize and normalize tabular records for Graphic-Walker
     */
    sanitizeData(data) {
        if (!data || !Array.isArray(data)) return [];
        return data.map(row => {
            if (!row || typeof row !== 'object') return {};
            const clean = {};
            for (const [k, v] of Object.entries(row)) {
                if (v === null || v === undefined) {
                    clean[k] = null;
                } else if (typeof v === 'number') {
                    clean[k] = isNaN(v) ? null : v;
                } else if (typeof v === 'string') {
                    const trimmed = v.trim();
                    if (trimmed === '') {
                        clean[k] = null;
                    } else if (!isNaN(Number(trimmed)) && !isNaN(parseFloat(trimmed))) {
                        clean[k] = Number(trimmed);
                    } else {
                        clean[k] = v;
                    }
                } else {
                    clean[k] = v;
                }
            }
            return clean;
        });
    }

    /**
     * Infer schema and rawFields directly so Graphic-Walker immediately populates shelves
     */
    inferRawFields(data) {
        if (!data || !Array.isArray(data) || data.length === 0) return [];
        const sampleRow = data[0] || {};
        const keys = Object.keys(sampleRow);

        return keys.map(key => {
            let isNumeric = true;
            let isTemporal = false;
            let nonNullCount = 0;

            for (let i = 0; i < Math.min(data.length, 100); i++) {
                const val = data[i][key];
                if (val === null || val === undefined || val === '') continue;
                nonNullCount++;

                if (typeof val === 'number') {
                    if (isNaN(val)) isNumeric = false;
                } else if (typeof val === 'string') {
                    const trimmed = val.trim();
                    if (!isNaN(Number(trimmed))) {
                        // numeric string
                    } else if (
                        trimmed.length >= 6 &&
                        (trimmed.includes('-') || trimmed.includes('/')) &&
                        !isNaN(Date.parse(trimmed))
                    ) {
                        isTemporal = true;
                        isNumeric = false;
                    } else {
                        isNumeric = false;
                    }
                } else {
                    isNumeric = false;
                }
            }

            if (nonNullCount === 0) {
                isNumeric = false;
            }

            let semanticType = 'nominal';
            let analyticType = 'dimension';
            let dataType = 'string';

            if (isNumeric) {
                semanticType = 'quantitative';
                analyticType = 'measure';
                dataType = 'number';
            } else if (isTemporal) {
                semanticType = 'temporal';
                analyticType = 'dimension';
                dataType = 'datetime';
            }

            return {
                fid: key,
                name: key,
                semanticType: semanticType,
                analyticType: analyticType,
                dataType: dataType
            };
        });
    }

    /**
     * Render or update dataset in GraphicWalker
     */
    async render(forcedData = null) {
        const rawData = forcedData || this.getData();
        if (!rawData || !Array.isArray(rawData) || rawData.length === 0) {
            return;
        }

        // Avoid re-rendering if data reference and length are identical (e.g. repeated tab clicks)
        if (this.hasRenderedData && this.lastDataRef === rawData && this.lastDataLength === rawData.length) {
            return;
        }

        try {
            const embed = await this.loadModule();
            if (!embed || !this.root) return;

            const cleanData = this.sanitizeData(rawData);
            const rawFields = this.inferRawFields(cleanData);

            // Clear previous instance/DOM
            this.root.innerHTML = '';

            // Directly pass clean tabular data and inferred field schemas
            this.instance = embed(this.root, {
                dataSource: cleanData,
                rawFields: rawFields,
                appearance: 'light',
                hideDataSourceConfig: false
            });

            this.hasRenderedData = true;
            this.lastDataRef = rawData;
            this.lastDataLength = rawData.length;
        } catch (err) {
            console.error('Error rendering Graphic-Walker:', err);
        }
    }

    showLoading(show) {
        this.isLoading = show;
        if (this.loadingEl) {
            if (show) {
                this.loadingEl.classList.remove('hidden');
            } else {
                this.loadingEl.classList.add('hidden');
            }
        }
    }

    showError(message) {
        if (this.root) {
            this.root.innerHTML = `
                <div class="gw-error-container">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <h3>Graphic-Walker Error</h3>
                    <p>${message}</p>
                </div>
            `;
        }
    }

    reset() {
        this.hasRenderedData = false;
        this.lastDataRef = null;
        this.lastDataLength = 0;
        this.instance = null;
        if (this.root) {
            this.root.innerHTML = '';
        }
    }
}
