/**
 * Procesado de audio determinista (sin Web Audio): puerta de ruido,
 * estiramiento temporal WSOLA, remuestreo por mapa de tiempo y medidas.
 */

export interface GateParams {
  thresholdDb: number;
  attackMs: number;
  releaseMs: number;
  reductionDb: number;
}

/**
 * Puerta de ruido con detector de envolvente por pico.
 * Bajo el umbral, la señal se atenúa reductionDb. Ataque y liberación suavizan la ganancia.
 * Técnica: "puerta de ruido" (no es reducción espectral).
 */
export function noiseGate(channels: Float32Array[], sampleRate: number, p: GateParams): Float32Array[] {
  const n = channels[0]?.length ?? 0;
  const out = channels.map((c) => new Float32Array(c.length));
  const threshold = Math.pow(10, p.thresholdDb / 20);
  const floor = Math.pow(10, p.reductionDb / 20);
  const attack = Math.exp(-1 / Math.max(1, (p.attackMs / 1000) * sampleRate));
  const release = Math.exp(-1 / Math.max(1, (p.releaseMs / 1000) * sampleRate));
  const envRelease = Math.exp(-1 / Math.max(1, 0.01 * sampleRate));
  let env = 0;
  let gain = floor;
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (const c of channels) peak = Math.max(peak, Math.abs(c[i]!));
    env = peak > env ? peak : env * envRelease + peak * (1 - envRelease);
    const target = env >= threshold ? 1 : floor;
    const coef = target > gain ? attack : release;
    gain = target + (gain - target) * coef;
    for (let ch = 0; ch < channels.length; ch++) out[ch]![i] = channels[ch]![i]! * gain;
  }
  return out;
}

/**
 * Estiramiento temporal WSOLA (conserva el tono).
 * rate > 1 acelera; rate < 1 ralentiza. Salida: longitud ≈ entrada / rate.
 */
export function wsola(input: Float32Array, rate: number, sampleRate: number): Float32Array {
  if (Math.abs(rate - 1) < 1e-6) return input.slice();
  const win = Math.round(sampleRate * 0.03);
  const hop = Math.round(win / 2);
  const tol = Math.round(sampleRate * 0.01);
  const outLen = Math.floor(input.length / rate);
  const out = new Float32Array(outLen + win);
  const norm = new Float32Array(outLen + win);
  const w = new Float32Array(win);
  for (let i = 0; i < win; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1));
  let prevPos = 0;
  for (let outPos = 0; outPos < outLen; outPos += hop) {
    const nominal = Math.round(outPos * rate);
    let best = nominal;
    if (outPos > 0) {
      // Busca el desplazamiento que mejor continúa el segmento anterior.
      const ref = prevPos + hop;
      let bestScore = -Infinity;
      for (let d = -tol; d <= tol; d += 2) {
        const cand = nominal + d;
        if (cand < 0 || cand + win >= input.length) continue;
        let score = 0;
        for (let i = 0; i < win; i += 4) {
          const a = input[ref + i] ?? 0;
          score += a * input[cand + i]!;
        }
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }
    if (best + win >= input.length) best = Math.max(0, input.length - win - 1);
    for (let i = 0; i < win; i++) {
      out[outPos + i]! += (input[best + i] ?? 0) * w[i]!;
      norm[outPos + i]! += w[i]!;
    }
    prevPos = best;
  }
  for (let i = 0; i < outLen; i++) if (norm[i]! > 1e-3) out[i] = out[i]! / norm[i]!;
  return out.subarray(0, outLen);
}

/**
 * Remuestreo por mapa de tiempo: para cada muestra de salida i,
 * sourceSampleAt(i) indica la posición fraccionaria de la fuente.
 * Cambia el tono junto con la velocidad (como una cinta).
 */
export function resampleByMap(input: Float32Array, outLength: number, sourceSampleAt: (i: number) => number): Float32Array {
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const s = sourceSampleAt(i);
    const i0 = Math.floor(s);
    const f = s - i0;
    const a = input[i0] ?? 0;
    const b = input[i0 + 1] ?? a;
    out[i] = a + (b - a) * f;
  }
  return out;
}

export function rms(data: Float32Array, start = 0, end = data.length): number {
  const a = Math.max(0, Math.floor(start));
  const b = Math.min(data.length, Math.floor(end));
  let acc = 0;
  for (let i = a; i < b; i++) acc += data[i]! * data[i]!;
  return Math.sqrt(acc / Math.max(1, b - a));
}

/** Picos por bloque para dibujar formas de onda. */
export function computePeaks(channels: Float32Array[], buckets: number): Float32Array {
  const n = channels[0]?.length ?? 0;
  const out = new Float32Array(buckets);
  const size = Math.max(1, Math.floor(n / buckets));
  for (let b = 0; b < buckets; b++) {
    let peak = 0;
    const s = b * size;
    const e = Math.min(n, s + size);
    for (const c of channels) for (let i = s; i < e; i++) peak = Math.max(peak, Math.abs(c[i]!));
    out[b] = peak;
  }
  return out;
}

/** Instantes (s) donde la energía sube por encima del umbral: sirve para medir pulsos. */
export function detectOnsets(data: Float32Array, sampleRate: number, thresholdDb = -30, minGapS = 0.3): number[] {
  const win = Math.round(sampleRate * 0.002);
  const thr = Math.pow(10, thresholdDb / 20);
  const out: number[] = [];
  let last = -Infinity;
  for (let i = 0; i + win < data.length; i += win) {
    const level = rms(data, i, i + win);
    if (level >= thr && i / sampleRate - last >= minGapS) {
      out.push(i / sampleRate);
      last = i / sampleRate;
    }
  }
  return out;
}
