<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { POSE_CONNECTIONS, Pose } from '@mediapipe/pose';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { getOrCreateUserId, saveBurpeeRecord } from '../services/api';

const emit = defineEmits(['record-saved']);

const MODES = {
    CAMERA: 'camera',
    UPLOAD: 'upload',
};

const STATES = {
    STANDING: 'STANDING',
    PLANK: 'PLANK',
    JUMP: 'JUMP',
};

const MIN_LANDMARK_VISIBILITY = 0.4;
const MEDIAPIPE_POSE_VERSION = '0.5.1675469404';
const HAVE_CURRENT_DATA = 2;

const mode = ref(MODES.CAMERA);
const userId = ref(getOrCreateUserId());
const burpeeCount = ref(0);
const currentState = ref(STATES.STANDING);
const lastHipAngle = ref(null);
const streamStatus = ref('idle'); // 'idle' | 'loading' | 'active' | 'error'
const errorMessage = ref('');
const selectedFileName = ref('');
const videoDimensions = ref({ width: 0, height: 0 });
const isDraggingOver = ref(false);
const startTime = ref(null);
const isSubmitting = ref(false);
const submitStatus = ref('idle'); // 'idle' | 'success' | 'error'
const submitMessage = ref('');

const videoRef = ref(null);
const canvasRef = ref(null);
const fileInputElement = ref(null);

// Keep native media, RAF, and MediaPipe instances outside Vue's reactive Proxy.
let activeStream = null;
let objectUrl = null;
let activeRequestId = 0;
let animationFrameId = null;
let isSendingFrame = false;
let isLoopRunning = false;
let isDisposed = false;
let poseInstance = null;

const sourceLabel = computed(() =>
    mode.value === MODES.CAMERA ? 'Live Камера' : 'Тестове відео'
);

const statusMeta = computed(() => {
    const map = {
        idle: {
            label: 'Очікування',
            dotClass: 'bg-slate-400',
            badgeClass: 'bg-slate-800 text-slate-300 border-slate-700',
        },
        loading: {
            label: 'Ініціалізація...',
            dotClass: 'bg-amber-400 animate-pulse',
            badgeClass: 'bg-amber-950/60 text-amber-300 border-amber-700/60',
        },
        active: {
            label: 'Активний',
            dotClass: 'bg-emerald-400 animate-pulse',
            badgeClass: 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60',
        },
        error: {
            label: 'Помилка',
            dotClass: 'bg-rose-400',
            badgeClass: 'bg-rose-950/60 text-rose-300 border-rose-700/60',
        },
    };

    return map[streamStatus.value] ?? map.idle;
});

const stateBadgeClass = computed(() => {
    const map = {
        [STATES.STANDING]: 'border-sky-500/40 bg-sky-950/60 text-sky-300',
        [STATES.PLANK]: 'border-amber-500/40 bg-amber-950/60 text-amber-300',
        [STATES.JUMP]: 'border-emerald-500/40 bg-emerald-950/60 text-emerald-300',
    };

    return map[currentState.value] ?? map[STATES.STANDING];
});

const resolutionLabel = computed(() => {
    const { width, height } = videoDimensions.value;

    return width > 0 && height > 0 ? `${width} × ${height}` : '—';
});

const hipAngleLabel = computed(() =>
    lastHipAngle.value !== null ? `${Math.round(lastHipAngle.value)}°` : '—'
);

const calculateAngle = (a, b, c) => {
    if (!a || !b || !c) {
        return 0;
    }

    const radians =
        Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs((radians * 180) / Math.PI);

    if (angle > 180) {
        angle = 360 - angle;
    }

    return angle;
};

const isLandmarkVisible = (point) =>
    Boolean(point) && (point.visibility ?? 1) >= MIN_LANDMARK_VISIBILITY;

const resolveJointPoint = (left, right) => {
    const leftVisible = isLandmarkVisible(left);
    const rightVisible = isLandmarkVisible(right);

    if (leftVisible && rightVisible) {
        return {
            x: (left.x + right.x) / 2,
            y: (left.y + right.y) / 2,
            visibility: Math.min(left.visibility ?? 1, right.visibility ?? 1),
        };
    }

    if (leftVisible) {
        return left;
    }

    if (rightVisible) {
        return right;
    }

    return null;
};

const updateBurpeeState = (landmarks) => {
    const nose = isLandmarkVisible(landmarks[0]) ? landmarks[0] : null;
    const shoulder = resolveJointPoint(landmarks[11], landmarks[12]);
    const wrist = resolveJointPoint(landmarks[15], landmarks[16]);
    const hip = resolveJointPoint(landmarks[23], landmarks[24]);
    const knee = resolveJointPoint(landmarks[25], landmarks[26]);

    if (!shoulder || !hip || !knee) {
        lastHipAngle.value = null;
        return;
    }

    const hipAngle = calculateAngle(shoulder, hip, knee);
    lastHipAngle.value = hipAngle;

    const isStanding = hipAngle > 160 && shoulder.y < hip.y - 0.15;
    const isPlank = Math.abs(shoulder.y - hip.y) < 0.2;
    const isJump = Boolean(wrist && nose && wrist.y < nose.y);

    if (currentState.value === STATES.STANDING && isPlank) {
        currentState.value = STATES.PLANK;
    } else if (currentState.value === STATES.PLANK && isJump) {
        burpeeCount.value += 1;
        currentState.value = STATES.JUMP;
    } else if (currentState.value === STATES.JUMP && isStanding) {
        currentState.value = STATES.STANDING;
    }
};

const onResults = (results) => {
    if (isDisposed) {
        return;
    }

    const canvas = canvasRef.value;
    if (!canvas) {
        return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return;
    }

    const frameWidth =
        results?.image?.videoWidth ||
        results?.image?.width ||
        videoRef.value?.videoWidth ||
        0;
    const frameHeight =
        results?.image?.videoHeight ||
        results?.image?.height ||
        videoRef.value?.videoHeight ||
        0;

    if (frameWidth > 0 && frameHeight > 0) {
        if (canvas.width !== frameWidth || canvas.height !== frameHeight) {
            canvas.width = frameWidth;
            canvas.height = frameHeight;
        }
    }

    const landmarks = results?.poseLandmarks;

    if (Array.isArray(landmarks) && landmarks.length > 0) {
        updateBurpeeState(landmarks);
    }

    // Clear canvas, draw current video frame, then overlay MediaPipe skeleton.
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (results?.image) {
        ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
    }

    if (Array.isArray(landmarks) && landmarks.length > 0) {
        drawConnectors(ctx, landmarks, POSE_CONNECTIONS, {
            color: '#10b981',
            lineWidth: 4,
        });
        drawLandmarks(ctx, landmarks, {
            color: '#f8fafc',
            fillColor: '#10b981',
            lineWidth: 2,
            radius: 5,
        });
    }

    ctx.restore();
};

const initPose = () => {
    if (poseInstance) {
        return poseInstance;
    }

    const pose = new Pose({
        locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/pose@${MEDIAPIPE_POSE_VERSION}/${file}`,
    });

    pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
    });

    pose.onResults(onResults);
    poseInstance = pose;

    return pose;
};

const stopProcessingLoop = () => {
    isLoopRunning = false;

    if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
};

const processFrame = async () => {
    if (!isLoopRunning || isDisposed) {
        return;
    }

    const video = videoRef.value;

    if (!video || video.paused || video.ended) {
        stopProcessingLoop();
        return;
    }

    if (
        poseInstance &&
        !isSendingFrame &&
        video.readyState >= HAVE_CURRENT_DATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
    ) {
        isSendingFrame = true;

        try {
            await poseInstance.send({ image: video });
        } catch (error) {
            if (!isDisposed) {
                errorMessage.value =
                    error?.message || 'Помилка обробки кадру нейромережею MediaPipe Pose.';
            }
        } finally {
            isSendingFrame = false;
        }
    }

    if (isLoopRunning && !isDisposed && !video.paused && !video.ended) {
        animationFrameId = requestAnimationFrame(processFrame);
    } else {
        stopProcessingLoop();
    }
};

const startProcessingLoop = () => {
    const video = videoRef.value;
    if (isDisposed || !video || video.paused || video.ended) {
        return;
    }

    initPose();

    if (isLoopRunning) {
        return;
    }

    isLoopRunning = true;
    animationFrameId = requestAnimationFrame(processFrame);
};

const clearCanvas = () => {
    const canvas = canvasRef.value;
    if (!canvas) {
        return;
    }

    const context = canvas.getContext('2d');
    if (context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
    }

    canvas.width = 0;
    canvas.height = 0;
};

const stopStreamTracks = (stream) => {
    if (!stream) {
        return;
    }

    stream.getTracks().forEach((track) => {
        track.stop();
    });
};

const cleanupMedia = () => {
    stopProcessingLoop();

    // Reset status before tearing down <video> so synthetic error events are ignored.
    streamStatus.value = 'idle';
    currentState.value = STATES.STANDING;
    lastHipAngle.value = null;
    videoDimensions.value = { width: 0, height: 0 };
    selectedFileName.value = '';
    errorMessage.value = '';

    const video = videoRef.value;
    const videoStream =
        video?.srcObject && typeof video.srcObject.getTracks === 'function'
            ? video.srcObject
            : null;

    if (activeStream) {
        stopStreamTracks(activeStream);
    }

    if (videoStream && videoStream !== activeStream) {
        stopStreamTracks(videoStream);
    }

    activeStream = null;

    if (video) {
        video.pause();
        video.srcObject = null;

        if (video.hasAttribute('src')) {
            video.removeAttribute('src');
            video.load();
        }
    }

    if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
    }

    clearCanvas();
};

const syncCanvasDimensions = () => {
    const video = videoRef.value;
    const canvas = canvasRef.value;

    if (!video || !canvas) {
        return;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;

    if (width > 0 && height > 0) {
        canvas.width = width;
        canvas.height = height;
        videoDimensions.value = { width, height };
    }
};

const mapMediaError = (error) => {
    if (!window.isSecureContext) {
        return 'Доступ до камери потребує безпечного з’єднання (HTTPS або localhost).';
    }

    const name = error?.name ?? '';

    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        return 'Доступ до камери заборонено. Дозвольте використання камери в налаштуваннях браузера.';
    }

    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        return 'Веб-камеру не знайдено. Перевірте підключення пристрою або оберіть режим "Тестове відео".';
    }

    if (name === 'NotReadableError' || name === 'TrackStartError') {
        return 'Камера зайнята іншим додатком. Закрийте інші програми та спробуйте ще раз.';
    }

    return error?.message || 'Не вдалося отримати відеопотік з веб-камери.';
};

const startCamera = async () => {
    cleanupMedia();

    if (!navigator.mediaDevices?.getUserMedia) {
        streamStatus.value = 'error';
        errorMessage.value = 'Ваш браузер не підтримує MediaDevices API (getUserMedia).';
        return;
    }

    initPose();

    const requestId = ++activeRequestId;
    streamStatus.value = 'loading';

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });

        // Guard against mode switches or unmount while waiting for camera permission.
        if (isDisposed || requestId !== activeRequestId || mode.value !== MODES.CAMERA) {
            stopStreamTracks(stream);
            return;
        }

        await nextTick();
        const video = videoRef.value;

        if (!video) {
            stopStreamTracks(stream);
            return;
        }

        activeStream = stream;
        video.srcObject = stream;

        try {
            await video.play();
        } catch {
            // Autoplay may resolve asynchronously once metadata arrives.
        }

        streamStatus.value = 'active';
        startWorkoutTimer();
        startProcessingLoop();
    } catch (error) {
        if (isDisposed || requestId !== activeRequestId) {
            return;
        }

        streamStatus.value = 'error';
        errorMessage.value = mapMediaError(error);
    }
};

const stopCamera = () => {
    activeRequestId++;
    cleanupMedia();
};

const loadVideoFile = async (file) => {
    if (!file) {
        return;
    }

    if (file.type && !file.type.startsWith('video/')) {
        cleanupMedia();
        streamStatus.value = 'error';
        errorMessage.value = 'Оберіть коректний відеофайл (MP4, WebM, MOV тощо).';
        return;
    }

    initPose();

    activeRequestId++;
    cleanupMedia();

    selectedFileName.value = file.name;
    streamStatus.value = 'loading';

    const nextUrl = URL.createObjectURL(file);
    objectUrl = nextUrl;

    await nextTick();
    const video = videoRef.value;

    if (!video || isDisposed || mode.value !== MODES.UPLOAD) {
        cleanupMedia();
        return;
    }

    video.src = nextUrl;
    video.load();

    try {
        await video.play();
    } catch {
        // User can start playback manually via native video controls.
    }

    streamStatus.value = 'active';
    startWorkoutTimer();
    startProcessingLoop();
};

const handleFileUpload = async (event) => {
    const input = event.target;
    const file = input?.files?.[0];

    await loadVideoFile(file);

    if (input) {
        input.value = '';
    }
};

const handleFileDrop = async (event) => {
    isDraggingOver.value = false;
    const file = event.dataTransfer?.files?.[0];

    await loadVideoFile(file);
};

const handleVideoLoadedMetadata = () => {
    syncCanvasDimensions();
};

const handleVideoPlay = () => {
    if (streamStatus.value === 'active') {
        startWorkoutTimer();
        startProcessingLoop();
    }
};

const handleVideoPause = () => {
    stopProcessingLoop();
};

const handleVideoSeeked = async () => {
    const video = videoRef.value;

    if (
        !isDisposed &&
        poseInstance &&
        video &&
        video.paused &&
        !isSendingFrame &&
        video.readyState >= HAVE_CURRENT_DATA
    ) {
        isSendingFrame = true;
        try {
            await poseInstance.send({ image: video });
        } finally {
            isSendingFrame = false;
        }
    }
};

const handleVideoError = () => {
    if (streamStatus.value === 'idle') {
        return;
    }

    stopProcessingLoop();
    streamStatus.value = 'error';
    errorMessage.value = 'Не вдалося відтворити вибране відео. Перевірте формат файлу.';
};

const switchMode = async (nextMode) => {
    if (mode.value === nextMode) {
        return;
    }

    activeRequestId++;
    cleanupMedia();
    mode.value = nextMode;

    if (nextMode === MODES.CAMERA) {
        await startCamera();
    }
};

const startWorkoutTimer = () => {
    if (!startTime.value) {
        startTime.value = Date.now();
    }
};

const calculateDurationSeconds = () => {
    if (!startTime.value) {
        return 1;
    }

    return Math.max(1, Math.round((Date.now() - startTime.value) / 1000));
};

const finishWorkout = async () => {
    if (isSubmitting.value || burpeeCount.value < 1) {
        return;
    }

    const countToSave = burpeeCount.value;
    const durationSeconds = calculateDurationSeconds();

    isSubmitting.value = true;
    submitStatus.value = 'idle';
    submitMessage.value = '';

    try {
        const savedRecord = await saveBurpeeRecord({
            userId: userId.value,
            count: countToSave,
            durationSeconds,
        });

        submitStatus.value = 'success';
        submitMessage.value = `Тренування збережено: ${countToSave} бьорпі за ${durationSeconds} сек.`;
        burpeeCount.value = 0;
        currentState.value = STATES.STANDING;
        startTime.value = streamStatus.value === 'active' ? Date.now() : null;
        emit('record-saved', savedRecord);
    } catch (error) {
        submitStatus.value = 'error';
        submitMessage.value = error?.message || 'Не вдалося зберегти результат тренування.';
    } finally {
        isSubmitting.value = false;
    }
};

const resetCounter = () => {
    burpeeCount.value = 0;
    currentState.value = STATES.STANDING;
    startTime.value = streamStatus.value === 'active' ? Date.now() : null;
};

const triggerFilePicker = () => {
    fileInputElement.value?.click();
};

onMounted(() => {
    initPose();
});

onUnmounted(() => {
    isDisposed = true;
    activeRequestId++;
    cleanupMedia();

    if (poseInstance && typeof poseInstance.close === 'function') {
        poseInstance.close();
    }

    poseInstance = null;
});
</script>

<template>
    <section
        class="mx-auto flex w-full max-w-5xl flex-col gap-6 rounded-2xl border border-slate-800 bg-slate-900/95 p-5 text-slate-100 shadow-2xl sm:p-8"
    >
        <!-- Header & Mode Toggle -->
        <header class="flex flex-col justify-between gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center">
            <div>
                <div class="flex items-center gap-2.5">
                    <span class="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400"></span>
                    <h1 class="text-xl font-bold tracking-tight text-white sm:text-2xl">
                        Burpee Tracker
                    </h1>
                </div>
                <p class="mt-1 text-sm text-slate-400">
                    Аналіз пози та автоматичний підрахунок бьорпі в реальному часі через MediaPipe Pose.
                </p>
            </div>

            <!-- Mode Switcher (Toggle) -->
            <div
                role="tablist"
                aria-label="Джерело відео"
                class="inline-flex rounded-xl border border-slate-800 bg-slate-950 p-1"
            >
                <button
                    type="button"
                    role="tab"
                    :aria-selected="mode === MODES.CAMERA"
                    class="rounded-lg px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                    :class="
                        mode === MODES.CAMERA
                            ? 'bg-emerald-500 text-slate-950 shadow-sm'
                            : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                    "
                    @click="switchMode(MODES.CAMERA)"
                >
                    Live Камера
                </button>
                <button
                    type="button"
                    role="tab"
                    :aria-selected="mode === MODES.UPLOAD"
                    class="rounded-lg px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                    :class="
                        mode === MODES.UPLOAD
                            ? 'bg-emerald-500 text-slate-950 shadow-sm'
                            : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                    "
                    @click="switchMode(MODES.UPLOAD)"
                >
                    Тестове відео
                </button>
            </div>
        </header>

        <!-- Test Video Upload Zone (Visible only in upload mode) -->
        <div
            v-if="mode === MODES.UPLOAD"
            :class="
                isDraggingOver
                    ? 'border-emerald-400 bg-emerald-950/20'
                    : 'border-slate-700 bg-slate-950/60 hover:border-emerald-500/70'
            "
            class="flex flex-col items-center justify-between gap-4 rounded-xl border border-dashed p-5 text-center transition sm:flex-row sm:text-left"
            @dragover.prevent="isDraggingOver = true"
            @dragleave.prevent="isDraggingOver = false"
            @drop.prevent="handleFileDrop"
        >
            <div class="space-y-1">
                <p class="text-sm font-semibold text-slate-200">
                    Завантажте тестове відео з виконанням бьорпі
                </p>
                <p class="text-xs text-slate-400">
                    {{
                        selectedFileName
                            ? `Обрано файл: ${selectedFileName}`
                            : 'Підтримуються локальні відеофайли (MP4, WebM, MOV). Файл обробляється локально в браузері.'
                    }}
                </p>
            </div>

            <div class="shrink-0">
                <input
                    ref="fileInputElement"
                    type="file"
                    accept="video/*"
                    class="sr-only"
                    @change="handleFileUpload"
                />
                <button
                    type="button"
                    class="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                    @click="triggerFilePicker"
                >
                    {{ selectedFileName ? 'Обрати інше відео' : 'Обрати відеофайл' }}
                </button>
            </div>
        </div>

        <!-- Camera Controls Bar -->
        <div
            v-else
            class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3"
        >
            <p class="text-xs text-slate-400 sm:text-sm">
                Увімкніть веб-камеру для захоплення потоку та детекції пози в реальному часі.
            </p>
            <div class="flex items-center gap-2">
                <button
                    v-if="streamStatus !== 'active'"
                    type="button"
                    :disabled="streamStatus === 'loading'"
                    class="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                    @click="startCamera"
                >
                    {{ streamStatus === 'loading' ? 'Підключення...' : 'Увімкнути камеру' }}
                </button>
                <button
                    v-else
                    type="button"
                    class="rounded-lg border border-rose-500/40 bg-rose-500/15 px-4 py-2 text-sm font-medium text-rose-300 transition hover:bg-rose-500/25"
                    @click="stopCamera"
                >
                    Зупинити камеру
                </button>
            </div>
        </div>

        <!-- Error Alert -->
        <div
            v-if="errorMessage"
            role="alert"
            class="rounded-xl border border-rose-500/40 bg-rose-950/50 px-4 py-3 text-sm text-rose-200"
        >
            {{ errorMessage }}
        </div>

        <!-- Visualization Stage: <video> + overlaid <canvas> -->
        <div
            class="relative flex min-h-[340px] w-full items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-950"
        >
            <!-- Tightly wrapped video + canvas so canvas overlays exact video frame aspect ratio -->
            <div
                v-show="streamStatus === 'active'"
                class="relative inline-flex max-h-[540px] max-w-full items-center justify-center"
            >
                <video
                    ref="videoRef"
                    playsinline
                    muted
                    autoplay
                    :controls="mode === MODES.UPLOAD"
                    :class="{ '-scale-x-100': mode === MODES.CAMERA }"
                    class="block max-h-[540px] max-w-full rounded-lg bg-black"
                    @loadedmetadata="handleVideoLoadedMetadata"
                    @play="handleVideoPlay"
                    @playing="handleVideoPlay"
                    @pause="handleVideoPause"
                    @ended="handleVideoPause"
                    @seeked="handleVideoSeeked"
                    @error="handleVideoError"
                />

                <canvas
                    ref="canvasRef"
                    :class="{ '-scale-x-100': mode === MODES.CAMERA }"
                    class="pointer-events-none absolute inset-0 h-full w-full"
                />
            </div>

            <!-- Empty / Loading State Overlay -->
            <div
                v-if="streamStatus !== 'active'"
                class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center"
            >
                <div class="rounded-full border border-slate-800 bg-slate-900 p-4 text-slate-400">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-8 w-8"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="1.5"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
                        />
                    </svg>
                </div>

                <p class="max-w-md text-sm text-slate-300">
                    <template v-if="streamStatus === 'loading'">
                        Підготовка відеоджерела, зачекайте...
                    </template>
                    <template v-else-if="mode === MODES.CAMERA">
                        Натисніть «Увімкнути камеру», щоб активувати захоплення відео та розпізнавання скелета.
                    </template>
                    <template v-else>
                        Завантажте відеофайл вище, щоб запустити аналіз рухів через MediaPipe Pose.
                    </template>
                </p>
            </div>
        </div>

        <!-- Debug / Telemetry Panel -->
        <aside
            aria-label="Панель стану та дебагу"
            class="grid grid-cols-1 gap-3 rounded-xl border border-slate-800 bg-slate-950/80 p-4 sm:grid-cols-2 lg:grid-cols-5"
        >
            <div class="rounded-lg border border-slate-800/80 bg-slate-900/70 p-3">
                <span class="block text-xs font-medium tracking-wide text-slate-400 uppercase">
                    Джерело
                </span>
                <span class="mt-1 block truncate text-sm font-semibold text-white">
                    {{ sourceLabel }}
                </span>
            </div>

            <div class="rounded-lg border border-slate-800/80 bg-slate-900/70 p-3">
                <span class="block text-xs font-medium tracking-wide text-slate-400 uppercase">
                    Статус потоку
                </span>
                <span
                    class="mt-1 inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-medium"
                    :class="statusMeta.badgeClass"
                >
                    <span class="h-1.5 w-1.5 rounded-full" :class="statusMeta.dotClass"></span>
                    {{ statusMeta.label }}
                </span>
            </div>

            <div class="rounded-lg border border-slate-800/80 bg-slate-900/70 p-3">
                <span class="block text-xs font-medium tracking-wide text-slate-400 uppercase">
                    Стан (FSM)
                </span>
                <div class="mt-1 flex items-center justify-between gap-2">
                    <span
                        class="inline-flex rounded-md border px-2 py-0.5 font-mono text-xs font-semibold"
                        :class="stateBadgeClass"
                    >
                        {{ currentState }}
                    </span>
                    <span class="font-mono text-xs text-slate-400">
                        {{ hipAngleLabel }}
                    </span>
                </div>
            </div>

            <div class="rounded-lg border border-slate-800/80 bg-slate-900/70 p-3">
                <span class="block text-xs font-medium tracking-wide text-slate-400 uppercase">
                    Роздільна здатність
                </span>
                <span class="mt-1 block font-mono text-sm font-semibold text-slate-200">
                    {{ resolutionLabel }}
                </span>
            </div>

            <div class="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-950/20 p-3">
                <div>
                    <span class="block text-xs font-medium tracking-wide text-emerald-300/80 uppercase">
                        Кількість бьорпі
                    </span>
                    <span class="mt-0.5 block font-mono text-2xl font-bold text-emerald-400">
                        {{ burpeeCount }}
                    </span>
                </div>
                <button
                    v-if="burpeeCount > 0"
                    type="button"
                    class="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white"
                    @click="resetCounter"
                >
                    Скинути
                </button>
            </div>
        </aside>

        <!-- Workout Submission Bar -->
        <div
            class="flex flex-col justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/80 p-4 sm:flex-row sm:items-center"
        >
            <div class="space-y-1 text-xs text-slate-400">
                <p>
                    Анонімний ID:
                    <span class="font-mono font-medium text-slate-200" :title="userId">
                        {{ userId.slice(0, 8) }}...
                    </span>
                </p>
                <p>
                    {{
                        startTime
                            ? 'Відлік тренування активовано. Виконайте бьорпі та збережіть результат.'
                            : 'Увімкніть камеру або запустіть відео, щоб почати відлік тренування.'
                    }}
                </p>
            </div>

            <button
                type="button"
                data-testid="finish-workout-btn"
                :disabled="isSubmitting || burpeeCount < 1"
                class="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                @click="finishWorkout"
            >
                <svg
                    v-if="isSubmitting"
                    class="h-4 w-4 animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                >
                    <circle
                        class="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        stroke-width="4"
                    />
                    <path
                        class="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                </svg>
                <span>{{ isSubmitting ? 'Збереження...' : 'Завершити тренування' }}</span>
            </button>
        </div>

        <!-- Submission Feedback -->
        <div
            v-if="submitStatus === 'success'"
            role="status"
            class="rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200"
        >
            {{ submitMessage }}
        </div>
        <div
            v-else-if="submitStatus === 'error'"
            role="alert"
            class="rounded-xl border border-rose-500/40 bg-rose-950/50 px-4 py-3 text-sm text-rose-200"
        >
            {{ submitMessage }}
        </div>
    </section>
</template>
