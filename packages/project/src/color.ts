/**
 * Corrección de color y LUT 3D.
 * Las mismas fórmulas existen en el shader WebGL2 (apps/web/src/engine/gl.ts).
 * Esta versión en CPU sirve de respaldo sin WebGL2 y de referencia en pruebas.
 */
import type { ColorAdjust } from './schema.ts';

export interface Lut3D {
  id: string;
  title: string;
  size: number;
  /** RGB float [0,1], índice = r + g*size + b*size*size (orden .cube). */
  data: Float32Array;
}

export function parseCube(id: string, text: string): Lut3D {
  let size = 0;
  let title = id;
  const values: number[] = [];
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('TITLE')) {
      title = line.replace(/^TITLE\s+/, '').replace(/^"|"$/g, '');
      continue;
    }
    if (line.startsWith('LUT_3D_SIZE')) {
      size = Number(line.split(/\s+/)[1]);
      continue;
    }
    if (line.startsWith('LUT_1D_SIZE')) throw new Error('Solo se admiten LUT 3D.');
    if (line.startsWith('DOMAIN_MIN')) {
      domainMin = line.split(/\s+/).slice(1).map(Number);
      continue;
    }
    if (line.startsWith('DOMAIN_MAX')) {
      domainMax = line.split(/\s+/).slice(1).map(Number);
      continue;
    }
    const parts = line.split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) values.push(...parts);
  }
  if (!size || values.length !== size * size * size * 3) {
    throw new Error(`LUT no válida: se esperaban ${size ** 3} entradas y hay ${values.length / 3}.`);
  }
  const data = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const c = i % 3;
    data[i] = (values[i]! - domainMin[c]!) / (domainMax[c]! - domainMin[c]!);
  }
  return { id, title, size, data };
}

export function serializeCube(lut: Lut3D): string {
  const lines = [`TITLE "${lut.title}"`, `LUT_3D_SIZE ${lut.size}`];
  for (let i = 0; i < lut.data.length; i += 3) {
    lines.push(`${lut.data[i]!.toFixed(6)} ${lut.data[i + 1]!.toFixed(6)} ${lut.data[i + 2]!.toFixed(6)}`);
  }
  return lines.join('\n') + '\n';
}

/** LUT de ejemplo reproducible: tono cálido en altas luces y azul verdoso en sombras. */
export function makeTealOrangeLut(size = 17): Lut3D {
  const data = new Float32Array(size * size * size * 3);
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const R = r / (size - 1);
        const G = g / (size - 1);
        const B = b / (size - 1);
        const l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        const shadow = 1 - l;
        let nr = R + 0.12 * l - 0.06 * shadow;
        let ng = G + 0.03 * l + 0.02 * shadow;
        let nb = B - 0.1 * l + 0.1 * shadow;
        // Curva S suave.
        const s = (x: number) => x * x * (3 - 2 * x) * 0.35 + x * 0.65;
        nr = s(Math.min(1, Math.max(0, nr)));
        ng = s(Math.min(1, Math.max(0, ng)));
        nb = s(Math.min(1, Math.max(0, nb)));
        const i = (r + g * size + b * size * size) * 3;
        data[i] = nr;
        data[i + 1] = ng;
        data[i + 2] = nb;
      }
  return { id: 'teal-orange', title: 'Cine cálido (teal & orange)', size, data };
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function adjustPixel(rgb: [number, number, number], c: ColorAdjust): [number, number, number] {
  let [r, g, b] = rgb;
  r += c.brightness * 0.4;
  g += c.brightness * 0.4;
  b += c.brightness * 0.4;
  const k = 1 + c.contrast;
  r = (r - 0.5) * k + 0.5;
  g = (g - 0.5) * k + 0.5;
  b = (b - 0.5) * k + 0.5;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const s = 1 + c.saturation;
  r = l + (r - l) * s;
  g = l + (g - l) * s;
  b = l + (b - l) * s;
  r += c.temperature * 0.1;
  b -= c.temperature * 0.1;
  return [clamp01(r), clamp01(g), clamp01(b)];
}

export function sampleLut(lut: Lut3D, rgb: [number, number, number]): [number, number, number] {
  const n = lut.size - 1;
  const fr = rgb[0] * n;
  const fg = rgb[1] * n;
  const fb = rgb[2] * n;
  const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
  const r1 = Math.min(n, r0 + 1), g1 = Math.min(n, g0 + 1), b1 = Math.min(n, b0 + 1);
  const dr = fr - r0, dg = fg - g0, db = fb - b0;
  const at = (r: number, g: number, b: number, ch: number) => lut.data[(r + g * lut.size + b * lut.size * lut.size) * 3 + ch]!;
  const out: [number, number, number] = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const c00 = at(r0, g0, b0, ch) * (1 - dr) + at(r1, g0, b0, ch) * dr;
    const c10 = at(r0, g1, b0, ch) * (1 - dr) + at(r1, g1, b0, ch) * dr;
    const c01 = at(r0, g0, b1, ch) * (1 - dr) + at(r1, g0, b1, ch) * dr;
    const c11 = at(r0, g1, b1, ch) * (1 - dr) + at(r1, g1, b1, ch) * dr;
    const c0 = c00 * (1 - dg) + c10 * dg;
    const c1 = c01 * (1 - dg) + c11 * dg;
    out[ch] = c0 * (1 - db) + c1 * db;
  }
  return out;
}

export function isNeutralColor(c: ColorAdjust): boolean {
  return c.brightness === 0 && c.contrast === 0 && c.saturation === 0 && c.temperature === 0 && !c.lut;
}

/** Aplica ajustes y LUT a un buffer RGBA en su lugar (respaldo CPU). */
export function applyColorCpu(pixels: Uint8ClampedArray, c: ColorAdjust, lut: Lut3D | null): void {
  const intensity = c.lut?.intensity ?? 1;
  for (let i = 0; i < pixels.length; i += 4) {
    let px = adjustPixel([pixels[i]! / 255, pixels[i + 1]! / 255, pixels[i + 2]! / 255], c);
    if (lut) {
      const l = sampleLut(lut, px);
      px = [px[0] + (l[0] - px[0]) * intensity, px[1] + (l[1] - px[1]) * intensity, px[2] + (l[2] - px[2]) * intensity];
    }
    pixels[i] = Math.round(px[0] * 255);
    pixels[i + 1] = Math.round(px[1] * 255);
    pixels[i + 2] = Math.round(px[2] * 255);
  }
}
