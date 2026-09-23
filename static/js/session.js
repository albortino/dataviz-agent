/**
 * Session State Management Module
 * Serializes and restores the entire analytics workspace state (LineUp, Graphic-Walker,
 * SandDance, Mermaid, Sankey, Agent) into a portable JSON session file.
 * Validates external datasets against the session's column schema and shape.
 */

export const SESSION_FORMAT = 'dataviz-agent-session';
export const SESSION_VERSION = 1;
export const INTERNAL_TOOL_COLUMNS = new Set(['GL_ORDINAL', '_unit_id', '__row_id', '__index']);

/**
 * Validates whether an uploaded candidate dataset satisfies the schema required by a session.
 * Checks required columns and reports shape differences without checking the original filename.
 * 
 * @param {object} session - Parsed session JSON
 * @param {Array<object>} dataset - Array of row objects
 * @returns {object} Validation result { valid, missingColumns, extraColumns, expectedRowCount, actualRowCount, rowCountDiff }
 */
export function validateDatasetForSession(session, dataset) {
    if (!session || typeof session !== 'object') {
        return { valid: false, error: 'Invalid session payload' };
    }
    if (session.format !== SESSION_FORMAT) {
        return { valid: false, error: `Unsupported session format: "${session.format || 'unknown'}"` };
    }
    if (!dataset || !Array.isArray(dataset) || dataset.length === 0) {
        return { valid: false, error: 'No dataset provided or dataset is empty' };
    }

    const expectedCols = ((session.datasetSchema && Array.isArray(session.datasetSchema.columns))
        ? session.datasetSchema.columns
        : []).filter(col => !INTERNAL_TOOL_COLUMNS.has(col));
    const actualCols = Object.keys(dataset[0] || {}).filter(col => !INTERNAL_TOOL_COLUMNS.has(col));
    const actualColSet = new Set(actualCols);

    const missingColumns = expectedCols.filter(col => !actualColSet.has(col));
    const extraColumns = actualCols.filter(col => !expectedCols.includes(col));
    const expectedRowCount = session.datasetSchema ? session.datasetSchema.rowCount : 0;
    const actualRowCount = dataset.length;
    const rowCountDiff = Math.abs(actualRowCount - expectedRowCount);

    return {
        valid: missingColumns.length === 0,
        missingColumns,
        extraColumns,
        expectedRowCount,
        actualRowCount,
        rowCountDiff
    };
}

/**
 * Extracts and bundles active workspace state into a JSON object and triggers a browser download.
 * 
 * @param {object} params
 * @param {Array<object>} params.currentData - Current active dataset rows
 * @param {string} params.activeView - Currently active visualizer tab identifier
 * @param {object} params.managers - References to tool managers
 * @param {object|null} params.lineupInstance - LineUp instance if active
 * @returns {object} The exported session object
 */
export function exportSession({ currentData, datasetName = null, activeView, managers = {}, lineupInstance = null }) {
    if (!currentData || !Array.isArray(currentData) || currentData.length === 0) {
        throw new Error('Cannot export session: No active dataset loaded.');
    }

    const columns = Object.keys(currentData[0] || {}).filter(col => !INTERNAL_TOOL_COLUMNS.has(col));
    const datasetSchema = {
        name: datasetName || 'dataset.csv',
        rowCount: currentData.length,
        columnCount: columns.length,
        columns: columns
    };

    let lineupDump = null;
    if (lineupInstance && typeof lineupInstance.dump === 'function') {
        try {
            lineupDump = lineupInstance.dump();
        } catch (err) {
            console.warn('Failed to dump LineUp state:', err);
        }
    }

    const session = {
        format: SESSION_FORMAT,
        version: SESSION_VERSION,
        exportedAt: new Date().toISOString(),
        activeView: activeView || 'lineup',
        datasetSchema,
        tools: {
            lineup: lineupDump ? { dump: lineupDump } : null,
            graphicWalker: managers.graphicWalker?.exportState ? managers.graphicWalker.exportState() : null,
            sanddance: managers.sanddance?.exportState ? managers.sanddance.exportState() : null,
            sankey: managers.sankey?.exportState ? managers.sankey.exportState() : null,
            mermaid: managers.mermaid?.exportState ? managers.mermaid.exportState() : null,
            vega: managers.vega?.exportState ? managers.vega.exportState() : null,
            agent: managers.agent?.exportState ? managers.agent.exportState() : null
        }
    };

    // Download JSON
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `dataviz-session-${dateStr}.json`;
    const jsonStr = JSON.stringify(session, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    return session;
}

/**
 * Restores tool states and activates the saved view tab.
 * 
 * @param {object} session - Validated session object
 * @param {object} handlers
 * @param {object} handlers.managers - Tool managers
 * @param {function} handlers.restoreLineup - Callback to rebuild LineUp with saved dump
 * @param {function} handlers.activateView - Callback to switch view tab
 */
export function restoreSessionState(session, { managers = {}, restoreLineup, activateView }) {
    if (!session || !session.tools) return;

    const tools = session.tools;

    // Restore LineUp
    if (tools.lineup && tools.lineup.dump && typeof restoreLineup === 'function') {
        try {
            restoreLineup(tools.lineup.dump);
        } catch (e) {
            console.warn('Error restoring LineUp from session:', e);
        }
    }

    // Restore SandDance
    if (tools.sanddance && managers.sanddance?.importState) {
        try {
            managers.sanddance.importState(tools.sanddance);
        } catch (e) {
            console.warn('Error restoring SandDance from session:', e);
        }
    }

    // Restore Graphic-Walker
    if (tools.graphicWalker && managers.graphicWalker?.importState) {
        try {
            managers.graphicWalker.importState(tools.graphicWalker);
        } catch (e) {
            console.warn('Error restoring Graphic-Walker from session:', e);
        }
    }

    // Restore Sankey
    if (tools.sankey && managers.sankey?.importState) {
        try {
            managers.sankey.importState(tools.sankey);
        } catch (e) {
            console.warn('Error restoring Sankey from session:', e);
        }
    }

    // Restore Mermaid
    if (tools.mermaid && managers.mermaid?.importState) {
        try {
            managers.mermaid.importState(tools.mermaid);
        } catch (e) {
            console.warn('Error restoring Mermaid from session:', e);
        }
    }

    // Restore Vega
    if (tools.vega && managers.vega?.importState) {
        try {
            managers.vega.importState(tools.vega);
        } catch (e) {
            console.warn('Error restoring Vega from session:', e);
        }
    }

    // Restore Agent
    if (tools.agent && managers.agent?.importState) {
        try {
            managers.agent.importState(tools.agent);
        } catch (e) {
            console.warn('Error restoring Agent from session:', e);
        }
    }

    // Switch to active view
    if (session.activeView && typeof activateView === 'function') {
        try {
            activateView(session.activeView);
        } catch (e) {
            console.warn('Error activating view:', e);
        }
    }
}
