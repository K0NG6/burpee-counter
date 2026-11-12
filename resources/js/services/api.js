const USER_ID_STORAGE_KEY = 'burpee_counter_user_id';
const DEFAULT_LOCAL_API_URL = 'http://localhost:8000';
const UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolve the Laravel API base URL from Vite env or local dev origin.
 */
function resolveApiBaseUrl() {
    const configured = import.meta.env?.VITE_API_BASE_URL;

    if (typeof configured === 'string' && configured.trim() !== '') {
        return configured.trim().replace(/\/+$/, '');
    }

    if (typeof window !== 'undefined' && window.location?.port === '5173') {
        return DEFAULT_LOCAL_API_URL;
    }

    return '';
}

export const API_BASE_URL = resolveApiBaseUrl();

/**
 * Generate an RFC 4122 compliant UUID v4 string.
 */
export function generateUuidV4() {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);

    if (typeof globalThis.crypto?.getRandomValues === 'function') {
        globalThis.crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));

    return [
        hex.slice(0, 4).join(''),
        hex.slice(4, 6).join(''),
        hex.slice(6, 8).join(''),
        hex.slice(8, 10).join(''),
        hex.slice(10, 16).join(''),
    ].join('-');
}

/**
 * Retrieve existing anonymous user UUID v4 from localStorage or create one.
 */
export function getOrCreateUserId() {
    try {
        const stored = globalThis.localStorage?.getItem(USER_ID_STORAGE_KEY);

        if (typeof stored === 'string' && UUID_V4_PATTERN.test(stored)) {
            return stored;
        }
    } catch {
        // Ignore storage read errors in restricted browser contexts.
    }

    const freshId = generateUuidV4();

    try {
        globalThis.localStorage?.setItem(USER_ID_STORAGE_KEY, freshId);
    } catch {
        // Ignore storage write errors so the workout flow still works in memory.
    }

    return freshId;
}

/**
 * Extract the most informative error message from a Laravel JSON error payload.
 */
function extractErrorMessage(payload, status) {
    if (payload && typeof payload === 'object') {
        if (payload.errors && typeof payload.errors === 'object') {
            const firstFieldErrors = Object.values(payload.errors)[0];
            if (Array.isArray(firstFieldErrors) && firstFieldErrors[0]) {
                return String(firstFieldErrors[0]);
            }
        }

        if (typeof payload.message === 'string' && payload.message.trim() !== '') {
            return payload.message;
        }
    }

    return `Помилка запиту до API (HTTP ${status}).`;
}

/**
 * Perform a JSON request against the Laravel REST API.
 */
async function requestJson(path, options = {}) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const headers = {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers ?? {}),
    };

    const response = await fetch(`${API_BASE_URL}${normalizedPath}`, {
        ...options,
        headers,
    });

    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok) {
        const error = new Error(extractErrorMessage(payload, response.status));
        error.status = response.status;
        error.payload = payload;
        throw error;
    }

    return payload;
}

/**
 * Save a finished burpee workout session to Laravel API.
 */
export async function saveBurpeeRecord({ userId, count, durationSeconds }) {
    const payload = await requestJson('/api/records', {
        method: 'POST',
        body: JSON.stringify({
            user_id: userId,
            count,
            duration_seconds: durationSeconds,
        }),
    });

    return payload?.data ?? payload;
}

/**
 * Load the top-10 leaderboard from Laravel API.
 */
export async function fetchLeaderboard() {
    const payload = await requestJson('/api/leaderboard', {
        method: 'GET',
    });

    return Array.isArray(payload?.data) ? payload.data : [];
}

