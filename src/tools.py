import pandas as pd
import numpy as np
import io
import base64
import sys
import warnings
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
try:
    import seaborn as sns
except ImportError:
    sns = None

import ast
import time
import signal
import threading

# Forbidden function and builtin calls that can bypass sandboxing or perform harmful actions
FORBIDDEN_CALLS = frozenset({
    'exec', 'eval', 'compile', '__import__', 'open',
    'getattr', 'setattr', 'delattr', 'hasattr', 'globals', 'locals',
    'vars', 'dir', 'help', 'breakpoint', 'exit', 'quit', 'input',
    'memoryview', 'system', 'popen', 'spawn'
})

# Forbidden attributes and dunder patterns that could lead to introspection escapes
FORBIDDEN_ATTRS = frozenset({
    '__subclasses__', '__globals__', '__builtins__', '__code__',
    '__import__', '__bases__', '__base__', '__mro__', '__class__',
    '__dict__', '__loader__', '__spec__', '__package__',
    '__reduce__', '__reduce_ex__', '__getattribute__'
})

# Curated safe builtins dictionary (excluding dangerous I/O, compilation, and evaluation builtins)
SAFE_BUILTIN_NAMES = [
    'abs', 'all', 'any', 'bin', 'bool', 'bytes', 'callable',
    'chr', 'complex', 'dict', 'divmod', 'enumerate', 'filter',
    'float', 'format', 'frozenset', 'hash', 'hex', 'int',
    'isinstance', 'issubclass', 'iter', 'len', 'list', 'map',
    'max', 'min', 'next', 'oct', 'ord', 'pow', 'print',
    'range', 'repr', 'reversed', 'round', 'set', 'slice',
    'sorted', 'str', 'sum', 'tuple', 'type', 'zip',
    'True', 'False', 'None',
    'ArithmeticError', 'AssertionError', 'AttributeError', 'IndexError',
    'KeyError', 'NameError', 'StopIteration', 'TypeError', 'ValueError',
    'ZeroDivisionError', 'Exception'
]

_builtins_source = __builtins__ if isinstance(__builtins__, dict) else vars(__builtins__)
SAFE_BUILTINS = {
    k: _builtins_source[k] for k in SAFE_BUILTIN_NAMES if k in _builtins_source
}


class TimeoutTransformer(ast.NodeTransformer):
    """Injects a cooperative timeout check at the head of every loop and function definition."""
    def _create_check_call(self):
        return ast.Expr(
            value=ast.Call(
                func=ast.Name(id='__check_timeout__', ctx=ast.Load()),
                args=[],
                keywords=[]
            )
        )

    def visit_While(self, node):
        self.generic_visit(node)
        node.body.insert(0, self._create_check_call())
        return node

    def visit_For(self, node):
        self.generic_visit(node)
        node.body.insert(0, self._create_check_call())
        return node

    def visit_FunctionDef(self, node):
        self.generic_visit(node)
        node.body.insert(0, self._create_check_call())
        return node


def _validate_and_compile(code: str, timeout_seconds: float = 10.0):
    """
    Parses and verifies untrusted Python code using AST traversal before compilation.
    Rejects imports, dangerous calls, and introspection access.
    Injects a loop/recursion execution timeout watchdog.
    """
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise ValueError(f"Syntax error in code: {e}")

    for node in ast.walk(tree):
        # 1. Reject any import statements
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            mod = getattr(node, 'module', None) or ', '.join(a.name for a in node.names)
            raise ValueError(f"Importing modules is not allowed ({mod}). Use pre-imported pd, np, plt, sns.")

        # 2. Reject calls to forbidden builtins/functions
        if isinstance(node, ast.Call):
            func = node.func
            name = getattr(func, 'id', getattr(func, 'attr', ''))
            if name in FORBIDDEN_CALLS:
                raise ValueError(f"Forbidden call: '{name}()' is not permitted.")

        # 3. Reject access to private/dunder attributes and introspection chains
        if isinstance(node, ast.Attribute):
            attr_name = node.attr
            if attr_name in FORBIDDEN_ATTRS or (attr_name.startswith('__') and attr_name.endswith('__')):
                raise ValueError(f"Access to private/dunder attribute '{attr_name}' is not permitted.")

    # Inject timeout watchdog into loops and function entries
    TimeoutTransformer().visit(tree)
    ast.fix_missing_locations(tree)
    return compile(tree, '<agent-code>', 'exec')


def execute_python_code(df: pd.DataFrame, code: str) -> dict:
    """
    Executes sandboxed Python code with access to pd, np, plt, sns, and df.
    Restricts builtins, blocks imports/introspection, enforces a 10s execution timeout,
    and captures stdout, stderr, and any matplotlib figures created.
    """
    stdout_buf = io.StringIO()
    old_stdout = sys.stdout
    old_stderr = sys.stderr
    sys.stdout = stdout_buf
    sys.stderr = stdout_buf
    images = []

    # Reset any previous matplotlib state
    plt.close('all')

    deadline = time.time() + 10.0

    def check_timeout():
        if time.time() > deadline:
            raise TimeoutError("Code execution exceeded time limit (10 seconds).")

    exec_globals = {
        '__builtins__': SAFE_BUILTINS,
        '__check_timeout__': check_timeout,
        'pd': pd,
        'np': np,
        'plt': plt,
        'sns': sns,
        'df': df.copy()
    }

    # Signal alarm fallback if executed in main thread
    old_alarm_handler = None
    use_signal = (threading.current_thread() is threading.main_thread() and hasattr(signal, 'SIGALRM'))

    try:
        compiled_code = _validate_and_compile(code, timeout_seconds=10.0)

        if use_signal:
            def _alarm_handler(signum, frame):
                raise TimeoutError("Code execution exceeded time limit (10 seconds).")
            old_alarm_handler = signal.signal(signal.SIGALRM, _alarm_handler)
            signal.alarm(10)

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            exec(compiled_code, exec_globals)

        # Check if figures were created
        fig_nums = plt.get_fignums()
        if fig_nums:
            for fig_num in fig_nums:
                fig = plt.figure(fig_num)
                img_buf = io.BytesIO()
                fig.savefig(img_buf, format='png', bbox_inches='tight', dpi=120)
                img_buf.seek(0)
                b64 = base64.b64encode(img_buf.read()).decode('utf-8')
                images.append(f"data:image/png;base64,{b64}")
            plt.close('all')

        captured = stdout_buf.getvalue()
        output_msg = captured.strip() if captured else ""
        if images:
            if output_msg:
                output_msg = f"Generated {len(images)} plot(s) successfully.\nOutput:\n{output_msg}"
            else:
                output_msg = f"Generated {len(images)} plot(s) successfully."
        elif not output_msg:
            output_msg = "Code executed successfully with no output."

        return {
            "output": output_msg,
            "images": images
        }
    except Exception as e:
        plt.close('all')
        captured = stdout_buf.getvalue()
        err_msg = f"Execution error: {str(e)}"
        if captured:
            err_msg = f"{captured.strip()}\n{err_msg}"
        return {
            "output": err_msg,
            "images": []
        }
    finally:
        if use_signal and old_alarm_handler is not None:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, old_alarm_handler)
        sys.stdout = old_stdout
        sys.stderr = old_stderr


def get_dataframe_schema(df: pd.DataFrame) -> str:
    """Extracts schema for the LLM."""
    schema = {
        "columns": list(df.columns),
        "dtypes": {k: str(v) for k, v in df.dtypes.items()},
        "shape": df.shape,
        "sample": df.head(3).to_dict(orient='records')
    }
    return str(schema)

def list_columns(df: pd.DataFrame) -> str:
    """Lists all column names."""
    return f"Columns: {', '.join(df.columns)}"

def get_info(df: pd.DataFrame) -> str:
    """Returns dataframe info."""
    return f"Shape: {df.shape[0]} rows × {df.shape[1]} columns\nColumns: {list(df.columns)}\nDtypes: {df.dtypes.to_dict()}"

def calculate_mean(df: pd.DataFrame, column: str) -> str:
    """Calculates mean of a column."""
    try:
        if not pd.api.types.is_numeric_dtype(df[column]):
            return f"Error: Column '{column}' is not numeric"
        mean_val = df[column].mean()
        return f"Mean of '{column}': {mean_val:.4f}"
    except Exception as e:
        return f"Error: {str(e)}"

def calculate_sum(df: pd.DataFrame, column: str) -> str:
    """Calculates sum of a column."""
    try:
        if not pd.api.types.is_numeric_dtype(df[column]):
            return f"Error: Column '{column}' is not numeric"
        sum_val = df[column].sum()
        return f"Sum of '{column}': {sum_val:.4f}"
    except Exception as e:
        return f"Error: {str(e)}"

def get_unique_values(df: pd.DataFrame, column: str) -> str:
    """Gets unique values in a column."""
    try:
        unique = df[column].unique()
        return f"Unique values in '{column}': {list(unique)[:20]}"  # Limit to 20
    except Exception as e:
        return f"Error: {str(e)}"

def apply_filter(df: pd.DataFrame, column: str, value: str, operator: str = "==") -> pd.DataFrame:
    """Filters the dataframe by column value."""
    try:
        if operator == "==":
            return df[df[column] == value]
        elif operator == ">":
            return df[df[column] > float(value)]
        elif operator == "<":
            return df[df[column] < float(value)]
        elif operator == "contains":
            return df[df[column].astype(str).str.contains(value, na=False)]
        return df
    except Exception as e:
        return df

def get_group_summary(df: pd.DataFrame, group_col: str, agg_col: str, agg_func: str = "mean") -> str:
    """Groups by column and aggregates."""
    try:
        if agg_func == "mean":
            res = df.groupby(group_col)[agg_col].mean()
        elif agg_func == "sum":
            res = df.groupby(group_col)[agg_col].sum()
        elif agg_func == "count":
            res = df.groupby(group_col)[agg_col].count()
        else:
            return "Error: Use mean, sum, or count"
        return res.to_string()
    except Exception as e:
        return f"Error: {str(e)}"

def calculate_correlation(df: pd.DataFrame, col_a: str, col_b: str) -> str:
    """Calculates Pearson correlation."""
    try:
        if not pd.api.types.is_numeric_dtype(df[col_a]) or not pd.api.types.is_numeric_dtype(df[col_b]):
            return "Error: Both columns must be numeric"
        corr = df[col_a].corr(df[col_b])
        return f"Correlation between {col_a} and {col_b}: {corr:.4f}"
    except Exception as e:
        return f"Error: {str(e)}"

def get_statistics(df: pd.DataFrame, column: str) -> str:
    """Returns descriptive statistics."""
    try:
        return df[column].describe().to_string()
    except Exception as e:
        return f"Error: {str(e)}"

def generate_mermaid_pie(df: pd.DataFrame, column: str, title: str = "Data Distribution", top_n: int = 8) -> str:
    """Generates a Mermaid.js pie chart for a categorical column."""
    try:
        if column not in df.columns:
            return f"Error: Column '{column}' not found in dataset"
        counts = df[column].dropna().value_counts()
        if len(counts) == 0:
            return "Error: No data to plot"
        
        top_counts = counts.head(top_n)
        other_sum = counts.iloc[top_n:].sum()
        
        lines = [f'pie title {title}']
        for val, count in top_counts.items():
            clean_label = str(val).replace('"', "'").strip()
            lines.append(f'    "{clean_label}" : {int(count)}')
        if other_sum > 0:
            lines.append(f'    "Other" : {int(other_sum)}')
            
        chart = "\n".join(lines)
        return f"```mermaid\n{chart}\n```"
    except Exception as e:
        return f"Error: {str(e)}"

def generate_mermaid_flowchart(df: pd.DataFrame, source_col: str, target_col: str, agg_col: str = None, agg_func: str = "count", direction: str = "LR") -> str:
    """Generates a Mermaid.js flowchart connecting source and target columns."""
    try:
        if source_col not in df.columns or target_col not in df.columns:
            return f"Error: '{source_col}' or '{target_col}' not found in dataset"
        
        dir_code = "TD" if direction.upper() in ["TD", "TB", "VERTICAL"] else "LR"
        lines = [f"flowchart {dir_code}"]
        
        # Aggregate relationships
        if agg_col and agg_col in df.columns and pd.api.types.is_numeric_dtype(df[agg_col]):
            if agg_func == "sum":
                grouped = df.groupby([source_col, target_col])[agg_col].sum().reset_index()
            elif agg_func == "mean":
                grouped = df.groupby([source_col, target_col])[agg_col].mean().reset_index()
            else:
                grouped = df.groupby([source_col, target_col])[agg_col].count().reset_index()
        else:
            grouped = df.groupby([source_col, target_col]).size().reset_index(name="count")
            agg_col = "count"
        
        # Sort and take top 25 connections to prevent diagram explosion
        grouped = grouped.sort_values(by=agg_col, ascending=False).head(25)
        
        node_id_map = {}
        def get_node_id(name):
            if name not in node_id_map:
                node_id_map[name] = f"node_{len(node_id_map) + 1}"
            return node_id_map[name]
            
        for _, row in grouped.iterrows():
            src = str(row[source_col]).strip()
            tgt = str(row[target_col]).strip()
            val = row[agg_col]
            val_str = f"{val:.1f}" if isinstance(val, float) else f"{val}"
            
            src_id = get_node_id(src)
            tgt_id = get_node_id(tgt)
            
            clean_src = src.replace('"', "'")
            clean_tgt = tgt.replace('"', "'")
            
            lines.append(f'    {src_id}["{clean_src}"] -->|"{val_str}"| {tgt_id}["{clean_tgt}"]')
            
        chart = "\n".join(lines)
        return f"```mermaid\n{chart}\n```"
    except Exception as e:
        return f"Error: {str(e)}"

def generate_mermaid_xy_chart(df: pd.DataFrame, x_col: str, y_col: str, chart_type: str = "bar", title: str = "Data Chart") -> str:
    """Generates a Mermaid.js xychart-beta with bar or line series."""
    try:
        if x_col not in df.columns or y_col not in df.columns:
            return f"Error: '{x_col}' or '{y_col}' not found in dataset"
            
        # Group and summarize numeric values
        if not pd.api.types.is_numeric_dtype(df[y_col]):
            return f"Error: Y column '{y_col}' must be numeric"
            
        grouped = df.groupby(x_col)[y_col].mean().reset_index().head(12)
        x_vals = [f'"{str(x).replace(chr(34), chr(39))[:15]}"' for x in grouped[x_col]]
        y_vals = [f"{round(float(y), 2)}" for y in grouped[y_col]]
        
        series_type = "line" if chart_type.lower() == "line" else "bar"
        
        lines = [
            f'xychart-beta',
            f'    title "{title}"',
            f'    x-axis [{", ".join(x_vals)}]',
            f'    y-axis "{y_col}"',
            f'    {series_type} [{", ".join(y_vals)}]'
        ]
        
        chart = "\n".join(lines)
        return f"```mermaid\n{chart}\n```"
    except Exception as e:
        return f"Error: {str(e)}"

def generate_mermaid_sankey(df: pd.DataFrame, source_col: str, target_col: str, value_col: str = None, agg_func: str = "sum", top_n: int = 25) -> str:
    """Generates a Mermaid.js sankey-beta chart connecting source and target columns, automatically avoiding circular links when source and target have overlapping categories."""
    try:
        if source_col not in df.columns or target_col not in df.columns:
            return f"Error: '{source_col}' or '{target_col}' not found in dataset"
        
        # Aggregate flow relationships
        if value_col and value_col in df.columns and pd.api.types.is_numeric_dtype(df[value_col]):
            if agg_func == "mean":
                grouped = df.groupby([source_col, target_col])[value_col].mean().reset_index()
            elif agg_func == "count":
                grouped = df.groupby([source_col, target_col])[value_col].count().reset_index()
            else:
                grouped = df.groupby([source_col, target_col])[value_col].sum().reset_index()
            measure_col = value_col
        else:
            grouped = df.groupby([source_col, target_col]).size().reset_index(name="count")
            measure_col = "count"
            
        # Filter non-positive, sort descending, and take top_n to keep visualization crisp
        grouped = grouped[grouped[measure_col] > 0]
        grouped = grouped.sort_values(by=measure_col, ascending=False).head(top_n)
        
        if grouped.empty:
            return "Error: No positive flow values to display for Sankey diagram"
            
        # Check if source and target values overlap (e.g. party movements across two elections)
        src_vals = set(grouped[source_col].dropna().astype(str).str.strip())
        tgt_vals = set(grouped[target_col].dropna().astype(str).str.strip())
        has_overlap = bool(src_vals.intersection(tgt_vals))

        lines = ["sankey-beta", ""]
        lines.append(f"%% {source_col} -> {target_col} ({agg_func.upper()} {value_col or 'count'})")
        
        for _, row in grouped.iterrows():
            s = str(row[source_col]).strip().replace('"', "'")
            t = str(row[target_col]).strip().replace('"', "'")
            if has_overlap:
                s = f"{s} ({source_col})"
                t = f"{t} ({target_col})"
            val = row[measure_col]
            val_str = f"{round(float(val), 2)}"
            lines.append(f'"{s}","{t}",{val_str}')
            
        chart = "\n".join(lines)
        return f"```mermaid\n{chart}\n```"
    except Exception as e:
        return f"Error: {str(e)}"

def generate_mermaid_radar(df: pd.DataFrame, axis_col: str, curve_cols: list, agg_func: str = "mean", title: str = "Radar Chart") -> str:
    """Generates a Mermaid.js radar chart comparing multiple numeric metrics across categorical axes."""
    try:
        if axis_col not in df.columns:
            return f"Error: Axis column '{axis_col}' not found in dataset"
        valid_curves = [c for c in curve_cols if c in df.columns and pd.api.types.is_numeric_dtype(df[c])]
        if not valid_curves:
            return "Error: At least one valid numeric column must be selected for radar curves"

        # Group by axis_col and compute aggregation
        if agg_func == "sum":
            grouped = df.groupby(axis_col)[valid_curves].sum()
        elif agg_func == "median":
            grouped = df.groupby(axis_col)[valid_curves].median()
        else:
            grouped = df.groupby(axis_col)[valid_curves].mean()

        # Limit to top 8 axis categories for clean radar layout
        grouped = grouped.head(8)
        if len(grouped) < 3:
            return f"Error: Radar chart requires at least 3 distinct axis categories (found {len(grouped)})"

        clean_axes = [str(ax).strip().replace(' ', '_').replace('-', '_')[:15] or 'Axis' for ax in grouped.index]

        lines = ["radar-beta"]
        if title:
            clean_title = title.replace('"', "'").strip()
            lines.append(f"    title {clean_title}")
        lines.append(f"    axis {', '.join(clean_axes)}")

        for idx, col in enumerate(valid_curves):
            curve_id = f"c{idx + 1}"
            curve_name = col.replace('"', "'")
            val_strs = []
            for val in grouped[col]:
                num_val = 0.0 if pd.isna(val) else round(float(val), 2)
                val_strs.append(str(num_val))
            lines.append(f'    curve {curve_id}["{curve_name}"]{{{", ".join(val_strs)}}}')
        lines.append("    showLegend true")

        chart = "\n".join(lines)
        return f"```mermaid\n{chart}\n```"
    except Exception as e:
        return f"Error: {str(e)}"

def generate_mermaid_treemap(df: pd.DataFrame, cat_col: str, subcat_col: str = None, val_col: str = None, agg_func: str = "sum", title: str = "Treemap") -> str:
    """Generates a Mermaid.js treemap-beta chart representing hierarchical distributions."""
    try:
        if cat_col not in df.columns:
            return f"Error: Category column '{cat_col}' not found in dataset"

        has_subcat = subcat_col and subcat_col in df.columns and subcat_col != cat_col
        has_val = val_col and val_col in df.columns and pd.api.types.is_numeric_dtype(df[val_col])

        lines = ["treemap-beta"]
        root_title = title.replace('"', "'").strip() if title else "Treemap Distribution"
        lines.append(f'    "{root_title}"')

        if has_subcat:
            group_cols = [cat_col, subcat_col]
            if has_val:
                if agg_func == "mean":
                    grouped = df.groupby(group_cols)[val_col].mean().reset_index()
                else:
                    grouped = df.groupby(group_cols)[val_col].sum().reset_index()
                measure = val_col
            else:
                grouped = df.groupby(group_cols).size().reset_index(name="count")
                measure = "count"

            grouped = grouped[grouped[measure] > 0]
            top_cats = grouped.groupby(cat_col)[measure].sum().sort_values(ascending=False).head(8).index

            for cat in top_cats:
                cat_name = str(cat).replace('"', "'").strip() or "Other"
                lines.append(f'        "{cat_name}"')
                sub_df = grouped[grouped[cat_col] == cat].sort_values(by=measure, ascending=False).head(8)
                for _, row in sub_df.iterrows():
                    sub_name = str(row[subcat_col]).replace('"', "'").strip() or "Detail"
                    v = round(float(row[measure]), 2)
                    lines.append(f'            "{sub_name}": {v}')
        else:
            if has_val:
                if agg_func == "mean":
                    grouped = df.groupby(cat_col)[val_col].mean().reset_index()
                else:
                    grouped = df.groupby(cat_col)[val_col].sum().reset_index()
                measure = val_col
            else:
                grouped = df.groupby(cat_col).size().reset_index(name="count")
                measure = "count"

            grouped = grouped[grouped[measure] > 0].sort_values(by=measure, ascending=False).head(12)
            for _, row in grouped.iterrows():
                cat_name = str(row[cat_col]).replace('"', "'").strip() or "Other"
                v = round(float(row[measure]), 2)
                lines.append(f'        "{cat_name}": {v}')

        chart = "\n".join(lines)
        return f"```mermaid\n{chart}\n```"
    except Exception as e:
        return f"Error: {str(e)}"

AVAILABLE_TOOLS = {
    "list_columns": list_columns,
    "get_info": get_info,
    "calculate_mean": calculate_mean,
    "calculate_sum": calculate_sum,
    "get_unique_values": get_unique_values,
    "apply_filter": apply_filter,
    "get_group_summary": get_group_summary,
    "calculate_correlation": calculate_correlation,
    "get_statistics": get_statistics,
    "generate_mermaid_pie": generate_mermaid_pie,
    "generate_mermaid_flowchart": generate_mermaid_flowchart,
    "generate_mermaid_xy_chart": generate_mermaid_xy_chart,
    "generate_mermaid_sankey": generate_mermaid_sankey,
    "generate_mermaid_radar": generate_mermaid_radar,
    "generate_mermaid_treemap": generate_mermaid_treemap,
    "execute_python_code": execute_python_code
}

# Tool descriptions for LLM (fallback textual prompt)
TOOL_DESCRIPTIONS = """
list_columns(): Get all column names
get_info(): Get shape and dtypes
calculate_mean(column): Mean of numeric column
calculate_sum(column): Sum of numeric column
get_unique_values(column): Unique values
get_statistics(column): Summary stats
apply_filter(column, value, operator): Filter data (==, >, <, contains)
get_group_summary(group_col, agg_col, agg_func): Group by and agg (mean, sum, count)
calculate_correlation(col_a, col_b): Pearson correlation
execute_python_code(code): Execute Python code with access to pd, np, plt (matplotlib), sns (seaborn), and df. Create plots using plt and sns - any open figures will be automatically rendered in chat.
generate_mermaid_pie(column, title, top_n): Generate Mermaid pie chart for category distribution
generate_mermaid_flowchart(source_col, target_col, agg_col, agg_func, direction): Generate Mermaid flowchart between columns
generate_mermaid_xy_chart(x_col, y_col, chart_type, title): Generate Mermaid xychart-beta (bar or line)
generate_mermaid_sankey(source_col, target_col, value_col, agg_func, top_n): Generate Mermaid sankey-beta diagram between source and target columns (avoids circular links)
generate_mermaid_radar(axis_col, curve_cols, agg_func, title): Generate Mermaid radar chart comparing multiple numeric metrics
generate_mermaid_treemap(cat_col, subcat_col, val_col, agg_func, title): Generate Mermaid treemap-beta showing hierarchical distribution
"""

# Native OpenAI Tool Definitions
OPENAI_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_columns",
            "description": "Lists all column names in the dataset.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_info",
            "description": "Returns dataset shape, columns, and data types.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_mean",
            "description": "Calculates the mean (average) of a numeric column.",
            "parameters": {
                "type": "object",
                "properties": {
                    "column": {"type": "string", "description": "The name of the column to calculate mean for."}
                },
                "required": ["column"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_sum",
            "description": "Calculates the sum of a numeric column.",
            "parameters": {
                "type": "object",
                "properties": {
                    "column": {"type": "string", "description": "The name of the column to sum."}
                },
                "required": ["column"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_unique_values",
            "description": "Gets unique values (sample up to 20) for a column.",
            "parameters": {
                "type": "object",
                "properties": {
                    "column": {"type": "string", "description": "The column name."}
                },
                "required": ["column"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_statistics",
            "description": "Returns summary descriptive statistics (count, mean, std, min, max, quantiles) for a column.",
            "parameters": {
                "type": "object",
                "properties": {
                    "column": {"type": "string", "description": "The column name."}
                },
                "required": ["column"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "apply_filter",
            "description": "Filters the dataset by a column condition and updates the active dataframe.",
            "parameters": {
                "type": "object",
                "properties": {
                    "column": {"type": "string", "description": "Column to filter on."},
                    "value": {"type": "string", "description": "Value to match or compare against."},
                    "operator": {"type": "string", "enum": ["==", ">", "<", "contains"], "description": "Comparison operator (default '==')."}
                },
                "required": ["column", "value"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_group_summary",
            "description": "Groups the dataset by one column and aggregates another column using mean, sum, or count.",
            "parameters": {
                "type": "object",
                "properties": {
                    "group_col": {"type": "string", "description": "Column to group by."},
                    "agg_col": {"type": "string", "description": "Column to aggregate."},
                    "agg_func": {"type": "string", "enum": ["mean", "sum", "count"], "description": "Aggregation function (mean, sum, count)."}
                },
                "required": ["group_col", "agg_col"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_correlation",
            "description": "Calculates Pearson correlation between two numeric columns.",
            "parameters": {
                "type": "object",
                "properties": {
                    "col_a": {"type": "string", "description": "First numeric column."},
                    "col_b": {"type": "string", "description": "Second numeric column."}
                },
                "required": ["col_a", "col_b"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_mermaid_pie",
            "description": "Generates a Mermaid.js pie chart showing frequency distribution of a categorical column.",
            "parameters": {
                "type": "object",
                "properties": {
                    "column": {"type": "string", "description": "Categorical column to analyze"},
                    "title": {"type": "string", "description": "Title of the chart"},
                    "top_n": {"type": "integer", "description": "Max categories to display (default 8)"}
                },
                "required": ["column"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_mermaid_flowchart",
            "description": "Generates a Mermaid.js flowchart showing relational flow/transitions between two columns.",
            "parameters": {
                "type": "object",
                "properties": {
                    "source_col": {"type": "string", "description": "Source category or start stage"},
                    "target_col": {"type": "string", "description": "Target category or end stage"},
                    "agg_col": {"type": "string", "description": "Optional numeric column to measure link weight"},
                    "agg_func": {"type": "string", "enum": ["count", "sum", "mean"], "description": "Aggregation function"},
                    "direction": {"type": "string", "enum": ["LR", "TD"], "description": "Flowchart layout direction"}
                },
                "required": ["source_col", "target_col"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_mermaid_xy_chart",
            "description": "Generates a Mermaid.js xychart-beta bar or line chart comparing categories to a numeric column.",
            "parameters": {
                "type": "object",
                "properties": {
                    "x_col": {"type": "string", "description": "Categorical or time column for the X-axis"},
                    "y_col": {"type": "string", "description": "Numeric column for the Y-axis"},
                    "chart_type": {"type": "string", "enum": ["bar", "line"], "description": "Chart type"},
                    "title": {"type": "string", "description": "Title of the chart"}
                },
                "required": ["x_col", "y_col"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_mermaid_sankey",
            "description": "Generates a Mermaid.js sankey-beta diagram showing directional flow and volumes between two stages/columns with aggregation (automatically avoids circular loops).",
            "parameters": {
                "type": "object",
                "properties": {
                    "source_col": {"type": "string", "description": "Source category or origin stage column"},
                    "target_col": {"type": "string", "description": "Target category or destination stage column"},
                    "value_col": {"type": "string", "description": "Optional numeric column to measure flow volume"},
                    "agg_func": {"type": "string", "enum": ["sum", "mean", "count"], "description": "Aggregation function (defaults to sum)"},
                    "top_n": {"type": "integer", "description": "Maximum number of top flows to include (defaults to 25)"}
                },
                "required": ["source_col", "target_col"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_mermaid_radar",
            "description": "Generates a Mermaid.js radar chart comparing multiple numerical metrics (curves) across categorical axis dimensions with aggregation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "axis_col": {"type": "string", "description": "Categorical column defining the radar spokes/axes (requires at least 3 distinct values)"},
                    "curve_cols": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of numeric column names to plot as individual radar curves/series"
                    },
                    "agg_func": {"type": "string", "enum": ["mean", "sum", "median"], "description": "Aggregation function for values across each axis category (defaults to mean)"},
                    "title": {"type": "string", "description": "Title of the radar chart"}
                },
                "required": ["axis_col", "curve_cols"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_mermaid_treemap",
            "description": "Generates a Mermaid.js treemap-beta diagram displaying nested hierarchical category proportions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "cat_col": {"type": "string", "description": "Primary high-level category column"},
                    "subcat_col": {"type": "string", "description": "Optional secondary sub-category column for nested nodes"},
                    "val_col": {"type": "string", "description": "Optional numeric column for node area/weights"},
                    "agg_func": {"type": "string", "enum": ["sum", "mean"], "description": "Aggregation method (defaults to sum)"},
                    "title": {"type": "string", "description": "Title/root label of the treemap"}
                },
                "required": ["cat_col"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "execute_python_code",
            "description": "Executes Python data analysis or visualization code. You have access to pd (pandas), np (numpy), plt (matplotlib.pyplot), sns (seaborn), and df (pandas DataFrame). Any plots created with plt/sns will automatically be captured and rendered directly in the user's chat.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Python code to execute. Can calculate metrics or generate matplotlib/seaborn plots (e.g., plt.figure(), sns.barplot(), plt.title(), etc.). Do not call plt.show(); figures are automatically captured."
                    }
                },
                "required": ["code"]
            }
        }
    }
]

