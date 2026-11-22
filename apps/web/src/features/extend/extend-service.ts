/**
 * Operaciones de extensión sobre el montaje.
 * Todas abren primero un hueco con insertGap: extender nunca pisa el material siguiente.
 */
import {
  addTransition,
  clipEnd,
  expandLinked,
  getClip,
  insertClip,
  insertGap,
  mediaClipDuration,
  newId,
  placeAsset,
  secondsToTicks,
  setSpeed,
  updateClip,
  type MediaClip,
  type Generation,
  type Project,
} from '@vs/project';
import { useStore } from '../../state/store.ts';
import { submitGeneration } from '../generate/generation-service.ts';
import { blobForAssetId } from '../../lib/media-service.ts';
import { TICKS_PER_SECOND as TPS } from '@vs/project';

/** A1. Ralentiza el clip (y su audio vinculado) hasta durar targetSeconds. */
export function applySlowdown(p: Project, clipId: string, targetSeconds: number, frameBlend: boolean): Project {
  const c = getClip(p, clipId) as MediaClip;
  const target = secondsToTicks(targetSeconds);
  const current = mediaClipDuration(c);
  const span = c.sourceOut - c.sourceIn;
  const rate = span / target;
  let next = target > current ? insertGap(p, clipEnd(c), target - current) : p;
  next = setSpeed(next, clipId, { mode: 'constant', rate, preservePitch: true });
  for (const id of expandLinked(next, [clipId])) {
    const x = next.clips[id];
    if (x?.kind === 'media' && next.tracks.find((t) => t.id === x.trackId)?.kind !== 'audio') next = updateClip(next, id, { frameBlend });
  }
  return next;
}

/** Copia un clip y sus vinculados con otro tramo de origen y otro inicio. */
function copySegment(p: Project, clipId: string, sIn: number, sOut: number, start: number): { project: Project; videoId: string } {
  const ids = expandLinked(p, [clipId]);
  const group = ids.length > 1 ? newId('lnk') : null;
  let next = p;
  let videoId = '';
  for (const id of ids) {
    const c = getClip(p, id) as MediaClip;
    const copy: MediaClip = { ...c, id: newId('clip'), linkGroupId: group, sourceIn: Math.round(sIn), sourceOut: Math.round(sOut), start, speed: { mode: 'constant', rate: 1, preservePitch: true } };
    next = insertClip(next, copy);
    if (id === clipId) videoId = copy.id;
  }
  return { project: next, videoId };
}

/**
 * A2. Bucle inteligente: el clip llega a fromTime, salta a toTime y repite.
 * Resultado: [in, from] + (repeats − 1)×[to, from] + [to, out]. Disolución corta en cada salto.
 */
export function applyLoop(p: Project, clipId: string, fromSeconds: number, toSeconds: number, repeats: number, crossfadeSeconds: number): Project {
  const c = getClip(p, clipId) as MediaClip;
  if (c.speed.mode !== 'constant' || c.speed.rate !== 1) throw new Error('El bucle inteligente requiere velocidad 1×. Restablece la velocidad del clip.');
  const from = secondsToTicks(fromSeconds);
  const to = secondsToTicks(toSeconds);
  if (!(c.sourceIn < to && to < from && from < c.sourceOut)) throw new Error('El punto de bucle queda fuera del tramo usado del clip.');
  const loopLen = from - to;
  let next = insertGap(p, clipEnd(c), repeats * loopLen);
  // Primer tramo: recorta el clip original en «from».
  const firstEnd = c.start + (from - c.sourceIn);
  for (const id of expandLinked(next, [clipId])) next = updateClip(next, id, { sourceOut: from } as Partial<MediaClip>);
  let prevId = clipId;
  let t = firstEnd;
  for (let i = 0; i < repeats; i++) {
    const last = i === repeats - 1;
    const r = copySegment(next, clipId, to, last ? c.sourceOut : from, t);
    next = r.project;
    try {
      next = addTransition(next, prevId, r.videoId, secondsToTicks(crossfadeSeconds)).project;
    } catch {
      // Sin material sobrante suficiente: corte directo.
    }
    prevId = r.videoId;
    t += last ? c.sourceOut - to : loopLen;
  }
  return next;
}

/**
 * B y C. Inserta un recurso generado justo después del clip, sin pisar nada.
 * skipSeconds descarta el inicio (la referencia incluida o el fotograma de unión).
 */
export function insertAfterClip(p: Project, clipId: string, assetId: string, skipSeconds: number): { project: Project; videoClipId: string } {
  const src = getClip(p, clipId);
  const asset = p.assets[assetId];
  if (!asset) throw new Error('El recurso generado no está en la biblioteca.');
  const skip = secondsToTicks(skipSeconds);
  const dur = asset.duration - skip;
  if (dur <= 0) throw new Error('El resultado no trae material nuevo.');
  const at = clipEnd(src);
  let next = insertGap(p, at, dur);
  const audioPartner = expandLinked(p, [clipId]).map((id) => p.clips[id]!).find((c) => p.tracks.find((t) => t.id === c.trackId)?.kind === 'audio');
  const placed = placeAsset(next, assetId, at, { videoTrackId: src.trackId, audioTrackId: audioPartner?.trackId });
  next = placed.project;
  for (const id of placed.clipIds) {
    const c = next.clips[id] as MediaClip;
    next = updateClip(next, id, { sourceIn: c.sourceIn + skip } as Partial<MediaClip>);
  }
  const videoClipId = placed.clipIds.find((id) => next.tracks.find((t) => t.id === next.clips[id]?.trackId)?.kind !== 'audio') ?? placed.clipIds[0]!;
  return { project: next, videoClipId };
}

async function withVideo<T>(assetId: string, fn: (v: HTMLVideoElement) => Promise<T>): Promise<T> {
  const blob = await blobForAssetId(assetId);
  if (!blob) throw new Error('No se encuentra el archivo del clip.');
  const url = URL.createObjectURL(blob);
  try {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = url;
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error('El navegador no puede leer este video.'));
    });
    return await fn(v);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function seekTo(v: HTMLVideoElement, s: number): Promise<void> {
  v.currentTime = Math.max(0, s);
  await new Promise<void>((res) => (v.onseeked = () => res()));
}

/** Fotogramas en gris de 32×18 para buscar puntos de bucle. Tiempos en segundos del medio. */
export async function sampleGrayFrames(clip: MediaClip, step = 0.1, max = 150): Promise<{ frames: Uint8ClampedArray[]; times: number[] }> {
  return withVideo(clip.assetId, async (v) => {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 18;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const inS = clip.sourceIn / TPS;
    const outS = clip.sourceOut / TPS;
    const n = Math.min(max, Math.floor((outS - inS) / step));
    const realStep = (outS - inS) / Math.max(1, n);
    const frames: Uint8ClampedArray[] = [];
    const times: number[] = [];
    for (let i = 0; i < n; i++) {
      const s = inS + i * realStep;
      await seekTo(v, s);
      g.drawImage(v, 0, 0, 32, 18);
      const d = g.getImageData(0, 0, 32, 18).data;
      const gray = new Uint8ClampedArray(32 * 18);
      for (let k = 0; k < gray.length; k++) gray[k] = (d[k * 4]! * 0.299 + d[k * 4 + 1]! * 0.587 + d[k * 4 + 2]! * 0.114) | 0;
      frames.push(gray);
      times.push(s);
    }
    return { frames, times };
  });
}

/** Último fotograma del tramo usado, en PNG (data URI) a resolución completa. */
export async function lastFrameDataUri(clip: MediaClip): Promise<string> {
  return withVideo(clip.assetId, async (v) => {
    await seekTo(v, clip.sourceOut / TPS - 0.02);
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    return c.toDataURL('image/png');
  });
}

const TERMINAL = new Set(['imported', 'failed', 'canceled', 'expired', 'unknown-submit']);

function waitForGeneration(id: string): Promise<Generation> {
  return new Promise((resolve) => {
    const check = () => {
      const g = useStore.getState().project?.generations[id];
      if (g && TERMINAL.has(g.status) && !(g.status === 'imported' && !g.assetId)) {
        unsub();
        resolve(g);
        return true;
      }
      return false;
    };
    const unsub = useStore.subscribe(() => void check());
    check();
  });
}

/**
 * C. Cadena por último fotograma: un tramo a la vez. Cada tramo parte del último
 * fotograma del anterior y descarta su primer fotograma (repetido) al insertarse.
 * Si un tramo falla, se conservan los anteriores y la cadena se detiene.
 */
export async function runLastFrameChain(opts: {
  clipId: string;
  segments: number;
  model: string;
  region: string;
  prompt: string;
  resolution: string;
  segmentSeconds: number;
  onProgress: (text: string) => void;
}): Promise<{ done: number; error: string | null }> {
  const chainId = newId('chain');
  let currentClipId = opts.clipId;
  for (let i = 0; i < opts.segments; i++) {
    const p = useStore.getState().project!;
    const clip = p.clips[currentClipId] as MediaClip | undefined;
    if (!clip) return { done: i, error: 'El clip de partida ya no está en el montaje.' };
    opts.onProgress(`Tramo ${i + 1} de ${opts.segments}: preparando el último fotograma…`);
    const image = await lastFrameDataUri(clip);
    opts.onProgress(`Tramo ${i + 1} de ${opts.segments}: enviado. Esperando al proveedor…`);
    const genId = await submitGeneration({
      operation: 'lastFrameChain',
      model: opts.model,
      region: opts.region,
      prompt: opts.prompt,
      negativePrompt: '',
      params: { resolution: opts.resolution, duration: opts.segmentSeconds, promptExtend: true },
      imageDataUri: image,
      sourceAssetId: clip.assetId,
      chain: { chainId, index: i, total: opts.segments },
    });
    const g = await waitForGeneration(genId);
    if (g.status !== 'imported' || !g.assetId) return { done: i, error: g.error?.message ?? 'El tramo no terminó.' };
    const fps = p.settings.fps;
    const frame = fps.den / fps.num;
    let newId_ = '';
    useStore.getState().apply((proj) => {
      const r = insertAfterClip(proj, currentClipId, g.assetId!, frame);
      newId_ = r.videoClipId;
      return r.project;
    }, `Extender por último fotograma (${i + 1}/${opts.segments})`);
    if (!newId_) return { done: i, error: 'No se pudo insertar el tramo.' };
    currentClipId = newId_;
  }
  return { done: opts.segments, error: null };
}
