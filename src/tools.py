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

try:
    from src.vizkit import (
        TOKENS as _VK_TOKENS,
        CATEGORICAL as _VK_CATEGORICAL,
        SINGLE_SERIES_COLOR as _VK_SINGLE,
        HIGHLIGHT_COLOR as _VK_ACCENT,
        BASE_GRAY as _VK_GRAY,
        palette as _vk_palette,
        apply_clean_layout as _vk_clean,
        apply_narrative_layout as _vk_narrative,
        direct_label_last as _vk_direct,
        label_bars as _vk_label_bars,
        inspect as _vk_inspect,
    )
except ImportError:
    try:
        from vizkit import (
            TOKENS as _VK_TOKENS,
            CATEGORICAL as _VK_CATEGORICAL,
            SINGLE_SERIES_COLOR as _VK_SINGLE,
            HIGHLIGHT_COLOR as _VK_ACCENT,
            BASE_GRAY as _VK_GRAY,
            palette as _vk_palette,
            apply_clean_layout as _vk_clean,
            apply_narrative_layout as _vk_narrative,
            direct_label_last as _vk_direct,
            label_bars as _vk_label_bars,
            inspect as _vk_inspect,
        )
    except ImportError:
        _VK_TOKENS = _VK_CATEGORICAL = None
        _VK_SINGLE = _VK_ACCENT = _VK_GRAY = None
        _vk_palette = _vk_clean = _vk_narrative = _vk_direct = _vk_label_bars = _vk_inspect = None

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

import types

# Create virtual 'helpers' module for agent sandbox compatibility
_helpers_module = types.ModuleType("helpers")
_helpers_module.__doc__ = "Visualization helper functions and visual tokens."
_helpers_module.VK_apply_clean_layout = _helpers_module.apply_clean_layout = _vk_clean
_helpers_module.VK_apply_narrative_layout = _helpers_module.apply_narrative_layout = _vk_narrative
_helpers_module.VK_direct_label_last = _helpers_module.direct_label_last = _vk_direct
_helpers_module.VK_label_bars = _helpers_module.label_bars = _vk_label_bars
_helpers_module.VK_palette = _helpers_module.palette = _vk_palette
_helpers_module.VK_ACCENT = _helpers_module.HIGHLIGHT_COLOR = _VK_ACCENT
_helpers_module.VK_PRIMARY = _helpers_module.SINGLE_SERIES_COLOR = _VK_SINGLE
_helpers_module.VK_GRAY = _helpers_module.BASE_GRAY = _VK_GRAY
_helpers_module.VK_TOKENS = _helpers_module.TOKENS = _VK_TOKENS
_helpers_module.VK_CATEGORICAL = _helpers_module.CATEGORICAL = _VK_CATEGORICAL
_helpers_module.inspect = _vk_inspect

sys.modules["helpers"] = _helpers_module

# Allowed module roots for safe sandboxed data science and visualization execution
ALLOWED_ROOT_MODULES = frozenset({
    'pandas', 'numpy', 'matplotlib', 'seaborn',
    'math', 'datetime', 'scipy', 'collections',
    'itertools', 'functools', 're', 'json',
    'vizkit', 'helpers', 'src'
})

def _check_module_allowed(mod_name: str) -> bool:
    if not mod_name:
        return False
    root = mod_name.split('.')[0]
    if root in {'pandas', 'numpy', 'matplotlib', 'seaborn', 'math', 'datetime', 'scipy', 'collections', 'itertools', 'functools', 're', 'json', 'vizkit', 'helpers'}:
        return True
    if root.startswith('VK_') or root.startswith('vk_'):
        return True
    if mod_name == 'src' or mod_name == 'src.vizkit' or mod_name.startswith('src.vizkit.'):
        return True
    return False

def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level != 0:
        raise ImportError("Relative imports are not permitted.")
    if not _check_module_allowed(name):
        raise ImportError(f"Importing module '{name}' is not permitted. Only safe data science and visualization libraries are allowed.")
    if name == 'helpers' or name.startswith('VK_') or name.startswith('vk_'):
        return sys.modules.get('helpers') or __import__(name, globals, locals, fromlist, level)
    return __import__(name, globals, locals, fromlist, level)

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
SAFE_BUILTINS['__import__'] = _safe_import


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
    Enforces whitelisted imports (no wildcard imports), blocks dangerous calls and introspection.
    Injects a loop/recursion execution timeout watchdog.
    """
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise ValueError(f"Syntax error in code: {e}")

    for node in ast.walk(tree):
        # 1. Check import statements against whitelist
        if isinstance(node, ast.Import):
            for alias in node.names:
                if not _check_module_allowed(alias.name):
                    raise ValueError(f"Importing module '{alias.name}' is not allowed. Only safe data science and vizkit/helpers libraries ({', '.join(sorted(ALLOWED_ROOT_MODULES))}) are permitted.")
        elif isinstance(node, ast.ImportFrom):
            if node.level != 0:
                raise ValueError("Relative imports are not permitted.")
            if not node.module or not _check_module_allowed(node.module):
                raise ValueError(f"Importing from module '{node.module}' is not allowed. Only safe data science and vizkit/helpers libraries ({', '.join(sorted(ALLOWED_ROOT_MODULES))}) are permitted.")
            for alias in node.names:
                if alias.name == '*':
                    raise ValueError("Wildcard imports ('from ... import *') are not permitted.")

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


def audit_dataset(df: pd.DataFrame) -> str:
    """Pandas-only health check: missingness, skew, cardinality, id-like cols."""
    try:
        lines = [f"DataHealthReport: {df.shape[0]} rows x {df.shape[1]} cols"]
        miss = df.isna().mean().sort_values(ascending=False)
        for col, frac in miss.items():
            if frac > 0:
                flag = " FLAG >30% missing" if frac > 0.30 else ""
                lines.append(f"- missing {col}: {frac:.1%}{flag}")
        for col in df.select_dtypes(include=[np.number]).columns:
            s = df[col].dropna()
            if len(s) == 0:
                continue
            std = s.std()
            skew = ((s.mean() - s.median()) / std) if std else 0.0
            zero_share = float((s == 0).mean())
            extra = []
            if abs(skew) > 1:
                extra.append(f"skew={skew:.2f}, prefer median/log")
            if zero_share > 0.2:
                extra.append(f"{zero_share:.0%} zeros")
            if s.nunique() <= 1:
                extra.append("constant")
            if extra:
                lines.append(f"- numeric {col}: " + "; ".join(extra))
        for col in df.select_dtypes(exclude=[np.number]).columns:
            k = int(df[col].nunique(dropna=True))
            if k > 50:
                lines.append(f"- high-cardinality {col}: k={k}, avoid raw grouping")
            elif k <= 1:
                lines.append(f"- constant {col}: single value")
        id_like = [c for c in df.columns
                   if any(t in c.lower() for t in ("id", "code", "zip", "phone"))
                   or (pd.api.types.is_integer_dtype(df[c]) and df[c].nunique() == len(df))]
        for col in id_like:
            lines.append(f"- id-like {col}: do not average/sum")
        return "\n".join(lines)
    except Exception as e:
        return f"Error: {str(e)}"


def execute_python_code(df: pd.DataFrame, code: str) -> dict:
    """
    Executes sandboxed Python code with access to pd, np, plt, sns, and df.
    Restricts builtins, blocks imports/introspection, enforces a 10s execution timeout,
    and captures stdout, stderr, and any matplotlib figures created.
    Pre-loaded visual helpers: VK_apply_clean_layout, VK_apply_narrative_layout,
    VK_direct_label_last, VK_palette, VK_ACCENT, VK_PRIMARY, VK_GRAY.
    Figures are linted for baseline/legend/title integrity before export.
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
        'df': df.copy(),
        # Pre-loaded deterministic visual helpers (no imports needed in agent code).
        'VK_TOKENS': _VK_TOKENS,
        'VK_CATEGORICAL': _VK_CATEGORICAL,
        'VK_ACCENT': _VK_ACCENT,
        'VK_PRIMARY': _VK_SINGLE,
        'VK_GRAY': _VK_GRAY,
        'VK_palette': _vk_palette,
        'VK_apply_clean_layout': _vk_clean,
        'VK_apply_narrative_layout': _vk_narrative,
        'VK_direct_label_last': _vk_direct,
        'VK_label_bars': _vk_label_bars,
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

        # Deterministic lint gate: inspect each axes before PNG export.
        # Warnings are returned as text so the ReAct loop can self-correct.
        lint_notes = []
        if _vk_inspect is not None:
            try:
                import matplotlib.pyplot as _plt_check
                for _fig_num in _plt_check.get_fignums():
                    _fig = _plt_check.figure(_fig_num)
                    for _ax in _fig.axes:
                        lint_notes.extend(_vk_inspect(_ax))
            except Exception:
                pass

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
        if lint_notes:
            seen = list(dict.fromkeys(lint_notes))
            output_msg = (output_msg + "\n" if output_msg else "") + "\n".join(seen)
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

def summarize_dataset(df: pd.DataFrame) -> str:
    """Comprehensive dataset summary: shape, dtypes, nulls, numeric stats, top categories, and head preview."""
    try:
        lines = [f"=== DATASET OVERVIEW ({df.shape[0]} rows × {df.shape[1]} columns) ==="]
        
        # Column data types and non-null counts
        lines.append("\n[COLUMNS & DATA TYPES]")
        for col in df.columns:
            non_null = int(df[col].notna().sum())
            pct_null = (df[col].isna().mean()) * 100
            null_str = f" ({pct_null:.1f}% missing)" if pct_null > 0 else ""
            lines.append(f"- {col}: {df[col].dtype} | {non_null}/{len(df)} non-null{null_str}")

        # Numeric column statistics
        num_cols = df.select_dtypes(include=[np.number]).columns
        if len(num_cols) > 0:
            lines.append("\n[NUMERIC SUMMARY]")
            desc = df[num_cols].describe().round(2)
            lines.append(desc.to_string())

        # Categorical / Object columns top values
        cat_cols = df.select_dtypes(exclude=[np.number]).columns
        if len(cat_cols) > 0:
            lines.append("\n[CATEGORICAL SUMMARY]")
            for col in cat_cols:
                n_uniq = int(df[col].nunique(dropna=True))
                top_counts = df[col].value_counts(dropna=True).head(3).to_dict()
                top_str = ", ".join(f"{k}: {v}" for k, v in top_counts.items())
                lines.append(f"- {col} (k={n_uniq} unique): top [{top_str}]")

        # Head preview
        lines.append("\n[SAMPLE DATA (first 5 rows)]")
        lines.append(df.head(5).to_string())

        return "\n".join(lines)
    except Exception as e:
        return f"Error summarizing dataset: {str(e)}"

def calculate_mean(df: pd.DataFrame, column: str = None, columns: list = None) -> str:
    """Calculates mean of one or multiple numeric columns."""
    try:
        target_cols = []
        if columns:
            target_cols = columns if isinstance(columns, list) else [columns]
        elif column:
            target_cols = [column] if isinstance(column, str) else list(column)
        else:
            target_cols = list(df.select_dtypes(include=[np.number]).columns)

        valid_cols = [c for c in target_cols if c in df.columns and pd.api.types.is_numeric_dtype(df[c])]
        if not valid_cols:
            return "Error: No valid numeric columns found."
        if len(valid_cols) == 1:
            return f"Mean of '{valid_cols[0]}': {df[valid_cols[0]].mean():.4f}"
        means = df[valid_cols].mean().round(4).to_dict()
        return "Means: " + ", ".join(f"'{k}': {v}" for k, v in means.items())
    except Exception as e:
        return f"Error: {str(e)}"

def calculate_sum(df: pd.DataFrame, column: str = None, columns: list = None) -> str:
    """Calculates sum of one or multiple numeric columns."""
    try:
        target_cols = []
        if columns:
            target_cols = columns if isinstance(columns, list) else [columns]
        elif column:
            target_cols = [column] if isinstance(column, str) else list(column)
        else:
            target_cols = list(df.select_dtypes(include=[np.number]).columns)

        valid_cols = [c for c in target_cols if c in df.columns and pd.api.types.is_numeric_dtype(df[c])]
        if not valid_cols:
            return "Error: No valid numeric columns found."
        if len(valid_cols) == 1:
            return f"Sum of '{valid_cols[0]}': {df[valid_cols[0]].sum():.4f}"
        sums = df[valid_cols].sum().round(4).to_dict()
        return "Sums: " + ", ".join(f"'{k}': {v}" for k, v in sums.items())
    except Exception as e:
        return f"Error: {str(e)}"

def get_unique_values(df: pd.DataFrame, column: str = None, columns: list = None) -> str:
    """Gets unique values for one or multiple columns."""
    try:
        target_cols = []
        if columns:
            target_cols = columns if isinstance(columns, list) else [columns]
        elif column:
            target_cols = [column] if isinstance(column, str) else list(column)
        else:
            target_cols = list(df.select_dtypes(exclude=[np.number]).columns)
            if not target_cols:
                target_cols = list(df.columns)

        valid_cols = [c for c in target_cols if c in df.columns]
        if not valid_cols:
            return f"Error: None of specified columns {target_cols} were found in dataset."

        if len(valid_cols) == 1:
            col = valid_cols[0]
            unique = list(df[col].unique())
            return f"Unique values in '{col}' ({len(unique)} total): {unique[:25]}"

        lines = []
        for col in valid_cols:
            unique = list(df[col].unique())
            lines.append(f"- '{col}' ({len(unique)} unique): {unique[:15]}")
        return "\n".join(lines)
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

def get_group_summary(df: pd.DataFrame, group_col: str, agg_col: str = None, agg_cols: list = None, agg_func: str = "mean") -> str:
    """Groups by column and aggregates one or multiple columns (mean, sum, count, median, min, max)."""
    try:
        if group_col not in df.columns:
            return f"Error: Group column '{group_col}' not found."
        
        target_cols = []
        if agg_cols:
            target_cols = agg_cols if isinstance(agg_cols, list) else [agg_cols]
        elif agg_col:
            target_cols = [agg_col] if isinstance(agg_col, str) else list(agg_col)
        else:
            target_cols = list(df.select_dtypes(include=[np.number]).columns)

        valid_cols = [c for c in target_cols if c in df.columns]
        if not valid_cols:
            return "Error: No valid aggregation columns found."

        if agg_func not in ("mean", "sum", "count", "median", "min", "max"):
            return "Error: Use mean, sum, count, median, min, or max"

        res = df.groupby(group_col)[valid_cols[0] if len(valid_cols) == 1 else valid_cols].agg(agg_func)
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

def get_statistics(df: pd.DataFrame, column: str = None, columns: list = None) -> str:
    """Returns summary descriptive statistics for one or multiple numeric columns."""
    try:
        target_cols = []
        if columns:
            target_cols = columns if isinstance(columns, list) else [columns]
        elif column:
            target_cols = [column] if isinstance(column, str) else list(column)
        else:
            target_cols = list(df.select_dtypes(include=[np.number]).columns)

        valid_cols = [c for c in target_cols if c in df.columns]
        if not valid_cols:
            return f"Error: None of specified columns {target_cols} were found."
        return df[valid_cols].describe().round(4).to_string()
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

def execute_sql(df: pd.DataFrame = None, query: str = "") -> str:
    """Executes SQL query on dataset (fallback in Python)."""
    try:
        if df is not None and len(df) > 0:
            import sqlite3
            conn = sqlite3.connect(":memory:")
            df.to_sql("dataset", conn, if_exists="replace", index=False)
            res = pd.read_sql_query(query, conn)
            return res.to_json(orient="records", indent=2)
        return "Error: No dataset available for SQL execution."
    except Exception as e:
        return f"SQL Error: {str(e)}"

AVAILABLE_TOOLS = {
    "execute_sql": execute_sql,
    "list_columns": list_columns,
    "get_info": get_info,
    "summarize_dataset": summarize_dataset,
    "audit_dataset": audit_dataset,
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

CLIENT_DELEGATED_TOOLS = frozenset({
    "execute_sql", "audit_dataset", "summarize_dataset", "get_info", "list_columns",
    "calculate_mean", "calculate_sum", "get_statistics", "get_unique_values",
    "calculate_correlation", "get_group_summary"
})

# Tool descriptions for LLM (fallback textual prompt)
TOOL_DESCRIPTIONS = """
execute_sql(query): Execute a SQL query on the full dataset in DuckDB (table name is 'dataset')
list_columns(): Get all column names
get_info(): Get shape and dtypes
summarize_dataset(): Comprehensive overview (shape, dtypes, null counts, numeric statistics, categorical frequencies, head sample)
audit_dataset(): Health check (missingness, skew, cardinality, id-like columns)
calculate_mean(column, columns): Mean of one or multiple numeric columns
calculate_sum(column, columns): Sum of one or multiple numeric columns
get_unique_values(column, columns): Unique values for one, multiple, or all categorical columns
get_statistics(column, columns): Summary stats (describe) for one, multiple, or all numeric columns
apply_filter(column, value, operator): Filter data (==, >, <, contains)
get_group_summary(group_col, agg_col, agg_cols, agg_func): Group by and aggregate one or multiple numeric columns (mean, sum, count, median, min, max)
calculate_correlation(col_a, col_b): Pearson correlation
execute_python_code(code): Execute Python code with access to pd, np, plt, sns (seaborn - prioritized), and df. Create plots using Seaborn (sns.barplot, sns.lineplot, sns.scatterplot, etc.) targeting ax. Figures are automatically captured and rendered in chat.
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
            "name": "execute_sql",
            "description": "Executes a SQL query on the full 100% dataset table 'dataset' in DuckDB. Supports all standard SQL: SELECT, WHERE, GROUP BY, ORDER BY, LIMIT, joins, and aggregates (SUM, AVG, MIN, MAX, COUNT, MEDIAN, STDDEV, QUANTILE_CONT). Always use this for aggregations, metrics, and exact calculations.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "SQL query to execute against table 'dataset'."
                    }
                },
                "required": ["query"]
            }
        }
    },
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
            "name": "summarize_dataset",
            "description": "Returns a comprehensive dataset summary including shape, dtypes, null counts, statistical describe() for numbers, top categories, and head sample preview.",
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
            "name": "audit_dataset",
            "description": "Pandas-only health check: missingness, skew, cardinality, id-like columns. Call first on vague EDA prompts.",
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
            "description": "Calculates the mean (average) of one or multiple numeric columns.",
            "parameters": {
                "type": "object",
                "properties": {
                    "column": {"type": "string", "description": "Single column name."},
                    "columns": {"type": "array", "items": {"type": "string"}, "description": "List of column names."}
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_sum",
            "description": "Calculates the sum of one or multiple numeric columns.",
            "parameters": {
                "type": "object",
                "properties": {
                    "column": {"type": "string", "description": "Single column name."},
                    "columns": {"type": "array", "items": {"type": "string"}, "description": "List of column names."}
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_unique_values",
            "description": "Gets unique values for one, multiple, or all categorical columns in a single call.",
            "parameters": {
                "type": "object",
                "properties": {
                    "column": {"type": "string", "description": "Single column name."},
                    "columns": {"type": "array", "items": {"type": "string"}, "description": "List of column names (e.g. ['department', 'region', 'project'])."}
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_statistics",
            "description": "Returns summary descriptive statistics (count, mean, std, min, max, quantiles) for one, multiple, or all numeric columns in a single call.",
            "parameters": {
                "type": "object",
                "properties": {
                    "column": {"type": "string", "description": "Single column name."},
                    "columns": {"type": "array", "items": {"type": "string"}, "description": "List of column names (e.g. ['budget_k', 'headcount'])."}
                },
                "required": []
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
            "description": "Groups the dataset by one column and aggregates one or multiple columns using mean, sum, count, median, min, or max in a single call.",
            "parameters": {
                "type": "object",
                "properties": {
                    "group_col": {"type": "string", "description": "Column to group by."},
                    "agg_col": {"type": "string", "description": "Single column to aggregate."},
                    "agg_cols": {"type": "array", "items": {"type": "string"}, "description": "List of columns to aggregate (e.g. ['budget_k', 'headcount'])."},
                    "agg_func": {"type": "string", "enum": ["mean", "sum", "count", "median", "min", "max"], "description": "Aggregation function (default 'mean')."}
                },
                "required": ["group_col"]
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
            "description": "Executes Python data visualization or analysis code. You have access to pd, np, plt, sns, df, and pre-loaded VK_* visual helpers (VK_apply_clean_layout, VK_apply_narrative_layout, VK_direct_label_last, VK_label_bars, VK_palette, VK_ACCENT, VK_PRIMARY, VK_GRAY). Always create plots using Seaborn (sns.barplot, sns.lineplot, sns.scatterplot, sns.histplot, sns.boxplot, sns.heatmap) targeting ax.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Python code to execute. For charts: PRIORITIZE Seaborn (e.g. sns.barplot(data=df_sorted, x=..., y=..., ax=ax, palette=[...])) instead of raw ax.bar/ax.barh/ax.plot. Sort categorical data by value, start bar axes at 0, label bars with VK_label_bars(ax, fmt='%.1f') or VK_label_bars(ax, fmt='%d'), apply VK_apply_clean_layout(ax, takeaway_title, subtitle) or VK_apply_narrative_layout(ax, action_title, callout). Do not call ax.set_title() or manual ax.text() for bar labels. Do not call plt.show()."
                    }
                },
                "required": ["code"]
            }
        }
    }
]

