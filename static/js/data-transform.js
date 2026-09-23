/**
 * Data Transformation & Analytical Utilities
 * Handles type detection, value parsing, aggregation, and full CSV processing.
 */

import { duckdbEngine, tableToObjects } from './duckdb-engine.js';

export const detectType = (value) => {
    if (value === null || value === undefined) return 'String';
    const cleanVal = String(value).trim();
    if (!cleanVal) return 'String';

    if (cleanVal.toLowerCase() === 'true' || cleanVal.toLowerCase() === 'false') return 'Boolean';

    // Time-only detection (e.g. 14:30, 14:30:00, 2:30 PM, 02:30:15 am)
    if (/^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(\s?[APap][Mm])?$/.test(cleanVal)) {
        return 'Time';
    }

    // Date or DateTime detection
    if (cleanVal.length >= 6 && /[\/\-\.]/.test(cleanVal) && !isNaN(Date.parse(cleanVal))) {
        const sepCount = (cleanVal.match(/[\/\-\.]/g) || []).length;
        if (sepCount >= 2) {
            if (/:/.test(cleanVal)) {
                return 'DateTime';
            }
            return 'Date';
        }
    }

    const numberClean = cleanVal.replace(/[^0-9,.-]/g, '');
    if (numberClean.length > 0 && /\d/.test(numberClean)) {
        return 'Number';
    }

    return 'String';
};

export const parseValue = (value, type, decimalSeparator = 'auto') => {
    if (value === null || value === undefined || value === '') return null;

    if (type === 'Number') {
        let v = value.toString().replace(/[^0-9,.-]/g, '');
        if (!v) return null;

        if (decimalSeparator === '.') {
            v = v.replace(/,/g, '');
        } else if (decimalSeparator === ',') {
            v = v.replace(/\./g, '').replace(',', '.');
        } else {
            if (v.includes(',') && v.includes('.')) {
                if (v.lastIndexOf(',') > v.lastIndexOf('.')) {
                    v = v.replace(/\./g, '').replace(',', '.');
                } else {
                    v = v.replace(/,/g, '');
                }
            } else if (v.includes(',')) {
                const parts = v.split(',');
                const lastPart = parts[parts.length - 1];
                if (parts.length > 1 && lastPart.length === 3) {
                    v = v.replace(/,/g, '');
                } else {
                    v = v.replace(',', '.');
                }
            } else if (v.includes('.')) {
                if ((v.match(/\./g) || []).length > 1) {
                    v = v.replace(/\./g, '');
                }
            }
        }
        return parseFloat(v);
    }

    if (type === 'Date') {
        const parsed = new Date(value);
        if (isNaN(parsed.getTime())) return value;
        // Store standardized YYYY-MM-DD string so table visualization works cleanly
        const year = parsed.getFullYear();
        const month = String(parsed.getMonth() + 1).padStart(2, '0');
        const day = String(parsed.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    if (type === 'DateTime') {
        const parsed = new Date(value);
        return isNaN(parsed.getTime()) ? value : parsed.toISOString();
    }

    if (type === 'Time') {
        const clean = String(value).trim();
        return clean;
    }

    if (type === 'Boolean') return value.toString().toLowerCase() === 'true';
    return value;
};

export const aggregateValues = (values, func) => {
    if (!values || values.length === 0) return 0;
    const numVals = values.map(v => {
        const n = parseFloat(v);
        return isNaN(n) ? 0 : n;
    });

    switch (func) {
        case 'none':
            return numVals.length > 0 ? numVals[0] : 0;
        case 'sum':
            return numVals.reduce((acc, v) => acc + v, 0);
        case 'mean':
            return numVals.length > 0 ? numVals.reduce((acc, v) => acc + v, 0) / numVals.length : 0;
        case 'min':
            return numVals.length > 0 ? Math.min(...numVals) : 0;
        case 'max':
            return numVals.length > 0 ? Math.max(...numVals) : 0;
        case 'count':
        default:
            return values.length;
    }
};

export const processFullCSV = async (file, config, onLoadingChange) => {
    if (typeof onLoadingChange === 'function') onLoadingChange(true);

    // 1. Primary Engine: DuckDB-Wasm in Web Worker
    try {
        await duckdbEngine.loadCSV(file, {
            delimiter: config.delimiter,
            decimalSeparator: config.decimalSeparator
        });
        window.duckdbEngine = duckdbEngine;
        window._duckdbLoadedFromCSV = true;

        const selectedCols = config.selectedColumns || (config.types ? Object.keys(config.types) : null);
        const safeSelect = (selectedCols && selectedCols.length > 0)
            ? selectedCols.map(c => `"${c.replace(/"/g, '""')}"`).join(', ')
            : '*';

        const table = await duckdbEngine.query(`SELECT ${safeSelect} FROM dataset;`);
        const processedData = tableToObjects(table);
        return processedData;
    } catch (err) {
        console.warn('[DuckDB] Failed to load into DuckDB-Wasm, falling back to PapaParse:', err);
    }

    // 2. Fallback Engine: PapaParse
    return new Promise((resolve, reject) => {
        if (!window.Papa) {
            reject(new Error("PapaParse library is not loaded"));
            return;
        }
        window.Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            delimiter: config.delimiter,
            complete: (results) => {
                const selectedCols = config.selectedColumns || (config.types ? Object.keys(config.types) : []);
                const rawData = results.data || [];
                const len = rawData.length;
                const processedData = new Array(len);
                for (let i = 0; i < len; i++) {
                    const row = rawData[i];
                    const newRow = {};
                    for (let j = 0; j < selectedCols.length; j++) {
                        const col = selectedCols[j];
                        const type = (config.types && config.types[col]) || 'String';
                        newRow[col] = parseValue(row[col], type, config.decimalSeparator);
                    }
                    processedData[i] = newRow;
                }
                results.data = null;
                resolve(processedData);
            },
            error: (error) => reject(error),
        });
    });
};

/**
 * Client-Side Instant Data Analysis Tools
 * Fast-path responses without waiting for backend LLM.
 */
export const ClientDataTools = {
    getSchema(data) {
        if (!data || data.length === 0) return { columns: [], shape: [0, 0], sample: [] };
        const cols = Object.keys(data[0]);
        const dtypes = {};
        cols.forEach(c => {
            const sampleVal = data.find(r => r[c] !== null && r[c] !== undefined)?.[c];
            dtypes[c] = detectType(sampleVal);
        });
        return {
            columns: cols,
            shape: [data.length, cols.length],
            dtypes: dtypes,
            sample: data.slice(0, 3)
        };
    },
    listColumns(data) {
        if (!data || data.length === 0) return "No columns found";
        return `Columns: ${Object.keys(data[0]).join(', ')}`;
    },
    getInfo(data) {
        if (!data || data.length === 0) return "Empty dataset";
        const s = this.getSchema(data);
        return `Shape: ${s.shape[0]} rows × ${s.shape[1]} columns\nColumns: ${s.columns.join(', ')}\nData Types: ${JSON.stringify(s.dtypes)}`;
    },
    calculateMean(data, column) {
        if (!data || data.length === 0) return "No data";
        const nums = data.map(r => parseFloat(r[column])).filter(n => !isNaN(n));
        if (nums.length === 0) return `Column '${column}' contains no numeric values.`;
        const sum = nums.reduce((a, b) => a + b, 0);
        return `Mean of '${column}': ${(sum / nums.length).toFixed(4)}`;
    },
    calculateSum(data, column) {
        if (!data || data.length === 0) return "No data";
        const nums = data.map(r => parseFloat(r[column])).filter(n => !isNaN(n));
        if (nums.length === 0) return `Column '${column}' contains no numeric values.`;
        const sum = nums.reduce((a, b) => a + b, 0);
        return `Sum of '${column}': ${sum.toFixed(4)}`;
    },
    getUniqueValues(data, column) {
        if (!data || data.length === 0) return "No data";
        const set = new Set();
        data.forEach(r => { if (r[column] !== undefined && r[column] !== null) set.add(String(r[column])); });
        const list = Array.from(set).slice(0, 20);
        return `Unique values in '${column}' (${set.size} total): ${JSON.stringify(list)}`;
    },
    getStatistics(data, column) {
        if (!data || data.length === 0) return "No data";
        const nums = data.map(r => parseFloat(r[column])).filter(n => !isNaN(n)).sort((a, b) => a - b);
        if (nums.length === 0) {
            const counts = {};
            data.forEach(r => {
                const k = String(r[column] ?? '');
                counts[k] = (counts[k] || 0) + 1;
            });
            return `Categorical stats for '${column}': Count: ${data.length}, Unique: ${Object.keys(counts).length}`;
        }
        const count = nums.length;
        const sum = nums.reduce((a, b) => a + b, 0);
        const mean = sum / count;
        const min = nums[0];
        const max = nums[count - 1];
        const median = count % 2 === 0 ? (nums[count / 2 - 1] + nums[count / 2]) / 2 : nums[Math.floor(count / 2)];
        const variance = nums.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / count;
        const std = Math.sqrt(variance);
        return `Statistics for '${column}':\nCount: ${count}\nMean: ${mean.toFixed(4)}\nStd: ${std.toFixed(4)}\nMin: ${min}\nMedian: ${median}\nMax: ${max}`;
    },
    calculateCorrelation(data, colA, colB) {
        if (!data || data.length === 0) return "No data";
        const pairs = [];
        data.forEach(r => {
            const a = parseFloat(r[colA]);
            const b = parseFloat(r[colB]);
            if (!isNaN(a) && !isNaN(b)) pairs.push([a, b]);
        });
        if (pairs.length < 2) return `Insufficient numeric pairs between '${colA}' and '${colB}'.`;
        const n = pairs.length;
        const meanA = pairs.reduce((s, p) => s + p[0], 0) / n;
        const meanB = pairs.reduce((s, p) => s + p[1], 0) / n;
        let num = 0, denA = 0, denB = 0;
        pairs.forEach(([a, b]) => {
            const diffA = a - meanA;
            const diffB = b - meanB;
            num += diffA * diffB;
            denA += diffA * diffA;
            denB += diffB * diffB;
        });
        const den = Math.sqrt(denA * denB);
        if (den === 0) return `Correlation between '${colA}' and '${colB}': 0.0000`;
        return `Pearson correlation between '${colA}' and '${colB}': ${(num / den).toFixed(4)}`;
    },
    getGroupSummary(data, groupCol, aggCol, aggFunc = 'mean') {
        if (!data || data.length === 0) return "No data";
        const groups = {};
        data.forEach(r => {
            const g = String(r[groupCol] ?? 'Unknown');
            if (!groups[g]) groups[g] = [];
            const v = parseFloat(r[aggCol]);
            if (!isNaN(v)) groups[g].push(v);
            else groups[g].push(1);
        });
        const res = {};
        Object.entries(groups).forEach(([k, vals]) => {
            if (aggFunc === 'sum') res[k] = vals.reduce((a, b) => a + b, 0);
            else if (aggFunc === 'count') res[k] = vals.length;
            else res[k] = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
            res[k] = Math.round(res[k] * 100) / 100;
        });
        return `Grouped by '${groupCol}' (${aggFunc.toUpperCase()} of '${aggCol}'):\n${JSON.stringify(res, null, 2)}`;
    }
};
