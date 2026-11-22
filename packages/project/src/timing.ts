import type { Clip, MediaClip, Speed, SpeedPoint, Keyframe } from './schema.ts';
import type { Ticks } from './time.ts';

/**
 * Relación entre tiempo del proyecto y tiempo del medio para un clip.
 *
 * Velocidad constante r: duración = (sourceOut - sourceIn) / r.
 * Curva de velocidad v(p), p en [0,1] normalizado sobre la duración D del clip:
 *   tiempo de fuente s(u) = sourceIn + D * integral_0^(u/D) v(p) dp
 *   D = (sourceOut - sourceIn) / promedio(v)
 * La curva es lineal por tramos. Su integral es exacta (cuadrática por tramos).
 */

export function sortedPoints(points: SpeedPoint[]): SpeedPoint[] {
  const pts = [...points].sort((a, b) => a.p - b.p);
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first && first.p > 0) pts.unshift({ p: 0, v: first.v });
  if (last && last.p < 1) pts.push({ p: 1, v: last.v });
  return pts;
}

/** Integral de v(p) entre 0 y q (q en [0,1]). */
export function curveIntegral(points: SpeedPoint[], q: number): number {
  const pts = sortedPoints(points);
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (q <= a.p) break;
    const end = Math.min(q, b.p);
    const span = b.p - a.p;
    if (span <= 0) continue;
    const vEnd = a.v + ((b.v - a.v) * (end - a.p)) / span;
    acc += ((a.v + vEnd) / 2) * (end - a.p);
  }
  return acc;
}

export function averageSpeed(speed: Speed): number {
  if (speed.mode === 'constant') return speed.rate;
  return curveIntegral(speed.points, 1);
}

/** Velocidad instantánea en la posición normalizada p. */
export function speedAt(speed: Speed, p: number): number {
  if (speed.mode === 'constant') return speed.rate;
  const pts = sortedPoints(speed.points);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (p <= b.p) {
      const span = b.p - a.p;
      return span <= 0 ? b.v : a.v + ((b.v - a.v) * (p - a.p)) / span;
    }
  }
  return pts[pts.length - 1]!.v;
}

export function mediaClipDuration(clip: Pick<MediaClip, 'sourceIn' | 'sourceOut' | 'speed'>): Ticks {
  const span = Math.max(0, clip.sourceOut - clip.sourceIn);
  return Math.max(1, Math.round(span / averageSpeed(clip.speed)));
}

export function clipDuration(clip: Clip): Ticks {
  if (clip.kind === 'media') return mediaClipDuration(clip);
  return clip.duration;
}

export function clipEnd(clip: Clip): Ticks {
  return clip.start + clipDuration(clip);
}

/**
 * Tiempo del medio para un tiempo local u (ticks desde el inicio del clip).
 * Admite u fuera de [0, D] para transiciones: extrapola con la velocidad del borde.
 */
export function localToSource(clip: Pick<MediaClip, 'sourceIn' | 'sourceOut' | 'speed'>, u: Ticks): number {
  const D = mediaClipDuration(clip);
  const speed = clip.speed;
  if (speed.mode === 'constant') return clip.sourceIn + u * speed.rate;
  if (u <= 0) return clip.sourceIn + u * speedAt(speed, 0);
  if (u >= D) return clip.sourceOut + (u - D) * speedAt(speed, 1);
  const span = clip.sourceOut - clip.sourceIn;
  const avg = averageSpeed(speed);
  // s = sourceIn + D * I(u/D); D = span/avg  =>  s = sourceIn + span * I(u/D) / avg
  return clip.sourceIn + (span * curveIntegral(speed.points, u / D)) / avg;
}

/** Inverso de localToSource: tiempo local para un tiempo del medio. */
export function sourceToLocal(clip: Pick<MediaClip, 'sourceIn' | 'sourceOut' | 'speed'>, s: number): Ticks {
  const speed = clip.speed;
  if (speed.mode === 'constant') return Math.round((s - clip.sourceIn) / speed.rate);
  const D = mediaClipDuration(clip);
  if (s <= clip.sourceIn) return Math.round((s - clip.sourceIn) / speedAt(speed, 0));
  if (s >= clip.sourceOut) return Math.round(D + (s - clip.sourceOut) / speedAt(speed, 1));
  // localToSource es monótona creciente: bisección.
  let lo = 0;
  let hi = D;
  for (let i = 0; i < 60 && hi - lo > 1; i++) {
    const mid = (lo + hi) / 2;
    if (localToSource(clip, mid) < s) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

export function projectToSource(clip: MediaClip, t: Ticks): number {
  return localToSource(clip, t - clip.start);
}

export function sourceToProject(clip: MediaClip, s: number): Ticks {
  return clip.start + sourceToLocal(clip, s);
}

/** Evalúa una curva de keyframes en el tiempo local u. Sin keyframes devuelve fallback. */
export function evalKeyframes(kfs: Keyframe[] | undefined, u: Ticks, fallback: number): number {
  if (!kfs || kfs.length === 0) return fallback;
  const sorted = [...kfs].sort((a, b) => a.t - b.t);
  const first = sorted[0]!;
  if (u <= first.t) return first.v;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (u < b.t) {
      if (a.ease === 'hold') return a.v;
      let k = (u - a.t) / (b.t - a.t);
      if (a.ease === 'easeInOut') k = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      return a.v + (b.v - a.v) * k;
    }
  }
  return sorted[sorted.length - 1]!.v;
}
