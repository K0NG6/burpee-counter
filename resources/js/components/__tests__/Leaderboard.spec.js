import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import Leaderboard from '../Leaderboard.vue';

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('Leaderboard.vue', () => {
    const currentUuid = '550e8400-e29b-41d4-a716-446655440000';

    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('burpee_counter_user_id', currentUuid);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('shows loading skeleton while fetching and renders leaderboard table on mount', async () => {
        const deferred = createDeferred();
        const fetchMock = vi.fn().mockReturnValue(deferred.promise);
        vi.stubGlobal('fetch', fetchMock);

        const wrapper = mount(Leaderboard);
        await nextTick();

        expect(wrapper.find('[role="status"]').text()).toContain('Завантаження рейтингу');

        deferred.resolve({
            ok: true,
            status: 200,
            json: async () => ({
                data: [
                    {
                        rank: 1,
                        user_id: currentUuid,
                        total_burpees: 35,
                        total_duration_seconds: 95,
                    },
                    {
                        rank: 2,
                        user_id: '123e4567-e89b-42d3-a456-426614174000',
                        total_burpees: 20,
                        total_duration_seconds: 60,
                    },
                ],
            }),
        });
        await flushPromises();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const headers = wrapper.findAll('thead th').map((th) => th.text());
        expect(headers).toEqual(['Місце', 'User ID', 'Кількість Бьорпі', 'Час (сек)']);

        const rows = wrapper.findAll('tbody tr');
        expect(rows).toHaveLength(2);
        expect(rows[0].text()).toContain('#1');
        expect(rows[0].text()).toContain('550e8400...');
        expect(rows[0].text()).toContain('Ви');
        expect(rows[0].text()).toContain('35');
        expect(rows[0].text()).toContain('95');

        expect(rows[1].text()).toContain('#2');
        expect(rows[1].text()).toContain('123e4567...');
        expect(rows[1].text()).not.toContain('Ви');
    });

    it('displays empty state message when leaderboard has no records', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ data: [] }),
            })
        );

        const wrapper = mount(Leaderboard);
        await flushPromises();

        expect(wrapper.find('table').exists()).toBe(false);
        expect(wrapper.text()).toContain('Поки що немає збережених тренувань');
    });

    it('shows error alert when backend is unavailable and allows retry', async () => {
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(new Error('Failed to fetch'))
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({
                    data: [
                        {
                            rank: 1,
                            user_id: 'abcdef12-e89b-42d3-a456-426614174000',
                            total_burpees: 10,
                            total_duration_seconds: 30,
                        },
                    ],
                }),
            });
        vi.stubGlobal('fetch', fetchMock);

        const wrapper = mount(Leaderboard);
        await flushPromises();

        const alert = wrapper.find('[role="alert"]');
        expect(alert.exists()).toBe(true);
        expect(alert.text()).toContain('Failed to fetch');

        await alert.find('button').trigger('click');
        await flushPromises();

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
        expect(wrapper.find('tbody').text()).toContain('abcdef12...');
    });
});
