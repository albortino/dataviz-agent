/**
 * Lightweight IndexedDB wrapper for DataViz Studio & Insight Canvas workspace persistence.
 * Database: dataviz_storage_v1 (version 1)
 * Object stores:
 *   - chat_history: { sessionId, history, updatedAt } (keyPath: sessionId)
 *   - sessions: { id, ...sessionData, updatedAt } (keyPath: id)
 */

export const DB_NAME = 'dataviz_storage_v1';
export const DB_VERSION = 1;
export const CHAT_HISTORY_STORE = 'chat_history';
export const SESSIONS_STORE = 'sessions';
export const LEGACY_CHAT_STORAGE_KEY = 'ai_agent_chat_history_v1';

let dbInstance = null;

/**
 * Opens or returns cached IndexedDB database instance.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
    if (dbInstance) {
        return Promise.resolve(dbInstance);
    }

    return new Promise((resolve, reject) => {
        const idb = typeof indexedDB !== 'undefined'
            ? indexedDB
            : (typeof window !== 'undefined' ? window.indexedDB : null);

        if (!idb) {
            reject(new Error('IndexedDB is not supported in this environment'));
            return;
        }

        const request = idb.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(CHAT_HISTORY_STORE)) {
                db.createObjectStore(CHAT_HISTORY_STORE, { keyPath: 'sessionId' });
            }
            if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
                db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
            }
        };

        request.onsuccess = () => {
            dbInstance = request.result;
            dbInstance.onversionchange = () => {
                dbInstance.close();
                dbInstance = null;
            };
            dbInstance.onclose = () => {
                dbInstance = null;
            };
            resolve(dbInstance);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

/**
 * Helper to execute a request inside an IDB transaction.
 */
async function performStoreRequest(storeName, mode, callback) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let req;

        try {
            req = callback(store);
        } catch (err) {
            reject(err);
            return;
        }

        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);

        if (req && 'onsuccess' in req) {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        } else {
            tx.oncomplete = () => resolve();
        }
    });
}

/**
 * Saves chat history array for a session/dataset key.
 * @param {string} key - Session or dataset identifier (defaults to 'default')
 * @param {Array} history - Array of chat turns/messages
 * @returns {Promise<string>} - sessionId key
 */
export async function saveChatHistory(key, history) {
    let actualKey = key;
    let actualHistory = history;

    if (history === undefined && typeof key !== 'string') {
        actualKey = 'default';
        actualHistory = key;
    } else if (!actualKey) {
        actualKey = 'default';
    }

    const record = {
        sessionId: actualKey,
        history: actualHistory,
        updatedAt: Date.now()
    };

    await performStoreRequest(CHAT_HISTORY_STORE, 'readwrite', store => store.put(record));
    return actualKey;
}

/**
 * Retrieves chat history array for a session/dataset key.
 * Automatically runs one-time migration from localStorage if needed.
 * @param {string} [key='default'] - Session or dataset identifier
 * @returns {Promise<Array|null>}
 */
export async function getChatHistory(key = 'default') {
    const actualKey = key || 'default';

    if (actualKey === 'default') {
        await migrateLegacyChatHistory();
    }

    const record = await performStoreRequest(CHAT_HISTORY_STORE, 'readonly', store => store.get(actualKey));
    if (!record) return null;
    return record.history !== undefined ? record.history : record;
}

/**
 * Saves a workspace session record.
 * @param {Object} sessionRecord
 * @returns {Promise<string>} - The saved session ID
 */
export async function saveSession(sessionRecord) {
    if (!sessionRecord || typeof sessionRecord !== 'object') {
        throw new Error('sessionRecord must be a valid object');
    }

    const record = { ...sessionRecord };
    if (!record.id) {
        record.id = record.sessionId || `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    record.updatedAt = record.updatedAt || Date.now();

    await performStoreRequest(SESSIONS_STORE, 'readwrite', store => store.put(record));
    return record.id;
}

/**
 * Retrieves a session record by sessionId.
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function getSession(sessionId) {
    if (!sessionId) return null;
    const record = await performStoreRequest(SESSIONS_STORE, 'readonly', store => store.get(sessionId));
    return record || null;
}

/**
 * Lists all session records.
 * @returns {Promise<Array>}
 */
export async function listSessions() {
    const records = await performStoreRequest(SESSIONS_STORE, 'readonly', store => store.getAll());
    return records || [];
}

/**
 * Deletes a session record by sessionId.
 * @param {string} sessionId
 * @returns {Promise<boolean>}
 */
export async function deleteSession(sessionId) {
    if (!sessionId) return false;
    await performStoreRequest(SESSIONS_STORE, 'readwrite', store => store.delete(sessionId));
    return true;
}

let isMigrating = false;

/**
 * One-time migration helper: migrates legacy localStorage chat history into IndexedDB.
 * @returns {Promise<boolean>} true if migration occurred, false otherwise
 */
export async function migrateLegacyChatHistory() {
    if (typeof window === 'undefined' || !window.localStorage) {
        return false;
    }

    if (isMigrating) {
        return false;
    }

    isMigrating = true;
    try {
        const raw = window.localStorage.getItem(LEGACY_CHAT_STORAGE_KEY);
        if (!raw) return false;

        let parsed = null;
        try {
            parsed = JSON.parse(raw);
        } catch (parseErr) {
            console.warn('Failed to parse legacy chat history from localStorage:', parseErr);
            window.localStorage.removeItem(LEGACY_CHAT_STORAGE_KEY);
            return false;
        }

        if (parsed) {
            await saveChatHistory('default', parsed);
        }
        window.localStorage.removeItem(LEGACY_CHAT_STORAGE_KEY);
        return true;
    } catch (err) {
        console.error('Migration of legacy chat history failed:', err);
        return false;
    } finally {
        isMigrating = false;
    }
}

/**
 * Closes the active database connection if open (useful for teardown or test suites).
 */
export function closeDB() {
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
    }
}
