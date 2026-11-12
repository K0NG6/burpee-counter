<script setup>
import { onMounted, ref } from 'vue';
import { fetchLeaderboard, getOrCreateUserId } from '../services/api';

const records = ref([]);
const isLoading = ref(false);
const errorMessage = ref('');
const currentUserId = ref(getOrCreateUserId());

const formatShortUserId = (userId) => {
    if (typeof userId !== 'string' || userId.trim() === '') {
        return '—';
    }

    return userId.length > 8 ? `${userId.slice(0, 8)}...` : userId;
};

const getRankValue = (record, index) => record?.rank ?? index + 1;
const getBurpeeTotal = (record) => record?.total_burpees ?? record?.count ?? 0;
const getDurationSeconds = (record) =>
    record?.total_duration_seconds ?? record?.duration_seconds ?? 0;

const getRankBadgeClass = (rank) => {
    if (rank === 1) {
        return 'border-amber-400/50 bg-amber-500/20 text-amber-300';
    }
    if (rank === 2) {
        return 'border-slate-300/40 bg-slate-400/20 text-slate-200';
    }
    if (rank === 3) {
        return 'border-orange-400/40 bg-orange-500/20 text-orange-300';
    }

    return 'border-slate-700 bg-slate-900 text-slate-400';
};

const loadLeaderboard = async () => {
    isLoading.value = true;
    errorMessage.value = '';

    try {
        records.value = await fetchLeaderboard();
    } catch (error) {
        errorMessage.value =
            error?.message || 'Не вдалося завантажити таблицю лідерів. Бекенд недоступний.';
    } finally {
        isLoading.value = false;
    }
};

defineExpose({
    refresh: loadLeaderboard,
});

onMounted(() => {
    loadLeaderboard();
});
</script>

<template>
    <section
        aria-label="Таблиця лідерів"
        class="mx-auto flex w-full max-w-5xl flex-col gap-5 rounded-2xl border border-slate-800 bg-slate-900/95 p-5 text-slate-100 shadow-2xl sm:p-8"
    >
        <header class="flex flex-col justify-between gap-4 border-b border-slate-800 pb-4 sm:flex-row sm:items-center">
            <div>
                <h2 class="text-xl font-bold tracking-tight text-white">
                    Таблиця лідерів (Топ-10)
                </h2>
                <p class="mt-1 text-sm text-slate-400">
                    Кращі результати за сумарною кількістю виконаних бьорпі.
                </p>
            </div>

            <button
                type="button"
                :disabled="isLoading"
                class="inline-flex items-center justify-center gap-2 self-start rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-emerald-500/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
                @click="loadLeaderboard"
            >
                {{ isLoading ? 'Оновлення...' : 'Оновити' }}
            </button>
        </header>

        <!-- Loading Skeleton State -->
        <div
            v-if="isLoading && records.length === 0"
            role="status"
            aria-live="polite"
            class="space-y-3"
        >
            <p class="text-sm text-slate-400">Завантаження рейтингу...</p>
            <div
                v-for="row in 5"
                :key="row"
                class="h-12 animate-pulse rounded-lg border border-slate-800/80 bg-slate-950/70"
            />
        </div>

        <!-- Error State -->
        <div
            v-else-if="errorMessage"
            role="alert"
            class="flex flex-col justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-950/50 p-4 text-sm text-rose-200 sm:flex-row sm:items-center"
        >
            <span>{{ errorMessage }}</span>
            <button
                type="button"
                class="shrink-0 self-start rounded-lg border border-rose-400/40 bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/30 sm:self-auto"
                @click="loadLeaderboard"
            >
                Спробувати ще раз
            </button>
        </div>

        <!-- Empty State -->
        <div
            v-else-if="records.length === 0"
            class="rounded-xl border border-dashed border-slate-800 bg-slate-950/60 px-6 py-10 text-center text-sm text-slate-400"
        >
            Поки що немає збережених тренувань. Завершіть перше тренування, щоб потрапити до рейтингу!
        </div>

        <!-- Leaderboard Table -->
        <div v-else class="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
            <table class="min-w-full divide-y divide-slate-800 text-left text-sm">
                <thead class="bg-slate-950/90 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                    <tr>
                        <th scope="col" class="px-4 py-3.5">Місце</th>
                        <th scope="col" class="px-4 py-3.5">User ID</th>
                        <th scope="col" class="px-4 py-3.5 text-right">Кількість Бьорпі</th>
                        <th scope="col" class="px-4 py-3.5 text-right">Час (сек)</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-800/70">
                    <tr
                        v-for="(record, index) in records"
                        :key="record.user_id ?? index"
                        :class="
                            record.user_id === currentUserId
                                ? 'bg-emerald-950/25'
                                : 'transition hover:bg-slate-900/60'
                        "
                    >
                        <td class="whitespace-nowrap px-4 py-3.5">
                            <span
                                class="inline-flex h-7 min-w-7 items-center justify-center rounded-full border px-2 font-mono text-xs font-bold"
                                :class="getRankBadgeClass(getRankValue(record, index))"
                            >
                                #{{ getRankValue(record, index) }}
                            </span>
                        </td>
                        <td class="whitespace-nowrap px-4 py-3.5">
                            <div class="flex items-center gap-2">
                                <span
                                    class="font-mono text-sm font-medium text-slate-200"
                                    :title="record.user_id"
                                >
                                    {{ formatShortUserId(record.user_id) }}
                                </span>
                                <span
                                    v-if="record.user_id === currentUserId"
                                    class="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300"
                                >
                                    Ви
                                </span>
                            </div>
                        </td>
                        <td class="whitespace-nowrap px-4 py-3.5 text-right font-mono text-base font-bold text-emerald-400">
                            {{ getBurpeeTotal(record) }}
                        </td>
                        <td class="whitespace-nowrap px-4 py-3.5 text-right font-mono text-slate-300">
                            {{ getDurationSeconds(record) }}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </section>
</template>

