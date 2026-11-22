/**
 * Cálculos de extensión de clips: local, continuación nativa y por último fotograma.
 * Funciones puras; la interfaz y el motor las usan para mostrar
 * duración original, segundos agregados y duración final antes de actuar.
 */

export interface ExtensionSummary {
  originalSeconds: number;
  addedSeconds: number;
  finalSeconds: number;
}

/** A1. Ralentización: factor = duración final / original. */
export function slowdownSummary(originalSeconds: number, targetSeconds: number): ExtensionSummary & { rate: number } {
  const rate = originalSeconds / targetSeconds;
  return { originalSeconds, addedSeconds: targetSeconds - originalSeconds, finalSeconds: targetSeconds, rate };
}

/**
 * A2. Bucle inteligente: busca el par (i, j) con j cerca del final e i cerca del inicio
 * cuyos fotogramas reducidos se parecen más. La reproducción salta de j a i con fundido.
 * frames: fotogramas en gris (mismo tamaño), times: instante de cada uno (s).
 */
export interface LoopCandidate {
  fromTime: number;
  toTime: number;
  difference: number;
}

export function frameDifference(a: Uint8Array | Uint8ClampedArray, b: Uint8Array | Uint8ClampedArray): number {
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    acc += d * d;
  }
  return Math.sqrt(acc / a.length) / 255;
}

export function findLoopCandidates(
  frames: (Uint8Array | Uint8ClampedArray)[],
  times: number[],
  opts: { minLoopSeconds: number; maxCandidates?: number },
): LoopCandidate[] {
  const out: LoopCandidate[] = [];
  const n = frames.length;
  const tailStart = Math.floor(n * 0.6);
  const headEnd = Math.ceil(n * 0.4);
  for (let j = tailStart; j < n; j++) {
    for (let i = 0; i < headEnd; i++) {
      if (times[j]! - times[i]! < opts.minLoopSeconds) continue;
      out.push({ fromTime: times[j]!, toTime: times[i]!, difference: frameDifference(frames[j]!, frames[i]!) });
    }
  }
  out.sort((a, b) => a.difference - b.difference);
  // Evita candidatos casi iguales entre sí.
  const picked: LoopCandidate[] = [];
  for (const c of out) {
    if (picked.every((p) => Math.abs(p.fromTime - c.fromTime) > 0.25 || Math.abs(p.toTime - c.toTime) > 0.25)) picked.push(c);
    if (picked.length >= (opts.maxCandidates ?? 5)) break;
  }
  return picked;
}

/**
 * Duración final de un bucle: se repite el tramo [toTime, fromTime] las veces indicadas.
 * El fundido se centra en cada empalme y usa material sobrante, así que no acorta el resultado.
 */
export function loopSummary(originalSeconds: number, c: LoopCandidate, repeats: number): ExtensionSummary {
  const loopLen = c.fromTime - c.toTime;
  const added = repeats * loopLen;
  return { originalSeconds, addedSeconds: added, finalSeconds: originalSeconds + added };
}

/**
 * B. Continuación nativa: la respuesta puede incluir la referencia.
 * Ejemplo: referencia 2 s, respuesta 12 s que la incluye -> se insertan 10 s.
 */
export function continuationNewSegment(opts: {
  referenceSeconds: number;
  returnedSeconds: number;
  includesReference: boolean;
}): { newSegmentStart: number; newSegmentDuration: number } {
  if (opts.includesReference) {
    const start = Math.min(opts.referenceSeconds, opts.returnedSeconds);
    return { newSegmentStart: start, newSegmentDuration: Math.max(0, opts.returnedSeconds - start) };
  }
  return { newSegmentStart: 0, newSegmentDuration: opts.returnedSeconds };
}

/**
 * C. Cadena por último fotograma: cuántas generaciones hacen falta.
 * Cada tramo dura segmentSeconds; si dropJoinFrame, cada tramo después del
 * primero pierde un fotograma (el de unión, repetido).
 */
export function chainPlan(opts: {
  targetAddSeconds: number;
  segmentSeconds: number;
  fps: number;
  dropJoinFrame: boolean;
  maxSegments: number;
}): { segments: number; addedSeconds: number; exceedsLimit: boolean } {
  const effective = opts.segmentSeconds - (opts.dropJoinFrame ? 1 / opts.fps : 0);
  const needed = Math.max(1, Math.ceil(opts.targetAddSeconds / effective - 1e-9));
  const segments = Math.min(needed, opts.maxSegments);
  return { segments, addedSeconds: segments * effective, exceedsLimit: needed > opts.maxSegments };
}
