import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import { bunny } from 'laravel-vite-plugin/fonts';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';

function mediapipeEsModuleShim() {
    const shims = {
        '@mediapipe/pose/pose.js': [
            'export const Pose = globalThis.Pose;',
            'export const POSE_CONNECTIONS = globalThis.POSE_CONNECTIONS;',
            'export const POSE_LANDMARKS = globalThis.POSE_LANDMARKS;',
            'export const POSE_LANDMARKS_LEFT = globalThis.POSE_LANDMARKS_LEFT;',
            'export const POSE_LANDMARKS_RIGHT = globalThis.POSE_LANDMARKS_RIGHT;',
            'export const POSE_LANDMARKS_NEUTRAL = globalThis.POSE_LANDMARKS_NEUTRAL;',
            'export const VERSION = globalThis.VERSION;',
        ].join('\n'),
        '@mediapipe/drawing_utils/drawing_utils.js': [
            'export const drawConnectors = globalThis.drawConnectors;',
            'export const drawLandmarks = globalThis.drawLandmarks;',
            'export const drawRectangle = globalThis.drawRectangle;',
            'export const clamp = globalThis.clamp;',
            'export const lerp = globalThis.lerp;',
        ].join('\n'),
    };

    return {
        name: 'mediapipe-esm-shim',
        load(id) {
            const normalizedId = id.replace(/\\/g, '/').split('?')[0];

            for (const [suffix, exportsCode] of Object.entries(shims)) {
                if (normalizedId.endsWith(suffix)) {
                    const code = fs.readFileSync(path.resolve(normalizedId), 'utf8');
                    return `${code}\n${exportsCode}\n`;
                }
            }

            return null;
        },
    };
}

export default defineConfig({
    plugins: [
        mediapipeEsModuleShim(),
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.js'],
            refresh: true,
            fonts: [
                bunny('Instrument Sans', {
                    weights: [400, 500, 600],
                }),
            ],
        }),
        vue({
            template: {
                transformAssetUrls: {
                    base: null,
                    includeAbsolute: false,
                },
            },
        }),
        tailwindcss(),
    ],
    optimizeDeps: {
        exclude: ['@mediapipe/pose', '@mediapipe/drawing_utils'],
    },
    server: {
        watch: {
            ignored: ['**/storage/framework/views/**'],
        },
    },
});
