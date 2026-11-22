/**
 * Descripción de composición compartida por el visor y el exportador.
 * Para un instante del proyecto determina qué fuentes intervienen, qué
 * instante de cada fuente se usa y con qué transformación, color y opacidad.
 * El audio se describe como segmentos con envolvente de ganancia.
 */
import type { ColorAdjust, Denoise, Project, Speed, TextStyle, Transform, Track, VisualClip, Clip } from './schema.ts';
import { clipDuration, clipEnd, evalKeyframes, localToSource } from './timing.ts';
import { resolveCues } from './ops.ts';
import type { Ticks } from './time.ts';

export interface ResolvedTransform extends Omit<Transform, 'crop'> {
  crop: Transform['crop'];
}

export interface MediaLayer {
  type: 'media';
  clipId: string;
  assetId: string;
  /** Instante en tiempo del medio (ticks desde el primer timestamp). */
  sourceTime: number;
  /** Mezclar el fotograma anterior y el siguiente según la posición exacta. */
  blend: boolean;
  transform: ResolvedTransform;
  color: ColorAdjust;
}

export interface ImageLayer {
  type: 'image';
  clipId: string;
  assetId: string;
  transform: ResolvedTransform;
  color: ColorAdjust;
}

export interface TextLayer {
  type: 'text';
  clipId: string;
  text: string;
  style: TextStyle;
  transform: ResolvedTransform;
}

export interface SubtitleLayer {
  type: 'subtitle';
  text: string;
  style: Project['subtitles']['style'];
}

export type Layer = MediaLayer | ImageLayer | TextLayer | SubtitleLayer;

export interface FrameDescription {
  t: Ticks;
  width: number;
  height: number;
  background: string;
  layers: Layer[];
}

const VISUAL_KINDS: Track['kind'][] = ['video', 'overlay', 'text'];

interface ActiveClip {
  clip: VisualClip;
  /** Tiempo local (puede salir de [0, D] durante una transición). */
  u: Ticks;
  /** Multiplicador de opacidad por transición. */
  mix: number;
}

function fadeFactor(u: Ticks, duration: Ticks, fadeIn: Ticks, fadeOut: Ticks): number {
  let f = 1;
  if (fadeIn > 0 && u < fadeIn) f = Math.min(f, Math.max(0, u / fadeIn));
  if (fadeOut > 0 && u > duration - fadeOut) f = Math.min(f, Math.max(0, (duration - u) / fadeOut));
  return f;
}

/** Clips activos de una pista en el instante t, incluidos los extendidos por transición. */
export function activeClipsOnTrack(p: Project, track: Track, t: Ticks): ActiveClip[] {
  const out: ActiveClip[] = [];
  const clips = Object.values(p.clips).filter((c) => c.trackId === track.id);
  const transitions = Object.values(p.transitions);
  for (const c of clips) {
    const start = c.start;
    const end = clipEnd(c);
    const inTr = transitions.find((tr) => tr.toClipId === c.id);
    const outTr = transitions.find((tr) => tr.fromClipId === c.id);
    const preRoll = inTr ? inTr.duration / 2 : 0;
    const postRoll = outTr ? outTr.duration / 2 : 0;
    if (t < start - preRoll || t >= end + postRoll) continue;
    let mix = 1;
    if (inTr && t < start + preRoll) {
      // Clip entrante: aparece con opacidad k sobre el saliente.
      mix = (t - (start - preRoll)) / inTr.duration;
    }
    out.push({ clip: c as VisualClip, u: t - start, mix });
  }
  // El saliente se dibuja primero y el entrante encima.
  return out.sort((a, b) => a.clip.start - b.clip.start);
}

function resolveTransform(clip: VisualClip, u: Ticks): ResolvedTransform {
  const tr = clip.transform;
  const k = clip.keyframes;
  return {
    x: evalKeyframes(k.x, u, tr.x),
    y: evalKeyframes(k.y, u, tr.y),
    scale: evalKeyframes(k.scale, u, tr.scale),
    rotation: evalKeyframes(k.rotation, u, tr.rotation),
    opacity: evalKeyframes(k.opacity, u, tr.opacity),
    crop: tr.crop,
    fit: tr.fit,
  };
}

export function describeFrame(p: Project, t: Ticks, opts: { includeSubtitles: boolean }): FrameDescription {
  const layers: Layer[] = [];
  for (const track of p.tracks) {
    if (!VISUAL_KINDS.includes(track.kind) || track.hidden) continue;
    for (const { clip, u, mix } of activeClipsOnTrack(p, track, t)) {
      const D = clipDuration(clip);
      const transform = resolveTransform(clip, Math.min(Math.max(u, 0), D));
      const fade = fadeFactor(u, D, clip.fadeIn, clip.fadeOut);
      transform.opacity = transform.opacity * fade * mix;
      if (transform.opacity <= 0.0005) continue;
      if (clip.kind === 'media') {
        const asset = p.assets[clip.assetId];
        if (!asset?.hasVideo) continue;
        const s = localToSource(clip, u);
        layers.push({
          type: 'media',
          clipId: clip.id,
          assetId: clip.assetId,
          sourceTime: Math.max(0, Math.min(s, Math.max(0, asset.duration - 1))),
          blend: clip.frameBlend,
          transform,
          color: clip.color,
        });
      } else if (clip.kind === 'image') {
        layers.push({ type: 'image', clipId: clip.id, assetId: clip.assetId, transform, color: clip.color });
      } else {
        layers.push({ type: 'text', clipId: clip.id, text: clip.text, style: clip.style, transform });
      }
    }
  }
  if (opts.includeSubtitles) {
    for (const cue of resolveCues(p)) {
      if (cue.visible && t >= cue.start && t < cue.end) layers.push({ type: 'subtitle', text: cue.text, style: p.subtitles.style });
    }
  }
  return { t, width: p.settings.width, height: p.settings.height, background: p.settings.background, layers };
}

// ---------------- audio ----------------

export interface GainPoint {
  /** Instante del proyecto en ticks. */
  t: Ticks;
  /** Ganancia lineal. */
  g: number;
}

export interface AudioSegment {
  clipId: string;
  assetId: string;
  trackId: string;
  /** Intervalo del proyecto en el que suena (incluye extensión de transición). */
  start: Ticks;
  end: Ticks;
  /** Inicio del clip (sin extensión), base de la conversión a tiempo del medio. */
  clipStart: Ticks;
  sourceIn: Ticks;
  sourceOut: Ticks;
  speed: Speed;
  envelope: GainPoint[];
  denoise: Denoise;
}

export interface AudioPlan {
  sampleRate: number;
  duration: Ticks;
  segments: AudioSegment[];
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => (g <= 0 ? -Infinity : 20 * Math.log10(g));

function isAudible(track: Track, anySolo: boolean): boolean {
  if (track.kind !== 'audio') return false;
  if (track.muted) return false;
  if (anySolo && !track.solo) return false;
  return true;
}

export function describeAudio(p: Project): AudioPlan {
  const anySolo = p.tracks.some((t) => t.kind === 'audio' && t.solo);
  const segments: AudioSegment[] = [];
  let duration = 0;
  const transitions = Object.values(p.transitions);
  for (const track of p.tracks) {
    if (!isAudible(track, anySolo)) continue;
    const clips = Object.values(p.clips).filter((c): c is Extract<Clip, { kind: 'media' }> => c.trackId === track.id && c.kind === 'media');
    for (const c of clips) {
      const asset = p.assets[c.assetId];
      if (!asset?.hasAudio || c.audio.muted) continue;
      const D = clipDuration(c);
      const inTr = transitions.find((tr) => tr.toClipId === c.id);
      const outTr = transitions.find((tr) => tr.fromClipId === c.id);
      const pre = inTr ? inTr.duration / 2 : 0;
      const post = outTr ? outTr.duration / 2 : 0;
      const start = c.start - pre;
      const end = c.start + D + post;
      const base = dbToGain(c.audio.gainDb) * dbToGain(track.gainDb) * dbToGain(p.masterGainDb);
      const gainAt = (t: Ticks): number => {
        const u = t - c.start;
        let g = base * fadeFactor(u, D, c.audio.fadeIn, c.audio.fadeOut);
        if (inTr && t < c.start + pre) g *= Math.max(0, Math.min(1, (t - start) / inTr.duration));
        if (outTr && t > c.start + D - post) g *= Math.max(0, Math.min(1, (end - t) / outTr.duration));
        return g;
      };
      const keys = new Set<number>([start, end, c.start + c.audio.fadeIn, c.start + D - c.audio.fadeOut, c.start + pre, c.start + D - post]);
      // Puntos intermedios para que el producto de rampas siga siendo fiel.
      const extra: number[] = [];
      for (const k of keys) for (const q of keys) if (k < q) extra.push((k + q) / 2);
      for (const e of extra) keys.add(e);
      const envelope = [...keys]
        .filter((k) => k >= start && k <= end)
        .sort((a, b) => a - b)
        .map((k) => ({ t: Math.round(k), g: gainAt(Math.min(k, end - 1)) }));
      envelope[envelope.length - 1] = { t: end, g: gainAt(end) };
      segments.push({
        clipId: c.id,
        assetId: c.assetId,
        trackId: track.id,
        start: Math.max(0, start),
        end,
        clipStart: c.start,
        sourceIn: c.sourceIn,
        sourceOut: c.sourceOut,
        speed: c.speed,
        envelope,
        denoise: c.audio.denoise,
      });
      duration = Math.max(duration, end);
    }
  }
  return { sampleRate: p.settings.sampleRate, duration, segments };
}
