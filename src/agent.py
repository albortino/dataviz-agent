import os
import json
import inspect
import pandas as pd
import numpy as np
from openai import OpenAI
try:
    from src.tools import AVAILABLE_TOOLS, get_dataframe_schema, OPENAI_TOOLS
except ImportError:
    from tools import AVAILABLE_TOOLS, get_dataframe_schema, OPENAI_TOOLS


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
    def __init__(self, df: pd.DataFrame, api_key: str = None, base_url: str = None, model_name: str = None):
        self.df = df
        self.schema = get_dataframe_schema(df)
        
        self.api_key = api_key or os.getenv("LLM_API_KEY") or ""
        self.base_url = (base_url or os.getenv("LLM_BASE_URL") or "https://api.deepseek.com").strip()
        self.model_name = (model_name or os.getenv("LLM_MODEL") or "deepseek-flash").strip()

        extra_headers = {"x-api-key": self.api_key} if ("anthropic" in self.base_url and self.api_key) else None

        self.client = OpenAI(
            api_key=self.api_key or "no-key",
            base_url=self.base_url,
            default_headers=extra_headers
        )

    def _build_response(self, answer: str, logs: list = None, images: list = None) -> dict:
        """Helper to construct standardized agent response dictionary."""
        return {
            "answer": answer,
            "logs": logs or [],
            "images": images or [],
            "df_head": _sanitize_records(self.df.head(5).to_dict(orient='records'))
        }

    def _execute_tool(self, tool_name: str, tool_args: dict):
        """Executes a tool on the DataFrame and returns an observation and any generated images."""
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
                            'arg': 'column', 'col': 'column', 'column_name': 'column',
                            'group_col': 'group_col', 'agg_col': 'agg_col',
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

    def process_query(self, user_query: str):
        logs = []
        collected_images = []
        system_prompt = (
            f"You are a concise, highly efficient data analyst AI. You have access to a dataset with schema:\n{self.schema}\n\n"
            "ABOUT THIS WORKBENCH & UI CONTEXT:\n"
            "- The user is interacting with an interactive Data Visualization Workbench.\n"
            "- Other tabs in this app include:\n"
            "  * LineUp: Multi-attribute tabular ranking and column sorting.\n"
            "  * SandDance: Particle-based 3D/2D unit visualizations (scatter, bar, treemap, density).\n"
            "  * Sankey: Live SankeyMatic flow diagrams with customizable palettes, stage disambiguation for election/transition circular-link prevention, and text annotations.\n"
            "  * Mermaid: Diagram and flowchart studio with native Sankey (sankey-beta), Radar charts, Treemap (treemap-beta), Flowchart, Pie, and XY charts.\n"
            "- Next to this chat panel, the user has a 'Live Data State' preview showing the first few rows of the active DataFrame. When you filter or modify data, that preview updates dynamically.\n\n"
            "CRITICAL EXECUTION RULES:\n"
            "1. THINK FIRST: Plan your steps before calling any tool. Do not guess or test randomly.\n"
            "2. NO REDUNDANT EXPLORATION: The columns, data types, and sample data are already given above. Do NOT call `list_columns` or `get_info` unless the user explicitly asked for them.\n"
            "3. BE DECISIVE (TARGET 1-2 STEPS MAX):\n"
            "   - For metrics or calculations, call the specific aggregation tool or write one short script with `execute_python_code`.\n"
            "   - For charts or visualizations, write a single `execute_python_code` script using `plt`/`sns` that computes the data and plots it simultaneously.\n"
            "   - Once a plot is generated successfully, do not re-run or repeat plotting code unless there was an explicit Execution error.\n"
            "4. KEEP IT SHORT & CONCISE: Present direct answers without unnecessary filler text.\n\n"
            "VISUALIZATION CAPABILITY:\n"
            "- Python Matplotlib/Seaborn: Use `execute_python_code`. Any figures you generate via `plt` are captured and rendered directly in the user's chat.\n"
            "- Mermaid diagrams: Use Mermaid tools (`generate_mermaid_sankey`, `generate_mermaid_radar`, `generate_mermaid_treemap`, `generate_mermaid_flowchart`, `generate_mermaid_pie`, `generate_mermaid_xy_chart`) or code blocks."
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_query}
        ]

        max_steps = 5

        try:
            for step in range(max_steps):
                is_last_step = (step == max_steps - 1)
                
                response = self.client.chat.completions.create(
                    model=self.model_name,
                    messages=messages,
                    tools=OPENAI_TOOLS if not is_last_step else None,
                    tool_choice="auto" if not is_last_step else "none",
                    temperature=0.1
                )
                
                choice = response.choices[0]
                message = choice.message
                
                if getattr(message, 'tool_calls', None) and not is_last_step:
                    messages.append(message)
                    for tool_call in message.tool_calls:
                        func_name = tool_call.function.name
                        try:
                            func_args = json.loads(tool_call.function.arguments)
                        except Exception:
                            func_args = {}
                        
                        logs.append(f"Step {step+1} [Tool Call]: {func_name}({json.dumps(func_args)})")
                        observation, imgs = self._execute_tool(func_name, func_args)
                        if imgs:
                            collected_images.extend(imgs)
                        logs.append(f"Observation: {observation}")

                        messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": observation
                        })

                    if step == max_steps - 2:
                        messages.append({
                            "role": "system",
                            "content": "You have completed your analysis tool execution. Please now synthesize your findings and give your concise final answer to the user."
                        })
                else:
                    answer = message.content or "Analysis complete."
                    logs.append(f"Step {step+1} [Answer]: {answer}")
                    return self._build_response(answer, logs, collected_images)

        except Exception as e:
            err_msg = (
                f"**AI Agent Error**: {str(e)}\n\n"
                f"Please verify that your API key, model name (`{self.model_name}`), and provider base URL (`{self.base_url}`) are valid in Settings."
            )
            logs.append(f"Agent Execution Error: {str(e)}")
            return self._build_response(err_msg, logs, collected_images)

        last_answer = "Generated the requested chart(s) based on your dataset." if collected_images else "Here is the summary based on the analysis completed."
        return self._build_response(last_answer, logs, collected_images)

