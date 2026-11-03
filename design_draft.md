# SQL-First Minimal-Egress Visualization Architecture & Exact Parity

* **Author:** Mats Schneider
* **Status:** Draft
* **Date:** 2026-11-03

--------------------------------------------------------------------------------

## Overview

Dataviz-Agent combines browser-native analytical tools with an embedded AI copilot. However, analytical execution is currently divided between two distinct runtimes:
1. **Client-Side DuckDB-Wasm:** The authoritative Single Source of Truth (SSOT) operating directly inside the user's browser across 100% of the active dataset.
2. **Server-Side Python Sandbox:** An ephemeral FastAPI backend executing Matplotlib and Seaborn code to render publication-grade narrative charts with layout helpers (`VK_apply_clean_layout`, `VK_apply_narrative_layout`).

Because the browser client previously truncated chat payloads to a 50-row preview (`data.slice(0, 50)`), the Python plotting environment operated on a fractional sample while DuckDB-Wasm calculated statistics across the full dataset. This led to conflicting numbers: textual answers, tables, and takeaway titles reported true full-dataset metrics (e.g. 516 Sales headcount across 250 rows), while the chart's bars and numerical labels plotted the 50-row sample (~100 headcount).

Attempting to resolve this by streaming complete raw datasets over HTTP to Python introduces severe failure modes: multi-megabyte JSON payloads, high latency, gateway `413 Payload Too Large` rejections, and enterprise data privacy leakage.

This specification introduces a **SQL-First Minimal-Egress Projection Architecture** anchored around an atomic tool: `generate_python_chart(sql_query, python_code)`. The agent executes DuckDB SQL locally inside the user's browser to project or aggregate the exact data needed for visualization. Only the lightweight query output (typically < 1 KB) is transmitted to the Python backend to render the chart. Most critically, this architecture establishes a strict **Accuracy Invariant**: all analytics insights must be 100% mathematically grounded in the complete dataset, and whenever an unaggregated query is constrained by a safety cap, an explicit, persistent user-facing warning badge must be displayed.

---

## The Problem

1. **Split-Brain Metric Discrepancies:** Users cannot trust an AI analyst whose chart bars contradict its own textual conclusions. Because backend Pandas was starved with 50 rows while client DuckDB-Wasm had 250+ rows, aggregations computed in Python diverged from SQL calculations.
2. **The Raw Egress Trap:** Datasets in modern analytical workflows often exceed 20,000–100,000 rows. Serializing and re-transmitting entire raw tables in JSON over HTTP on every ReAct chat turn consumes massive bandwidth, stalls client threads, and causes reverse proxy timeouts (`413 Payload Too Large`).
3. **Silent Sampling & Trust Erosion:** When systems silently sample datasets without user awareness, users make decisions on skewed metrics. Any fallback or sampling threshold must be transparently surfaced to the human analyst.
4. **Interactive Invalidation ("Edit Code" Failure):** Pinned and in-chat chart cards allow users to click "Edit Code" and re-run Python snippets via `POST /execute_code`. If the Python script is written against a pre-aggregated schema (e.g. `df` having columns `department` and `headcount`), re-running code against the raw dataset crashes with `KeyError` or schema mismatch.
5. **Multi-Turn LLM Latency:** Separating SQL aggregation and Python plotting into two distinct ReAct turns (`execute_sql` in Turn 1, `execute_python_code` in Turn 2) forces an unnecessary second LLM roundtrip, adding 2–4 seconds of latency per visualization.

---

## Goals

* **100% Value Parity:** Eliminate all discrepancies between chart values and textual metrics by making DuckDB-Wasm the single authoritative compute engine for all data inputs feeding Python plots.
* **Atomic Single-Turn Tooling (`generate_python_chart`):** Combine SQL data projection and Python plotting into a single atomic action, eliminating redundant LLM roundtrips and cutting visualization latency by 50%.
* **Minimal-Egress Transfer:** Restrict HTTP transfers to projected query rows (typically < 10 KB), eliminating `413 Payload Too Large` ingress failures and protecting raw user data privacy.
* **Mandatory Sampling Visibility:** If a query cannot be aggregated and exceeds the client-side safety cap (e.g., a scatter plot hitting 5,000 rows), display an explicit, visible sampling warning badge in the UI and inform the user that metrics reflect a sampled subset.
* **Persistent Card State & Lifecycle:** Store both `sql_query` and `python_code` within the chart card metadata so that user code edits re-query DuckDB-Wasm before re-running Python code.
* **Self-Contained Jupyter Notebook Portability:** Ensure the "Copy Code" button exports a complete, runnable script including the DuckDB connection and SQL query.
* **Zero Viewport-Coupled Prompt Branching:** Maintain uniform execution and rendering across desktop and mobile devices without fragile screen-width branching in system prompts.

---

## Non-Goals

* **Heavy Server-Side Machine Learning:** Training complex models (XGBoost, Random Forests, deep clustering) remains out of scope.
* **In-Browser WebAssembly Python (Pyodide):** No 30 MB+ Pyodide WebAssembly runtime download in the browser. Python execution remains securely contained in the stateless backend sandbox.
* **Multi-Table Relational Joins:** The data model remains centered on the active tabular `dataset` table.
* **Arbitrary In-Memory Server State:** The backend remains strictly stateless; no session databases, file uploads, or cached DataFrame stores on the server.

---

## Critical User Journeys (CUJs)

### CUJ 1: Clean Aggregate Narrative Chart
* **Given**: A user loads the 250-row demo dataset with columns `department` and `headcount`.
* **When**: The user asks: "Show total headcount per department as a horizontal bar chart".
* **Then**: The agent calls `generate_python_chart(sql_query, python_code)`. The browser executes the SQL in DuckDB-Wasm, producing a 5-row table (Sales: 516, Marketing: 438, etc.). The browser sends these 5 rows to `POST /execute_code`. The returned Seaborn chart displays bar lengths and labels of exactly 516, 438, etc., matching the text and takeaway title with 100% accuracy.

### CUJ 2: Sampling Warning on Large Unaggregated Scatter Plot
* **Given**: A user loads an active dataset of 50,000 rows.
* **When**: The user asks: "Plot a scatter plot of revenue vs spend".
* **Then**: The SQL query selects individual points. The client-side egress safety cap detects that the result exceeds 5,000 points. The query is capped at 5,000 rows for rendering, and the chart card renders an explicit warning badge: `⚠️ Displaying sampled subset (5,000 of 50,000 rows). Metric totals should be queried via aggregate SQL.`

### CUJ 3: Interactive "Run Code" Editing
* **Given**: An existing chart card rendered via `generate_python_chart`.
* **When**: The user expands the code drawer, modifies the Seaborn palette or title, and clicks "Run Code".
* **Then**: The card retrieves its bound `sql_query`, re-queries DuckDB-Wasm locally to reconstruct the projected `df`, and dispatches the updated Python script to `/execute_code`, updating the chart smoothly without schema mismatch errors.

--------------------------------------------------------------------------------

## Technical Plan

### 1. High-Level Architecture & Component Interaction

The architecture establishes a strict unidirectional data flow where client-side DuckDB-Wasm remains the Single Source of Truth, and Python operates purely as an on-demand rendering sandbox for projected data:

```mermaid
flowchart TD
    subgraph Browser ["Client Browser (Local Execution & SSOT)"]
        ChatInput["Chat Input (handleSend)"]
        DuckDB[("DuckDB-Wasm (Table: dataset)")]
        SafetyCap{"Egress Guardrail (Count > 5000?)"}
        SampleBadge["⚠️ Sampling Warning Banner"]
        ChartCard["Chat Plot Card (sql + code)"]
        ReRunButton["'Run Code' Handler"]
    end

    subgraph AgentRuntime ["ReAct Agent Orchestration (FastAPI Proxy / Direct)"]
        ReActLoop["ReAct Agent (agent.py)"]
        ToolRegistry["OPENAI_TOOLS & CLIENT_DELEGATED_TOOLS"]
    end

    subgraph BackendSandbox ["Stateless Backend Sandbox (FastAPI)"]
        ExecuteCode["POST /execute_code (main.py)"]
        PythonEngine["execute_python_code (tools.py)"]
        Matplotlib["Seaborn / Matplotlib (Base64 PNG)"]
    end

    ChatInput -->|Prompt + Schema| ReActLoop
    ReActLoop -->|Tool Call: generate_python_chart| ToolRegistry
    ToolRegistry -->|Delegation (requires_action)| ChatInput
    ChatInput -->|1. queryRows(sql_query)| DuckDB
    DuckDB -->|Projected Rows| SafetyCap
    SafetyCap -->|Rows > 5,000| SampleBadge
    SafetyCap -->|Projected Rows <= 5,000| ExecuteCode
    ExecuteCode --> PythonEngine
    PythonEngine --> Matplotlib
    Matplotlib -->|Base64 PNG + Lint Output| ChartCard
    SampleBadge --> ChartCard
    ChartCard -->|State Binding {sql, code}| ReRunButton
    ReRunButton -->|Re-query DuckDB| DuckDB
```

---

### 2. Tool Interface Contract: `generate_python_chart`

In [`src/tools.py`](file:///Users/matsschneider/Documents/Ideas/dataviz-agent/src/tools.py), the new composite tool is declared and registered into `OPENAI_TOOLS` and `CLIENT_DELEGATED_TOOLS`:

```json
{
  "type": "function",
  "function": {
    "name": "generate_python_chart",
    "description": "Generates a publication-quality Seaborn/Matplotlib chart with takeaway titles and clean styling by executing an analytical SQL query against DuckDB-Wasm first, then plotting the projected data in Python.",
    "parameters": {
      "type": "object",
      "properties": {
        "sql_query": {
          "type": "string",
          "description": "DuckDB SQL query targeting table 'dataset' to aggregate or project the exact columns and rows required for plotting."
        },
        "python_code": {
          "type": "string",
          "description": "Python plotting code using seaborn (sns) and matplotlib.pyplot (plt) targeting ax, with pre-loaded VK_* layout helpers. Plotted data is available in DataFrame 'df'."
        }
      },
      "required": ["sql_query", "python_code"]
    }
  }
}
```

#### Tool Routing Rules in Agent System Prompt:
- **Pure calculations, single metrics, or correlation checks:** Call `execute_sql`.
- **Derived columns or dataset transformations:** Call `propose_column`.
- **Publication charts & visualizations:** Call `generate_python_chart`.
- *Deprecation:* `execute_python_code` is removed from active tool choice in chat, preventing models from attempting direct plotting without SQL projection.

---

### 3. Client-Side Execution Pipeline (`static/js/agent.js`)

When the backend returns `status: "requires_action"` with tool call `generate_python_chart`:

#### A. Local DuckDB Execution
The client executes `callArgs.sql_query` directly against DuckDB-Wasm:
```javascript
const rows = await window.duckdbEngine.queryRows(callArgs.sql_query);
```

#### B. Egress Safety Cap & Mandatory Sampling Warning Invariant
To enforce the **100% Data Accuracy Invariant**:
- If `rows.length === 0`: Abort network dispatch and return observation:
  `"Observation: SQL query returned 0 rows. Verify filter criteria and column names."`
- If `rows.length > 5000`: 
  1. The dataset is clamped to the first 5,000 rows for rendering:
     `const renderRows = rows.slice(0, 5000);`
  2. A persistent sampling flag is recorded:
     `const isSampled = true; const totalRowCount = rows.length;`
  3. An explicit warning badge is injected into the rendered card header:
     `<div class="chat-sampling-warning"><i class="fa-solid fa-triangle-exclamation"></i> <strong>Sampled Data:</strong> Displaying 5,000 of ${totalRowCount.toLocaleString()} rows. Summary totals should be queried via aggregate SQL.</div>`
  4. The observation sent back to the agent includes the sampling notice so the agent's textual explanation reflects the sample:
     `"Observation: Rendered with 5,000 rows (sampled from ${totalRowCount} query rows). Warning displayed to user."`
- If `rows.length <= 5000`:
  `isSampled = false;`

#### C. Backend Dispatch (`POST /execute_code`)
The client dispatches the projected rows and code to the existing endpoint:
```javascript
const resp = await fetch('/execute_code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        data: renderRows,
        code: callArgs.python_code
    })
});
```

#### D. Card State Binding & Interactive Editing
The returned Base64 PNG is mounted into a chat plot card. The card DOM element stores both properties:
```javascript
cardEl._plotMetadata = {
    sql: callArgs.sql_query,
    code: callArgs.python_code,
    isSampled: isSampled,
    totalRows: rows.length
};
```

When the user modifies Python code and clicks "Run Code" in `setupPlotCard()`:
1. The handler reads `cardEl._plotMetadata.sql`.
2. It re-executes the SQL query against `window.duckdbEngine.queryRows(cardEl._plotMetadata.sql)` to ensure `df` contains the exact projected schema.
3. It sends the fresh projected rows + edited code to `/execute_code`.

#### E. Self-Contained Jupyter Notebook Export
The card's "Copy Code" action builds a self-contained, reproducible Python snippet:
```python
import duckdb
import pandas as pd
import seaborn as sns
import matplotlib.pyplot as plt

# Query active dataset from DuckDB
con = duckdb.connect()
# Register local data table or replace with your CSV path:
# con.register('dataset', pd.read_csv('your_dataset.csv'))
df = con.execute("""${sql_query}""").df()

# Plotting script
${python_code}

plt.tight_layout()
plt.show()
```

---

### 4. Backend Sandbox Contract (`src/main.py`)

No new backend endpoints are needed. The existing endpoint:
```python
@app.post("/execute_code")
def execute_code_endpoint(request: ExecuteCodeRequest):
```
accepts `ExecuteCodeRequest(code=..., data=...)`. It constructs `df = pd.DataFrame(request.data)` and calls `execute_python_code(df, request.code)`. Because `request.data` now contains the projected rows (typically 5–50 rows), execution completes in < 100ms with negligible memory overhead.

--------------------------------------------------------------------------------

## Alternatives Considered

### 1. Raw Full-Dataset Streaming over HTTP
* **Description:** Forward the entire active in-memory dataset (`data` array up to 50,000 rows) in the JSON payload of every `/chat` request and continuation turn.
* **Rejected by author:** Rejected due to severe transport and infrastructure failure modes. Datasets with 10,000–50,000 rows generate 15 MB–35 MB JSON bodies. In a multi-turn ReAct loop, re-transmitting this payload over WAN adds 15–30 seconds of pure network latency, causes browser main-thread UI jitter during `JSON.stringify()`, and triggers HTTP `413 Payload Too Large` errors on standard reverse proxies (Nginx `client_max_body_size 1M`, AWS API Gateway 10M). Furthermore, transmitting unneeded raw columns over the wire introduces unnecessary enterprise data leakage risks.

### 2. In-Browser Pyodide WebAssembly Sandbox
* **Description:** Run Python, NumPy, Matplotlib, and Seaborn directly inside the browser using Pyodide compiled to WebAssembly, eliminating the backend Python container entirely.
* **Rejected by author:** Rejected due to client resource constraints and mobile fragility. Pyodide requires downloading 25 MB–35 MB of WebAssembly binaries before rendering the first chart. Once initialized, the runtime allocates 200 MB–300 MB of browser memory. On mobile devices (iOS Safari, mobile Chrome), running DuckDB-Wasm and Pyodide concurrently causes the operating system to forcefully kill the browser tab due to out-of-memory limits.

### 3. Universal Vega-Lite (Retire Seaborn Completely)
* **Description:** Eliminate Python Seaborn charting entirely and standardize exclusively on declarative in-browser Vega-Lite JSON specifications.
* **Rejected by author:** Rejected to preserve core user analytical workflows. While Vega-Lite provides interactive brushing and zooming, out-of-the-box it lacks the publication-grade layout discipline provided by Seaborn and the custom `VK_*` helpers (left-aligned bold takeaway titles with exact figures, muted unit subtitles, focal driver accent highlighting). Crucially, users frequently sketch chart drafts in the agent to copy into Jupyter Notebooks; retiring Python plotting breaks seamless copy-paste export into Python data science environments.

### 4. Viewport-Coupled LLM Prompt Branching
* **Description:** Inject the client's screen width into the LLM system prompt and instruct the agent to generate Vega-Lite on screens < 768px and Seaborn on desktop screens.
* **Rejected by author:** Rejected due to architectural anti-patterns and fragile prompt maintenance. Viewport dimensions belong strictly in client CSS layout, not in agent decision trees or system prompts. If a user resizes a browser window or rotates a mobile device, the agent's core capabilities would arbitrarily mutate, invalidating prompt caches and causing tool hallucinations. Furthermore, a 40 KB Base64 PNG generated by Python consumes significantly less volatile client RAM on mobile devices than running client-side WebAssembly visualization engines.

### 5. Dedicated `/execute_chart` Endpoint
* **Description:** Introduce a new dedicated FastAPI route `@app.post("/execute_chart")` specifically for projected chart rendering.
* **Rejected by author:** Rejected due to code duplication and YAGNI. The codebase already provides a production-tested endpoint in `src/main.py:279-294` (`POST /execute_code`) that accepts `ExecuteCodeRequest(code: str, data: List[Any])` and executes sandboxed Python code with AST linting and Base64 PNG capture. Reusing the existing endpoint keeps the backend interface minimal and eliminates redundant maintenance surfaces.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

The implementation is structured into four sequential phases. Each phase leaves the codebase buildable and testable:

### Phase 1: Tool Schema Registration & Prompt Architecture (Backend)

#### [`src/tools.py`](file:///Users/matsschneider/Documents/Ideas/dataviz-agent/src/tools.py)
* **Rationale:** Register the composite `generate_python_chart` tool schema and configure client delegation.
* **Modifications:**
  - Define function schema for `generate_python_chart` in `OPENAI_TOOLS` requiring `sql_query` and `python_code`.
  - Add `"generate_python_chart"` to the `CLIENT_DELEGATED_TOOLS` frozenset so `ReActAgent` yields `status: "requires_action"` to the browser without executing on the server.
  - Define a server-side stub/fallback handler in `AVAILABLE_TOOLS` that logs a clear deprecation message if invoked outside client delegation.

#### [`src/agent.py`](file:///Users/matsschneider/Documents/Ideas/dataviz-agent/src/agent.py)
* **Rationale:** Guide the LLM to use the new atomic projection tool for all visualizations while preserving analytical SQL querying.
* **Modifications:**
  - In `_build_system_prompt()`:
    - Update `CRITICAL EXECUTION RULES: Rule 4 (BE DECISIVE)`: Instruct the agent that when generating charts or visualizations, it must call `generate_python_chart(sql_query, python_code)`.
    - Update `VISUALIZATION CAPABILITY` section: Instruct that `sql_query` must select and aggregate the exact columns and rows required from table `dataset`, and `python_code` has the resulting query rows pre-loaded into DataFrame `df`.
    - Remove `execute_python_code` from the active tool set exposed to the LLM during conversational chat turns.

---

### Phase 2: Client-Side Execution Pipeline & Egress Guardrail (Frontend)

#### [`static/js/agent.js`](file:///Users/matsschneider/Documents/Ideas/dataviz-agent/static/js/agent.js)
* **Rationale:** Intercept the atomic tool call, query DuckDB-Wasm locally, enforce egress guardrails, dispatch to the Python sandbox, and bind metadata to the chat card.
* **Modifications:**
  - In `handleSend()` tool result loop:
    - Add handler branch for `callName === 'generate_python_chart'`.
    - Execute `sql_query` via `window.duckdbEngine.queryRows(callArgs.sql_query)`.
    - Enforce the **Sampling Warning Invariant**:
      - If `rows.length === 0`: Return tool error observation without hitting network.
      - If `rows.length > 5000`: Set `isSampled = true`, slice to 5,000 rows for rendering, and record `totalRows = rows.length`.
      - If `rows.length <= 5000`: Set `isSampled = false`.
    - POST `{ data: renderRows, code: callArgs.python_code }` to `POST /execute_code`.
    - Ingest returned Base64 PNG into `collectedPlots` array for immediate card mounting.
    - Return execution confirmation observation into `toolResults` for the agent's textual summary.
  - In `renderPlotCard()`:
    - Accept `plotMetadata` containing `{ sql, code, isSampled, totalRows }`.
    - If `isSampled` is true, inject the sampling warning badge into the card header.
  - In `setupPlotCard()`:
    - Update "Run Code" click handler: When re-executing edited Python code, check for card's bound `sql` query. If present, re-execute `window.duckdbEngine.queryRows(card.sql)` to repopulate `df` with the projected schema before POSTing to `/execute_code`.
    - Update "Copy Code" click handler: Export a self-contained script prepending the DuckDB query and imports.
  - In `extractCodeBlocksFromLogs()`:
    - Update regex matching to extract code blocks from both `execute_python_code` and `generate_python_chart`.

---

### Phase 3: Visual Presentation & Warning Banner (Styling)

#### [`static/style.css`](file:///Users/matsschneider/Documents/Ideas/dataviz-agent/static/style.css)
* **Rationale:** Provide a clean, high-visibility warning badge when sampling occurs, matching the design system.
* **Modifications:**
  - Add styles for `.chat-sampling-warning`:
    - Yellow/Amber muted border and subtle background tint (`var(--warning-bg)` or `rgba(245, 158, 11, 0.1)`).
    - Compact typography, warning icon (`fa-triangle-exclamation`), and clear explanation.
    - Positioned directly above the rendered chart figure inside `.chat-plot-card`.

---

### Phase 4: Verification, Automated Testing & Documentation

#### [`tests/test_agent.py`](file:///Users/matsschneider/Documents/Ideas/dataviz-agent/tests/test_agent.py)
* **Rationale:** Verify tool schema registration, client delegation tagging, and prompt consistency.
* **Modifications:**
  - Test `generate_python_chart` schema presence in `OPENAI_TOOLS`.
  - Assert that `generate_python_chart` is present in `CLIENT_DELEGATED_TOOLS`.
  - Test `POST /execute_code` with projected synthetic payloads (5 rows) verifying 100% aggregation parity and Base64 PNG generation.

#### [`tests/test_comprehensive.py`](file:///Users/matsschneider/Documents/Ideas/dataviz-agent/tests/test_comprehensive.py)
* **Rationale:** Guard against regressions in existing analytics tools (`execute_sql`, `propose_column`).
* **Modifications:**
  - Assert that `execute_sql` remains fully operational for non-visual analytical queries.
  - Verify that `propose_column` retains its preview and confirmation lifecycle.



