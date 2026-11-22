/**
 * Recorrido vertical: proyecto de ejemplo → exportar MP4 y WebM → verificar con ffprobe.
 * Los archivos quedan en tests/output/.
 */
import { test, expect } from '@playwright/test';
// @ts-expect-error módulo JS sin tipos
import { probe, volume } from '../../scripts/verify-export.mjs';
import { exportAndSave, openSample, watchErrors } from './helpers.ts';

for (const fmt of ['mp4', 'webm'] as const) {
  test(`exporta el ejemplo en ${fmt.toUpperCase()} 720p con imagen y audio`, async ({ page }) => {
    const errors = watchErrors(page);
    await openSample(page);
    const { file, meta, elapsed } = await exportAndSave(page, fmt, `ejemplo-720p.${fmt}`);
    const p = probe(file);
    test.info().annotations.push({ type: 'ruta', description: `${meta.route.summary} ${elapsed} ms` });
    expect(p.video.codec).toBe(fmt === 'mp4' ? 'h264' : meta.route.video.codec === 'vp8' ? 'vp8' : 'vp9');
    expect(p.audio.codec).toBe(fmt === 'mp4' ? 'aac' : 'opus');
    expect([p.video.width, p.video.height]).toEqual([1280, 720]);
    expect(Math.abs(p.duration - 8.5)).toBeLessThan(0.1);
    expect(p.audio.sampleRate).toBe(48000);
    expect(volume(file).max).toBeGreaterThan(-20);
    expect(errors).toEqual([]);
  });
}

test('exporta MP4 por la ruta FFmpeg.wasm forzada', async ({ page }) => {
  await openSample(page);
  const { file, meta } = await exportAndSave(page, 'mp4', 'ejemplo-720p-ffmpeg.mp4', { forceFfmpeg: true });
  expect(meta.route.video.via).toBe('ffmpeg');
  const p = probe(file);
  expect(p.video.codec).toBe('h264');
  expect(p.audio.codec).toBe('aac');
  expect(Math.abs(p.duration - 8.5)).toBeLessThan(0.1);
});

test('exporta WebM por la ruta FFmpeg.wasm forzada', async ({ page }) => {
  await openSample(page);
  const { file, meta } = await exportAndSave(page, 'webm', 'ejemplo-720p-ffmpeg.webm', { forceFfmpeg: true });
  expect(meta.route.video.via).toBe('ffmpeg');
  const p = probe(file);
  expect(p.video.codec).toBe('vp8');
  expect(p.audio.codec).toBe('opus');
  expect(Math.abs(p.duration - 8.5)).toBeLessThan(0.1);
});

test('exporta MP4 a 1080p', async ({ page }) => {
  await openSample(page);
  const { file } = await exportAndSave(page, 'mp4', 'ejemplo-1080p.mp4', { resolution: '1080p' });
  const p = probe(file);
  expect([p.video.width, p.video.height]).toEqual([1920, 1080]);
  expect(p.audio.codec).toBe('aac');
});
