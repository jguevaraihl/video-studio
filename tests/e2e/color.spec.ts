/** Color y LUT: la exportación aplica la LUT 3D (WebGL2) y el resultado cambia el color medido. */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { exportAndSave, openSample } from './helpers.ts';

/** Color medio (R, G, B) de un fotograma a los 1,3 s (fuera de los destellos), decodificado con ffmpeg. */
function meanRgb(file: string): number[] {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', '1.3', '-i', file, '-frames:v', '1', '-vf', 'scale=64:36', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 });
  const acc = [0, 0, 0];
  for (let i = 0; i < raw.length; i += 3) for (let c = 0; c < 3; c++) acc[c]! += raw[i + c]!;
  return acc.map((v) => v / (raw.length / 3));
}

test('la LUT «teal-orange» cambia el color exportado', async ({ page }) => {
  await openSample(page);
  const plain = await exportAndSave(page, 'webm', 'color-sin-lut.webm');
  await page.evaluate(() => {
    const st = (window as any).__vs.store.getState();
    const clip = (Object.values(st.project.clips) as any[]).find((c) => c.name === 'clip-a.webm' && c.trackId === st.project.tracks[0].id);
    st.apply((p: any) => ({ ...p, clips: { ...p.clips, [clip.id]: { ...clip, color: { ...clip.color, lut: { id: 'teal-orange', intensity: 1 } } } } }), 'LUT');
  });
  const graded = await exportAndSave(page, 'webm', 'color-con-lut.webm');
  expect(graded.meta.renderMode).toBe('webgl2');
  const a = meanRgb(plain.file);
  const b = meanRgb(graded.file);
  const diff = Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!);
  console.log('RGB sin LUT', a.map((v) => v.toFixed(1)), 'con LUT', b.map((v) => v.toFixed(1)));
  expect(diff).toBeGreaterThan(10);
});
