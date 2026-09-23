import os
import re
import json
import inspect
import pandas as pd
import numpy as np
from openai import OpenAI
try:
    from src.tools import AVAILABLE_TOOLS, get_dataframe_schema, OPENAI_TOOLS, CLIENT_DELEGATED_TOOLS
except ImportError:
    from tools import AVAILABLE_TOOLS, get_dataframe_schema, OPENAI_TOOLS, CLIENT_DELEGATED_TOOLS
try:
    from src.agent_skills import normalize_active_skills
except ImportError:
    try:
        from agent_skills import normalize_active_skills
    except ImportError:
        def normalize_active_skills(active_skills):
            return sorted(active_skills) if active_skills else ["dataviz", "data-audit"]


def _sanitize_answer(text: str) -> str:
    """Removes raw LLM tool markup/tokens that might leak into text responses."""
    if not text:
        return "Analysis complete."
    cleaned = re.sub(r'<\|tool_call_start\|>[\s\S]*?(<\|tool_call_end\|>|$)', '', text)
    cleaned = re.sub(r'<tool_call>[\s\S]*?(</tool_call>|$)', '', cleaned)
    cleaned = re.sub(r'<function=[\w_]+>[\s\S]*?(</function>|$)', '', cleaned)
    cleaned = re.sub(r'<parameter=[\w_]+>[\s\S]*?(</parameter>|$)', '', cleaned)
    cleaned = cleaned.strip()
    return cleaned if cleaned else "Analysis and visualization complete."


def _sanitize_records(records):
    """Convert NaN/Inf and numpy types to JSON-safe Python types."""
    sanitized = []
    for r in records:
        nr = {}
        for k, v in r.items():
            # numpy scalars
            if isinstance(v, (np.generic,)):
                try:
                    v = v.item()
                except:
                    v = str(v)
            # NaN or infinite
            try:
                if v is None:
                    nr[k] = None
                    continue
                if isinstance(v, float) and (np.isnan(v) or np.isinf(v)):
                    nr[k] = None
                    continue
            except Exception:
                pass
            nr[k] = v
        sanitized.append(nr)
    return sanitized


class ReActAgent:
    def __init__(
        self,
        df: pd.DataFrame = None,
        api_key: str = None,
        base_url: str = None,
        model_name: str = None,
        active_skills: list = None,
        row_count: int = None,
        dataset_profile: str = None,
        delegate_client_tools: bool = True
    ):
        self.df = df if df is not None else pd.DataFrame()
        self.schema = get_dataframe_schema(self.df)
        self.row_count = row_count if row_count is not None else len(self.df)
        self.dataset_profile = dataset_profile or ""
        self.delegate_client_tools = delegate_client_tools
        self.active_skills = normalize_active_skills(active_skills)
        self.dataviz_on = "dataviz" in self.active_skills
        self.audit_on = "data-audit" in self.active_skills
        
        self.api_key = api_key or os.getenv("LLM_API_KEY") or ""
        self.base_url = (base_url or os.getenv("LLM_BASE_URL") or "https://api.deepseek.com").strip()
        self.model_name = (model_name or os.getenv("LLM_MODEL") or "deepseek-flash").strip()

        extra_headers = {"x-api-key": self.api_key} if ("anthropic" in self.base_url and self.api_key) else None

        self.client = OpenAI(
            api_key=self.api_key or "no-key",
            base_url=self.base_url,
            default_headers=extra_headers
        )

    def _build_response(self, answer: str, logs: list = None, images: list = None, code_blocks: list = None, status: str = "completed") -> dict:
        """Helper to construct standardized agent response dictionary."""
        return {
            "status": status,
            "answer": answer,
            "logs": logs or [],
            "images": images or [],
            "code_blocks": code_blocks or [],
            "df_head": _sanitize_records(self.df.head(5).to_dict(orient='records')) if hasattr(self.df, 'head') else []
        }

    def _execute_tool(self, tool_name: str, tool_args: dict):
        """Executes a tool on the DataFrame and returns an observation and any generated images."""
        if tool_name == "audit_dataset" and not self.audit_on:
            return "Error: Tool 'audit_dataset' is disabled (data-audit skill off).", []
        if tool_name not in AVAILABLE_TOOLS:
            return f"Error: Tool '{tool_name}' not recognized.", []
        
        fn = AVAILABLE_TOOLS[tool_name]
        try:
            if isinstance(tool_args, dict):
                clean_args = {k: v for k, v in tool_args.items() if k not in ['df', 'self']}
                sig = inspect.signature(fn)
                expected_params = [p.name for p in sig.parameters.values() if p.name != 'df']

                # Common alias mapping
                if clean_args and not set(clean_args.keys()).issubset(set(expected_params)):
                    if len(expected_params) >= 1 and len(clean_args) == 1:
                        clean_args = {expected_params[0]: next(iter(clean_args.values()))}
                    else:
                        alias_map = {
                            'arg': 'column', 'col': 'column', 'column_name': 'column', 'cols': 'columns',
                            'group_col': 'group_col', 'groupby': 'group_col', 'group': 'group_col',
                            'agg_col': 'agg_col', 'agg_cols': 'agg_cols',
                            'col_a': 'col_a', 'col_b': 'col_b', 'value': 'value',
                            'script': 'code', 'python_code': 'code', 'py_code': 'code'
                        }
                        mapped = {alias_map.get(k, k): v for k, v in clean_args.items() if alias_map.get(k, k) in expected_params}
                        if mapped:
                            clean_args = mapped
                result = fn(self.df, **clean_args)
            else:
                result = fn(self.df)

            if tool_name == "apply_filter":
                self.df = result
                return f"Filtered dataset to {len(self.df)} rows", []
            
            if isinstance(result, dict) and "output" in result and "images" in result:
                return str(result["output"])[:1000], result.get("images", [])

            return str(result)[:500], []
        except Exception as e:
            return f"Tool execution error: {str(e)}", []

    def _build_system_prompt(self) -> str:
        """Assemble the system prompt, filtering skill blocks by toggle state."""
        row_info = f"Dataset size: {self.row_count:,} total rows.\n" if self.row_count else ""
        profile_info = f"FULL DATASET PROFILE & PRE-COMPUTED METRICS (100% DATA):\n{self.dataset_profile}\n\n" if self.dataset_profile else ""
        base = (
            f"You are a concise, highly efficient data analyst AI.\n"
            f"{row_info}"
            f"Schema:\n{self.schema}\n\n"
            f"{profile_info}"
            "ABOUT THIS WORKBENCH & UI CONTEXT:\n"
            "- The user is interacting with an interactive Data Visualization Workbench.\n"
            "- Other tabs in this app include:\n"
            "  * LineUp: Multi-attribute tabular ranking and column sorting.\n"
            "  * SandDance: Particle-based 3D/2D unit visualizations (scatter, bar, treemap, density).\n"
            "  * Sankey: Live SankeyMatic flow diagrams with customizable palettes, stage disambiguation for election/transition circular-link prevention, and text annotations.\n"
            "  * Mermaid: Diagram and flowchart studio with native Sankey (sankey-beta), Radar charts, Treemap (treemap-beta), Flowchart, Pie, and XY charts.\n"
            "- Next to this chat panel, the user has a 'Live Data State' preview showing the first few rows of the active DataFrame. When you filter or modify data, that preview updates dynamically.\n\n"
            "CRITICAL EXECUTION RULES:\n"
            "1. DUCKDB-WASM ENGINE FOR ACCURATE ANALYTICS: For ANY aggregations, sums, averages, counts, unique values, filtering, group-by metrics, or correlations across the complete dataset, ALWAYS call `execute_sql` with DuckDB SQL targeting table `dataset`. The client executes this query directly on the 100% full dataset in DuckDB-Wasm with zero sampling and exact mathematical precision.\n"
            "2. THINK FIRST: Plan your steps before calling any tool. Do not guess or test randomly.\n"
            "3. NO REDUNDANT EXPLORATION: The columns, data types, and sample data are already given above. Do NOT call `list_columns` or `get_info` unless the user explicitly asked for them.\n"
            "4. BE DECISIVE (TARGET 1-2 STEPS MAX):\n"
            "   - For metrics or calculations, call `execute_sql`.\n"
            "   - For charts or visualizations, write a single `execute_python_code` script prioritizing `seaborn` (`sns`) alongside `matplotlib.pyplot` (`plt`) and `VK_*` helpers.\n"
            "   - Once a plot is generated successfully, do not re-run or repeat plotting code unless there was an explicit Execution error or a LINT warning to fix.\n"
            "5. KEEP IT SHORT & CONCISE: Present direct answers without unnecessary filler text.\n\n"
        )
        if self.audit_on:
            base += (
                "ROUTING (two-track):\n"
                "- fast-path: explicit chart request ('bar chart of X by Y'). Go straight to one `execute_python_code` call.\n"
                "- eda-path: vague request ('analyze revenue', 'what drives churn', 'summarize dataset'). First call `summarize_dataset` or `audit_dataset`, then state 2-3 hypotheses as VisualizationPlan JSON "
                '{"metric, dimension, filter, agg, rollup, intent, mode} intent in [ranking, trend, distribution, group_compare, relation, part_whole, correlation, change_2pt], '
                "mode in [exploration, editorial, narrative]. Execute one plan at a time.\n\n"
            )
        else:
            base += (
                "ROUTING: the data-audit skill is OFF. Use `summarize_dataset` for overviews or go straight to `execute_python_code`.\n\n"
            )
        if self.dataviz_on:
            base += (
                "CHART RULES & STYLE MODES (one chart, one checkable statement):\n"
                "- Mandatory Seaborn: ALWAYS use Seaborn plotting methods (`sns.barplot(data=..., x=..., y=..., ax=ax)`, `sns.lineplot`, `sns.scatterplot`, `sns.histplot`, `sns.boxplot`, `sns.heatmap`) targeting `ax`. Do NOT call raw `ax.bar`, `ax.barh`, or `ax.plot` directly.\n"
                "- Select and apply one of 3 Style Modes for every chart:\n"
                "  1. `editorial` (Journalistic clarity & minimal data-ink): Restrained palette (`color=VK_PRIMARY`), horizontal grid only, left-aligned bold takeaway title with numbers, muted subtitle with units/aggregation/timeframe (e.g. 'USD thousands, monthly sum, 2024'), direct line/bar labels (`ax.bar_label` or `VK_direct_label_last`). Helper: `VK_apply_clean_layout(ax, title, subtitle, source)`.\n"
                "  2. `narrative` (Strategic decision-making & driver storytelling): MECE-sorted categories, comparison base in neutral gray (`VK_GRAY`), single focal driver in vivid accent (`VK_ACCENT`), full-sentence Action Title with numbers ('Segment A drove 68% of margin on 22% of customers'), in-plot callout explaining catalyst. Helper: `VK_apply_narrative_layout(ax, action_title, callout)`. Answer shape: Observation / Driver / Next step.\n"
                "  3. `exploration` (Diagnostic discovery): Faceted small multiples (`sns.FacetGrid`), distribution overlays (`sns.histplot`+KDE, `sns.ecdfplot`), descriptive exploratory titles with sample sizes.\n"
                "- Order in charts: Always sort categorical dimensions by metric value descending (or ascending) before plotting. Use horizontal bars (`y=cat, x=val`) when k>5 or labels are long.\n"
                "- Color restraint: Never assign arbitrary random colors to categories; use 1 uniform hue or highlight 1 driver in accent.\n"
                "- Layout & Title Integrity: NEVER call `ax.set_title()` or manual `ax.text()` loops when using layout helpers. Pass title, subtitle, or callout exclusively to `VK_apply_clean_layout(ax, title, subtitle)` or `VK_apply_narrative_layout(ax, action_title, callout)`. Always set clear axis labels (`ax.set_xlabel(...)`, `ax.set_ylabel(...)`) for continuous coordinates and scatterplots. Use `VK_label_bars(ax, fmt='%.1f')` or `VK_label_bars(ax, fmt='%d')` to label bars directly.\n"
                "- Palette & Highlighting: Never layer raw `ax.barh` on top of `sns.barplot`. For highlighted drivers, pass `palette=[VK_ACCENT if c == driver else VK_GRAY for c in df_sorted['cat']]` directly to `sns.barplot`.\n"
                "- Empirical Grounding: Verify that labels and takeaway titles strictly match the plotted data (e.g. if plotting rural districts, do not label them urban; check values before writing conclusions).\n"
                "- Pre-loaded helpers: VK_apply_clean_layout, VK_apply_narrative_layout, VK_direct_label_last, VK_label_bars, VK_palette, VK_ACCENT, VK_PRIMARY, VK_GRAY.\n"
                "- If the tool observation contains LINT warnings, fix them with one follow-up script.\n\n"
            )
        else:
            base += (
                "CHART INTEGRITY (always on): Use Seaborn (`sns.*`), bar axes start at 0, sort categorical bars by value, no single-series legends, "
                "always label scatter/continuous axes (xlabel/ylabel), and titles must state a takeaway with numbers. Fix LINT warnings on re-run.\n\n"
            )
        base += (
            "VISUALIZATION CAPABILITY:\n"
            "- Python Matplotlib/Seaborn: Use `execute_python_code`. Standard safe libraries (pd, np, plt, sns, math, datetime, scipy) can be imported or used directly. Any figures you generate via `plt` are captured, linted, and rendered directly in the user's chat.\n"
            "- Mermaid diagrams: Use Mermaid tools (`generate_mermaid_sankey`, `generate_mermaid_radar`, `generate_mermaid_treemap`, `generate_mermaid_flowchart`, `generate_mermaid_pie`, `generate_mermaid_xy_chart`) or code blocks."
        )
        return base

    def _active_openai_tools(self) -> list:
        """Return tool schemas minus disabled skills (audit_dataset when off)."""
        if self.audit_on:
            return OPENAI_TOOLS
        return [t for t in OPENAI_TOOLS
                if not (isinstance(t, dict) and t.get("function", {}).get("name") == "audit_dataset")]

    def process_query(self, user_query: str = None, messages: list = None, tool_results: list = None):
        logs = []
        image_runs = []

        def serialize_msg(m):
            if isinstance(m, dict):
                return m
            if hasattr(m, "model_dump"):
                return m.model_dump()
            if hasattr(m, "dict"):
                return m.dict()
            res = {"role": getattr(m, "role", "assistant"), "content": getattr(m, "content", None)}
            if getattr(m, "tool_calls", None):
                res["tool_calls"] = [
                    tc.model_dump() if hasattr(tc, "model_dump") else (tc.dict() if hasattr(tc, "dict") else tc)
                    for tc in m.tool_calls
                ]
            return res

        if messages is None:
            system_prompt = self._build_system_prompt()
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_query or "Please analyze the dataset."}
            ]
        else:
            # Rehydrating conversation from client turn
            messages = [serialize_msg(m) for m in messages]
            if tool_results:
                for tr in tool_results:
                    tr_id = tr.get("tool_call_id") or tr.get("id")
                    tr_content = tr.get("content", "")
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tr_id,
                        "content": str(tr_content)
                    })
                    logs.append(f"Observation (DuckDB-Wasm): {str(tr_content)[:400]}")

        max_steps = 10

        try:
            active_tools = self._active_openai_tools()
            for step in range(max_steps):
                is_last_step = (step == max_steps - 1)

                response = self.client.chat.completions.create(
                    model=self.model_name,
                    messages=messages,
                    tools=active_tools if not is_last_step else None,
                    tool_choice="auto" if not is_last_step else "none",
                    temperature=0.1
                )
                
                choice = response.choices[0]
                message = choice.message
                
                if getattr(message, 'tool_calls', None) and not is_last_step:
                    serialized_assistant = serialize_msg(message)
                    messages.append(serialized_assistant)
                    
                    client_calls = []
                    for tool_call in message.tool_calls:
                        func_name = tool_call.function.name
                        try:
                            func_args = json.loads(tool_call.function.arguments)
                        except Exception:
                            func_args = {}
                        tc_id = tool_call.id
                        
                        if self.delegate_client_tools and func_name in CLIENT_DELEGATED_TOOLS:
                            logs.append(f"Step {step+1} [Delegating to DuckDB-Wasm]: {func_name}({json.dumps(func_args)})")
                            client_calls.append({
                                "id": tc_id,
                                "name": func_name,
                                "arguments": func_args
                            })
                        else:
                            logs.append(f"Step {step+1} [Tool Call]: {func_name}({json.dumps(func_args)})")
                            observation, imgs = self._execute_tool(func_name, func_args)
                            has_lint = "LINT [" in observation or "LINT:" in observation
                            if imgs:
                                # If the previous chart had a lint warning and a new chart was generated to fix it,
                                # drop the previous flawed chart and replace it with the new one.
                                if image_runs and image_runs[-1].get("had_lint"):
                                    image_runs.pop()
                                executed_code = ""
                                if func_name == "execute_python_code" and isinstance(func_args, dict):
                                    executed_code = func_args.get("code") or func_args.get("script") or func_args.get("python_code") or ""
                                image_runs.append({"imgs": imgs, "had_lint": has_lint, "code": executed_code})
                            elif has_lint and image_runs:
                                image_runs[-1]["had_lint"] = True

                            logs.append(f"Observation: {observation}")

                            messages.append({
                                "role": "tool",
                                "tool_call_id": tc_id,
                                "content": observation
                            })

                    if client_calls:
                        collected_images = [img for run in image_runs for img in run.get("imgs", [])]
                        collected_code = [run.get("code", "") for run in image_runs for _ in run.get("imgs", [])]
                        return {
                            "status": "requires_action",
                            "tool_calls": client_calls,
                            "messages": [serialize_msg(m) for m in messages],
                            "logs": logs,
                            "images": collected_images,
                            "code_blocks": collected_code,
                            "df_head": _sanitize_records(self.df.head(5).to_dict(orient='records')) if hasattr(self.df, 'head') else []
                        }

                    if step == max_steps - 2:
                        messages.append({
                            "role": "system",
                            "content": "You have completed your analysis tool execution. Please now synthesize your findings and give your concise final answer to the user."
                        })
                else:
                    raw_answer = message.content or "Analysis complete."
                    answer = _sanitize_answer(raw_answer)
                    logs.append(f"Step {step+1} [Answer]: {answer}")
                    collected_images = [img for run in image_runs for img in run.get("imgs", [])]
                    collected_code = [run.get("code", "") for run in image_runs for _ in run.get("imgs", [])]
                    return self._build_response(answer, logs, collected_images, collected_code)

        except Exception as e:
            err_msg = (
                f"**AI Agent Error**: {str(e)}\n\n"
                f"Please verify that your API key, model name (`{self.model_name}`), and provider base URL (`{self.base_url}`) are valid in Settings."
            )
            logs.append(f"Agent Execution Error: {str(e)}")
            collected_images = [img for run in image_runs for img in run.get("imgs", [])]
            collected_code = [run.get("code", "") for run in image_runs for _ in run.get("imgs", [])]
            return self._build_response(err_msg, logs, collected_images, collected_code)

        last_answer = "Generated the requested chart(s) based on your dataset." if collected_images else "Here is the summary based on the analysis completed."
        collected_images = [img for run in image_runs for img in run.get("imgs", [])]
        collected_code = [run.get("code", "") for run in image_runs for _ in run.get("imgs", [])]
        return self._build_response(_sanitize_answer(last_answer), logs, collected_images, collected_code)

