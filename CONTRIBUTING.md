# Contributing to Dataviz-Agent

Thank you for your interest in contributing to **Dataviz-Agent**! This document provides an in-depth guide to our codebase architecture, development setup, security model, coding standards, and pull request workflow.

---

## Philosophy & Architecture Principles

- **Local-First Visual Computation**: Whenever possible, visualizations and fast metric computations run in the browser without server roundtrips.
- **Minimalist & Pragmatic Architecture**: We value clean, readable code and native browser/platform features over heavy abstraction layers or speculative frameworks.
- **AST-Sandboxed Agent Execution**: Backend tools for the AI agent are statically validated via AST parsing, executing in a strictly controlled namespace with cooperative execution timeouts.
- **Responsive & Tokenized Design**: The frontend utilizes a centralized CSS token system (`variables.css`) supporting fluid responsiveness from 4K displays down to mobile viewports.

---

## Codebase Structure

```
dataviz-agent/
├── src/                         # Python backend application
│   ├── __init__.py
│   ├── main.py                  # FastAPI application, routing, CORS, model validation, static mounts
│   ├── agent.py                 # ReActAgent loop, OpenAI client orchestration, prompt synthesis
│   └── tools.py                 # AST Python sandbox, Pandas/Matplotlib tools, Mermaid & Sankey generators
├── static/                      # Vanilla JS/CSS client application
│   ├── index.html               # Main application layout and modal templates
│   ├── style.css                # Component styles, responsive media queries, and layouts
│   ├── variables.css            # Color tokens, typography, dark mode CSS variables
│   ├── main.js                  # UI controller, file ingestion, event bus, tab routing, LineUp setup
│   ├── favicon.ico              # Application favicon
│   └── js/
│       ├── agent.js             # Chat UI, streaming message handler, ReAct step visualization
│       ├── graphic-walker.js    # Graphic-Walker container & lifecycle management
│       ├── mermaid.js           # Mermaid studio rendering, syntax editor, and pan/zoom canvas
│       ├── mermaid-config.js    # Mermaid configuration & custom dark themes
│       ├── sanddance.js         # Microsoft SandDance 3D unit canvas integration
│       ├── sankey.js            # D3-sankey flowchart engine and SVG export
│       ├── data-transform.js    # Client-side data parsing, type inference, filtering utilities
│       └── settings.js          # Model provider management, BYOK localStorage, key tester
├── concepts/                    # Internal design documents & backlog tracking
│   ├── BUGS.md                  # Tracked UI/UX bugs and verified fixes
│   ├── IDEAS.md                 # Feature roadmap & exploration notes
│   ├── MERMAID_PLAN.md          # Mermaid diagram studio architecture plan
│   └── header_prototypes.html   # UI prototyping scratchpad
├── .agents/                     # AI assistant workflows, rules, and skills
├── requirements.txt             # Core Python dependencies
├── Dockerfile                   # Production container build definition
├── README.md                    # Project introduction & feature breakdown (rendered in-app Docs modal)
├── SELF-HOSTING.md              # Production deployment & self-hosting instructions
└── CONTRIBUTING.md              # Developer & contributor guide
```

---

## Development Setup

### Prerequisites

- **Python**: Version 3.10 or newer (Python 3.10 – 3.14 supported).
- **Modern Web Browser**: Chrome, Firefox, Safari, or Edge with WebGL support for 3D SandDance.
- **Node / Package Manager**: Not strictly required (frontend dependencies are loaded via ESM/CDN).
- **Git**: For version control.

### Step-by-Step Setup

1. **Fork and clone the repository**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/dataviz-agent.git
   cd dataviz-agent
   ```

2. **Create and activate a virtual environment**:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Launch the development server**:
   ```bash
   uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
   ```

5. **Open in browser**:
   Navigate to [http://localhost:8000](http://localhost:8000). With `--reload` active, Python edits trigger automatic reload; edits to `static/` files are visible immediately on browser refresh.

---

## How to Add New Features

### 1. Adding a New Agent Tool (Backend)

The agent uses tools defined in [src/tools.py](file:///home/mats/dataviz-agent/src/tools.py) for both schema-guided function calling and reasoning-step generation.

> [!IMPORTANT]
> **AST Sandboxing & Security Rules**:
> All Python code executed by the agent passes through an AST security scanner:
> - **Forbidden Calls**: `exec`, `eval`, `compile`, `__import__`, `open`, `getattr`, `setattr`, `globals`, `locals`, `system`, `popen`, etc.
> - **Forbidden Dunder Attributes**: `__subclasses__`, `__globals__`, `__builtins__`, `__code__`, `__dict__`, etc.
> - **Loop Protection**: Loops are automatically injected with `TimeoutTransformer` checks to prevent infinite loops.

To add a new tool:

1. **Define the tool function** in [src/tools.py](file:///home/mats/dataviz-agent/src/tools.py):
   ```python
   def calculate_my_metric(df: pd.DataFrame, column: str) -> str:
       """Calculates a custom metric for a specified column."""
       if column not in df.columns:
           return f"Error: Column '{column}' not found in dataset."
       # Perform computation safely with Pandas/NumPy...
       val = df[column].mean()
       return f"Result: {val:.4f}"
   ```

2. **Register in `AVAILABLE_TOOLS`**:
   Add your function reference to `AVAILABLE_TOOLS` in `src/tools.py`.

3. **Add OpenAPI Tool Schema**:
   Add the JSON schema definition to `OPENAI_TOOLS` in `src/tools.py` for function-calling models.

4. **Update `TOOL_DESCRIPTIONS`**:
   Ensure text-based fallback models receive a concise description in `TOOL_DESCRIPTIONS`.

---

### 2. Adding a New Visualization Tab (Frontend)

1. **Add Tab Navigation Button**:
   In `static/index.html`, add a button inside `#view-controls` with an appropriate icon, label, and title attribute.

2. **Add Container Element & Collapsible Banner**:
   Add the container in `static/index.html`:
   ```html
   <div id="my-vis-container" class="vis-container hidden">
     <div class="tab-intro-banner">
       <div class="tab-intro-header">
         <span class="tab-intro-title">My Visualizer</span>
         <div class="tab-intro-actions">
           <button class="tab-intro-info-btn" aria-label="Toggle description">ℹ️</button>
         </div>
       </div>
       <p class="tab-intro-desc">Description of what this visualizer does...</p>
     </div>
     <div id="my-vis-canvas-wrapper" class="canvas-wrapper">
       <!-- Visualization output -->
     </div>
   </div>
   ```

3. **Implement Module Script**:
   Create `static/js/my-vis.js` exporting initialization, data update, and resize handlers.

4. **Hook into Tab Navigation**:
   In `static/main.js`, bind the tab button click event and call your visualizer's lifecycle functions when switching active views.

---

### 3. Adding a New AI Model Provider Preset

1. In [src/main.py](file:///home/mats/dataviz-agent/src/main.py), add the provider definition to `PROVIDER_PRESETS`:
   ```python
   {
       "id": "my-provider",
       "name": "My Provider Name",
       "model": "my-model-name",
       "base_url": "https://api.myprovider.com/v1"
   }
   ```
2. Ensure endpoint compatibility with the standard OpenAI format (`/v1/models` and `/v1/chat/completions`).
3. Test connectivity using the `/validate_key` endpoint in the in-app AI Settings dialog.

---

## Coding & Style Guidelines

### Python Standards
- Adhere to **PEP 8** formatting and style conventions.
- Use explicit type hints for function arguments and return values (`df: pd.DataFrame`, `col: str -> str`).
- Handle errors gracefully and return descriptive strings rather than unhandled tracebacks to the agent.
- Keep server dependencies lean; avoid adding heavy unnecessary binaries.

### Frontend Standards
- Use **modern Vanilla JavaScript (ES6+)** with standard DOM APIs.
- Utilize CSS custom properties defined in `variables.css` for colors, spacing, and typography.
- **Responsive Layout Rules**:
  - Keep headers compact on medium screens (`@media (max-width: 1300px)`).
  - Collapse view tab labels cleanly on tablet screens (`@media (max-width: 1100px)`).
  - Support horizontal tab scrolling and collapsible banner descriptions (`.tab-intro-info-btn`) on mobile devices (`@media (max-width: 768px)`).
- Ensure all interactive buttons and inputs have accessible `title` or `aria-label` attributes.

---

## Pull Request Workflow

1. **Create a Feature Branch**:
   ```bash
   git checkout -b feature/my-amazing-feature
   ```
2. **Commit Your Changes**:
   Write clear, concise commit messages following conventional commits (e.g. `feat: add boxplot tool to python agent`, `fix: handle null values in sankey generator`).
3. **Test Locally**:
   - Verify that all visualizer tabs initialize and render sample datasets.
   - Run the AI agent against different prompts to test tool calling and code execution.
   - Verify `/health` and `/validate_key` endpoints return valid HTTP responses.
4. **Push and Open a Pull Request**:
   - Push to your fork: `git push origin feature/my-amazing-feature`.
   - Open a PR against the `main` branch.
   - Provide a clear summary of what was added or fixed, including screenshots or GIFs for UI changes.

---

## Questions or Need Help?

Feel free to open an issue or start a discussion on GitHub if you have questions, architectural proposals, or need guidance on implementation!
