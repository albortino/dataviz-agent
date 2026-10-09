/**
 * LineUp Manager Module
 * Encapsulates LineUp.js initialization, responsive width scaling,
 * side panel adjustment, and lifecycle management.
 */

export class LineUpManager {
    constructor(options = {}) {
        this.getData = options.getData || (() => []);
        this.root = document.getElementById('lineup-root');
        this.container = document.getElementById('lineup-container');
        this.instance = null;
        this.resizeObserver = null;
        this.resizeTimeout = null;
    }

    init() {
        if (!this.root) return;

        // Auto-rescaling on window/container resize
        if (window.ResizeObserver && this.root) {
            this.resizeObserver = new ResizeObserver(() => {
                if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
                this.resizeTimeout = setTimeout(() => {
                    this.adjustColumnWidths();
                }, 100);
            });
            this.resizeObserver.observe(this.root);
        }
    }

    /**
     * Get the active LineUp instance
     */
    getInstance() {
        return this.instance;
    }

    /**
     * Render or re-render LineUp with dataset
     */
    render(data) {
        if (!window.LineUpJS || !this.root) return;
        const dataset = data || this.getData();
        if (!dataset || dataset.length === 0) return;

        this.destroy();
        this.root.innerHTML = '';

        try {
            this.instance = LineUpJS.asLineUp(this.root, dataset);
            requestAnimationFrame(() => this.adjustColumnWidths());
        } catch (err) {
            console.error('Failed to initialize LineUp:', err);
        }
    }

    /**
     * Restore LineUp state from serialized session dump
     */
    restore(dump, data) {
        if (!window.LineUpJS || !this.root) return;
        const dataset = data || this.getData();
        if (!dataset || dataset.length === 0) return;

        this.destroy();
        this.root.innerHTML = '';

        try {
            this.instance = LineUpJS.asLineUp(this.root, dataset);
            if (dump) {
                if (typeof this.instance.restore === 'function') {
                    this.instance.restore(dump);
                } else if (this.instance.data && typeof this.instance.data.restore === 'function') {
                    this.instance.data.restore(dump);
                }
            }
            this.update();
            requestAnimationFrame(() => this.adjustColumnWidths());
        } catch (err) {
            console.error('Failed to restore LineUp with dump:', err);
            this.render(dataset);
        }
    }

    /**
     * Auto-scale column widths so columns fill available space up to side panel
     */
    adjustColumnWidths() {
        if (!this.instance || !this.instance.data || !this.root) return;

        try {
            const ranking = this.instance.data.getFirstRanking ? this.instance.data.getFirstRanking() : null;
            if (!ranking || !ranking.children) return;

            // Find the side panel (config panel) width and position
            const sidePanel = this.root.querySelector('.lu-side-panel') || this.root.querySelector('.lineup-side-panel');
            const sidePanelWidth = (sidePanel && sidePanel.offsetWidth > 0) ? sidePanel.offsetWidth : 280;
            const containerWidth = this.root.clientWidth;

            // Space available for the table body: container width minus the config panel and buffer
            // (128px padding/margin allowance ensures zero horizontal overflow or spurious scrollbars)
            const targetAvailableWidth = containerWidth - sidePanelWidth - 128;

            if (targetAvailableWidth <= 150) return;

            const visibleColumns = ranking.children.filter(col => !col.isHidden || !col.isHidden());
            if (visibleColumns.length === 0) return;

            // Sum fixed columns (rank, selection, aggregate, actions)
            let fixedWidth = 0;
            const resizableCols = [];

            visibleColumns.forEach(col => {
                const colType = col.desc ? col.desc.type : '';
                if (colType === 'rank' || colType === 'selection' || colType === 'aggregate' || colType === 'actions') {
                    fixedWidth += (col.getWidth ? col.getWidth() : 40);
                } else {
                    resizableCols.push(col);
                }
            });

            if (resizableCols.length > 0) {
                // Distribute remaining space evenly across content columns
                const availableForContent = targetAvailableWidth - fixedWidth;
                const calculatedWidth = Math.floor(availableForContent / resizableCols.length);

                // Minimum readable width of 80px and hard maximum cap of 200px
                const clampedWidth = Math.max(80, Math.min(calculatedWidth, 200));

                resizableCols.forEach(col => {
                    if (typeof col.setWidth === 'function') {
                        col.setWidth(clampedWidth);
                    }
                });
            }

            this.update();
        } catch (e) {
            console.debug('LineUp width auto-scale info:', e);
        }
    }

    /**
     * Trigger redraw / layout update
     */
    update() {
        if (this.instance && typeof this.instance.update === 'function') {
            try {
                this.instance.update();
            } catch (e) { }
        }
    }

    /**
     * Safely destroy instance
     */
    destroy() {
        if (this.instance) {
            try {
                this.instance.destroy();
            } catch (e) { }
            this.instance = null;
        }
    }
}
