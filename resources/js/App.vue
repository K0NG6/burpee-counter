<script setup>
import { ref } from 'vue';
import BurpeeTracker from './components/BurpeeTracker.vue';
import Leaderboard from './components/Leaderboard.vue';

const leaderboardRef = ref(null);

const handleRecordSaved = () => {
    leaderboardRef.value?.refresh();
};
</script>

<template>
    <main class="min-h-screen space-y-8 bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
        <BurpeeTracker @record-saved="handleRecordSaved" />
        <Leaderboard ref="leaderboardRef" />
    </main>
</template>

