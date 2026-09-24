/**
 * Browser-Direct ReAct Agent Module
 * Executes LLM queries directly from the browser (bypassing backend server).
 * Enables VPN-restricted private Azure OpenAI endpoints to communicate with DuckDB-Wasm.
 */

/**
 * Checks if a given URL points to Azure OpenAI
 */
export function isAzureEndpoint(url) {
    if (!url) return false;
    return url.includes('openai.azure.com') || url.includes('azure.com');
}

/**
 * Normalizes Azure OpenAI endpoint URL to root resource domain
 */
export function cleanAzureEndpoint(url) {
    let clean = (url || '').trim();
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
        clean = `https://${clean}`;
    }
    return clean.replace(/\/+$/, '').replace(/\/openai(\/.*)?$/, '');
}

/**
 * Resolves standard OpenAI / DeepSeek / OpenAI-compatible completion endpoint
 */
export function resolveOpenAIEndpoint(url) {
    let clean = (url || '').trim();
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
        clean = `https://${clean}`;
    }
    clean = clean.replace(/\/+$/, '');
    if (clean.endsWith('/chat/completions')) return clean;
    if (clean.endsWith('/v1')) return `${clean}/chat/completions`;
    if (clean.includes('api.deepseek.com') || clean.includes('/v1beta/openai')) return `${clean}/chat/completions`;
    return `${clean}/v1/chat/completions`;
}

/**
 * Validates direct LLM credentials from the browser.
 * Useful for VPN endpoints that the backend cannot reach.
 */
export async function validateBrowserDirectConnection({ apiKey, baseUrl, model, apiVersion, timeout = 2000 }) {
    const key = (apiKey || '').trim();
    const url = (baseUrl || '').trim();
    const mdl = (model || '').trim() || 'gpt-4o';
    const isLocal = url.includes('localhost') || url.includes('127.0.0.1');

    if (!key && !isLocal) {
        return {
            valid: false,
            error: 'No API Key configured. Please enter your API key in Settings.',
            model: mdl
        };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
        let testUrl = '';
        let body = null;
        const headers = { 'Content-Type': 'application/json' };

        if (isAzureEndpoint(url)) {
            const endpoint = cleanAzureEndpoint(url);
            const ver = (apiVersion || '').trim() || '2024-10-21';
            testUrl = `${endpoint}/openai/deployments/${encodeURIComponent(mdl)}/chat/completions?api-version=${encodeURIComponent(ver)}`;
            headers['api-key'] = key;
            body = JSON.stringify({
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 1
            });
        } else {
            const endpoint = resolveOpenAIEndpoint(url);
            testUrl = endpoint;
            if (key) headers['Authorization'] = `Bearer ${key}`;
            body = JSON.stringify({
                model: mdl,
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 1
            });
        }

        const resp = await fetch(testUrl, {
            method: 'POST',
            headers,
            body,
            signal: controller.signal
        });
        clearTimeout(timer);

        if (resp.status >= 200 && resp.status < 300) {
            return { valid: true, model: mdl, provider_url: url };
        } else if (resp.status === 401) {
            return { valid: false, error: 'Unauthorized (401). Invalid API Key.', model: mdl };
        } else if (resp.status === 403) {
            return { valid: false, error: 'Forbidden (403). Check access permissions or VNet.', model: mdl };
        } else if (resp.status === 404) {
            return { valid: false, error: `Deployment '${mdl}' not found (404).`, model: mdl };
        } else {
            if (resp.status === 400) {
                return { valid: true, model: mdl, provider_url: url };
            }
            return { valid: false, error: `Provider error (${resp.status})`, model: mdl };
        }
    } catch (e) {
        clearTimeout(timer);
        if (e.name === 'AbortError') {
            return { valid: false, error: 'Timeout after 2s', model: mdl, timeout: true };
        }
        return {
            valid: false,
            error: e.message || 'Direct connection failed.',
            model: mdl
        };
    }
}

/**
 * OpenAI Tool definitions for in-browser execution with DuckDB-Wasm
 */
export const BROWSER_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'execute_sql',
            description: "Executes a SQL query on the full dataset table 'dataset' in DuckDB. Supports standard SQL: SELECT, WHERE, GROUP BY, ORDER BY, LIMIT, and aggregates (SUM, AVG, MIN, MAX, COUNT, MEDIAN). Always use this for aggregations, metrics, and exact calculations.",
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: "SQL query to execute against table 'dataset'." }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_columns',
            description: 'Lists all column names in the dataset.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_info',
            description: 'Returns dataset row count, columns, and data types.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'summarize_dataset',
            description: 'Returns comprehensive dataset summary including shape, dtypes, null counts, numeric statistics, and head sample preview.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'audit_dataset',
            description: 'Health check of the dataset: missingness, skew, cardinality, and ID-like columns.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_statistics',
            description: 'Returns summary descriptive statistics for one, multiple, or all numeric columns.',
            parameters: {
                type: 'object',
                properties: {
                    column: { type: 'string', description: 'Single column name.' },
                    columns: { type: 'array', items: { type: 'string' }, description: 'List of column names.' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'calculate_correlation',
            description: 'Calculates Pearson correlation between two numeric columns.',
            parameters: {
                type: 'object',
                properties: {
                    col_a: { type: 'string', description: 'First numeric column.' },
                    col_b: { type: 'string', description: 'Second numeric column.' }
                },
                required: ['col_a', 'col_b']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'calculate_sum',
            description: 'Calculates the sum of a numeric column.',
            parameters: {
                type: 'object',
                properties: {
                    column: { type: 'string', description: 'Column name.' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'calculate_mean',
            description: 'Calculates the average/mean of a numeric column.',
            parameters: {
                type: 'object',
                properties: {
                    column: { type: 'string', description: 'Column name.' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_unique_values',
            description: 'Gets unique distinct values for a categorical column.',
            parameters: {
                type: 'object',
                properties: {
                    column: { type: 'string', description: 'Column name.' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_group_summary',
            description: 'Groups dataset by one column and aggregates another column (mean, sum, count, min, max).',
            parameters: {
                type: 'object',
                properties: {
                    group_col: { type: 'string', description: 'Column to group by.' },
                    agg_col: { type: 'string', description: 'Column to aggregate.' },
                    agg_func: { type: 'string', enum: ['mean', 'sum', 'count', 'min', 'max'], description: 'Aggregation function.' }
                },
                required: ['group_col', 'agg_col']
            }
        }
    }
];

export function getActiveBrowserTools(activeSkills = ['dataviz', 'data-audit']) {
    const hasAudit = activeSkills.includes('data-audit');
    if (hasAudit) return BROWSER_TOOLS;
    return BROWSER_TOOLS.filter(t => t.function.name !== 'audit_dataset');
}

/**
 * Dispatches tool execution to the browser's DuckDB-Wasm engine
 */
export async function executeBrowserTool(callName, callArgs, duckdbEngine) {
    if (!duckdbEngine || !duckdbEngine.isReady()) {
        return 'Error: DuckDB engine is not initialized or ready.';
    }
    const args = callArgs || {};

    switch (callName) {
        case 'execute_sql': {
            const query = args.query || args.sql || '';
            return await duckdbEngine.executeSQL(query);
        }
        case 'audit_dataset': {
            return await duckdbEngine.auditDataset();
        }
        case 'summarize_dataset': {
            return await duckdbEngine.summarizeDataset();
        }
        case 'get_statistics': {
            const cols = args.columns || (args.column ? [args.column] : null);
            const stats = await duckdbEngine.getStatistics(cols);
            return JSON.stringify(stats, null, 2);
        }
        case 'calculate_correlation': {
            const corr = await duckdbEngine.calculateCorrelation(args.col_a, args.col_b);
            return JSON.stringify(corr, null, 2);
        }
        case 'get_unique_values': {
            const col = args.column || (args.columns && args.columns[0]);
            if (!col) return 'Error: column not specified';
            const rows = await duckdbEngine.queryRows(`SELECT DISTINCT "${col}" FROM dataset WHERE "${col}" IS NOT NULL LIMIT 50;`);
            return JSON.stringify(rows.map(r => r[col]), null, 2);
        }
        case 'calculate_sum': {
            const col = args.column || (args.columns && args.columns[0]);
            if (!col) return 'Error: column not specified';
            const rows = await duckdbEngine.queryRows(`SELECT SUM("${col}") AS total FROM dataset;`);
            return JSON.stringify(rows[0] || {}, null, 2);
        }
        case 'calculate_mean': {
            const col = args.column || (args.columns && args.columns[0]);
            if (!col) return 'Error: column not specified';
            const rows = await duckdbEngine.queryRows(`SELECT AVG("${col}") AS mean FROM dataset;`);
            return JSON.stringify(rows[0] || {}, null, 2);
        }
        case 'get_group_summary': {
            const grp = args.group_col || args.group;
            const aggCol = args.agg_col || args.column;
            const func = (args.agg_func || 'mean').toUpperCase() === 'MEAN' ? 'AVG' : (args.agg_func || 'sum').toUpperCase();
            if (!grp || !aggCol) return 'Error: group_col and agg_col must be specified';
            const rows = await duckdbEngine.queryRows(`SELECT "${grp}", ${func}("${aggCol}") AS metric FROM dataset GROUP BY "${grp}" ORDER BY metric DESC LIMIT 25;`);
            return JSON.stringify(rows, null, 2);
        }
        case 'list_columns': {
            const schema = await duckdbEngine.getSchema();
            return JSON.stringify(schema.map(c => c.name));
        }
        case 'get_info': {
            const cnt = await duckdbEngine.getRowCount();
            const schema = await duckdbEngine.getSchema();
            return `Table: dataset (${cnt} rows, ${schema.length} columns)\n` + schema.map(c => `${c.name}: ${c.type}`).join('\n');
        }
        default:
            return `Error: Tool '${callName}' is not recognized in browser-direct mode.`;
    }
}

/**
 * Runs a multi-step ReAct agent loop entirely in the browser
 */
export async function runBrowserDirectAgent({
    userQuery,
    apiKey,
    baseUrl,
    model,
    apiVersion,
    activeSkills = ['dataviz', 'data-audit'],
    duckdbEngine,
    onProgress
}) {
    if (!duckdbEngine || !duckdbEngine.isReady()) {
        throw new Error('DuckDB-Wasm engine is not ready. Please wait a moment or reload your data.');
    }

    const key = (apiKey || '').trim();
    const url = (baseUrl || '').trim();
    const mdl = (model || '').trim() || 'gpt-4o';
    const isAzure = isAzureEndpoint(url);

    // Retrieve dataset schema and profile
    const schemaList = await duckdbEngine.getSchema();
    const schemaStr = schemaList.map(c => `${c.name}: ${c.type}`).join('\n');
    const rowCount = await duckdbEngine.getRowCount();
    const datasetProfile = await duckdbEngine.summarizeDataset();

    const systemPrompt = `You are a concise, highly efficient data analyst AI running in direct browser execution mode.
Dataset size: ${rowCount.toLocaleString()} total rows.
Schema:
${schemaStr}

FULL DATASET PROFILE & PRE-COMPUTED METRICS:
${datasetProfile}

ABOUT THIS WORKBENCH & VISUALIZATION ENVIRONMENT:
- The user is interacting with an interactive Data Workbench.
- Analytical queries run directly on the full dataset using DuckDB-Wasm (table 'dataset').
- When the user asks for charts, plots, or visual summaries, generate a complete Vega-Lite specification in a \`\`\`vega-lite ... \`\`\` code block. Do NOT hardcode the entire dataset in values; omit data.values or leave it empty, and the workbench will automatically bind the active dataset to your chart spec.
- When the user asks for flow diagrams, architectures, or process charts, generate a Mermaid diagram in a \`\`\`mermaid ... \`\`\` code block.
- You are running in direct browser mode without Python backend access. Do not call execute_python_code or write Python scripts.
- DATASET MODIFICATIONS: If the user asks to add, calculate, rename, or drop columns, or transform/filter the dataset permanently, you MUST execute a SQL statement on table 'dataset' using \`execute_sql\` (e.g. \`ALTER TABLE dataset ADD COLUMN col_name INT DEFAULT 1;\` or \`CREATE OR REPLACE TABLE dataset AS SELECT *, 1 AS col_ones, 2 AS col_twos FROM dataset;\`). This permanently updates table 'dataset' so that the user's Live Data State preview reflects the new columns.
- Present direct, concise answers without redundant filler text.`;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userQuery || 'Please analyze the dataset.' }
    ];

    let requestUrl = '';
    const headers = { 'Content-Type': 'application/json' };

    if (isAzure) {
        const endpoint = cleanAzureEndpoint(url);
        const ver = (apiVersion || '').trim() || '2024-10-21';
        requestUrl = `${endpoint}/openai/deployments/${encodeURIComponent(mdl)}/chat/completions?api-version=${encodeURIComponent(ver)}`;
        headers['api-key'] = key;
    } else {
        requestUrl = resolveOpenAIEndpoint(url);
        if (key) headers['Authorization'] = `Bearer ${key}`;
    }

    const tools = getActiveBrowserTools(activeSkills);
    const maxSteps = 10;
    const logs = [];

    for (let step = 0; step < maxSteps; step++) {
        const isLastStep = (step === maxSteps - 1);
        const requestBody = {
            model: mdl,
            messages: messages,
            tools: !isLastStep ? tools : undefined,
            tool_choice: !isLastStep ? 'auto' : 'none',
            temperature: 0.1
        };

        let response;
        try {
            response = await fetch(requestUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody)
            });
        } catch (fetchErr) {
            if (fetchErr.name === 'TypeError') {
                throw new Error(
                    `Direct browser connection failed (Network or CORS error). ` +
                    `Ensure your machine is connected to the VPN and that CORS is enabled on ${url} for origin "${window.location.origin}".`
                );
            }
            throw fetchErr;
        }

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const errDetail = errData.error?.message || errData.detail || `Provider error (${response.status}): ${response.statusText}`;
            throw new Error(`LLM Error: ${errDetail}`);
        }

        const data = await response.json();
        const choice = data.choices && data.choices[0];
        if (!choice || !choice.message) {
            throw new Error('LLM returned an empty or invalid response.');
        }

        const msg = choice.message;

        if (msg.tool_calls && msg.tool_calls.length > 0 && !isLastStep) {
            messages.push({
                role: 'assistant',
                content: msg.content || null,
                tool_calls: msg.tool_calls
            });

            const toolNames = msg.tool_calls.map(tc => tc.function.name).join(', ');
            if (onProgress) {
                onProgress({ step: step + 1, toolNames });
            }

            for (const tc of msg.tool_calls) {
                const funcName = tc.function.name;
                let funcArgs = {};
                try {
                    funcArgs = JSON.parse(tc.function.arguments);
                } catch {
                    funcArgs = {};
                }

                logs.push(`Step ${step + 1} [DuckDB-Wasm]: ${funcName}(${JSON.stringify(funcArgs)})`);
                let outputStr = '';
                try {
                    outputStr = await executeBrowserTool(funcName, funcArgs, duckdbEngine);
                } catch (execErr) {
                    outputStr = `Tool Execution Error: ${execErr.message}`;
                }

                logs.push(`Observation: ${outputStr.slice(0, 400)}`);
                messages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: outputStr
                });
            }
        } else {
            const rawAnswer = msg.content || 'Analysis complete.';
            logs.push(`Step ${step + 1} [Answer]: ${rawAnswer.slice(0, 200)}...`);

            let dfHead = [];
            try {
                dfHead = await duckdbEngine.queryRows('SELECT * FROM dataset LIMIT 5;');
            } catch {
                dfHead = [];
            }

            return {
                status: 'completed',
                answer: rawAnswer,
                logs: logs,
                images: [],
                code_blocks: [],
                df_head: dfHead
            };
        }
    }

    throw new Error('Agent reached maximum step limit without synthesizing an answer.');
}
