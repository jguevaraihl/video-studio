/**
 * Base de tiempo del proyecto.
 *
 * Todas las posiciones se guardan como enteros en "ticks".
 * 1 segundo = 705 600 000 ticks (unidad "flick").
 * Esta base divide exactamente a 24, 25, 30, 48, 50, 60, 120 fps,
 * a 24000/1001 y 30000/1001 fps, y a 8, 16, 22.05, 44.1 y 48 kHz.
 *
 * Dominios de tiempo:
 * - Tiempo del medio: timestamps del archivo fuente (segundos o microsegundos).
 * - Tiempo del proyecto: ticks desde el inicio de la línea de tiempo.
 * - Fotograma de salida: índice entero según los fps del proyecto.
 * - Muestra de audio: índice entero según la frecuencia de muestreo.
 */

export const TICKS_PER_SECOND = 705_600_000;
const TPS = BigInt(TICKS_PER_SECOND);

export type Ticks = number;

export interface Rational {
  num: number;
  den: number;
}

export function secondsToTicks(seconds: number): Ticks {
  return Math.round(seconds * TICKS_PER_SECOND);
}

export function ticksToSeconds(ticks: Ticks): number {
  return ticks / TICKS_PER_SECOND;
}

/** Microsegundos de WebCodecs a ticks. */
export function microsToTicks(us: number): Ticks {
  return Math.round(us * (TICKS_PER_SECOND / 1_000_000));
}

export function ticksToMicros(ticks: Ticks): number {
  return Math.round(ticks / (TICKS_PER_SECOND / 1_000_000));
}

export function fpsValue(fps: Rational): number {
  return fps.num / fps.den;
}

/** Duración de un fotograma en ticks (redondeada). */
export function frameDurationTicks(fps: Rational): Ticks {
  return Number((TPS * BigInt(fps.den) + BigInt(fps.num) / 2n) / BigInt(fps.num));
}

/** Índice del fotograma de salida que contiene el instante dado. */
export function ticksToFrame(ticks: Ticks, fps: Rational): number {
  const t = BigInt(Math.floor(ticks));
  return Number((t * BigInt(fps.num)) / (TPS * BigInt(fps.den)));
}

/** Inicio exacto (redondeado al tick) del fotograma n. */
export function frameToTicks(frame: number, fps: Rational): Ticks {
  const n = BigInt(frame) * TPS * BigInt(fps.den);
  const d = BigInt(fps.num);
  return Number((n + d / 2n) / d);
}

/** Índice de la muestra de audio que contiene el instante dado. */
export function ticksToSample(ticks: Ticks, sampleRate: number): number {
  const t = BigInt(Math.floor(ticks));
  return Number((t * BigInt(sampleRate)) / TPS);
}

export function sampleToTicks(sample: number, sampleRate: number): Ticks {
  const n = BigInt(sample) * TPS;
  const d = BigInt(sampleRate);
  return Number((n + d / 2n) / d);
}

/** Número total de fotogramas que cubren una duración. */
export function frameCount(durationTicks: Ticks, fps: Rational): number {
  const t = BigInt(Math.max(0, Math.round(durationTicks)));
  const n = t * BigInt(fps.num);
  const d = TPS * BigInt(fps.den);
  return Number((n + d - 1n) / d);
}

/** Ajusta un instante al inicio de su fotograma. */
export function snapToFrame(ticks: Ticks, fps: Rational): Ticks {
  return frameToTicks(ticksToFrame(ticks, fps), fps);
}

/** Formato visible: mm:ss.ff (ff = fotograma). */
export function formatTimecode(ticks: Ticks, fps: Rational): string {
  const frame = ticksToFrame(Math.max(0, ticks), fps);
  const fpsRounded = Math.round(fpsValue(fps));
  const totalSeconds = Math.floor(frame / fpsRounded);
  const ff = frame % fpsRounded;
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(ff).padStart(2, '0')}`;
}

export function formatSeconds(ticks: Ticks, decimals = 1): string {
  return `${ticksToSeconds(ticks).toFixed(decimals)} s`;
}

/** Convierte un fps decimal medido (p. ej. 29.97) a racional estable. */
export function rationalFromFps(fps: number): Rational {
  const known: Rational[] = [
    { num: 24000, den: 1001 },
    { num: 30000, den: 1001 },
    { num: 60000, den: 1001 },
  ];
  for (const k of known) {
    if (Math.abs(fpsValue(k) - fps) < 0.005) return k;
  }
  const rounded = Math.round(fps);
  if (Math.abs(rounded - fps) < 0.01) return { num: rounded, den: 1 };
  return { num: Math.round(fps * 1000), den: 1000 };
}
