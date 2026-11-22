/// <reference lib="webworker" />
/**
 * Worker de exportación: recorre los fotogramas según el reloj del proyecto,
 * renderiza con el mismo motor que el visor y codifica.
 * - Ruta WebCodecs: mediabunny (MP4 o WebM) con video y, si se envía, audio.
 * - Ruta FFmpeg: emite lotes de JPEG al hilo principal, que los codifica con FFmpeg.wasm.
 */
import { AudioSample, AudioSampleSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, WebMOutputFormat } from 'mediabunny';
import { describeFrame, frameCount, frameToTicks, fpsValue, type Asset, type Lut3D, type Project } from '@vs/project';
import { FrameProvider } from '../engine/frames.ts';
import { ColorProcessor } from '../engine/gl.ts';
import { renderFrame } from '../engine/renderer.ts';
import { loadFontsInto, type FontSource } from '../engine/fonts.ts';

declare const self: DedicatedWorkerGlobalScope;

export interface ExportJob {
  project: Project;
  blobs: Record<string, Blob>;
  luts: Lut3D[];
  fonts: FontSource[];
  origin: string;
  width: number;
  height: number;
  durationTicks: number;
  burnSubtitles: boolean;
  video: { via: 'webcodecs'; codec: 'avc' | 'vp9' | 'vp8' } | { via: 'ffmpeg-frames'; batchSize: number };
  container: 'mp4' | 'webm';
  /** Audio ya mezclado; solo en la ruta WebCodecs con audio nativo. */
  audio: { codec: 'aac' | 'opus'; channels: Float32Array[]; sampleRate: number } | null;
  bitrate: number;
}

export type WorkerOut =
  | { type: 'progress'; phase: string; done: number; total: number }
  | { type: 'batch'; index: number; firstFrame: number; frames: Blob[] }
  | { type: 'done'; buffer: ArrayBuffer | null; mime: string; frames: number; renderMode: string }
  | { type: 'error'; message: string };

let canceled = false;
let ackResolve: (() => void) | null = null;

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: 'start'; job: ExportJob } | { type: 'cancel' } | { type: 'ack' };
  if (msg.type === 'cancel') {
    canceled = true;
    ackResolve?.();
    return;
  }
  if (msg.type === 'ack') {
    ackResolve?.();
    ackResolve = null;
    return;
  }
  try {
    await run(msg.job);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

function post(m: WorkerOut, transfer: Transferable[] = []): void {
  self.postMessage(m, transfer);
}

async function run(job: ExportJob): Promise<void> {
  const { project } = job;
  await loadFontsInto(self.fonts as unknown as { add(f: FontFace): void }, job.fonts, job.origin);
  const luts = new Map(job.luts.map((l) => [l.id, l]));
  const frames = new FrameProvider(async (a: Asset) => job.blobs[a.id] ?? null);
  const color = new ColorProcessor((id) => luts.get(id) ?? null);
  const canvas = new OffscreenCanvas(job.width, job.height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const fps = project.settings.fps;
  const total = frameCount(job.durationTicks, fps);
  const scaleX = job.width / project.settings.width;
  const scaleY = job.height / project.settings.height;
  const env = { assets: project.assets, frames, color, exact: true, streamPrefix: 'export' };
  const frameDur = 1 / fpsValue(fps);

  const renderAt = async (i: number) => {
    const t = frameToTicks(i, fps);
    const desc = describeFrame(project, t, { includeSubtitles: job.burnSubtitles });
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    await renderFrame(ctx, desc, env);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (i % 30 === 0) frames.gc(8000);
  };

  if (job.video.via === 'ffmpeg-frames') {
    const batch: Blob[] = [];
    let batchIndex = 0;
    let first = 0;
    for (let i = 0; i < total; i++) {
      if (canceled) throw new Error('Exportación cancelada');
      await renderAt(i);
      batch.push(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 }));
      if (batch.length >= job.video.batchSize || i === total - 1) {
        const ack = new Promise<void>((r) => (ackResolve = r));
        post({ type: 'batch', index: batchIndex++, firstFrame: first, frames: batch.splice(0) });
        first = i + 1;
        await ack; // contrapresión: espera a que el hilo principal codifique el lote
      }
      post({ type: 'progress', phase: 'Renderizando fotogramas', done: i + 1, total });
    }
    frames.dispose();
    post({ type: 'done', buffer: null, mime: '', frames: total, renderMode: color.mode });
    return;
  }

  const output = new Output({
    format: job.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const videoSource = new CanvasSource(canvas, { codec: job.video.codec, bitrate: job.bitrate || QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: fpsValue(fps) });
  let audioSource: AudioSampleSource | null = null;
  if (job.audio) {
    audioSource = new AudioSampleSource({ codec: job.audio.codec, bitrate: 160_000 });
    output.addAudioTrack(audioSource);
  }
  await output.start();
  for (let i = 0; i < total; i++) {
    if (canceled) {
      await output.cancel();
      throw new Error('Exportación cancelada');
    }
    await renderAt(i);
    await videoSource.add(i * frameDur, frameDur);
    post({ type: 'progress', phase: 'Codificando video', done: i + 1, total });
  }
  videoSource.close();
  if (audioSource && job.audio) {
    const { channels, sampleRate } = job.audio;
    const n = channels[0]!.length;
    const chunk = sampleRate; // 1 s por bloque
    for (let off = 0; off < n; off += chunk) {
      if (canceled) {
        await output.cancel();
        throw new Error('Exportación cancelada');
      }
      const len = Math.min(chunk, n - off);
      const planar = new Float32Array(len * 2);
      planar.set(channels[0]!.subarray(off, off + len), 0);
      planar.set((channels[1] ?? channels[0]!).subarray(off, off + len), len);
      const sample = new AudioSample({ data: planar, format: 'f32-planar', numberOfChannels: 2, sampleRate, timestamp: off / sampleRate });
      await audioSource.add(sample);
      sample.close();
      post({ type: 'progress', phase: 'Codificando audio', done: Math.min(n, off + len), total: n });
    }
    audioSource.close();
  }
  post({ type: 'progress', phase: 'Cerrando el archivo', done: 0, total: 0 });
  await output.finalize();
  frames.dispose();
  const buffer = output.target.buffer!;
  post({ type: 'done', buffer, mime: await output.getMimeType(), frames: total, renderMode: color.mode }, [buffer]);
}
