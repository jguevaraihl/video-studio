import { expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT = join(ROOT, 'tests', 'output');

export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

export async function openSample(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('sample').click();
  await expect(page.getByTestId('open-export')).toBeVisible();
  await expect(page.locator('text=clip-a.webm').first()).toBeVisible();
}

export async function importToNewProject(page: Page, files: string[]): Promise<void> {
  await page.goto('/');
  await page.locator('input[aria-label="Importar archivos"]').setInputFiles(files);
  await expect(page.getByTestId('open-export')).toBeVisible();
}

/** Exporta desde el diálogo y guarda el archivo en tests/output. Devuelve ruta y metadatos. */
export async function exportAndSave(page: Page, fmt: 'mp4' | 'webm', outName: string, opts: { forceFfmpeg?: boolean; resolution?: '720p' | '1080p' } = {}) {
  await page.getByTestId('open-export').click();
  await page.getByTestId(`fmt-${fmt}`).click();
  if (opts.resolution === '1080p') await page.getByRole('button', { name: /^1080p/ }).click();
  if (opts.forceFfmpeg) await page.getByTestId('force-ffmpeg').check();
  await expect(page.getByTestId('route-summary')).toBeVisible();
  const start = page.getByTestId('start-export');
  await expect(start).toBeEnabled();
  const t0 = Date.now();
  await start.click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 280_000 });
  const elapsed = Date.now() - t0;
  const data = await page.evaluate(async () => {
    const e = window.__vsLastExport!;
    const buf = new Uint8Array(await e.blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { b64: btoa(s), meta: e.result };
  });
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, outName);
  writeFileSync(file, Buffer.from(data.b64, 'base64'));
  await page.getByRole('button', { name: 'Cerrar' }).click().catch(() => undefined);
  return { file, meta: data.meta, elapsed };
}
