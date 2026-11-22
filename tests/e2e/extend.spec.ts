/** Extensión local (sin IA): la duración final mostrada coincide con la del archivo exportado. */
import { test, expect, type Page } from '@playwright/test';
// @ts-expect-error módulo JS sin tipos
import { probe } from '../../scripts/verify-export.mjs';
import { exportAndSave, openSample } from './helpers.ts';

async function openExtend(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__vs.store.getState();
    const id = (Object.values(s.project.clips) as any[]).find((c) => c.name === 'clip-a.webm' && c.trackId === s.project.tracks[0].id).id;
    s.setExtendClip(id);
  });
}
const duration = (page: Page) => page.evaluate(async () => {
  const ops = await import('/@id/@vs/project');
  return ops.projectDuration((window as any).__vs.store.getState().project) / 705_600_000;
});

test('ralentizar de 4 s a 6 s alarga el montaje 2 s sin pisar el clip siguiente', async ({ page }) => {
  await openSample(page);
  const before = await duration(page);
  await openExtend(page);
  await page.getByRole('slider').first().fill('6');
  await expect(page.getByTestId('extend-summary')).toContainText('+2.00 s');
  await page.getByTestId('apply-slow').click();
  expect(await duration(page)).toBeCloseTo(before + 2, 2);
  const { file } = await exportAndSave(page, 'webm', 'extendido-lento.webm');
  expect(probe(file).duration).toBeCloseTo(before + 2, 1);
});

test('bucle inteligente: agrega el tramo indicado', async ({ page }) => {
  await openSample(page);
  const before = await duration(page);
  await openExtend(page);
  await page.getByRole('button', { name: 'Bucle inteligente (local)' }).click();
  await page.getByRole('button', { name: 'Buscar puntos de bucle' }).click();
  const summary = page.getByTestId('extend-summary');
  await expect(summary).toBeVisible({ timeout: 60_000 });
  const added = Number((await summary.textContent())!.match(/\+([\d.]+) s/)![1]);
  await page.getByRole('button', { name: 'Aplicar' }).click();
  expect(await duration(page)).toBeCloseTo(before + added, 2);
});
