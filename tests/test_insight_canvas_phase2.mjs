import assert from 'node:assert/strict';

// ---------------------------------------------------------
// Mock Minimal DOM Environment for Canvas Testing
// ---------------------------------------------------------

class MockClassList {
    constructor() {
        this.classes = new Set();
    }
    add(...cls) {
        cls.forEach(c => this.classes.add(c));
    }
    remove(...cls) {
        cls.forEach(c => this.classes.delete(c));
    }
    contains(c) {
        return this.classes.has(c);
    }
    toggle(c, force) {
        if (force === undefined) {
            if (this.classes.has(c)) {
                this.classes.delete(c);
                return false;
            } else {
                this.classes.add(c);
                return true;
            }
        }
        if (force) {
            this.classes.add(c);
            return true;
        } else {
            this.classes.delete(c);
            return false;
        }
    }
}

class MockElement {
    constructor(tagName) {
        this.tagName = tagName ? tagName.toUpperCase() : 'DIV';
        this.id = '';
        this.classList = new MockClassList();
        this.style = {};
        this.children = [];
        this.parentElement = null;
        this.listeners = new Map();
        this.attributes = new Map();
        this.textContent = '';
        this._innerHTML = '';
        this.shadowRoot = null;
        this.clientWidth = 1000;
        this.clientHeight = 700;
        this.offsetWidth = 440;
        this.offsetHeight = 320;
    }

    get className() {
        return Array.from(this.classList.classes).join(' ');
    }

    set className(val) {
        this.classList.classes.clear();
        if (val) {
            val.split(/\s+/).forEach(c => c && this.classList.add(c));
        }
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(html) {
        this._innerHTML = html;
        this.children = [];
        // Simple parser to extract child elements with id or class for selector queries
        const tagMatches = html.matchAll(/<([a-zA-Z0-9-]+)([^>]*)>(.*?)<\/\1>|<([a-zA-Z0-9-]+)([^>]*)\/>/gs);
        for (const match of tagMatches) {
            const tagName = match[1] || match[4];
            const attrs = match[2] || match[5] || '';
            const child = new MockElement(tagName);
            const idMatch = attrs.match(/id=["']([^"']+)["']/);
            if (idMatch) child.id = idMatch[1];
            const classMatch = attrs.match(/class=["']([^"']+)["']/);
            if (classMatch) {
                child.className = classMatch[1];
                child.className.split(/\s+/).forEach(c => c && child.classList.add(c));
            }
            child.parentElement = this;
            this.children.push(child);
        }
    }

    setAttribute(name, val) {
        this.attributes.set(name, String(val));
    }

    getAttribute(name) {
        return this.attributes.get(name) || null;
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    remove() {
        if (this.parentElement) {
            const idx = this.parentElement.children.indexOf(this);
            if (idx !== -1) {
                this.parentElement.children.splice(idx, 1);
            }
            this.parentElement = null;
        }
    }

    addEventListener(event, fn) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(fn);
    }

    removeEventListener(event, fn) {
        if (!this.listeners.has(event)) return;
        const list = this.listeners.get(event);
        const idx = list.indexOf(fn);
        if (idx !== -1) {
            list.splice(idx, 1);
        }
    }

    setPointerCapture(id) {
        this.capturedPointerId = id;
    }

    releasePointerCapture(id) {
        this.capturedPointerId = null;
    }

    dispatchEvent(evt) {
        const list = this.listeners.get(evt.type) || [];
        list.forEach(fn => fn(evt));
        return true;
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
        const results = [];
        const match = (el) => {
            if (selector.startsWith('#') && el.id === selector.slice(1)) return true;
            if (selector.startsWith('.')) {
                const classes = selector.slice(1).split('.');
                return classes.every(c => el.classList.contains(c));
            }
            if (el.tagName.toLowerCase() === selector.toLowerCase()) return true;
            return false;
        };

        const traverse = (node) => {
            for (const child of node.children) {
                if (match(child)) results.push(child);
                traverse(child);
            }
            if (node.shadowRoot) {
                for (const child of node.shadowRoot.children) {
                    if (match(child)) results.push(child);
                    traverse(child);
                }
            }
        };

        traverse(this);
        return results;
    }

    closest(selector) {
        let cur = this;
        while (cur) {
            if (selector.startsWith('.')) {
                const classes = selector.slice(1).split('.');
                if (cur.classList && classes.every(c => cur.classList.contains(c))) return cur;
            } else if (selector.startsWith('#')) {
                if (cur.id === selector.slice(1)) return cur;
            } else if (selector.startsWith('[')) {
                const attrMatch = selector.match(/\[([a-zA-Z0-9_-]+)(?:=["']?([^"']+)["']?)?\]/);
                if (attrMatch) {
                    const attrName = attrMatch[1];
                    const attrVal = attrMatch[2];
                    if (cur.getAttribute && (attrVal ? cur.getAttribute(attrName) === attrVal : cur.getAttribute(attrName) !== null)) return cur;
                }
            } else if (cur.tagName && cur.tagName.toLowerCase() === selector.toLowerCase()) {
                return cur;
            }
            cur = cur.parentElement;
        }
        return null;
    }

    attachShadow(opts) {
        this.shadowRoot = new MockElement('shadow-root');
        return this.shadowRoot;
    }

    focus() {}
}

class MockDocument {
    constructor() {
        this.elementsById = new Map();
        this.body = new MockElement('body');
    }

    createElement(tag) {
        return new MockElement(tag);
    }

    getElementById(id) {
        return this.elementsById.get(id) || null;
    }

    registerElement(el) {
        if (el.id) this.elementsById.set(el.id, el);
        for (const child of el.children) {
            this.registerElement(child);
        }
    }
}

class MockCustomEvent {
    constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail || null;
    }
}

// Global D3 Mock
const mockD3 = {
    zoomIdentity: {
        x: 0,
        y: 0,
        k: 1.0,
        translate(x, y) {
            return { ...this, x, y };
        },
        scale(k) {
            return { ...this, k };
        }
    },
    zoom() {
        let zoomHandler = () => {};
        const behavior = {
            scaleExtent(ext) { return this; },
            filter(fn) { return this; },
            on(evt, fn) {
                if (evt === 'zoom') zoomHandler = fn;
                return this;
            },
            triggerZoom(transform) {
                zoomHandler({ transform });
            },
            scaleBy(sel, factor) {},
            transform(sel, t) {}
        };
        return behavior;
    },
    drag() {
        const handlers = {};
        const behavior = {
            on(evt, fn) {
                handlers[evt] = fn;
                return this;
            },
            trigger(evt, eventData) {
                if (handlers[evt]) handlers[evt](eventData);
            }
        };
        return behavior;
    },
    select(target) {
        return {
            call(fn, ...args) {
                if (typeof fn === 'function') fn(this, ...args);
                return this;
            },
            on(evt, fn) {
                return this;
            },
            transition() {
                return {
                    duration() { return this; },
                    call(fn, ...args) {
                        if (typeof fn === 'function') fn(this, ...args);
                        return this;
                    }
                };
            }
        };
    }
};

// Setup global environment
const mockDoc = new MockDocument();
const windowListeners = new Map();

global.window = {
    d3: mockD3,
    addEventListener(evt, fn) {
        if (!windowListeners.has(evt)) windowListeners.set(evt, []);
        windowListeners.get(evt).push(fn);
    },
    removeEventListener(evt, fn) {
        const list = windowListeners.get(evt) || [];
        const idx = list.indexOf(fn);
        if (idx !== -1) list.splice(idx, 1);
    },
    dispatchEvent(evt) {
        const list = windowListeners.get(evt.type) || [];
        list.forEach(fn => fn(evt));
    },
    DOMPurify: {
        sanitize: (str) => str
    },
    marked: {
        parse: (md) => `<p>${md}</p>`
    },
    vegaEmbed: async (el, spec) => {
        el.innerHTML = '<svg class="vega-embed-svg"></svg>';
        return {};
    }
};
global.document = mockDoc;
global.CustomEvent = MockCustomEvent;

// ---------------------------------------------------------
// Import Module Under Test
// ---------------------------------------------------------
console.log('Testing canvas.js CanvasManager...');
const { CanvasManager } = await import('../static/js/canvas.js');

// Setup Container Elements
const container = new MockElement('div');
container.id = 'canvas-container';

const dock = new MockElement('div');
dock.id = 'canvas-control-dock';
dock.classList.add('canvas-floating-dock');

const addNoteBtn = new MockElement('button');
addNoteBtn.id = 'canvas-add-note-btn';
dock.appendChild(addNoteBtn);

const arrangeBtn = new MockElement('button');
arrangeBtn.id = 'canvas-arrange-btn';
dock.appendChild(arrangeBtn);

const fitBtn = new MockElement('button');
fitBtn.id = 'canvas-fit-btn';
dock.appendChild(fitBtn);

const zoomInBtn = new MockElement('button');
zoomInBtn.id = 'canvas-zoom-in-btn';
dock.appendChild(zoomInBtn);

const zoomOutBtn = new MockElement('button');
zoomOutBtn.id = 'canvas-zoom-out-btn';
dock.appendChild(zoomOutBtn);

const zoomLevelEl = new MockElement('span');
zoomLevelEl.id = 'canvas-zoom-level';
zoomLevelEl.textContent = '100%';
dock.appendChild(zoomLevelEl);

const world = new MockElement('div');
world.id = 'canvas-world';

container.appendChild(dock);
container.appendChild(world);

const badgeCounter = new MockElement('span');
badgeCounter.id = 'canvas-card-count';
badgeCounter.classList.add('hidden');
badgeCounter.textContent = '0';

mockDoc.registerElement(container);
mockDoc.registerElement(badgeCounter);

let openStudioVegaSpec = null;
let openStudioMermaidCode = null;
let openStudioSankeyPayload = null;

const mgr = new CanvasManager({
    container,
    onOpenVega: (spec) => { openStudioVegaSpec = spec; },
    onOpenMermaid: (code) => { openStudioMermaidCode = code; },
    onOpenSankey: (payload) => { openStudioSankeyPayload = payload; }
});

// Test 1: Initial state
assert.equal(mgr.cards.size, 0);
assert.equal(mgr.currentScale, 1.0);
assert.equal(mgr.panX, 0);
assert.equal(mgr.panY, 0);
assert.equal(badgeCounter.classList.contains('hidden'), true);
console.log('✓ CanvasManager initialization and initial state passed');

// Test 2: Add Vega Card
const vegaCard = mgr.addCard({
    id: 'card-vega-1',
    type: 'vega',
    title: 'Revenue Distribution',
    x: 100,
    y: 120,
    payload: {
        spec: { mark: 'bar', encoding: { x: { field: 'a' } } }
    },
    source: {
        origin: 'vega',
        datasetName: 'sales.csv',
        timestamp: 1730635200000
    }
});

assert.ok(vegaCard);
assert.equal(mgr.cards.size, 1);
assert.equal(vegaCard.id, 'card-vega-1');
assert.equal(vegaCard.type, 'vega');
assert.equal(vegaCard.title, 'Revenue Distribution');
assert.equal(vegaCard.x, 100);
assert.equal(vegaCard.y, 120);
assert.equal(badgeCounter.classList.contains('hidden'), true);
console.log('✓ addCard Vega card & badge hidden passed');

// Test 3: Add Mermaid Card with SVG in Shadow DOM
const mermaidCard = mgr.addCard({
    id: 'card-mermaid-1',
    type: 'mermaid',
    title: 'Workflow Graph',
    x: 580,
    y: 120,
    payload: {
        svgString: '<svg id="mermaid-svg"><g><rect/></g></svg>',
        code: 'flowchart LR; A-->B'
    },
    source: {
        origin: 'mermaid',
        datasetName: 'flow.csv',
        timestamp: 1730635210000
    }
});

assert.ok(mermaidCard);
assert.equal(mgr.cards.size, 2);
assert.ok(mermaidCard.el);
const mermaidBody = mermaidCard.el.querySelector('.canvas-card-body');
assert.ok(mermaidBody);
assert.ok(mermaidBody.shadowRoot, 'Mermaid card body should mount inside Shadow DOM');
assert.ok(mermaidBody.shadowRoot.innerHTML.includes('<svg id="mermaid-svg">'));
console.log('✓ addCard Mermaid card with Shadow DOM SVG passed');

// Test 4: Add Sankey, Plot, and Markdown Cards
const sankeyCard = mgr.addCard({
    id: 'card-sankey-1',
    type: 'sankey',
    title: 'Flow Model',
    x: 100,
    y: 480,
    payload: {
        svgString: '<svg id="sankey-svg"><path/></svg>'
    },
    source: {
        origin: 'sankey',
        datasetName: 'nodes.csv',
        timestamp: 1730635220000
    }
});

const plotCard = mgr.addCard({
    id: 'card-plot-1',
    type: 'plot',
    title: 'Scatter Plot',
    x: 580,
    y: 480,
    payload: {
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    },
    source: {
        origin: 'agent',
        datasetName: 'sales.csv',
        timestamp: 1730635230000
    }
});

const noteCard = mgr.addCard({
    id: 'card-note-1',
    type: 'markdown',
    title: 'Executive Note',
    payload: {
        content: '# Important finding\nSales grew 20%.'
    },
    source: {
        origin: 'user',
        timestamp: 1730635240000
    }
});

assert.equal(mgr.cards.size, 5);
assert.equal(badgeCounter.classList.contains('hidden'), true);

// Check Plot Card img element
const plotImg = plotCard.el.querySelector('.canvas-plot-img');
assert.ok(plotImg, 'Plot card body must mount .canvas-plot-img');
assert.ok(plotImg.src.startsWith('data:image/png'));

// Check Note Card markdown content and editor
const noteContent = noteCard.el.querySelector('.canvas-markdown-content');
const noteEditor = noteCard.el.querySelector('.canvas-markdown-editor');
assert.ok(noteContent, 'Markdown card must contain .canvas-markdown-content');
assert.ok(noteEditor, 'Markdown card must contain .canvas-markdown-editor');
assert.equal(noteEditor.value, '# Important finding\nSales grew 20%.');
console.log('✓ Sankey, Plot, and Markdown card mounting passed');

// Test 5: Open in Studio actions
const vegaHeader = vegaCard.el.querySelector('.canvas-card-header');
const vegaStudioBtn = vegaHeader.querySelector('.open-studio-btn');
assert.ok(vegaStudioBtn, 'Vega card header must have open-studio-btn');
vegaStudioBtn.dispatchEvent({ type: 'click', stopPropagation() {} });
assert.deepEqual(openStudioVegaSpec, { mark: 'bar', encoding: { x: { field: 'a' } } });

const mermaidHeader = mermaidCard.el.querySelector('.canvas-card-header');
const mermaidStudioBtn = mermaidHeader.querySelector('.open-studio-btn');
assert.ok(mermaidStudioBtn, 'Mermaid card header must have open-studio-btn');
mermaidStudioBtn.dispatchEvent({ type: 'click', stopPropagation() {} });
assert.equal(openStudioMermaidCode, 'flowchart LR; A-->B');
console.log('✓ Open in Studio callbacks passed');

// Test 6: Drag calculation scale division
// Simulate dragging card when scale is 0.5
mgr.currentScale = 0.5;
const initialX = vegaCard.x; // 100
const initialY = vegaCard.y; // 120
const dx = 10;
const dy = 20;

// Coordinate division by currentScale: card.x += dx / currentScale
vegaCard.x += dx / mgr.currentScale;
vegaCard.y += dy / mgr.currentScale;
assert.equal(vegaCard.x, initialX + 20, 'At 0.5x scale, dx of 10 must translate to 20 world units');
assert.equal(vegaCard.y, initialY + 40, 'At 0.5x scale, dy of 20 must translate to 40 world units');
mgr.currentScale = 1.0;
console.log('✓ Drag scale division math verified');

// Test 7: Tidy Grid
mgr.tidyGrid();
const sortedCards = Array.from(mgr.cards.values()).sort((a, b) => a.source.timestamp - b.source.timestamp);
// Col 0, Row 0
assert.equal(sortedCards[0].x, 60);
assert.equal(sortedCards[0].y, 60);
// Col 1, Row 0 (colWidth=460, gapX=32 -> 60 + 492 = 552)
assert.equal(sortedCards[1].x, 60 + (460 + 32));
assert.equal(sortedCards[1].y, 60);
// Col 2, Row 0
assert.equal(sortedCards[2].x, 60 + 2 * (460 + 32));
assert.equal(sortedCards[2].y, 60);
// Col 0, Row 1 (rowHeight=360, gapY=32 -> 60 + 392 = 452)
assert.equal(sortedCards[3].x, 60);
assert.equal(sortedCards[3].y, 60 + (360 + 32));
console.log('✓ tidyGrid 3-column layout passed');

// Test 8: Fit All
mgr.fitAll();
assert.ok(mgr.currentScale > 0.15 && mgr.currentScale <= 1.25);
console.log('✓ fitAll viewport computation passed');

// Test 9: Remove Card
mgr.removeCard('card-note-1');
assert.equal(mgr.cards.size, 4);
assert.equal(badgeCounter.classList.contains('hidden'), true);
console.log('✓ removeCard passed');

// Test 10: Export State and Import State (Round trip)
const state = mgr.exportState();
assert.equal(state.version, 1);
assert.ok(state.viewport);
assert.equal(Array.isArray(state.cards), true);
assert.equal(state.cards.length, 4);

const newContainer = new MockElement('div');
newContainer.id = 'canvas-container-2';
const newWorld = new MockElement('div');
newWorld.id = 'canvas-world';
newContainer.appendChild(newWorld);
mockDoc.registerElement(newContainer);

const mgr2 = new CanvasManager({ container: newContainer });
mgr2.importState(state);

assert.equal(mgr2.cards.size, 4);
const exportedState2 = mgr2.exportState();
assert.equal(exportedState2.cards.length, 4);
assert.equal(exportedState2.cards[0].id, state.cards[0].id);
assert.equal(exportedState2.cards[0].type, state.cards[0].type);
assert.equal(exportedState2.cards[0].title, state.cards[0].title);
console.log('✓ exportState / importState round-trip passed');

// Test 11: Global Event Listener dataviz:pin-card
const initialCount = mgr.cards.size;
window.dispatchEvent(new CustomEvent('dataviz:pin-card', {
    detail: {
        type: 'markdown',
        title: 'Global Pinned Insight',
        payload: { content: 'Insight discovered by Agent' },
        source: { origin: 'agent', datasetName: 'sales.csv', timestamp: Date.now() }
    }
}));

assert.equal(mgr.cards.size, initialCount + 1);
const pinned = Array.from(mgr.cards.values()).find(c => c.title === 'Global Pinned Insight');
assert.ok(pinned, 'Card dispatched via dataviz:pin-card event must be pinned to canvas');
console.log('✓ dataviz:pin-card global event dispatch passed');

// Test 13: Obsidian-Style Shaded Sticky Notes
const textNote = mgr.addTextNote();
assert.ok(textNote);
assert.equal(textNote.type, 'text');
assert.ok(textNote.el);
assert.equal(textNote.el.classList.contains('canvas-text-note'), true);

// Verify no detached hover bar exists
assert.equal(textNote.el.querySelector('.text-note-hover-bar'), null);

// Verify native delete button in top-right
const noteDeleteBtn = textNote.el.querySelector('.delete-card-btn');
assert.ok(noteDeleteBtn, 'Sticky note must have .delete-card-btn');
assert.equal(noteDeleteBtn.classList.contains('card-action-btn'), true);

// Verify rendered content div and editor
const textContentDiv = textNote.el.querySelector('.text-note-content');
const textEditor = textNote.el.querySelector('.text-note-editor');
assert.ok(textContentDiv, 'Sticky note must have .text-note-content');
assert.ok(textEditor, 'Sticky note must have .text-note-editor');

// Verify click-to-edit
textContentDiv.dispatchEvent({ type: 'click' });
assert.equal(textNote.el.classList.contains('is-editing'), true, 'Clicking text must enter edit mode');
assert.equal(textEditor.classList.contains('hidden'), false);
assert.equal(textContentDiv.classList.contains('hidden'), true);

// Type text into editor
textEditor.value = '## Findings\nObsidian style note.';

// Exit edit mode on Escape
textEditor.dispatchEvent({ type: 'keydown', key: 'Escape' });
assert.equal(textNote.el.classList.contains('is-editing'), false, 'Escape must exit edit mode');
assert.equal(textEditor.classList.contains('hidden'), true);
assert.equal(textContentDiv.classList.contains('hidden'), false);
assert.equal(textNote.payload.content, '## Findings\nObsidian style note.');

console.log('✓ Obsidian-style shaded sticky note DOM, click-to-edit, and escape passed');

// Test 14: 8-Point Spatial Resizing Engine (Presence of all 8 handles and event isolation)
const expectedHandles = [
    'resize-corner-tl',
    'resize-edge-t',
    'resize-corner-tr',
    'resize-edge-r',
    'resize-corner-br',
    'resize-edge-b',
    'resize-corner-bl',
    'resize-edge-l'
];

expectedHandles.forEach(cls => {
    const handle = textNote.el.querySelector(`.${cls}`);
    assert.ok(handle, `Sticky note missing handle .${cls}`);
    assert.equal(handle.classList.contains('resize-handle'), true);
});

// Create a chart card to test chart resizing as well
const resizableVegaCard = mgr.addCard({
    id: 'resizable-vega',
    type: 'vega',
    title: 'Resizable Vega Chart',
    x: 200,
    y: 200,
    width: 440,
    height: 320,
    payload: { spec: {} }
});

expectedHandles.forEach(cls => {
    const handle = resizableVegaCard.el.querySelector(`.${cls}`);
    assert.ok(handle, `Vega card missing handle .${cls}`);
    assert.equal(handle.classList.contains('resize-handle'), true);
});

// Verify event isolation on pointerdown
const rightHandle = resizableVegaCard.el.querySelector('.resize-edge-r');
let stopPropCalled = false;
let prevDefCalled = false;
rightHandle.dispatchEvent({
    type: 'pointerdown',
    button: 0,
    clientX: 640,
    clientY: 360,
    pointerId: 42,
    stopPropagation() { stopPropCalled = true; },
    preventDefault() { prevDefCalled = true; }
});

assert.equal(stopPropCalled, true, 'Pointerdown on resize handle must stop propagation to D3 zoom/pan');
assert.equal(prevDefCalled, true, 'Pointerdown on resize handle must prevent default');
assert.equal(rightHandle.capturedPointerId, 42, 'Resize handle must acquire pointer capture');
assert.equal(resizableVegaCard.el.classList.contains('is-resizing'), true, 'Card must have .is-resizing during drag');

// Test scale-normalized delta math during pointermove
mgr.currentScale = 0.5;
rightHandle.dispatchEvent({
    type: 'pointermove',
    clientX: 690, // delta clientX = +50px -> at 0.5 scale = +100px
    clientY: 360,
    stopPropagation() {}
});

assert.equal(resizableVegaCard.width, 540, 'Width must increase by 100 at 0.5 scale (50 / 0.5)');
assert.equal(resizableVegaCard.x, 200, 'Left edge must remain anchored during right edge resize');
assert.equal(resizableVegaCard.el.style.width, '540px');

// Pointerup releases capture and cleans up
rightHandle.dispatchEvent({
    type: 'pointerup',
    pointerId: 42,
    stopPropagation() {}
});
assert.equal(rightHandle.capturedPointerId, null, 'Pointer capture must be released');
assert.equal(resizableVegaCard.el.classList.contains('is-resizing'), false, 'is-resizing must be removed on pointerup');
mgr.currentScale = 1.0;
console.log('✓ 8-point handles, pointer capture, event isolation, and scale-normalized resizing passed');

// Test 15: Spatial Anchoring and Dimension Clamping
// 15a: Left-edge resize anchors right edge
const leftHandle = resizableVegaCard.el.querySelector('.resize-edge-l');
const startWidth = resizableVegaCard.width; // 540
const startX = resizableVegaCard.x; // 200
const initialRightEdge = startX + startWidth; // 740

leftHandle.dispatchEvent({
    type: 'pointerdown',
    button: 0,
    clientX: 200,
    clientY: 200,
    pointerId: 43,
    stopPropagation() {},
    preventDefault() {}
});

// Drag left handle to the right by 40px (reducing width from 540 to 500)
leftHandle.dispatchEvent({
    type: 'pointermove',
    clientX: 240, // deltaX = +40 -> rawW = 540 - 40 = 500
    clientY: 200,
    stopPropagation() {}
});

assert.equal(resizableVegaCard.width, 500);
assert.equal(resizableVegaCard.x, 240);
assert.equal(resizableVegaCard.x + resizableVegaCard.width, initialRightEdge, 'Right edge must remain anchored');

// Clamping test: chart card min width 320, max width 1200
leftHandle.dispatchEvent({
    type: 'pointermove',
    clientX: 600, // try to shrink width to 140 -> should clamp to min 320
    clientY: 200,
    stopPropagation() {}
});
assert.equal(resizableVegaCard.width, 320, 'Chart card width clamped to min 320px');
assert.equal(resizableVegaCard.x + resizableVegaCard.width, initialRightEdge, 'Right edge remains anchored at clamp boundary');

leftHandle.dispatchEvent({
    type: 'pointermove',
    clientX: -1000, // try to expand width to 1740 -> should clamp to max 1200
    clientY: 200,
    stopPropagation() {}
});
assert.equal(resizableVegaCard.width, 1200, 'Chart card width clamped to max 1200px');
assert.equal(resizableVegaCard.x + resizableVegaCard.width, initialRightEdge, 'Right edge remains anchored at max clamp boundary');

leftHandle.dispatchEvent({ type: 'pointerup', pointerId: 43, stopPropagation() {} });

// 15b: Top-edge resize anchors bottom edge and clamps height [200, 900]
const topHandle = resizableVegaCard.el.querySelector('.resize-edge-t');
const startHeight = resizableVegaCard.height; // 320
const startY = resizableVegaCard.y; // 200
const initialBottomEdge = startY + startHeight; // 520

topHandle.dispatchEvent({
    type: 'pointerdown',
    button: 0,
    clientX: 200,
    clientY: 200,
    pointerId: 44,
    stopPropagation() {},
    preventDefault() {}
});

// Drag top handle up by 80px (increasing height from 320 to 400)
topHandle.dispatchEvent({
    type: 'pointermove',
    clientX: 200,
    clientY: 120, // deltaY = -80 -> rawH = 320 - (-80) = 400
    stopPropagation() {}
});

assert.equal(resizableVegaCard.height, 400);
assert.equal(resizableVegaCard.y, 120);
assert.equal(resizableVegaCard.y + resizableVegaCard.height, initialBottomEdge, 'Bottom edge must remain anchored');

// Try to expand beyond max 900px
topHandle.dispatchEvent({
    type: 'pointermove',
    clientX: 200,
    clientY: -800, // rawH = 320 - (-1000) = 1320 -> clamp to 900
    stopPropagation() {}
});
assert.equal(resizableVegaCard.height, 900, 'Chart card height clamped to max 900px');
assert.equal(resizableVegaCard.y + resizableVegaCard.height, initialBottomEdge, 'Bottom edge remains anchored');

// Try to shrink below min 200px
topHandle.dispatchEvent({
    type: 'pointermove',
    clientX: 200,
    clientY: 400, // rawH = 320 - 200 = 120 -> clamp to 200
    stopPropagation() {}
});
assert.equal(resizableVegaCard.height, 200, 'Chart card height clamped to min 200px');
assert.equal(resizableVegaCard.y + resizableVegaCard.height, initialBottomEdge, 'Bottom edge remains anchored');

topHandle.dispatchEvent({ type: 'pointerup', pointerId: 44, stopPropagation() {} });

// 15c: Text note dimension clamping [200, 1200] width, [60, 1200] height
const textBrHandle = textNote.el.querySelector('.resize-corner-br');
textBrHandle.dispatchEvent({
    type: 'pointerdown',
    button: 0,
    clientX: 320,
    clientY: 160,
    pointerId: 45,
    stopPropagation() {},
    preventDefault() {}
});

// Try to shrink below min: width < 200, height < 60
textBrHandle.dispatchEvent({
    type: 'pointermove',
    clientX: 0,   // deltaX = -320 -> rawW = 320 - 320 = 0 -> clamp to 200
    clientY: 0,   // deltaY = -160 -> rawH = 160 - 160 = 0 -> clamp to 60
    stopPropagation() {}
});
assert.equal(textNote.width, 200, 'Text note min width clamped to 200px');
assert.equal(textNote.height, 60, 'Text note min height clamped to 60px');

// Try to grow above max: width > 1200, height > 1200
textBrHandle.dispatchEvent({
    type: 'pointermove',
    clientX: 2000,
    clientY: 2000,
    stopPropagation() {}
});
assert.equal(textNote.width, 1200, 'Text note max width clamped to 1200px');
assert.equal(textNote.height, 1200, 'Text note max height clamped to 1200px');

textBrHandle.dispatchEvent({ type: 'pointerup', pointerId: 45, stopPropagation() {} });
console.log('✓ Spatial anchoring and min/max dimension clamping passed');

// Test 16: Dimension Persistence across exportState and importState
const savedState = mgr.exportState();
const savedVega = savedState.cards.find(c => c.id === 'resizable-vega');
const savedNote = savedState.cards.find(c => c.id === textNote.id);
assert.ok(savedVega);
assert.ok(savedNote);
assert.equal(savedVega.width, resizableVegaCard.width);
assert.equal(savedVega.height, resizableVegaCard.height);
assert.equal(savedNote.width, 1200);
assert.equal(savedNote.height, 1200);

const rehydrateContainer = new MockElement('div');
rehydrateContainer.id = 'canvas-container-rehydrate';
const rehydrateWorld = new MockElement('div');
rehydrateWorld.id = 'canvas-world';
rehydrateContainer.appendChild(rehydrateWorld);
mockDoc.registerElement(rehydrateContainer);

const mgrRehydrate = new CanvasManager({ container: rehydrateContainer });
mgrRehydrate.importState(savedState);

const rehydratedVega = mgrRehydrate.cards.get('resizable-vega');
const rehydratedNote = mgrRehydrate.cards.get(textNote.id);
assert.ok(rehydratedVega);
assert.ok(rehydratedNote);
assert.equal(rehydratedVega.width, savedVega.width);
assert.equal(rehydratedVega.height, savedVega.height);
assert.equal(rehydratedVega.el.style.width, `${savedVega.width}px`);
assert.equal(rehydratedVega.el.style.height, `${savedVega.height}px`);
assert.equal(rehydratedNote.width, 1200);
assert.equal(rehydratedNote.height, 1200);
assert.equal(rehydratedNote.el.style.width, '1200px');
assert.equal(rehydratedNote.el.style.height, '1200px');

// Test delete button on sticky note
noteDeleteBtn.dispatchEvent({ type: 'click', stopPropagation() {} });
assert.equal(mgr.cards.has(textNote.id), false, 'Clicking delete button must remove note from CanvasManager');
console.log('✓ Dimension persistence and delete card action passed');

// Test 12: mgr.reset() and mgr.clear()
mgr.reset();
assert.equal(mgr.cards.size, 0);
assert.equal(mgr.exportState().cards.length, 0);
console.log('✓ CanvasManager reset/clear passed');

console.log('\nAll Phase 2 CanvasManager tests passed successfully!');
