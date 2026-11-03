/**
 * DuckDB-Wasm & Apache Arrow Engine Module
 * High-performance, in-memory zero-copy columnar query engine.
 * Provides microsecond analytical queries, aggregations, and statistics
 * entirely in a background WebAssembly Web Worker.
 */

export function tableToObjects(table, limit = null) {
    if (!table) return [];
    const numRows = table.numRows || 0;
    const count = limit ? Math.min(numRows, limit) : numRows;
    if (count === 0) return [];

    const fields = table.schema.fields;
    const fieldNames = fields.map(f => f.name);
    const cols = fieldNames.map(name => ({
        name,
        vector: table.getChild(name)
    }));

    const objects = new Array(count);
    for (let i = 0; i < count; i++) {
        const row = {};
        for (let j = 0; j < cols.length; j++) {
            const v = cols[j].vector ? cols[j].vector.get(i) : null;
            row[cols[j].name] = typeof v === 'bigint' ? Number(v) : v;
        }
        objects[i] = row;
    }
    return objects;
}

/**
 * Defensive division sanitization: wraps / <term> with / NULLIF(<term>, 0)
 */
export function sanitizeSqlDivision(expr) {
    if (!expr || typeof expr !== 'string') return expr;
    let result = '';
    let i = 0;
    while (i < expr.length) {
        if (expr[i] === "'") {
            const nextQuote = expr.indexOf("'", i + 1);
            if (nextQuote === -1) {
                result += expr.slice(i);
                break;
            } else {
                result += expr.slice(i, nextQuote + 1);
                i = nextQuote + 1;
                continue;
            }
        }
        if (expr[i] === '/') {
            let j = i + 1;
            while (j < expr.length && /\s/.test(expr[j])) j++;
            if (expr.slice(j, j + 6).toUpperCase() === 'NULLIF') {
                result += '/';
                i++;
                continue;
            }
            if (expr[j] === '(') {
                let depth = 0;
                let k = j;
                for (; k < expr.length; k++) {
                    if (expr[k] === '(') depth++;
                    else if (expr[k] === ')') {
                        depth--;
                        if (depth === 0) break;
                    }
                }
                if (depth === 0 && k < expr.length) {
                    const term = expr.slice(j, k + 1);
                    result += `/ NULLIF(${term}, 0)`;
                    i = k + 1;
                    continue;
                }
            }
            const rest = expr.slice(j);
            const m = rest.match(/^[a-zA-Z_0-9."]+/);
            if (m) {
                const term = m[0];
                result += `/ NULLIF(${term}, 0)`;
                i = j + term.length;
                continue;
            }
        }
        result += expr[i];
        i++;
    }
    return result;
}

export class DuckDBEngine {
    constructor() {
        this.duckdb = null;
        this.db = null;
        this.conn = null;
        this.initPromise = null;
        this.hasTable = false;
        this.tableName = 'dataset';
        this.isInitializing = false;
        this.lastFileName = null;
    }

    /**
     * Lazily initialize DuckDB-Wasm worker and database connection
     */
    async init() {
        if (this.conn) return this.conn;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            this.isInitializing = true;
            try {
                // Dynamically import DuckDB-Wasm bundle from jsDelivr ESM
                const duckdbModule = await import('https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm');
                this.duckdb = duckdbModule;

                const JSDELIVR_BUNDLES = duckdbModule.getJsDelivrBundles();
                const bundle = await duckdbModule.selectBundle(JSDELIVR_BUNDLES);

                const workerBlob = new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' });
                const workerUrl = URL.createObjectURL(workerBlob);
                const worker = new Worker(workerUrl);

                const logger = new duckdbModule.ConsoleLogger(duckdbModule.LogLevel.WARNING);
                this.db = new duckdbModule.AsyncDuckDB(logger, worker);
                await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker);
                URL.revokeObjectURL(workerUrl);

                this.conn = await this.db.connect();
                console.info('[DuckDB-Wasm] Initialized in WebAssembly Web Worker.');
                return this.conn;
            } catch (err) {
                console.warn('[DuckDB-Wasm] Initialization failed, falling back to client-side JS:', err);
                this.conn = null;
                throw err;
            } finally {
                this.isInitializing = false;
            }
        })();

        return this.initPromise;
    }

    isReady() {
        return !!this.conn && this.hasTable;
    }

    /**
     * Ingest CSV file or text directly into DuckDB's in-memory columnar table
     */
    async loadCSV(file, options = {}) {
        await this.init();
        if (!this.conn || !this.db) throw new Error('DuckDB not initialized');

        // Drop previous table & file if any
        if (this.lastFileName) {
            try { await this.db.dropFile(this.lastFileName); } catch (e) { }
        }

        const fileName = 'uploaded_' + Date.now() + '.csv';
        this.lastFileName = fileName;

        let buffer;
        if (file instanceof File || file instanceof Blob) {
            const arrayBuffer = await file.arrayBuffer();
            buffer = new Uint8Array(arrayBuffer);
        } else if (typeof file === 'string') {
            const encoder = new TextEncoder();
            buffer = encoder.encode(file);
        } else {
            throw new Error('Unsupported file format for DuckDB load');
        }

        await this.db.registerFileBuffer(fileName, buffer);

        let readOptions = `header=true`;
        if (options.delimiter) {
            readOptions += `, delim='${options.delimiter.replace(/'/g, "\\'")}'`;
        }
        if (options.decimalSeparator && options.decimalSeparator !== 'auto') {
            readOptions += `, decimal_separator='${options.decimalSeparator}'`;
        }

        const sql = `CREATE OR REPLACE TABLE ${this.tableName} AS SELECT * FROM read_csv_auto('${fileName}', ${readOptions});`;
        await this.conn.query(sql);
        this.hasTable = true;

        const countTable = await this.conn.query(`SELECT COUNT(*) as count FROM ${this.tableName};`);
        const rowCount = Number(countTable.getChild('count')?.get(0) || 0);
        console.info(`[DuckDB-Wasm] Ingested ${rowCount} rows into table '${this.tableName}'.`);
        return rowCount;
    }

    /**
     * Ingest raw array of JS records (e.g. demo data)
     */
    async loadJSON(records) {
        await this.init();
        if (!this.conn || !this.db) throw new Error('DuckDB not initialized');

        const jsonName = 'records_' + Date.now() + '.json';
        const encoder = new TextEncoder();
        const buffer = encoder.encode(JSON.stringify(records));

        await this.db.registerFileBuffer(jsonName, buffer);
        await this.conn.query(`CREATE OR REPLACE TABLE ${this.tableName} AS SELECT * FROM read_json_auto('${jsonName}');`);
        await this.db.dropFile(jsonName);

        this.hasTable = true;
        return records.length;
    }

    /**
     * Run arbitrary SQL query, returning Arrow Table
     */
    async query(sql) {
        if (!this.conn) await this.init();
        return await this.conn.query(sql);
    }

    /**
     * Run arbitrary SQL query, returning plain JavaScript object array
     */
    async queryRows(sql, limit = null) {
        const table = await this.query(sql);
        return tableToObjects(table, limit);
    }

    /**
     * Get dataset schema (column names and types)
     */
    async getSchema() {
        if (!this.isReady()) return [];
        const table = await this.conn.query(`PRAGMA table_info('${this.tableName}');`);
        return tableToObjects(table).map(col => ({
            name: col.name,
            type: col.type
        }));
    }

    /**
     * Get row count
     */
    async getRowCount() {
        if (!this.isReady()) return 0;
        const res = await this.conn.query(`SELECT COUNT(*) as cnt FROM ${this.tableName};`);
        return Number(res.getChild('cnt')?.get(0) || 0);
    }

    /**
     * Resolves collision-free column name by appending _1, _2 suffix if collision exists
     */
    async resolveColumnName(baseName) {
        if (!this.isReady()) return baseName;
        const schema = await this.getSchema();
        const existingNames = new Set(schema.map(c => c.name.toLowerCase()));
        if (!existingNames.has(baseName.toLowerCase())) {
            return baseName;
        }
        let i = 1;
        while (existingNames.has(`${baseName}_${i}`.toLowerCase())) {
            i++;
        }
        return `${baseName}_${i}`;
    }

    /**
     * Dry run SQL expression for column addition with division sanitization and TRY() projection
     */
    async dryRunExpression(columnName, sqlExpr) {
        if (!this.isReady()) {
            return {
                valid: false,
                previewRows: [],
                resolvedName: columnName,
                sanitizedExpr: sqlExpr,
                wasRenamed: false,
                inferredType: 'UNKNOWN',
                error: 'DuckDB engine is not initialized or ready.'
            };
        }
        const sanitizedExpr = sanitizeSqlDivision(sqlExpr);
        const resolvedName = await this.resolveColumnName(columnName);
        const wasRenamed = resolvedName.toLowerCase() !== columnName.toLowerCase();

        try {
            const testQuery = `SELECT *, TRY(${sanitizedExpr}) AS "${resolvedName}" FROM ${this.tableName} LIMIT 5;`;
            const table = await this.query(testQuery);
            const previewRows = tableToObjects(table);
            const field = table?.schema?.fields?.find(f => f.name === resolvedName);
            const inferredType = field ? String(field.type) : 'UNKNOWN';

            return {
                valid: true,
                previewRows,
                resolvedName,
                sanitizedExpr,
                wasRenamed,
                inferredType,
                error: null
            };
        } catch (err) {
            return {
                valid: false,
                previewRows: [],
                resolvedName,
                sanitizedExpr,
                wasRenamed,
                inferredType: 'UNKNOWN',
                error: err.message
            };
        }
    }

    /**
     * Adds persistent calculated column by rebuilding table
     */
    async addColumnExpression(columnName, sqlExpr) {
        if (!this.isReady()) throw new Error('DuckDB engine not initialized');
        const sanitizedExpr = sanitizeSqlDivision(sqlExpr);
        const sql = `CREATE OR REPLACE TABLE ${this.tableName} AS SELECT *, ${sanitizedExpr} AS "${columnName}" FROM ${this.tableName};`;
        await this.query(sql);
        this.hasTable = true;
    }

    /**
     * Fast Top-N aggregation for Sankey flow charts with residual rollup
     */
    async aggregateSankeyFlows(srcCol, tgtCol, valCol = null, aggFunc = 'sum', limit = 50) {
        if (!this.isReady()) return null;

        let sqlVal;
        if (!valCol) {
            sqlVal = 'COUNT(*)';
        } else {
            const safeVal = `"${valCol.replace(/"/g, '""')}"`;
            switch (aggFunc) {
                case 'count':
                    sqlVal = 'COUNT(*)';
                    break;
                case 'mean':
                    sqlVal = `AVG(TRY_CAST(${safeVal} AS DOUBLE))`;
                    break;
                case 'min':
                    sqlVal = `MIN(TRY_CAST(${safeVal} AS DOUBLE))`;
                    break;
                case 'max':
                    sqlVal = `MAX(TRY_CAST(${safeVal} AS DOUBLE))`;
                    break;
                case 'none':
                    sqlVal = `FIRST(${safeVal})`;
                    break;
                case 'sum':
                default:
                    sqlVal = `SUM(TRY_CAST(${safeVal} AS DOUBLE))`;
                    break;
            }
        }

        const safeSrc = `"${srcCol.replace(/"/g, '""')}"`;
        const safeTgt = `"${tgtCol.replace(/"/g, '""')}"`;

        const sql = `
            WITH ranked_flows AS (
                SELECT 
                    ${safeSrc}::VARCHAR AS source,
                    ${safeTgt}::VARCHAR AS target,
                    COALESCE(${sqlVal}, 0) AS value,
                    ROW_NUMBER() OVER (ORDER BY COALESCE(${sqlVal}, 0) DESC) as rnk
                FROM ${this.tableName}
                WHERE ${safeSrc} IS NOT NULL AND ${safeTgt} IS NOT NULL
                GROUP BY 1, 2
            )
            SELECT source, target, value, rnk
            FROM ranked_flows;
        `;

        const table = await this.conn.query(sql);
        const rows = tableToObjects(table);

        const topFlows = [];
        let remainingSum = 0;
        let totalFlows = rows.length;

        rows.forEach(r => {
            const val = typeof r.value === 'number' ? r.value : parseFloat(r.value) || 0;
            if (val <= 0) return;
            if (r.rnk <= limit) {
                topFlows.push({
                    source: String(r.source),
                    target: String(r.target),
                    value: val
                });
            } else {
                remainingSum += val;
            }
        });

        return {
            topFlows,
            remainingSum,
            totalFlows
        };
    }

    /**
     * Compute statistics for a column in single-digit milliseconds
     */
    async getStatistics(col) {
        if (!this.isReady()) return null;
        const safeCol = `"${col.replace(/"/g, '""')}"`;

        const sql = `
            SELECT 
                COUNT(*) as total_count,
                COUNT(${safeCol}) as non_null_count,
                COUNT(DISTINCT ${safeCol}) as unique_count,
                TRY_CAST(AVG(TRY_CAST(${safeCol} AS DOUBLE)) AS DOUBLE) as mean_val,
                TRY_CAST(STDDEV(TRY_CAST(${safeCol} AS DOUBLE)) AS DOUBLE) as std_val,
                TRY_CAST(MIN(TRY_CAST(${safeCol} AS DOUBLE)) AS DOUBLE) as min_val,
                TRY_CAST(MEDIAN(TRY_CAST(${safeCol} AS DOUBLE)) AS DOUBLE) as median_val,
                TRY_CAST(MAX(TRY_CAST(${safeCol} AS DOUBLE)) AS DOUBLE) as max_val
            FROM ${this.tableName};
        `;

        const table = await this.conn.query(sql);
        const res = tableToObjects(table)[0];
        return res;
    }

    /**
     * Compute Pearson correlation between two numeric columns
     */
    async calculateCorrelation(colA, colB) {
        if (!this.isReady()) return null;
        const safeA = `"${colA.replace(/"/g, '""')}"`;
        const safeB = `"${colB.replace(/"/g, '""')}"`;

        const sql = `
            SELECT CORR(TRY_CAST(${safeA} AS DOUBLE), TRY_CAST(${safeB} AS DOUBLE)) as corr
            FROM ${this.tableName}
            WHERE ${safeA} IS NOT NULL AND ${safeB} IS NOT NULL;
        `;

        const table = await this.conn.query(sql);
        const res = tableToObjects(table)[0];
        return res ? res.corr : null;
    }

    /**
     * Execute SQL and return formatted JSON string for agent observations
     */
    async executeSQL(sql, limit = 100) {
        if (!this.isReady()) throw new Error("DuckDB dataset table not ready.");
        const table = await this.conn.query(sql.trim());
        const allRows = tableToObjects(table);
        if (!allRows || allRows.length === 0) {
            return "Query executed successfully. 0 rows returned.";
        }
        const rows = allRows.slice(0, limit);
        const note = allRows.length > limit ? `\n[Showing first ${limit} of ${allRows.length} rows]` : '';
        return JSON.stringify(rows, null, 2) + note;
    }

    /**
     * Comprehensive dataset health audit across 100% of rows
     */
    async auditDataset() {
        if (!this.isReady()) return "Error: Dataset not loaded in DuckDB.";
        try {
            const schema = await this.getSchema();
            const rowCount = await this.getRowCount();
            if (rowCount === 0) return "Dataset is empty.";

            const lines = [`DataHealthReport: ${rowCount} rows x ${schema.length} cols [DuckDB-Wasm 100% Data]`];

            // 1. Missingness across all columns
            const missingExpressions = schema.map(col => {
                const safe = `"${col.name.replace(/"/g, '""')}"`;
                return `SUM(CASE WHEN ${safe} IS NULL THEN 1 ELSE 0 END)::DOUBLE / COUNT(*)::DOUBLE as "miss_${col.name}"`;
            }).join(', ');
            const missRes = (await this.queryRows(`SELECT ${missingExpressions} FROM ${this.tableName};`))[0] || {};

            schema.forEach(col => {
                const frac = missRes[`miss_${col.name}`] || 0;
                if (frac > 0) {
                    const flag = frac > 0.30 ? " FLAG >30% missing" : "";
                    lines.push(`- missing ${col.name}: ${(frac * 100).toFixed(1)}%${flag}`);
                }
            });

            // 2. Numeric and categorical column checks
            for (const col of schema) {
                const typeStr = (col.type || '').toUpperCase();
                const isNumeric = typeStr.includes('INT') || typeStr.includes('FLOAT') || typeStr.includes('DOUBLE') || typeStr.includes('DECIMAL') || typeStr.includes('REAL');
                const safe = `"${col.name.replace(/"/g, '""')}"`;

                if (isNumeric) {
                    const numSql = `
                        SELECT 
                            COUNT(DISTINCT ${safe}) as nunique,
                            AVG(TRY_CAST(${safe} AS DOUBLE)) as mean_val,
                            MEDIAN(TRY_CAST(${safe} AS DOUBLE)) as median_val,
                            STDDEV(TRY_CAST(${safe} AS DOUBLE)) as std_val,
                            SUM(CASE WHEN ${safe} = 0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*)::DOUBLE as zero_share
                        FROM ${this.tableName}
                        WHERE ${safe} IS NOT NULL;
                    `;
                    const stat = (await this.queryRows(numSql))[0] || {};
                    const std = stat.std_val || 0;
                    const skew = std ? ((stat.mean_val - stat.median_val) / std) : 0;
                    const extra = [];
                    if (Math.abs(skew) > 1) extra.push(`skew=${skew.toFixed(2)}, prefer median/log`);
                    if (stat.zero_share > 0.2) extra.push(`${(stat.zero_share * 100).toFixed(0)}% zeros`);
                    if (stat.nunique <= 1) extra.push("constant");
                    if (extra.length > 0) {
                        lines.push(`- numeric ${col.name}: ${extra.join('; ')}`);
                    }
                } else {
                    const catSql = `SELECT COUNT(DISTINCT ${safe}) as nunique FROM ${this.tableName} WHERE ${safe} IS NOT NULL;`;
                    const nunique = Number((await this.queryRows(catSql))[0]?.nunique || 0);
                    if (nunique > 50) {
                        lines.push(`- high-cardinality ${col.name}: k=${nunique}, avoid raw grouping`);
                    } else if (nunique <= 1) {
                        lines.push(`- constant ${col.name}: single value`);
                    }
                }

                // ID-like column check
                const lower = col.name.toLowerCase();
                if (lower.includes('id') || lower.includes('code') || lower.includes('zip') || lower.includes('phone')) {
                    lines.push(`- id-like ${col.name}: do not average/sum`);
                }
            }

            return lines.join('\n');
        } catch (e) {
            return `Error auditing dataset: ${e.message}`;
        }
    }

    /**
     * Comprehensive dataset overview computed over 100% of rows
     */
    async summarizeDataset() {
        if (!this.isReady()) return "Dataset not loaded.";
        try {
            const schema = await this.getSchema();
            const rowCount = await this.getRowCount();
            const lines = [`=== DATASET OVERVIEW (${rowCount} rows × ${schema.length} columns) [DuckDB-Wasm 100% Data] ===`];

            // Columns and missingness
            lines.push("\n[COLUMNS & DATA TYPES]");
            const missingExpressions = schema.map(col => {
                const safe = `"${col.name.replace(/"/g, '""')}"`;
                return `COUNT(${safe}) as "non_null_${col.name}", SUM(CASE WHEN ${safe} IS NULL THEN 1 ELSE 0 END)::DOUBLE / COUNT(*)::DOUBLE as "pct_null_${col.name}"`;
            }).join(', ');

            const nullStats = (await this.queryRows(`SELECT ${missingExpressions} FROM ${this.tableName};`))[0] || {};
            schema.forEach(col => {
                const nonNull = nullStats[`non_null_${col.name}`] || 0;
                const pctNull = (nullStats[`pct_null_${col.name}`] || 0) * 100;
                const nullStr = pctNull > 0 ? ` (${pctNull.toFixed(1)}% missing)` : "";
                lines.push(`- ${col.name}: ${col.type} | ${nonNull}/${rowCount} non-null${nullStr}`);
            });

            // Numeric summary
            const numericCols = schema.filter(col => {
                const t = (col.type || '').toUpperCase();
                return t.includes('INT') || t.includes('FLOAT') || t.includes('DOUBLE') || t.includes('DECIMAL') || t.includes('REAL');
            });

            if (numericCols.length > 0) {
                lines.push("\n[NUMERIC SUMMARY (100% of rows)]");
                for (const col of numericCols) {
                    const safe = `"${col.name.replace(/"/g, '""')}"`;
                    const statSql = `
                        SELECT 
                            COUNT(${safe}) as count,
                            ROUND(AVG(${safe})::DOUBLE, 2) as mean,
                            ROUND(STDDEV(${safe})::DOUBLE, 2) as std,
                            ROUND(MIN(${safe})::DOUBLE, 2) as min,
                            ROUND(QUANTILE_CONT(${safe}, 0.25)::DOUBLE, 2) as "25%",
                            ROUND(MEDIAN(${safe})::DOUBLE, 2) as "50%",
                            ROUND(QUANTILE_CONT(${safe}, 0.75)::DOUBLE, 2) as "75%",
                            ROUND(MAX(${safe})::DOUBLE, 2) as max
                        FROM ${this.tableName};
                    `;
                    const s = (await this.queryRows(statSql))[0];
                    if (s) {
                        lines.push(`${col.name}: count=${s.count}, mean=${s.mean}, std=${s.std}, min=${s.min}, 25%=${s['25%']}, 50%=${s['50%']}, 75%=${s['75%']}, max=${s.max}`);
                    }
                }
            }

            // Categorical summary
            const catCols = schema.filter(col => !numericCols.includes(col));
            if (catCols.length > 0) {
                lines.push("\n[CATEGORICAL SUMMARY]");
                for (const col of catCols.slice(0, 10)) {
                    const safe = `"${col.name.replace(/"/g, '""')}"`;
                    const topRows = await this.queryRows(`
                        SELECT ${safe} as val, COUNT(*) as cnt
                        FROM ${this.tableName}
                        WHERE ${safe} IS NOT NULL
                        GROUP BY 1
                        ORDER BY cnt DESC
                        LIMIT 3;
                    `);
                    const nunique = Number((await this.queryRows(`SELECT COUNT(DISTINCT ${safe}) as cnt FROM ${this.tableName};`))[0]?.cnt || 0);
                    const topStr = topRows.map(r => `${r.val}: ${r.cnt}`).join(', ');
                    lines.push(`- ${col.name} (k=${nunique} unique): top [${topStr}]`);
                }
            }

            // Sample data preview
            const sampleRows = await this.queryRows(`SELECT * FROM ${this.tableName} LIMIT 5;`);
            lines.push("\n[SAMPLE DATA (first 5 rows)]");
            lines.push(JSON.stringify(sampleRows, null, 2));

            return lines.join('\n');
        } catch (e) {
            return `Error generating summary: ${e.message}`;
        }
    }

    /**
     * Clear tables and memory
     */
    async clear() {
        if (this.conn && this.hasTable) {
            try {
                await this.conn.query(`DROP TABLE IF EXISTS ${this.tableName};`);
            } catch (e) { }
            this.hasTable = false;
        }
        if (this.db && this.lastFileName) {
            try {
                await this.db.dropFile(this.lastFileName);
            } catch (e) { }
            this.lastFileName = null;
        }
    }
}

// Global singleton instance
export const duckdbEngine = new DuckDBEngine();
