/**
 * Motor de audio. La misma planificación sirve para:
 * - Vista previa: AudioContext en tiempo real.
 * - Exportación: OfflineAudioContext por bloques (determinista; no depende de la pestaña).
 *
 * Cada segmento del plan se prepara una vez (recorte, puerta de ruido, velocidad)
 * y se programa con una envolvente de ganancia.
 *
 * Velocidad:
 * - Constante con "conservar tono": estiramiento WSOLA (sin cambio de tono).
 * - Constante sin conservar tono: playbackRate (el tono sube o baja).
 * - Curva de velocidad: remuestreo por mapa de tiempo (el tono cambia con la velocidad).
 */
import {
  localToSource,
  noiseGate,
  resampleByMap,
  ticksToSeconds,
  TICKS_PER_SECOND,
  wsola,
  type AudioPlan,
  type AudioSegment,
  type Asset,
} from '@vs/project';

export class AudioLibrary {
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private prepared = new Map<string, PreparedSegment>();
  private decodeCtx: BaseAudioContext | null = null;

  constructor(private getBlob: (asset: Asset) => Promise<Blob | null>, private sampleRate = 48000) {}

  private ctx(): BaseAudioContext {
    // Contexto offline mínimo solo para decodificar (decodeAudioData remuestrea a sampleRate).
    this.decodeCtx ??= new OfflineAudioContext(2, 1, this.sampleRate);
    return this.decodeCtx;
  }

  buffer(asset: Asset): Promise<AudioBuffer | null> {
    let p = this.buffers.get(asset.id);
    if (!p) {
      p = (async () => {
        if (!asset.hasAudio) return null;
        const blob = await this.getBlob(asset);
        if (!blob) return null;
        try {
          return await this.ctx().decodeAudioData(await blob.arrayBuffer());
        } catch {
          return null;
        }
      })();
      this.buffers.set(asset.id, p);
    }
    return p;
  }

  async prepare(seg: AudioSegment, asset: Asset): Promise<PreparedSegment | null> {
    const key = JSON.stringify([seg.assetId, seg.start, seg.end, seg.clipStart, seg.sourceIn, seg.sourceOut, seg.speed, seg.denoise]);
    const hit = this.prepared.get(key);
    if (hit) return hit;
    const buf = await this.buffer(asset);
    if (!buf) return null;
    const prepared = prepareSegment(seg, buf, this.sampleRate);
    this.prepared.set(key, prepared);
    if (this.prepared.size > 64) this.prepared.delete(this.prepared.keys().next().value!);
    return prepared;
  }

  forget(assetId: string): void {
    this.buffers.delete(assetId);
    for (const k of [...this.prepared.keys()]) if (k.includes(`"${assetId}"`)) this.prepared.delete(k);
  }
}

export interface PreparedSegment {
  channels: Float32Array[];
  sampleRate: number;
  /** Instante del proyecto (ticks) al que corresponde la muestra 0 de channels. */
  projectStart: number;
  /** Factor de reproducción (1 salvo velocidad constante sin conservar tono). */
  playbackRate: number;
  /** Duración en el proyecto (s). */
  duration: number;
  /** Descripción de la técnica usada, para la interfaz. */
  technique: string;
}

function sliceChannels(buf: AudioBuffer, fromSec: number, toSec: number): Float32Array[] {
  const sr = buf.sampleRate;
  const a = Math.max(0, Math.floor(fromSec * sr));
  const b = Math.min(buf.length, Math.ceil(toSec * sr));
  const out: Float32Array[] = [];
  const chs = Math.min(2, buf.numberOfChannels);
  for (let c = 0; c < chs; c++) {
    const data = buf.getChannelData(c);
    const slice = new Float32Array(Math.max(0, b - a) + Math.max(0, -Math.floor(fromSec * sr)));
    // Silencio delante si el tramo empieza antes del archivo.
    slice.set(data.subarray(a, b), Math.max(0, -Math.floor(fromSec * sr)));
    out.push(slice);
  }
  if (out.length === 1) out.push(out[0]!);
  return out;
}

export function prepareSegment(seg: AudioSegment, buf: AudioBuffer, sampleRate: number): PreparedSegment {
  const clip = { sourceIn: seg.sourceIn, sourceOut: seg.sourceOut, speed: seg.speed };
  const srcFrom = ticksToSeconds(localToSource(clip, seg.start - seg.clipStart));
  const srcTo = ticksToSeconds(localToSource(clip, seg.end - seg.clipStart));
  let channels = sliceChannels(buf, srcFrom, srcTo);
  const durationProject = ticksToSeconds(seg.end - seg.start);
  if (seg.denoise.enabled) channels = noiseGate(channels, sampleRate, seg.denoise);
  let playbackRate = 1;
  let technique = 'Normal';
  if (seg.speed.mode === 'constant' && Math.abs(seg.speed.rate - 1) > 1e-6) {
    if (seg.speed.preservePitch) {
      channels = channels.map((c) => wsola(c, seg.speed.mode === 'constant' ? seg.speed.rate : 1, sampleRate));
      technique = 'WSOLA (conserva el tono)';
    } else {
      playbackRate = seg.speed.rate;
      technique = 'Remuestreo (cambia el tono)';
    }
  } else if (seg.speed.mode === 'curve') {
    const outLen = Math.round(durationProject * sampleRate);
    const fromTicks = localToSource(clip, seg.start - seg.clipStart);
    channels = channels.map((c) =>
      resampleByMap(c, outLen, (i) => {
        const local = seg.start - seg.clipStart + (i / sampleRate) * TICKS_PER_SECOND;
        return ((localToSource(clip, local) - fromTicks) / TICKS_PER_SECOND) * sampleRate;
      }),
    );
    technique = 'Curva: remuestreo por mapa de tiempo (cambia el tono)';
  }
  return { channels, sampleRate, projectStart: seg.start, playbackRate, duration: durationProject, technique };
}

function toAudioBuffer(ctx: BaseAudioContext, p: PreparedSegment): AudioBuffer {
  const len = Math.max(1, p.channels[0]!.length);
  const b = ctx.createBuffer(2, len, p.sampleRate);
  b.copyToChannel(p.channels[0]! as Float32Array<ArrayBuffer>, 0);
  b.copyToChannel((p.channels[1] ?? p.channels[0]!) as Float32Array<ArrayBuffer>, 1);
  return b;
}

export interface ScheduleOptions {
  /** Instante del proyecto (s) que coincide con `when`. */
  projectFrom: number;
  /** Fin del rango a programar (s del proyecto). */
  projectTo: number;
  /** Tiempo del contexto en que suena projectFrom. */
  when: number;
  destination: (trackId: string) => AudioNode;
}

/** Programa los segmentos del plan que caen en el rango. Devuelve las fuentes para poder detenerlas. */
export async function schedulePlan(
  ctx: BaseAudioContext,
  plan: AudioPlan,
  lib: AudioLibrary,
  assets: Record<string, Asset>,
  opts: ScheduleOptions,
): Promise<AudioBufferSourceNode[]> {
  const sources: AudioBufferSourceNode[] = [];
  const toCtx = (projectSec: number) => opts.when + (projectSec - opts.projectFrom);
  for (const seg of plan.segments) {
    const segStart = ticksToSeconds(seg.start);
    const segEnd = ticksToSeconds(seg.end);
    if (segEnd <= opts.projectFrom || segStart >= opts.projectTo) continue;
    const asset = assets[seg.assetId];
    if (!asset) continue;
    const prepared = await lib.prepare(seg, asset);
    if (!prepared) continue;
    const src = ctx.createBufferSource();
    src.buffer = toAudioBuffer(ctx, prepared);
    src.playbackRate.value = prepared.playbackRate;
    const gain = ctx.createGain();
    // Envolvente en tiempo del contexto.
    const startSec = Math.max(segStart, opts.projectFrom);
    const env = seg.envelope;
    const gAt = (sec: number) => {
      const t = sec * TICKS_PER_SECOND;
      for (let i = 0; i < env.length - 1; i++) {
        const a = env[i]!;
        const b = env[i + 1]!;
        if (t >= a.t && t <= b.t) return b.t === a.t ? b.g : a.g + ((b.g - a.g) * (t - a.t)) / (b.t - a.t);
      }
      return env[env.length - 1]?.g ?? 1;
    };
    gain.gain.setValueAtTime(gAt(startSec), Math.max(0, toCtx(startSec)));
    for (const pt of env) {
      const sec = ticksToSeconds(pt.t);
      if (sec <= startSec) continue;
      gain.gain.linearRampToValueAtTime(pt.g, Math.max(0, toCtx(sec)));
    }
    src.connect(gain).connect(opts.destination(seg.trackId));
    const offsetProject = startSec - segStart;
    const when = toCtx(startSec);
    const startAt = Math.max(0, when);
    const extraSkip = when < 0 ? -when : 0;
    src.start(startAt, (offsetProject + extraSkip) * prepared.playbackRate);
    src.stop(Math.max(startAt, toCtx(Math.min(segEnd, opts.projectTo))));
    sources.push(src);
  }
  return sources;
}

/**
 * Mezcla offline del proyecto entero, por bloques de 10 s para acotar memoria.
 * Devuelve canales planos Float32 a sampleRate.
 */
export async function renderPlanOffline(
  plan: AudioPlan,
  lib: AudioLibrary,
  assets: Record<string, Asset>,
  durationSec: number,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Float32Array[]> {
  const sr = plan.sampleRate;
  const total = Math.max(1, Math.round(durationSec * sr));
  const out = [new Float32Array(total), new Float32Array(total)];
  const BLOCK = 10;
  for (let from = 0; from < durationSec; from += BLOCK) {
    if (signal?.aborted) throw new DOMException('Exportación cancelada', 'AbortError');
    const to = Math.min(durationSec, from + BLOCK);
    const startSample = Math.round(from * sr);
    const len = Math.round(to * sr) - startSample;
    if (len <= 0) break;
    const ctx = new OfflineAudioContext(2, len, sr);
    await schedulePlan(ctx, plan, lib, assets, { projectFrom: from, projectTo: to, when: 0, destination: () => ctx.destination });
    const rendered = await ctx.startRendering();
    out[0]!.set(rendered.getChannelData(0), startSample);
    out[1]!.set(rendered.getChannelData(1), startSample);
    onProgress?.(to / durationSec);
  }
  return out;
}
