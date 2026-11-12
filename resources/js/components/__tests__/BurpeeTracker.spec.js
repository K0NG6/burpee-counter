import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

const mediaPipeMocks = vi.hoisted(() => {
    const poseInstances = [];

    class MockPose {
        constructor(options) {
            this.options = options;
            this.setOptions = vi.fn();
            this.onResultsCallback = null;
            this.onResults = vi.fn((cb) => {
                this.onResultsCallback = cb;
            });
            this.send = vi.fn().mockResolvedValue(undefined);
            this.close = vi.fn().mockResolvedValue(undefined);
            poseInstances.push(this);
        }
    }

    return {
        MockPose,
        poseInstances,
        POSE_CONNECTIONS: [
            [11, 23],
            [23, 25],
        ],
        drawConnectors: vi.fn(),
        drawLandmarks: vi.fn(),
    };
});

vi.mock('@mediapipe/pose', () => ({
    Pose: mediaPipeMocks.MockPose,
    POSE_CONNECTIONS: mediaPipeMocks.POSE_CONNECTIONS,
}));

vi.mock('@mediapipe/drawing_utils', () => ({
    drawConnectors: mediaPipeMocks.drawConnectors,
    drawLandmarks: mediaPipeMocks.drawLandmarks,
}));

import BurpeeTracker from '../BurpeeTracker.vue';

function createMockStream() {
    const track = { stop: vi.fn() };
    const stream = new MediaStream();
    stream.getTracks = vi.fn(() => [track]);
    return {
        stream,
        track,
    };
}

function buildPoseLandmarks({
    nose = { x: 0.5, y: 0.2, visibility: 0.99 },
    shoulder = { x: 0.5, y: 0.3, visibility: 0.99 },
    wrist = { x: 0.5, y: 0.5, visibility: 0.99 },
    hip = { x: 0.5, y: 0.55, visibility: 0.99 },
    knee = { x: 0.5, y: 0.8, visibility: 0.99 },
} = {}) {
    const landmarks = Array.from({ length: 33 }, () => ({
        x: 0.5,
        y: 0.5,
        visibility: 0.99,
    }));

    landmarks[0] = nose;
    landmarks[11] = shoulder;
    landmarks[12] = shoulder;
    landmarks[15] = wrist;
    landmarks[16] = wrist;
    landmarks[23] = hip;
    landmarks[24] = hip;
    landmarks[25] = knee;
    landmarks[26] = knee;

    return landmarks;
}

describe('BurpeeTracker.vue', () => {
    let createObjectURLSpy;
    let revokeObjectURLSpy;
    let getUserMediaMock;
    let canvasCtxMock;
    let rafCallbacks;
    let rafIdCounter;
    let cancelAnimationFrameSpy;

    beforeEach(() => {
        localStorage.clear();
        mediaPipeMocks.poseInstances.length = 0;
        mediaPipeMocks.drawConnectors.mockClear();
        mediaPipeMocks.drawLandmarks.mockClear();

        Object.defineProperty(HTMLMediaElement.prototype, 'play', {
            configurable: true,
            value: vi.fn().mockResolvedValue(undefined),
        });
        Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
            configurable: true,
            value: vi.fn(),
        });
        Object.defineProperty(HTMLMediaElement.prototype, 'load', {
            configurable: true,
            value: vi.fn(),
        });

        canvasCtxMock = {
            save: vi.fn(),
            restore: vi.fn(),
            clearRect: vi.fn(),
            drawImage: vi.fn(),
        };
        HTMLCanvasElement.prototype.getContext = vi.fn(() => canvasCtxMock);

        let counter = 0;
        createObjectURLSpy = vi.fn(() => `blob:mock-video-${++counter}`);
        revokeObjectURLSpy = vi.fn();
        vi.stubGlobal('URL', {
            ...URL,
            createObjectURL: createObjectURLSpy,
            revokeObjectURL: revokeObjectURLSpy,
        });

        rafCallbacks = new Map();
        rafIdCounter = 0;
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn((cb) => {
                const id = ++rafIdCounter;
                rafCallbacks.set(id, cb);
                return id;
            })
        );
        cancelAnimationFrameSpy = vi.fn((id) => {
            rafCallbacks.delete(id);
        });
        vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameSpy);

        vi.stubGlobal('isSecureContext', true);
        getUserMediaMock = vi.fn();
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: {
                getUserMedia: getUserMediaMock,
            },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('renders camera mode by default, initializes MediaPipe Pose with expected options, and closes on unmount', () => {
        const wrapper = mount(BurpeeTracker);

        const video = wrapper.find('video');
        const canvas = wrapper.find('canvas');

        expect(video.exists()).toBe(true);
        expect(video.attributes('playsinline')).toBeDefined();
        expect(video.element.muted).toBe(true);
        expect(canvas.exists()).toBe(true);
        expect(wrapper.find('input[type="file"]').exists()).toBe(false);

        expect(mediaPipeMocks.poseInstances).toHaveLength(1);
        const pose = mediaPipeMocks.poseInstances[0];
        expect(pose.setOptions).toHaveBeenCalledWith(
            expect.objectContaining({
                modelComplexity: 1,
                minDetectionConfidence: 0.5,
            })
        );
        expect(pose.onResults).toHaveBeenCalledTimes(1);

        const debugPanel = wrapper.find('aside');
        expect(debugPanel.text()).toContain('Live Камера');
        expect(debugPanel.text()).toContain('STANDING');
        expect(debugPanel.text()).toContain('0');

        wrapper.unmount();
        expect(pose.close).toHaveBeenCalledTimes(1);
    });

    it('toggles between Live Камера and Тестове відео and shows file input only in upload mode', async () => {
        const { stream } = createMockStream();
        getUserMediaMock.mockResolvedValue(stream);

        const wrapper = mount(BurpeeTracker);
        const tabs = wrapper.findAll('button[role="tab"]');

        await tabs[1].trigger('click');
        expect(wrapper.find('input[type="file"][accept="video/*"]').exists()).toBe(true);
        expect(wrapper.find('aside').text()).toContain('Тестове відео');

        await tabs[0].trigger('click');
        await flushPromises();
        expect(wrapper.find('input[type="file"]').exists()).toBe(false);
        expect(wrapper.find('aside').text()).toContain('Live Камера');
    });

    it('starts camera via getUserMedia, attaches stream to srcObject, and stops tracks on mode switch and unmount', async () => {
        const { stream, track } = createMockStream();
        getUserMediaMock.mockResolvedValue(stream);

        const wrapper = mount(BurpeeTracker);
        const startButton = wrapper.findAll('button').find((b) => b.text().includes('Увімкнути камеру'));
        await startButton.trigger('click');
        await flushPromises();

        expect(getUserMediaMock).toHaveBeenCalledWith({ video: true });
        const video = wrapper.find('video').element;
        expect(video.srcObject).toBe(stream);
        expect(wrapper.find('aside').text()).toContain('Активний');

        const uploadTab = wrapper.findAll('button[role="tab"]')[1];
        await uploadTab.trigger('click');
        expect(track.stop).toHaveBeenCalledTimes(1);
        expect(video.srcObject).toBeNull();

        const second = createMockStream();
        getUserMediaMock.mockResolvedValueOnce(second.stream);
        const cameraTab = wrapper.findAll('button[role="tab"]')[0];
        await cameraTab.trigger('click');
        await flushPromises();

        wrapper.unmount();
        expect(second.track.stop).toHaveBeenCalledTimes(1);
    });

    it('prevents leaking camera stream if mode changes before getUserMedia resolves', async () => {
        let resolveStream;
        getUserMediaMock.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveStream = resolve;
                })
        );

        const wrapper = mount(BurpeeTracker);
        const startButton = wrapper.findAll('button').find((b) => b.text().includes('Увімкнути камеру'));
        await startButton.trigger('click');

        const uploadTab = wrapper.findAll('button[role="tab"]')[1];
        await uploadTab.trigger('click');

        const { stream, track } = createMockStream();
        resolveStream(stream);
        await flushPromises();

        expect(track.stop).toHaveBeenCalledTimes(1);
        expect(wrapper.find('video').element.srcObject).toBeNull();
    });

    it('runs custom requestAnimationFrame loop sending video frames to pose.send while playing', async () => {
        const { stream } = createMockStream();
        getUserMediaMock.mockResolvedValue(stream);

        const wrapper = mount(BurpeeTracker);
        const video = wrapper.find('video').element;
        Object.defineProperty(video, 'paused', { configurable: true, value: false });
        Object.defineProperty(video, 'ended', { configurable: true, value: false });
        Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
        Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
        Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });

        const startButton = wrapper.findAll('button').find((b) => b.text().includes('Увімкнути камеру'));
        await startButton.trigger('click');
        await flushPromises();

        expect(rafCallbacks.size).toBe(1);
        const [firstId, firstCb] = Array.from(rafCallbacks.entries())[0];
        rafCallbacks.delete(firstId);
        await firstCb();

        const pose = mediaPipeMocks.poseInstances[0];
        expect(pose.send).toHaveBeenCalledTimes(1);
        expect(pose.send).toHaveBeenCalledWith({ image: video });

        // Loop schedules next frame while video keeps playing.
        expect(rafCallbacks.size).toBe(1);

        // Pausing cancels scheduled RAF loop.
        await wrapper.find('video').trigger('pause');
        expect(cancelAnimationFrameSpy).toHaveBeenCalled();
    });

    it('counts burpees accurately through STANDING -> PLANK -> JUMP -> STANDING state machine and renders skeleton on canvas', async () => {
        const wrapper = mount(BurpeeTracker);
        const pose = mediaPipeMocks.poseInstances[0];
        const fakeImage = { videoWidth: 1280, videoHeight: 720 };

        // 1) STANDING: angle ~ 180 deg, shoulder.y (0.25) < hip.y (0.55) - 0.15
        pose.onResultsCallback({
            image: fakeImage,
            poseLandmarks: buildPoseLandmarks({
                nose: { x: 0.5, y: 0.15, visibility: 0.99 },
                shoulder: { x: 0.5, y: 0.25, visibility: 0.99 },
                wrist: { x: 0.5, y: 0.5, visibility: 0.99 },
                hip: { x: 0.5, y: 0.55, visibility: 0.99 },
                knee: { x: 0.5, y: 0.85, visibility: 0.99 },
            }),
        });
        await nextTick();
        expect(wrapper.find('aside').text()).toContain('STANDING');
        expect(wrapper.find('aside').text()).toContain('0');

        // Verify canvas draw pipeline ran at end of onResults.
        expect(canvasCtxMock.clearRect).toHaveBeenCalledWith(0, 0, 1280, 720);
        expect(canvasCtxMock.drawImage).toHaveBeenCalledWith(fakeImage, 0, 0, 1280, 720);
        expect(mediaPipeMocks.drawConnectors).toHaveBeenCalledWith(
            canvasCtxMock,
            expect.any(Array),
            mediaPipeMocks.POSE_CONNECTIONS,
            expect.any(Object)
        );
        expect(mediaPipeMocks.drawLandmarks).toHaveBeenCalledWith(
            canvasCtxMock,
            expect.any(Array),
            expect.any(Object)
        );

        // 2) PLANK: |shoulder.y - hip.y| < 0.2 -> STANDING -> PLANK
        pose.onResultsCallback({
            image: fakeImage,
            poseLandmarks: buildPoseLandmarks({
                nose: { x: 0.2, y: 0.7, visibility: 0.99 },
                shoulder: { x: 0.3, y: 0.72, visibility: 0.99 },
                wrist: { x: 0.3, y: 0.9, visibility: 0.99 },
                hip: { x: 0.55, y: 0.74, visibility: 0.99 },
                knee: { x: 0.8, y: 0.76, visibility: 0.99 },
            }),
        });
        await nextTick();
        expect(wrapper.find('aside').text()).toContain('PLANK');
        expect(wrapper.find('aside').text()).toContain('0');

        // 3) JUMP: wrist.y < nose.y -> PLANK -> JUMP (burpeeCount increments to 1)
        pose.onResultsCallback({
            image: fakeImage,
            poseLandmarks: buildPoseLandmarks({
                nose: { x: 0.5, y: 0.2, visibility: 0.99 },
                shoulder: { x: 0.5, y: 0.3, visibility: 0.99 },
                wrist: { x: 0.5, y: 0.1, visibility: 0.99 },
                hip: { x: 0.5, y: 0.55, visibility: 0.99 },
                knee: { x: 0.5, y: 0.8, visibility: 0.99 },
            }),
        });
        await nextTick();
        expect(wrapper.find('aside').text()).toContain('JUMP');
        expect(wrapper.find('aside').text()).toContain('1');

        // Staying in JUMP frame must not double-count.
        pose.onResultsCallback({
            image: fakeImage,
            poseLandmarks: buildPoseLandmarks({
                nose: { x: 0.5, y: 0.22, visibility: 0.99 },
                shoulder: { x: 0.5, y: 0.32, visibility: 0.99 },
                wrist: { x: 0.5, y: 0.12, visibility: 0.99 },
                hip: { x: 0.5, y: 0.57, visibility: 0.99 },
                knee: { x: 0.5, y: 0.82, visibility: 0.99 },
            }),
        });
        await nextTick();
        expect(wrapper.find('aside').text()).toContain('1');

        // 4) Return to STANDING: angle > 160 && shoulder.y < hip.y - 0.15
        pose.onResultsCallback({
            image: fakeImage,
            poseLandmarks: buildPoseLandmarks({
                nose: { x: 0.5, y: 0.15, visibility: 0.99 },
                shoulder: { x: 0.5, y: 0.25, visibility: 0.99 },
                wrist: { x: 0.5, y: 0.5, visibility: 0.99 },
                hip: { x: 0.5, y: 0.55, visibility: 0.99 },
                knee: { x: 0.5, y: 0.85, visibility: 0.99 },
            }),
        });
        await nextTick();
        expect(wrapper.find('aside').text()).toContain('STANDING');
        expect(wrapper.find('aside').text()).toContain('1');
    });

    it('loads uploaded video via ObjectURL and revokes it on new file and unmount', async () => {
        const wrapper = mount(BurpeeTracker);
        await wrapper.findAll('button[role="tab"]')[1].trigger('click');

        const input = wrapper.find('input[type="file"]');
        const file1 = new File(['video-bytes-1'], 'burpee-set-1.mp4', { type: 'video/mp4' });
        Object.defineProperty(input.element, 'files', {
            configurable: true,
            value: [file1],
        });
        await input.trigger('change');
        await flushPromises();

        const video = wrapper.find('video').element;
        expect(createObjectURLSpy).toHaveBeenCalledWith(file1);
        expect(video.getAttribute('src')).toBe('blob:mock-video-1');
        expect(wrapper.text()).toContain('burpee-set-1.mp4');

        const file2 = new File(['video-bytes-2'], 'burpee-set-2.webm', { type: 'video/webm' });
        Object.defineProperty(input.element, 'files', {
            configurable: true,
            value: [file2],
        });
        await input.trigger('change');
        await flushPromises();

        expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-video-1');
        expect(video.getAttribute('src')).toBe('blob:mock-video-2');

        wrapper.unmount();
        expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-video-2');
    });

    it('rejects non-video file uploads with an error message', async () => {
        const wrapper = mount(BurpeeTracker);
        await wrapper.findAll('button[role="tab"]')[1].trigger('click');

        const input = wrapper.find('input[type="file"]');
        const invalidFile = new File(['hello'], 'notes.txt', { type: 'text/plain' });
        Object.defineProperty(input.element, 'files', {
            configurable: true,
            value: [invalidFile],
        });

        await input.trigger('change');
        await flushPromises();

        expect(createObjectURLSpy).not.toHaveBeenCalled();
        expect(wrapper.find('[role="alert"]').text()).toContain('Оберіть коректний відеофайл');
    });

    it('syncs canvas intrinsic dimensions with video metadata', async () => {
        const wrapper = mount(BurpeeTracker);
        const video = wrapper.find('video');
        const canvas = wrapper.find('canvas');

        Object.defineProperty(video.element, 'videoWidth', { configurable: true, value: 1280 });
        Object.defineProperty(video.element, 'videoHeight', { configurable: true, value: 720 });

        await video.trigger('loadedmetadata');

        expect(canvas.element.width).toBe(1280);
        expect(canvas.element.height).toBe(720);
        expect(wrapper.find('aside').text()).toContain('1280 × 720');
    });

    it('submits workout duration and count to POST /api/records with loader and success feedback', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));

        const { stream } = createMockStream();
        getUserMediaMock.mockResolvedValue(stream);

        let resolveFetch;
        const fetchMock = vi.fn(
            () =>
                new Promise((resolve) => {
                    resolveFetch = resolve;
                })
        );
        vi.stubGlobal('fetch', fetchMock);

        const wrapper = mount(BurpeeTracker);
        const finishButton = wrapper.get('[data-testid="finish-workout-btn"]');
        expect(finishButton.attributes('disabled')).toBeDefined();

        // Start camera at t=0s to fix startTime.
        await wrapper.findAll('button').find((b) => b.text().includes('Увімкнути камеру')).trigger('click');
        await flushPromises();

        // Simulate 1 completed burpee rep after 45 seconds.
        const pose = mediaPipeMocks.poseInstances[0];
        const fakeImage = { videoWidth: 640, videoHeight: 480 };

        pose.onResultsCallback({
            image: fakeImage,
            poseLandmarks: buildPoseLandmarks({
                nose: { x: 0.2, y: 0.7, visibility: 0.99 },
                shoulder: { x: 0.3, y: 0.72, visibility: 0.99 },
                wrist: { x: 0.3, y: 0.9, visibility: 0.99 },
                hip: { x: 0.55, y: 0.74, visibility: 0.99 },
                knee: { x: 0.8, y: 0.76, visibility: 0.99 },
            }),
        });
        pose.onResultsCallback({
            image: fakeImage,
            poseLandmarks: buildPoseLandmarks({
                nose: { x: 0.5, y: 0.2, visibility: 0.99 },
                shoulder: { x: 0.5, y: 0.3, visibility: 0.99 },
                wrist: { x: 0.5, y: 0.1, visibility: 0.99 },
                hip: { x: 0.5, y: 0.55, visibility: 0.99 },
                knee: { x: 0.5, y: 0.8, visibility: 0.99 },
            }),
        });
        await nextTick();

        expect(finishButton.attributes('disabled')).toBeUndefined();

        vi.setSystemTime(new Date('2026-11-12T10:00:45Z'));
        await finishButton.trigger('click');
        await nextTick();

        expect(finishButton.text()).toContain('Збереження...');
        expect(finishButton.attributes('disabled')).toBeDefined();

        const storedUserId = localStorage.getItem('burpee_counter_user_id');
        expect(storedUserId).toBeTruthy();
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringMatching(/\/api\/records$/),
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({
                    user_id: storedUserId,
                    count: 1,
                    duration_seconds: 45,
                }),
            })
        );

        const createdRecord = {
            id: 77,
            user_id: storedUserId,
            count: 1,
            duration_seconds: 45,
        };
        resolveFetch({
            ok: true,
            status: 201,
            json: async () => ({ data: createdRecord }),
        });
        await flushPromises();

        expect(wrapper.find('[role="status"]').text()).toContain('Тренування збережено: 1 бьорпі за 45 сек.');
        expect(wrapper.find('aside').text()).toContain('0');
        expect(wrapper.emitted('record-saved')).toEqual([[createdRecord]]);
    });

    it('shows error alert and keeps burpee count if saving workout fails', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => ({ message: 'Помилка бази даних' }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const wrapper = mount(BurpeeTracker);
        const pose = mediaPipeMocks.poseInstances[0];
        const fakeImage = { videoWidth: 640, videoHeight: 480 };

        pose.onResultsCallback({
            image: fakeImage,
            poseLandmarks: buildPoseLandmarks({
                shoulder: { x: 0.3, y: 0.72, visibility: 0.99 },
                hip: { x: 0.55, y: 0.74, visibility: 0.99 },
                knee: { x: 0.8, y: 0.76, visibility: 0.99 },
            }),
        });
        pose.onResultsCallback({
            image: fakeImage,
            poseLandmarks: buildPoseLandmarks({
                nose: { x: 0.5, y: 0.2, visibility: 0.99 },
                wrist: { x: 0.5, y: 0.1, visibility: 0.99 },
            }),
        });
        await nextTick();

        await wrapper.get('[data-testid="finish-workout-btn"]').trigger('click');
        await flushPromises();

        expect(wrapper.find('[role="alert"]').text()).toContain('Помилка бази даних');
        expect(wrapper.find('aside').text()).toContain('1');
        expect(wrapper.emitted('record-saved')).toBeUndefined();
    });
});
