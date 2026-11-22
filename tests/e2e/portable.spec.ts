/** Copia portátil: descarga un .zip, lo abre en un navegador limpio y exporta. */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error módulo JS sin tipos
import { probe } from '../../scripts/verify-export.mjs';
import { exportAndSave, openSample, OUT } from './helpers.ts';

test('copia portátil: ida y vuelta sin credenciales', async ({ page, browser }) => {
  await openSample(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Copia portátil' }).click()]);
  const zip = join(OUT, 'copia-portatil.zip');
  await dl.saveAs(zip);
  const bytes = readFileSync(zip);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  expect(bytes.toString('latin1')).not.toMatch(/sk-[\w-]{6,}|apiKey/);
  // Navegador limpio: otro contexto sin IndexedDB ni OPFS previos.
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto('/');
  await p2.locator('input[aria-label="Abrir copia portátil"]').setInputFiles(zip);
  await expect(p2.getByTestId('open-export')).toBeVisible();
  await expect(p2.getByText('clip-a.webm').first()).toBeVisible();
  const { file } = await exportAndSave(p2, 'webm', 'desde-copia-portatil.webm');
  expect(Math.abs(probe(file).duration - 8.5)).toBeLessThan(0.1);
  await ctx.close();
});
