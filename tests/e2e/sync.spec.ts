/**
 * Sincronía: el fixture tiene un destello blanco y un pitido en cada segundo desde 1 s.
 * Tras exportar, cada destello y su pitido deben coincidir con un fotograma o menos de diferencia.
 */
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
// @ts-expect-error módulo JS sin tipos
import { syncOffsets, probe } from '../../scripts/verify-export.mjs';
import { exportAndSave, importToNewProject, ROOT } from './helpers.ts';

for (const fmt of ['mp4', 'webm'] as const) {
  test(`desfase audio/video ≤ 1 fotograma en ${fmt.toUpperCase()}`, async ({ page }) => {
    await importToNewProject(page, [join(ROOT, 'fixtures', 'sync-30fps.webm')]);
    const { file } = await exportAndSave(page, fmt, `sync.${fmt}`);
    const offs: { flash: number; beep: number; offset: number }[] = syncOffsets(file);
    test.info().annotations.push({ type: 'desfases', description: offs.map((o) => `${o.flash.toFixed(3)}s: ${(o.offset * 1000).toFixed(1)} ms`).join('; ') });
    expect(offs.length).toBe(3);
    for (const o of offs) expect(Math.abs(o.offset)).toBeLessThanOrEqual(1 / 30 + 0.001);
    expect(Math.abs(probe(file).duration - 4)).toBeLessThan(0.1);
  });
}
