import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    API_BASE_URL,
    fetchLeaderboard,
    generateUuidV4,
    getOrCreateUserId,
    saveBurpeeRecord,
} from '../api';

const STORAGE_KEY = 'burpee_counter_user_id';
const UUID_V4_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('api service', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('generates and persists an anonymous UUID v4 user_id in localStorage, then reuses it', () => {
        const firstId = getOrCreateUserId();
        expect(firstId).toMatch(UUID_V4_REGEX);
        expect(localStorage.getItem(STORAGE_KEY)).toBe(firstId);

        const secondId = getOrCreateUserId();
        expect(secondId).toBe(firstId);
    });

    it('replaces corrupted non-UUID user_id values in localStorage', () => {
        localStorage.setItem(STORAGE_KEY, 'not-a-valid-uuid');

        const recoveredId = getOrCreateUserId();
        expect(recoveredId).toMatch(UUID_V4_REGEX);
        expect(localStorage.getItem(STORAGE_KEY)).toBe(recoveredId);
    });

    it('generates valid UUID v4 even without crypto.randomUUID', () => {
        vi.stubGlobal('crypto', {
            getRandomValues: (arr) => {
                for (let i = 0; i < arr.length; i++) {
                    arr[i] = (i * 17 + 5) & 0xff;
                }
                return arr;
            },
        });

        expect(generateUuidV4()).toMatch(UUID_V4_REGEX);
    });

    it('posts burpee record payload to /api/records and returns created resource', async () => {
        const savedPayload = {
            id: 12,
            user_id: '550e8400-e29b-41d4-a716-446655440000',
            count: 15,
            duration_seconds: 62,
        };

        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 201,
            json: async () => ({ data: savedPayload }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await saveBurpeeRecord({
            userId: savedPayload.user_id,
            count: 15,
            durationSeconds: 62,
        });

        expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/api/records`, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                user_id: savedPayload.user_id,
                count: 15,
                duration_seconds: 62,
            }),
        });
        expect(result).toEqual(savedPayload);
    });

    it('throws validation message when POST /api/records returns 422', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: false,
                status: 422,
                json: async () => ({
                    message: 'The count field must be at least 1.',
                    errors: {
                        count: ['Кількість бьорпі має бути не менше 1.'],
                    },
                }),
            })
        );

        await expect(
            saveBurpeeRecord({
                userId: '550e8400-e29b-41d4-a716-446655440000',
                count: 0,
                durationSeconds: 10,
            })
        ).rejects.toThrow('Кількість бьорпі має бути не менше 1.');
    });

    it('fetches top-10 leaderboard from GET /api/leaderboard', async () => {
        const rows = [
            {
                rank: 1,
                user_id: '550e8400-e29b-41d4-a716-446655440000',
                total_burpees: 40,
                total_duration_seconds: 120,
            },
        ];

        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ data: rows }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchLeaderboard();

        expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/api/leaderboard`, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
            },
        });
        expect(result).toEqual(rows);
    });
});

