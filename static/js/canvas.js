/**
 * Insight Canvas Manager (Phase 2)
 *
 * Implements an infinite 2D storytelling workspace with D3 pan/zoom,
 * drag-and-drop card positioning, isolated visual rendering, and state persistence.
 */

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatTimestamp(ts) {
    if (!ts) return '';
    const date = new Date(ts);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export class CanvasManager {
    constructor({ container, onOpenVega, onOpenMermaid, onOpenSankey } = {}) {
        this.container = container;
        this.world = container ? container.querySelector('#canvas-world') : null;
        this.dock = container ? container.querySelector('#canvas-control-dock') : null;
        this.zoomLevelEl = container ? container.querySelector('#canvas-zoom-level') : null;
        this.cardCountEl = document.getElementById('canvas-card-count');

        this.onOpenVega = onOpenVega;
        this.onOpenMermaid = onOpenMermaid;
        this.onOpenSankey = onOpenSankey;

        this.cards = new Map();
        this.currentScale = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.nextZIndex = 10;
        this.zoomBehavior = null;

        this._toastTimeout = null;
        this._boundPinHandler = (e) => {
            if (e && e.detail) {
                this.addCard(e.detail);
            }
        };

        this.init();
    }

    init() {
        if (typeof window !== 'undefined') {
            window.addEventListener('dataviz:pin-card', this._boundPinHandler);
        }

        this.initD3Zoom();
        this.bindDockControls();
        this.updateCardCountBadge();
    }

    destroy() {
        if (typeof window !== 'undefined') {
            window.removeEventListener('dataviz:pin-card', this._boundPinHandler);
        }
    }

    initD3Zoom() {
        if (!this.container || typeof window === 'undefined' || !window.d3) return;

        const d3 = window.d3;
        this.zoomBehavior = d3.zoom()
            .scaleExtent([0.15, 3.0])
            .filter((event) => {
                // Allow wheel zooming everywhere across canvas container
                if (event.type === 'wheel') return true;
                // Prevent drag-pan when interacting with cards or the control dock
                if (event.target && event.target.closest) {
                    if (event.target.closest('.canvas-card') || event.target.closest('.canvas-floating-dock')) {
                        return false;
                    }
                }
                return !event.button;
            })
            .on('zoom', (event) => {
                const { x, y, k } = event.transform;
                this.panX = x;
                this.panY = y;
                this.currentScale = k;
                this.applyTransform();
            });

        d3.select(this.container).call(this.zoomBehavior);
        // Disable double-click zoom to preserve double-click interactions (like editing notes)
        d3.select(this.container).on('dblclick.zoom', null);
    }

    applyTransform() {
        if (this.world) {
            this.world.style.transform = `translate3d(${this.panX}px, ${this.panY}px, 0) scale(${this.currentScale})`;
        }
        if (this.zoomLevelEl) {
            this.zoomLevelEl.textContent = `${Math.round(this.currentScale * 100)}%`;
        }
    }

    bindDockControls() {
        if (!this.container) return;

        const noteBtn = this.container.querySelector('#canvas-add-note-btn');
        if (noteBtn) {
            noteBtn.addEventListener('click', () => this.addTextNote());
        }

        const arrangeBtn = this.container.querySelector('#canvas-arrange-btn');
        if (arrangeBtn) {
            arrangeBtn.addEventListener('click', () => this.tidyGrid());
        }

        const fitBtn = this.container.querySelector('#canvas-fit-btn');
        if (fitBtn) {
            fitBtn.addEventListener('click', () => this.fitAll());
        }

        const zoomInBtn = this.container.querySelector('#canvas-zoom-in-btn');
        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', () => this.zoomBy(1.25));
        }

        const zoomOutBtn = this.container.querySelector('#canvas-zoom-out-btn');
        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', () => this.zoomBy(0.8));
        }
    }

    zoomBy(factor) {
        if (this.zoomBehavior && this.container && typeof window !== 'undefined' && window.d3) {
            window.d3.select(this.container)
                .transition()
                .duration(200)
                .call(this.zoomBehavior.scaleBy, factor);
        } else {
            const nextScale = Math.max(0.15, Math.min(3.0, this.currentScale * factor));
            this.currentScale = nextScale;
            this.applyTransform();
        }
    }

    addTextNote() {
        return this.addCard({
            type: 'text',
            title: 'Text',
            payload: {
                content: ''
            },
            source: {
                origin: 'user',
                datasetName: 'Text Note',
                timestamp: Date.now()
            }
        });
    }

    addNoteCard() {
        return this.addTextNote();
    }

    addCard(cardDetail = {}, options = {}) {
        if (!cardDetail) return null;

        const id = cardDetail.id || `card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const type = cardDetail.type || 'markdown';
        const title = cardDetail.title || (type === 'markdown' ? 'Note' : 'Insight Card');
        const width = cardDetail.width || 440;
        const height = cardDetail.height || 320;
        const zIndex = cardDetail.zIndex || ++this.nextZIndex;
        const payload = cardDetail.payload ? JSON.parse(JSON.stringify(cardDetail.payload)) : {};
        const source = {
            origin: cardDetail.source?.origin || 'user',
            datasetName: cardDetail.source?.datasetName || '',
            timestamp: cardDetail.source?.timestamp || Date.now()
        };

        // Determine coordinates: default to visible center if not specified
        let x = cardDetail.x;
        let y = cardDetail.y;
        if (x === undefined || y === undefined) {
            const count = this.cards.size;
            const viewW = this.container?.clientWidth || 800;
            const viewH = this.container?.clientHeight || 600;
            const centerWorldX = (-this.panX + viewW / 2) / this.currentScale - (width / 2);
            const centerWorldY = (-this.panY + viewH / 2) / this.currentScale - (height / 2);
            const stagger = (count % 8) * 28;
            x = Math.round(centerWorldX + stagger);
            y = Math.round(centerWorldY + stagger);
        }

        const card = {
            id,
            type,
            title,
            x,
            y,
            width,
            height,
            zIndex,
            payload,
            source,
            el: null
        };

        const cardEl = this.createCardDOM(card);
        card.el = cardEl;

        if (this.world) {
            this.world.appendChild(cardEl);
        }

        if (card.type !== 'text') {
            this.mountCardBody(card, cardEl.querySelector('.canvas-card-body'));
            this.initCardDrag(cardEl, card);
        }

        this.cards.set(id, card);
        this.updateCardCountBadge();

        if (!options.silent) {
            this.showToast('Pinned to Canvas');
        }

        return card;
    }

    removeCard(cardId) {
        const card = this.cards.get(cardId);
        if (card) {
            if (card.el) {
                card.el.remove();
            }
            this.cards.delete(cardId);
            this.updateCardCountBadge();
        }
    }

    createCardDOM(card) {
        if (card.type === 'text') {
            return this.createTextNoteDOM(card);
        }

        const cardEl = document.createElement('div');
        cardEl.id = card.id;
        cardEl.className = `canvas-card card-${card.type}`;
        cardEl.style.transform = `translate3d(${card.x}px, ${card.y}px, 0)`;
        cardEl.style.zIndex = card.zIndex;
        if (card.width) cardEl.style.width = `${card.width}px`;

        // Bring to front on click
        cardEl.addEventListener('pointerdown', () => {
            card.zIndex = ++this.nextZIndex;
            cardEl.style.zIndex = card.zIndex;
        });

        // Header
        const header = document.createElement('div');
        header.className = 'canvas-card-header';

        const typeLabels = {
            vega: 'Vega-Lite',
            mermaid: 'Mermaid',
            sankey: 'Sankey',
            plot: 'Plot',
            markdown: 'Agent Insight',
            text: 'Text'
        };
        const badgeLabel = typeLabels[card.type] || card.type.toUpperCase();

        const canOpenStudio = ['vega', 'mermaid', 'sankey'].includes(card.type);
        const isFromAgent = card.source?.origin === 'agent' || !!card.source?.chatId;

        header.innerHTML = `
            <i class="fa-solid fa-grip-vertical drag-handle" title="Drag to move card"></i>
            <span class="badge-card badge-${card.type}">${badgeLabel}</span>
            <span class="canvas-card-title" contenteditable="true" spellcheck="false" title="Click to rename">${escapeHtml(card.title)}</span>
            ${isFromAgent ? '<button class="card-action-btn jump-chat-btn" title="Jump to message in chat"><i class="fa-solid fa-comment-dots"></i></button>' : ''}
            ${canOpenStudio ? '<button class="card-action-btn open-studio-btn" title="Open in Studio"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>' : ''}
            <button class="card-action-btn delete-card-btn" title="Delete card"><i class="fa-solid fa-xmark"></i></button>
        `;

        // Title editing
        const titleSpan = header.querySelector('.canvas-card-title');
        if (titleSpan) {
            titleSpan.addEventListener('input', () => {
                card.title = titleSpan.textContent.trim();
            });
            titleSpan.addEventListener('pointerdown', (e) => e.stopPropagation());
            titleSpan.addEventListener('mousedown', (e) => e.stopPropagation());
        }

        // Jump to Chat Button
        if (isFromAgent) {
            const jumpBtn = header.querySelector('.jump-chat-btn');
            if (jumpBtn) {
                jumpBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.jumpToChatMessage(card);
                });
            }
        }

        // Studio Button
        if (canOpenStudio) {
            const studioBtn = header.querySelector('.open-studio-btn');
            if (studioBtn) {
                studioBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.openInStudio(card);
                });
            }
        }

        // Delete Button
        const deleteBtn = header.querySelector('.delete-card-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeCard(card.id);
            });
        }

        cardEl.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.className = 'canvas-card-body';
        cardEl.appendChild(body);

        // Footer
        const footer = document.createElement('div');
        footer.className = 'canvas-card-footer';
        const datasetLabel = card.source?.datasetName || (card.type === 'markdown' ? 'Agent Insight' : 'Dataset');
        const timeLabel = formatTimestamp(card.source?.timestamp);

        footer.innerHTML = `
            <span class="card-provenance" title="${escapeHtml(datasetLabel)}">
                <i class="fa-regular fa-file-lines"></i>
                <span class="provenance-text">${escapeHtml(datasetLabel)}</span>
            </span>
            <span class="card-timestamp">${escapeHtml(timeLabel)}</span>
        `;
        cardEl.appendChild(footer);

        return cardEl;
    }

    createTextNoteDOM(card) {
        const noteEl = document.createElement('div');
        noteEl.id = card.id;
        noteEl.className = 'canvas-text-note';
        noteEl.style.transform = `translate3d(${card.x}px, ${card.y}px, 0)`;
        noteEl.style.zIndex = card.zIndex;

        // Bring to front on pointerdown
        noteEl.addEventListener('pointerdown', () => {
            card.zIndex = ++this.nextZIndex;
            noteEl.style.zIndex = card.zIndex;
        });

        // Hover toolbar with drag handle and delete button
        const hoverBar = document.createElement('div');
        hoverBar.className = 'text-note-hover-bar';
        hoverBar.innerHTML = `
            <i class="fa-solid fa-grip-vertical text-drag-handle" title="Drag to move text"></i>
            <button type="button" class="text-note-delete-btn" title="Delete text"><i class="fa-solid fa-xmark"></i></button>
        `;
        noteEl.appendChild(hoverBar);

        const deleteBtn = hoverBar.querySelector('.text-note-delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeCard(card.id);
            });
        }

        // Content div (rendered markdown)
        const contentDiv = document.createElement('div');
        contentDiv.className = 'text-note-content markdown-content';
        noteEl.appendChild(contentDiv);

        // Textarea editor (inline)
        const textarea = document.createElement('textarea');
        textarea.className = 'text-note-editor hidden';
        textarea.placeholder = 'Type text...';
        textarea.value = card.payload?.content || '';
        noteEl.appendChild(textarea);

        const renderText = () => {
            const raw = (card.payload?.content || '').trim();
            if (!raw) {
                contentDiv.innerHTML = '';
            } else if (typeof window !== 'undefined' && window.marked) {
                const parsed = window.marked.parse(raw);
                contentDiv.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(parsed) : parsed;
            } else {
                contentDiv.textContent = raw;
            }
        };

        const enterEdit = () => {
            textarea.value = card.payload?.content || '';
            contentDiv.classList.add('hidden');
            textarea.classList.remove('hidden');
            noteEl.classList.add('is-editing');
            textarea.focus();
            textarea.style.height = 'auto';
            textarea.style.height = `${Math.max(48, textarea.scrollHeight)}px`;
        };

        const exitEdit = () => {
            if (textarea.classList.contains('hidden')) return;
            card.payload.content = textarea.value;
            renderText();
            textarea.classList.add('hidden');
            contentDiv.classList.remove('hidden');
            noteEl.classList.remove('is-editing');
        };

        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = `${Math.max(48, textarea.scrollHeight)}px`;
        });

        contentDiv.addEventListener('click', enterEdit);
        textarea.addEventListener('blur', exitEdit);
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') exitEdit();
        });

        renderText();
        if (!card.payload?.content && typeof setTimeout !== 'undefined') {
            setTimeout(enterEdit, 20);
        }

        const dragHandle = hoverBar.querySelector('.text-drag-handle');
        this.initCardDrag(noteEl, card, dragHandle);

        return noteEl;
    }

    mountCardBody(card, cardBody) {
        if (!cardBody) return;
        cardBody.innerHTML = '';

        switch (card.type) {
            case 'vega': {
                if (typeof window !== 'undefined' && window.vegaEmbed && card.payload?.spec) {
                    window.vegaEmbed(cardBody, card.payload.spec, {
                        actions: false,
                        renderer: 'svg'
                    }).catch(err => {
                        console.error('Vega mount error in Canvas card:', err);
                        cardBody.innerHTML = `<div class="canvas-card-error"><i class="fa-solid fa-triangle-exclamation"></i> Vega render error</div>`;
                    });
                } else if (card.payload?.spec) {
                    cardBody.innerHTML = `<pre class="canvas-spec-dump">${escapeHtml(JSON.stringify(card.payload.spec, null, 2))}</pre>`;
                }
                break;
            }

            case 'mermaid': {
                if (card.payload?.svgString) {
                    this.mountIsolatedSvg(cardBody, card.payload.svgString);
                } else if (card.payload?.code) {
                    if (typeof window !== 'undefined' && window.mermaid) {
                        const tempId = `mermaid-${card.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
                        window.mermaid.render(tempId, card.payload.code)
                            .then(({ svg }) => {
                                card.payload.svgString = svg;
                                this.mountIsolatedSvg(cardBody, svg);
                            })
                            .catch(() => {
                                cardBody.innerHTML = `<pre class="canvas-code-dump">${escapeHtml(card.payload.code)}</pre>`;
                            });
                    } else {
                        cardBody.innerHTML = `<pre class="canvas-code-dump">${escapeHtml(card.payload.code)}</pre>`;
                    }
                }
                break;
            }

            case 'sankey': {
                if (card.payload?.svgString) {
                    this.mountIsolatedSvg(cardBody, card.payload.svgString);
                } else {
                    cardBody.innerHTML = `<div class="canvas-card-empty">No Sankey SVG content</div>`;
                }
                break;
            }

            case 'plot': {
                const src = card.payload?.dataUrl || card.payload?.imgUrl || card.payload?.src || card.payload?.svgString || '';
                if (src) {
                    const img = document.createElement('img');
                    img.className = 'canvas-plot-img';
                    img.src = src;
                    img.alt = card.title || 'Plot visual';
                    img.loading = 'lazy';
                    cardBody.appendChild(img);
                } else {
                    cardBody.innerHTML = `<div class="canvas-card-empty">No plot image</div>`;
                }
                break;
            }

            case 'markdown':
            default: {
                const contentDiv = document.createElement('div');
                contentDiv.className = 'canvas-markdown-content markdown-content';

                const renderContent = () => {
                    const raw = card.payload?.content || '';
                    if (typeof window !== 'undefined' && window.marked) {
                        const parsed = window.marked.parse(raw);
                        contentDiv.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(parsed) : parsed;
                    } else {
                        contentDiv.textContent = raw;
                    }
                };
                renderContent();
                cardBody.appendChild(contentDiv);

                const textarea = document.createElement('textarea');
                textarea.className = 'canvas-markdown-editor hidden';
                textarea.value = card.payload?.content || '';
                cardBody.appendChild(textarea);

                const enterEdit = () => {
                    textarea.value = card.payload?.content || '';
                    contentDiv.classList.add('hidden');
                    textarea.classList.remove('hidden');
                    textarea.focus();
                };

                const exitEdit = () => {
                    if (textarea.classList.contains('hidden')) return;
                    card.payload.content = textarea.value;
                    renderContent();
                    textarea.classList.add('hidden');
                    contentDiv.classList.remove('hidden');
                };

                contentDiv.addEventListener('dblclick', enterEdit);
                textarea.addEventListener('blur', exitEdit);
                textarea.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') exitEdit();
                });
                break;
            }
        }
    }

    mountIsolatedSvg(cardBody, svgString) {
        if (!cardBody || !svgString) return;

        const cleanSvg = (typeof window !== 'undefined' && window.DOMPurify)
            ? window.DOMPurify.sanitize(svgString, { USE_PROFILES: { svg: true } })
            : svgString;

        if (cardBody.attachShadow) {
            let shadow = cardBody.shadowRoot;
            if (!shadow) {
                shadow = cardBody.attachShadow({ mode: 'open' });
            }
            shadow.innerHTML = `
                <style>
                    :host {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        width: 100%;
                        height: 100%;
                        overflow: auto;
                    }
                    svg {
                        max-width: 100%;
                        max-height: 100%;
                        height: auto;
                        display: block;
                    }
                </style>
                ${cleanSvg}
            `;
        } else {
            cardBody.innerHTML = cleanSvg;
        }
    }

    initCardDrag(cardEl, card, customHandle) {
        if (!cardEl) return;
        const handle = customHandle || cardEl.querySelector('.canvas-card-header') || cardEl;
        if (!handle) return;

        let startClientX = 0;
        let startClientY = 0;
        let startCardX = 0;
        let startCardY = 0;
        let isDragging = false;

        const onPointerDown = (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            if (e.target && e.target.closest) {
                if (e.target.closest('button') || e.target.closest('input') || e.target.closest('textarea') || e.target.closest('[contenteditable="true"]')) {
                    return;
                }
            }

            if (e.stopPropagation) e.stopPropagation();
            isDragging = true;
            if (handle.setPointerCapture && e.pointerId !== undefined) {
                try {
                    handle.setPointerCapture(e.pointerId);
                } catch (_) {}
            }

            startClientX = e.clientX || 0;
            startClientY = e.clientY || 0;
            startCardX = card.x;
            startCardY = card.y;

            card.zIndex = ++this.nextZIndex;
            cardEl.style.zIndex = card.zIndex;
            cardEl.classList.add('is-dragging');
        };

        const onPointerMove = (e) => {
            if (!isDragging) return;
            const scale = this.currentScale || 1.0;
            const deltaX = ((e.clientX || 0) - startClientX) / scale;
            const deltaY = ((e.clientY || 0) - startClientY) / scale;
            card.x = Math.round(startCardX + deltaX);
            card.y = Math.round(startCardY + deltaY);
            cardEl.style.transform = `translate3d(${card.x}px, ${card.y}px, 0)`;
        };

        const onPointerUp = (e) => {
            if (!isDragging) return;
            isDragging = false;
            if (handle.releasePointerCapture && e.pointerId !== undefined) {
                try {
                    handle.releasePointerCapture(e.pointerId);
                } catch (_) {}
            }
            cardEl.classList.remove('is-dragging');
        };

        handle.addEventListener('pointerdown', onPointerDown);
        handle.addEventListener('pointermove', onPointerMove);
        handle.addEventListener('pointerup', onPointerUp);
        handle.addEventListener('pointercancel', onPointerUp);

        // Fallback for mock/test environments
        if (typeof window !== 'undefined' && window.d3) {
            const d3 = window.d3;
            const drag = d3.drag()
                .on('start', () => {
                    cardEl.classList.add('is-dragging');
                    card.zIndex = ++this.nextZIndex;
                    cardEl.style.zIndex = card.zIndex;
                })
                .on('drag', (event) => {
                    const scale = this.currentScale || 1.0;
                    card.x += event.dx / scale;
                    card.y += event.dy / scale;
                    cardEl.style.transform = `translate3d(${card.x}px, ${card.y}px, 0)`;
                })
                .on('end', () => {
                    cardEl.classList.remove('is-dragging');
                });
            d3.select(handle).call(drag);
        }
    }

    jumpToChatMessage(card) {
        if (!card || typeof window === 'undefined') return;
        window.dispatchEvent(new CustomEvent('dataviz:jump-chat', {
            detail: {
                card,
                chatId: card.source?.chatId,
                messageId: card.source?.messageId,
                timestamp: card.source?.timestamp
            }
        }));
    }

    openInStudio(card) {
        if (!card) return;
        if (card.type === 'vega') {
            this.onOpenVega?.(card.payload?.spec, card.id);
        } else if (card.type === 'mermaid') {
            this.onOpenMermaid?.(card.payload?.code || card.payload?.svgString, card.id);
        } else if (card.type === 'sankey') {
            this.onOpenSankey?.(card.payload, card.id);
        }
    }

    tidyGrid() {
        const sorted = Array.from(this.cards.values()).sort((a, b) => {
            const tA = a.source?.timestamp || 0;
            const tB = b.source?.timestamp || 0;
            return tA - tB;
        });

        if (sorted.length === 0) return;

        const colWidth = 460;
        const rowHeight = 360;
        const gapX = 32;
        const gapY = 32;
        const startX = 60;
        const startY = 60;

        sorted.forEach((card, index) => {
            const col = index % 3;
            const row = Math.floor(index / 3);
            card.x = startX + col * (colWidth + gapX);
            card.y = startY + row * (rowHeight + gapY);

            if (card.el) {
                card.el.style.transition = 'transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)';
                card.el.style.transform = `translate3d(${card.x}px, ${card.y}px, 0)`;
                setTimeout(() => {
                    if (card.el) card.el.style.transition = '';
                }, 360);
            }
        });
    }

    fitAll() {
        if (this.cards.size === 0) {
            this.resetViewport();
            return;
        }

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const card of this.cards.values()) {
            const w = card.width || (card.el ? card.el.offsetWidth : 440) || 440;
            const h = card.height || (card.el ? card.el.offsetHeight : 320) || 320;
            minX = Math.min(minX, card.x);
            minY = Math.min(minY, card.y);
            maxX = Math.max(maxX, card.x + w);
            maxY = Math.max(maxY, card.y + h);
        }

        const padding = 40;
        const boundsW = (maxX - minX) + padding * 2;
        const boundsH = (maxY - minY) + padding * 2;
        const viewW = this.container?.clientWidth || 800;
        const viewH = this.container?.clientHeight || 600;

        let scale = Math.min(viewW / boundsW, viewH / boundsH);
        scale = Math.max(0.15, Math.min(scale, 1.25));

        const targetPanX = (viewW - (minX + maxX) * scale) / 2;
        const targetPanY = (viewH - (minY + maxY) * scale) / 2;

        if (this.zoomBehavior && this.container && typeof window !== 'undefined' && window.d3) {
            window.d3.select(this.container)
                .transition()
                .duration(450)
                .call(
                    this.zoomBehavior.transform,
                    window.d3.zoomIdentity.translate(targetPanX, targetPanY).scale(scale)
                );
        } else {
            this.panX = targetPanX;
            this.panY = targetPanY;
            this.currentScale = scale;
            this.applyTransform();
        }
    }

    resetViewport() {
        if (this.zoomBehavior && this.container && typeof window !== 'undefined' && window.d3) {
            window.d3.select(this.container)
                .transition()
                .duration(300)
                .call(this.zoomBehavior.transform, window.d3.zoomIdentity);
        } else {
            this.panX = 0;
            this.panY = 0;
            this.currentScale = 1.0;
            this.applyTransform();
        }
    }

    exportState() {
        return {
            version: 1,
            viewport: {
                panX: this.panX,
                panY: this.panY,
                zoom: this.currentScale
            },
            cards: Array.from(this.cards.values()).map(c => ({
                id: c.id,
                type: c.type,
                title: c.title,
                x: c.x,
                y: c.y,
                width: c.width,
                height: c.height,
                zIndex: c.zIndex,
                source: c.source,
                payload: c.payload
            }))
        };
    }

    clear() {
        for (const card of this.cards.values()) {
            if (card.el) card.el.remove();
        }
        this.cards.clear();
        if (this.content) {
            this.content.innerHTML = '';
        }
        this.resetViewport();
        this.updateCardCountBadge();
    }

    reset() {
        this.clear();
    }

    importState(state) {
        this.clear();
        if (!state) return;

        // Restore viewport
        const vp = state.viewport || { panX: 0, panY: 0, zoom: 1.0 };
        const k = Math.max(0.15, Math.min(3.0, vp.zoom || 1.0));
        const px = vp.panX || 0;
        const py = vp.panY || 0;

        if (this.zoomBehavior && this.container && typeof window !== 'undefined' && window.d3) {
            window.d3.select(this.container).call(
                this.zoomBehavior.transform,
                window.d3.zoomIdentity.translate(px, py).scale(k)
            );
        } else {
            this.panX = px;
            this.panY = py;
            this.currentScale = k;
            this.applyTransform();
        }

        // Rehydrate cards
        if (Array.isArray(state.cards)) {
            state.cards.forEach(cardDetail => {
                this.addCard(cardDetail, { silent: true });
            });
        }

        this.updateCardCountBadge();
    }

    updateCardCountBadge() {
        // Badge indicator removed per user request
        const countEl = this.cardCountEl || (typeof document !== 'undefined' ? document.getElementById('canvas-card-count') : null);
        if (countEl) countEl.classList.add('hidden');
    }

    showToast(message = 'Pinned to Canvas') {
        if (typeof document === 'undefined') return;

        let toast = document.getElementById('canvas-toast-msg');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'canvas-toast-msg';
            toast.className = 'canvas-toast';
            document.body.appendChild(toast);
        }

        toast.innerHTML = `<i class="fa-solid fa-thumbtack"></i><span>${escapeHtml(message)}</span>`;
        toast.classList.add('visible');

        clearTimeout(this._toastTimeout);
        this._toastTimeout = setTimeout(() => {
            toast.classList.remove('visible');
        }, 2200);
    }
}
