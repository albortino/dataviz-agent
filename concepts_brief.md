# Insight Canvas & Workspace Persistence MVP

* **Author:** Mats Schneider
* **Date:** 2026-11-03

## Overview

Dataviz-Agent excels at interactive exploratory data analysis through specialized visualizers (LineUp, Graphic-Walker, SandDance, Vega-Lite, Sankey, Mermaid) and an integrated Python ReAct AI agent. However, users currently lack a dedicated workspace to accumulate, annotate, and organize analytical findings. Discovered insights remain scattered across tool tabs and ephemeral across page reloads.

The **Insight Canvas** elevates Dataviz-Agent into an analytical storytelling engine. It introduces a dedicated spatial canvas view where users can pin analytical artifacts—AI answers, statistical charts, and structural diagrams—with one click, annotate them with markdown note cards, and arrange them freely across a 2D plane. Session state (canvas cards, spatial layout, full chat history, and tool configurations) is persisted locally via browser IndexedDB and exported as a portable JSON session file.

---

## Analysis

The feature concept was audited across six Goldfish review lenses (`egm-design`, `egm-codebase-details`, `egm-zoom-out`, `egm-comprehension`, `egm-implementation-readiness`, `egm-structural`) and shaped with `/impeccable` design patterns.

### 1. Storage Quota & LocalStorage Eviction Trap
* **Root Issue:** Chat history and visualizer states currently attempt to serialize into `localStorage`. In `static/js/agent.js`, `saveChatHistory()` already suffers from an aggressive quota mitigation loop: when data exceeds ~5MB (common with embedded base64 Matplotlib/Seaborn plots), it silently truncates history down to the last 5 messages, discarding critical user context.
* **Resolution:** Ban `localStorage` for canvas cards, chat transcripts, and session payloads. Implement an asynchronous IndexedDB adapter (`static/js/storage-db.js`) with an explicit object store (`sessions` and `chat_history`).

### 2. Spec-First Storage vs. SVG Payload Bloat
* **Root Issue:** Serializing multi-megabyte raw SVG snapshots for complex Vega-Lite charts balloons session JSON files from kilobytes to 30+ MB, causing main-thread execution freezes during `JSON.stringify` on pan/zoom debouncing.
* **Resolution:** Enforce a **Spec-First** representation for Vega-Lite cards: store the compact JSON specification (~2 KB) and dataset column bindings. For non-declarative outputs (Mermaid diagrams, Sankey flows, Matplotlib plots), store sanitized, minified SVG strings or image blobs with a hard cap (250 KB per card).

### 3. Detached SVG Silhouette & Style Bleed Trap
* **Root Issue:** Mermaid and D3 (Sankey) SVGs rely on global CSS rules and CSS variables from `variables.css`. Directly extracting them via `XMLSerializer().serializeToString()` strips stylesheets, rendering elements as black silhouettes or unstyled text. Additionally, shared SVG `<clipPath id="...">` and gradient IDs collide when multiple SVGs exist in a single DOM container.
* **Resolution:** Standardize SVG extraction via a helper (`static/js/studio-utils.js`) that clones the element and inlines computed CSS styles (`fill`, `stroke`, `font-family`). Render SVG cards inside isolated shadow roots (`ShadowRoot`) or as `<img>` tags referencing SVG Blob Object URLs (`URL.createObjectURL(blob)`).

### 4. Codebase Reuse: D3 Pan/Zoom vs. Custom Coordinate Math
* **Root Issue:** Building a custom freeform pan/zoom/drag coordinate projection engine from scratch in vanilla JS introduces cross-browser pointer capture bugs, DPR scaling issues, and pinch-to-zoom race conditions.
* **Resolution:** Dataviz-Agent already includes D3.js globally (`d3.v7.min.js` in `static/index.html`). Leverage `d3.zoom()` and `d3.drag()` for coordinate handling, reducing hundreds of lines of fragile pointer math to ~25 lines of battle-tested code.

### 5. Chat History Persistence Already Exists
* **Root Issue:** The brainstorming proposal treated agent chat history serialization as a net-new requirement. Codebase audit revealed that `AgentManager.exportState()` and `AgentManager.importState()` are already implemented in `static/js/agent.js` and wired into `static/js/session.js`.
* **Resolution:** Reuse existing agent serialization logic. The only required work is diverting storage from `localStorage` to IndexedDB to eliminate the silent 5-message truncation bug.

---

## Goals vs. Non-Goals

### In-Scope Goals (MVP Scope)
* **Insight Canvas View:** Add a new tab (`#canvas-container`) in `static/index.html` and register it in `main.js` view lifecycle (`activateViewByName('canvas')`).
* **Spatial Canvas Runtime:** Pan, zoom, and card repositioning powered by global `d3.zoom()` and `d3.drag()`.
* **One-Click Pin Actions:**
  * **Agent Chat:** Pin button on agent response cards capturing final answer markdown + embedded plots/charts.
  * **Vega Studio:** Pin button capturing declarative Vega spec + preview snapshot.
  * **Mermaid Studio:** Pin button capturing diagram syntax + styled SVG snapshot.
  * **Sankey Studio:** Pin button capturing node-link flow SVG snapshot.
* **User Text Cards:** Add and edit freeform markdown notes directly on the canvas.
* **IndexedDB Session Adapter:** Auto-save active session state (dataset metadata, canvas cards, tool states, full chat history) in browser IndexedDB.
* **Session Schema v2:** Update `static/js/session.js` to serialize `tools.canvas` alongside existing tools with backward compatibility for v1 session files.
* **Decoupled Pinning Event Protocol:** Global CustomEvent (`dataviz:pin-card`) allowing any visualizer to push cards into the canvas without tight coupling.

### Out-of-Scope Non-Goals (Explicit Exclusions)
* **Graphic-Walker & SandDance Pinning:** Deferred to v2 due to proprietary state models and 3D WebGL rendering constraints.
* **Live In-Card Interactivity:** Canvas cards display static snapshots or re-rendered specs with preview capabilities; interactive editing happens via "Open in Studio" navigation.
* **Multi-User Collaboration & Real-Time Sync:** No WebSockets, CRDTs (Yjs), or multi-cursor synchronization in MVP.
* **Cloud Storage Backends:** Google Drive and OneDrive connectors deferred to post-MVP; focus strictly on local IndexedDB and file download/upload.
* **Vector Connectors / Mindmap Edges:** Freeform node positioning only; edge routing and connecting lines deferred to v2.

---

## UI/UX Placement & Design System Reuse

### 1. Navigation Placement (`static/index.html`)
The header follows an end-to-end analytical journey:
$$\text{Data Ingest} \longrightarrow \text{Exploration (Table/Explorer/Particles)} \longrightarrow \text{Charting (Vega/Sankey/Mermaid)} \longrightarrow \mathbf{Storytelling\ (Canvas)}$$

In `#view-controls`, place the Canvas button after `#plots-split-hub` separated by `.nav-separator-dot`:
```html
<div class="nav-separator-dot"></div>
<button id="show-canvas-btn" class="button icon-button" disabled
    title="Storytelling board with pinned findings, charts, and notes (Canvas)">
    <i class="fa-solid fa-shapes"></i><span>Canvas</span>
    <span id="canvas-card-count" class="badge-counter hidden">0</span>
</button>
```

### 2. "Pin to Canvas" Button Placements
* **Agent Chat Bubbles (`static/js/agent.js`):**
  * Hover button on the top-right corner of `.message.agent`:
    ```html
    <button class="chat-msg-pin-btn" title="Pin finding to Canvas">
        <i class="fa-solid fa-thumbtack"></i>
    </button>
    ```
  * Inline chart action bar (alongside Copy and Open):
    ```html
    <button class="button icon-button chat-pin-chart-btn" id="pin-${chartId}" title="Pin chart to Canvas">
        <i class="fa-solid fa-thumbtack"></i><span>Pin</span>
    </button>
    ```
* **Vega Studio (`static/index.html:1177`):** Placed in `.actions-stack` directly under `#vega-ai-btn`.
* **Mermaid Studio (`static/index.html:854`):** Placed in `.actions-stack` directly under `#mermaid-ai-btn`.
* **Sankey Studio (`static/index.html:682`):** Placed inside `.controls-sidebar-actions` below `#sankey-add-text-btn`.

### 3. Canvas Workspace Layout (`#canvas-container`)
* **Background:** Radial dot-matrix grid using `--c-canvas` (#f1f5f9) and `--c-border-strong` (#cbd5e1).
* **Floating Control Dock (Top-Center):**
  Matches the `.sidebars-controls-pill` design pattern:
  * `[ ➕ Note ]` (`#canvas-add-note-btn`)
  * `[ 📐 Tidy ]` (`#canvas-arrange-btn` - snaps cards to a clean masonry/grid)
  * `[ 🔍 Fit ]` (`#canvas-fit-btn` - resets zoom to fit all cards)
  * `[ - 100% + ]` (zoom indicator and controls)
* **Pinned Cards (`.canvas-card`):**
  * Container: `var(--c-surface)`, `1px solid var(--c-border)`, radius `var(--r-md)`, shadow `var(--shadow-sm)` (idle) and `var(--shadow-pop)` (dragging).
  * Header: Drag handle (`fa-grip-vertical`), category badge (`.badge-vega`, `.badge-mermaid`, `.badge-sankey`, `.badge-agent`), editable title, and action icons (`Open in Studio`, `Delete`).
  * Body: Rendered chart / markdown content.
  * Footer: Provenance badge (`sales_q3.csv • 10:42 AM`).

### 4. Existing CSS Classes & Tokens Reused

| UI Element | Existing Class / Token Reused |
| :--- | :--- |
| **Header Tab** | `.button.icon-button`, `.nav-separator-dot` |
| **Control Dock** | `.sidebars-controls-pill`, `.copilot-header-btn` |
| **Card Badges** | `.badge-vega`, `.badge-mermaid`, `.badge-sankey`, `.dataset-status-badge` |
| **Card Elevation & Radius** | `--shadow-sm`, `--shadow-pop`, `--r-md`, `--r-sm` |
| **Note Typography** | `.message.agent .markdown-content` |
| **Pin Actions** | `.button.icon-button`, `.ai-action-btn` |

---

## Data Contracts & Schemas

### 1. Global Pinning Event Protocol
Tools emit a single decoupled event to push artifacts onto the canvas:
```javascript
window.dispatchEvent(new CustomEvent('dataviz:pin-card', {
    detail: {
        type: 'vega' | 'mermaid' | 'sankey' | 'plot' | 'markdown',
        title: string,
        payload: {
            spec?: object,         // Vega-Lite JSON
            code?: string,         // Mermaid syntax
            svgString?: string,    // Minified SVG for Sankey / Matplotlib
            content?: string       // Markdown text
        },
        source: {
            origin: 'agent' | 'vega' | 'mermaid' | 'sankey' | 'user',
            datasetName: string,
            timestamp: number
        }
    }
}));
```

### 2. Session Schema Integration (`SESSION_VERSION = 2`)
Extend `static/js/session.js`:
```json
{
  "format": "dataviz-agent-session",
  "version": 2,
  "exportedAt": "2026-11-03T12:00:00.000Z",
  "activeView": "canvas",
  "datasetSchema": {
    "name": "dataset.csv",
    "rowCount": 1000,
    "columnCount": 10,
    "columns": ["col_a", "col_b"]
  },
  "tools": {
    "lineup": null,
    "graphicWalker": null,
    "sanddance": null,
    "sankey": null,
    "mermaid": null,
    "vega": null,
    "agent": {
      "history": [],
      "activeSkills": []
    },
    "canvas": {
      "version": 1,
      "viewport": { "panX": 0, "panY": 0, "zoom": 1.0 },
      "cards": [
        {
          "id": "card-1730635200-1",
          "type": "vega",
          "title": "Revenue Trend by Region",
          "x": 100,
          "y": 120,
          "width": 480,
          "height": 340,
          "zIndex": 1,
          "source": { "origin": "vega", "datasetName": "sales.csv", "timestamp": 1730635200000 },
          "payload": { "spec": { "$schema": "https://vega.github.io/schema/vega-lite/v5.json", "mark": "bar" } }
        }
      ]
    }
  }
}
```

---

## Alternatives Weighed

1. **Freeform 2D Infinite Canvas vs. Responsive Storyboard Grid**
   * *Option A (Infinite 2D Canvas):* Miro-style infinite plane with pan/zoom and coordinate translation.
   * *Option B (Responsive Storyboard Grid):* 12-column responsive grid or masonry card layout with native vertical scrolling and drag-to-reorder.
   * *Decision:* Proceed with Freeform 2D Canvas using existing global `d3.zoom()`. Rejected pure Storyboard Grid because user explicitly requested a spatial widescreen layout for non-linear storytelling. Retain option to snap cards to grid via "Tidy" button.

2. **DOM-Based Nodes vs. HTML5 `<canvas>` (Konva.js / Pixi.js)**
   * *Option A (HTML5 `<canvas>` via Konva.js):* Pixel-based canvas rendering.
   * *Option B (DOM Elements + CSS Transforms):* Div-based card elements inside a transformed container.
   * *Decision:* Adopt DOM Elements + CSS Transforms (`Option B`). Rejected HTML5 `<canvas>` because it prevents embedded SVG vector scaling, text selection, and native markdown rendering inside note cards.

3. **Storage Engine: LocalStorage vs. IndexedDB vs. SQLite-Wasm**
   * *Option A (LocalStorage):* Retain existing key-value store.
   * *Option B (IndexedDB):* Asynchronous browser document store.
   * *Option C (SQLite-Wasm / DuckDB-Wasm):* In-browser SQL engine.
   * *Decision:* Adopt IndexedDB (`Option B`). Rejected LocalStorage due to 5MB quota ceiling and silent eviction. Rejected SQLite-Wasm to avoid adding a heavy binary dependency when DuckDB-Wasm is already dedicated to analytics.

---

## Key Decisions & Staging for Next Steps

### Key Decisions Resolved
1. **Zero New Build Tools:** Canvas implementation remains vanilla JavaScript (ES modules) and CSS, utilizing globally available `d3.zoom()` and CDN-loaded libraries.
2. **Spec-First Vega Nodes:** Vega charts store compact Vega-Lite specs; DOM snapshots are reserved for non-declarative engines (Mermaid, Sankey, Matplotlib).
3. **Session v2 Format:** `session.js` increments to version 2, adding `tools.canvas` while maintaining safe fallback instantiation for version 1 session files.
4. **Side-by-Side Co-existence:** Agent side-panel copilot remains toggleable side-by-side with the Canvas view, enabling drag-and-drop or one-click pinning while reviewing data.

### Staging for Coding Agent Implementation
* **Phase 1: Storage Layer & Sanitizer Utilities**
  * Create `static/js/storage-db.js` (IndexedDB wrapper for sessions and chat history).
  * Migrate `AgentManager.saveChatHistory()` away from `localStorage` to IndexedDB.
  * Add `extractStandaloneSvg()` in `static/js/studio-utils.js` with computed style inlining and DOMPurify sanitization.
* **Phase 2: Canvas View & Manager**
  * Add `#show-canvas-btn` and `#canvas-container` in `static/index.html`.
  * Implement `CanvasManager` in `static/js/canvas.js` with D3 zoom/pan, drag physics, and card DOM nodes.
  * Wire `activateViewByName('canvas')` in `static/main.js`.
* **Phase 3: Pinning Triggers & Event Bus**
  * Hook up `dataviz:pin-card` custom event listener in `CanvasManager`.
  * Add pin buttons to Agent response bubbles, Vega Studio, Mermaid Studio, and Sankey Studio.
* **Phase 4: Session v2 Integration & Verification**
  * Update `exportSession` and `restoreSessionState` in `static/js/session.js` to serialize `tools.canvas`.
  * Test end-to-end export, browser refresh, IndexedDB restore, and file download/upload.
