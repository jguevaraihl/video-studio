/** Edición, persistencia y casos límite en el navegador real. */
import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
// @ts-expect-error módulo JS sin tipos
import { probe, volume } from '../../scripts/verify-export.mjs';
import { exportAndSave, importToNewProject, openSample, ROOT, watchErrors } from './helpers.ts';

const TPS = 705_600_000;
const state = (page: Page) => page.evaluate(() => {
  const s = (window as any).__vs.store.getState();
  return { clips: Object.keys(s.project.clips).length, past: s.past.length, future: s.future.length, name: s.project.name, id: s.project.id };
});

test('dividir, deshacer y rehacer con el teclado', async ({ page }) => {
  await openSample(page);
  const before = await state(page);
  await page.evaluate((t) => (window as any).__vs.store.getState().setPlayhead(t), 2 * TPS);
  await page.keyboard.press('s');
  const split = await state(page);
  // A los 2 s se cortan el clip A (video y audio vinculados), la música y el título.
  expect(split.clips).toBe(before.clips + 4);
  await page.keyboard.press('Control+z');
  expect((await state(page)).clips).toBe(before.clips);
  await page.keyboard.press('Control+y');
  expect((await state(page)).clips).toBe(before.clips + 4);
});

test('recortar arrastrando crea una sola entrada de deshacer', async ({ page }) => {
  await openSample(page);
  const before = await state(page);
  const clip = page.getByRole('button', { name: 'Clip Mi primer video' });
  const handle = clip.getByLabel('Recortar final');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width / 2 - i * 6, box.y + box.height / 2);
  await page.mouse.up();
  const after = await state(page);
  expect(after.past).toBe(before.past + 1);
  const dur = await page.evaluate(() => {
    const p = (window as any).__vs.store.getState().project;
    const c = Object.values(p.clips).find((x: any) => x.kind === 'text') as any;
    return c.duration / 705_600_000;
  });
  expect(dur).toBeLessThan(3);
  await page.keyboard.press('Control+z');
  expect((await state(page)).past).toBe(before.past);
});

test('guardar, recargar y recuperar la sesión', async ({ page }) => {
  await openSample(page);
  await expect(page.getByRole('status').filter({ hasText: 'Guardado en este navegador' })).toBeVisible();
  const before = await state(page);
  await page.reload();
  await page.getByRole('button', { name: 'Recuperar sesión' }).click();
  await expect(page.getByTestId('open-export')).toBeVisible();
  const after = await state(page);
  expect(after.id).toBe(before.id);
  expect(after.clips).toBe(before.clips);
  // Los medios siguen disponibles: exportar funciona tras recargar.
  const { file } = await exportAndSave(page, 'webm', 'tras-recargar.webm');
  expect(probe(file).video.width).toBe(1280);
});

test('archivo sin pista de audio: se importa y exporta con audio silencioso', async ({ page }) => {
  const errors = watchErrors(page);
  await importToNewProject(page, [join(ROOT, 'fixtures', 'sin-audio.webm')]);
  const { file } = await exportAndSave(page, 'mp4', 'sin-audio.mp4');
  const p = probe(file);
  expect(p.video.codec).toBe('h264');
  expect(p.audio.codec).toBe('aac');
  expect(Math.abs(p.duration - 3)).toBeLessThan(0.1);
  expect(volume(file).max).toBeLessThan(-80);
  expect(errors).toEqual([]);
});

test('cancelar la exportación deja el editor usable', async ({ page }) => {
  await openSample(page);
  await page.getByTestId('open-export').click();
  await page.getByTestId('force-ffmpeg').check();
  await expect(page.getByTestId('start-export')).toBeEnabled();
  await page.getByTestId('start-export').click();
  await expect(page.getByTestId('cancel-export')).toBeVisible();
  await page.getByTestId('cancel-export').click();
  await expect(page.getByText('Exportación cancelada')).toBeVisible();
  await page.getByTestId('force-ffmpeg').uncheck();
  await page.getByTestId('start-export').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 120_000 });
});

test('almacenamiento local insuficiente: el medio queda en memoria y se avisa', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const m = await import('/src/storage/media.ts');
    m.setSimulatedQuotaFull(true);
  });
  await page.locator('input[aria-label="Importar archivos"]').setInputFiles([join(ROOT, 'fixtures', 'sync-30fps.webm')]);
  await expect(page.getByTestId('open-export')).toBeVisible();
  await expect(page.getByText(/espacio|almacenamiento/i).first()).toBeVisible();
  const { file } = await exportAndSave(page, 'webm', 'cuota-llena.webm');
  expect(probe(file).video.codec).toMatch(/vp8|vp9/);
});

test('escenario de 30 s a 720p: tiempo de exportación medido', async ({ page }) => {
  await openSample(page);
  // Repite el montaje del ejemplo hasta superar 30 s.
  const dur = await page.evaluate(async () => {
    const ops = await import('/@id/@vs/project');
    const st = (window as any).__vs.store.getState();
    let p = st.project;
    const end = ops.projectDuration(p);
    const media = Object.values(p.clips).filter((c: any) => c.kind === 'media');
    let offset = end;
    while (offset < 31 * 705_600_000) {
      for (const c of media as any[]) p = ops.insertClip(p, { ...c, id: ops.newId('clip'), linkGroupId: null, start: c.start + offset });
      offset += end;
    }
    st.apply(() => p, 'Repetir montaje');
    return ops.projectDuration(p) / 705_600_000;
  });
  expect(dur).toBeGreaterThan(30);
  const { file, elapsed, meta } = await exportAndSave(page, 'mp4', 'escenario-30s-720p.mp4');
  const p = probe(file);
  const medicion = `${p.duration.toFixed(2)} s de video exportados en ${(elapsed / 1000).toFixed(1)} s. Ruta: ${meta.route.summary}`;
  test.info().annotations.push({ type: 'medición', description: medicion });
  console.log('MEDICIÓN:', medicion);
  expect(p.duration).toBeGreaterThan(30);
  expect(p.video.width).toBe(1280);
});
