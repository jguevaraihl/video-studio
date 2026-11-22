/**
 * Orquestador de exportación (hilo principal).
 * Fases reales: detección de ruta, mezcla de audio offline, render y codificación
 * en un worker y, si hace falta, codificación o multiplexado con FFmpeg.wasm.
 */
import { describeAudio, projectDuration, ticksToSeconds, fpsValue, type Project } from '@vs/project';
import { AudioLibrary, renderPlanOffline } from '../audio.ts';
import { allLuts, loadBuiltinLuts } from '../luts.ts';
import { fontSourcesForWorker } from '../fonts.ts';
import { detectRoute, outputSize, type ExportFormat, type ExportRoute, type Resolution } from './capabilities.ts';
import { encodeWav, loadFfmpeg, runFfmpeg } from './ffmpeg.ts';
import { AudioSample, AudioSampleSource, BufferTarget, Mp4OutputFormat, Output, WebMOutputFormat } from 'mediabunny';
import type { ExportJob, WorkerOut } from '../../workers/export.worker.ts';
import { estimate } from '../../storage/media.ts';

export interface ExportOptions {
  format: ExportFormat;
  resolution: Resolution;
  burnSubtitles: boolean;
  forceFfmpeg?: boolean;
}

export interface ExportProgress {
  phase: string;
  /** null cuando la fase no se puede medir. */
  fraction: number | null;
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  mime: string;
  route: ExportRoute;
  width: number;
  height: number;
  seconds: number;
  elapsedMs: number;
  frames: number;
  renderMode: string;
}

export interface ExportEstimate {
  width: number;
  height: number;
  seconds: number;
  frames: number;
  estimatedBytes: number;
  estimatedPeakMemory: number;
  warnings: string[];
}

export async function estimateExport(p: Project, opts: ExportOptions): Promise<ExportEstimate> {
  const { width, height } = outputSize(p.settings.width, p.settings.height, opts.resolution);
  const seconds = ticksToSeconds(projectDuration(p));
  const fps = fpsValue(p.settings.fps);
  const bitrate = bitrateFor(width, height);
  const estimatedBytes = Math.round(((bitrate + 160_000) / 8) * seconds);
  // Audio Float32 estéreo + archivo final en memoria + margen por decodificadores.
  const audioBytes = seconds * 48000 * 2 * 4 * 2;
  const estimatedPeakMemory = estimatedBytes * 2 + audioBytes + width * height * 4 * 24;
  const warnings: string[] = [];
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (mem && estimatedPeakMemory > mem * 1e9 * 0.35) {
    warnings.push(`La exportación puede necesitar unos ${(estimatedPeakMemory / 1e9).toFixed(1)} GB de memoria y este equipo informa ${mem} GB. Considera 720p o dividir el proyecto.`);
  }
  if (seconds > 20 * 60) warnings.push('Proyectos de más de 20 minutos pueden tardar mucho y agotar la memoria de la pestaña.');
  const est = await estimate();
  if (est && est.quota - est.usage < estimatedBytes * 1.5) warnings.push('Queda poco espacio de almacenamiento del navegador para el archivo final.');
  if (seconds <= 0) warnings.push('La línea de tiempo está vacía.');
  return { width, height, seconds, frames: Math.ceil(seconds * fps), estimatedBytes, estimatedPeakMemory, warnings };
}

function bitrateFor(w: number, h: number): number {
  return Math.round(w * h * 30 * 0.12);
}

export async function exportProject(
  p: Project,
  opts: ExportOptions,
  getBlob: (assetId: string) => Promise<Blob | null>,
  onProgress: (pr: ExportProgress) => void,
  signal: AbortSignal,
): Promise<ExportResult> {
  const t0 = performance.now();
  const { width, height } = outputSize(p.settings.width, p.settings.height, opts.resolution);
  const durationTicks = projectDuration(p);
  const seconds = ticksToSeconds(durationTicks);
  if (seconds <= 0) throw new Error('La línea de tiempo está vacía. Agrega al menos un clip.');
  const fps = fpsValue(p.settings.fps);

  onProgress({ phase: 'Detectando codificadores disponibles', fraction: null });
  const route = await detectRoute(opts.format, width, height, fps, { forceFfmpeg: opts.forceFfmpeg });
  if (!route.ok) throw new Error(route.summary);
  const abortIf = () => {
    if (signal.aborted) throw new DOMException('Exportación cancelada', 'AbortError');
  };

  // Medios usados (cada recurso una vez, aunque aparezca en muchos clips).
  const used = new Set<string>();
  for (const c of Object.values(p.clips)) if (c.kind !== 'text') used.add(c.assetId);
  const blobs: Record<string, Blob> = {};
  for (const id of used) {
    const b = await getBlob(id);
    if (b) blobs[id] = b;
  }

  // 1. Audio offline determinista.
  onProgress({ phase: 'Mezclando audio', fraction: 0 });
  const plan = describeAudio(p);
  const lib = new AudioLibrary(async (a) => blobs[a.id] ?? null, plan.sampleRate);
  const audio = await renderPlanOffline(plan, lib, p.assets, seconds, (f) => onProgress({ phase: 'Mezclando audio', fraction: f }), signal);
  abortIf();

  await loadBuiltinLuts();
  const worker = new Worker(new URL('../../workers/export.worker.ts', import.meta.url), { type: 'module' });
  const cleanup = () => worker.terminate();
  signal.addEventListener('abort', () => {
    worker.postMessage({ type: 'cancel' });
    setTimeout(cleanup, 500);
  });

  const videoViaFfmpeg = route.video!.via === 'ffmpeg';
  const audioViaWc = route.audio!.via === 'webcodecs';
  const job: ExportJob = {
    project: p,
    blobs,
    luts: allLuts(),
    fonts: fontSourcesForWorker(),
    origin: location.origin,
    width,
    height,
    durationTicks,
    burnSubtitles: opts.burnSubtitles,
    container: opts.format,
    video: videoViaFfmpeg ? { via: 'ffmpeg-frames', batchSize: 45 } : { via: 'webcodecs', codec: (route.video as { codec: 'avc' | 'vp9' | 'vp8' }).codec },
    audio: !videoViaFfmpeg && audioViaWc ? { codec: (route.audio as { codec: 'aac' | 'opus' }).codec, channels: audio.map((c) => c.slice()), sampleRate: plan.sampleRate } : null,
    bitrate: bitrateFor(width, height),
  };

  const ext = opts.format;
  const segments: string[] = [];
  let ff: Awaited<ReturnType<typeof loadFfmpeg>>['ff'] | null = null;
  if (videoViaFfmpeg || !audioViaWc) ff = (await loadFfmpeg()).ff;
  const vEncoder = route.video!.via === 'ffmpeg' ? route.video!.encoder : null;
  const aFile = ext === 'mp4' ? 'a.m4a' : 'a.webm';
  if (videoViaFfmpeg && ff) {
    // El audio se codifica antes que el video: en FFmpeg.wasm, codificar audio después de
    // varias órdenes de video resultó inestable. Opus va siempre por WebCodecs.
    if (route.audio!.via === 'webcodecs') {
      onProgress({ phase: 'Codificando audio (WebCodecs)', fraction: null });
      await ff.writeFile(aFile, await encodeAudioOnly(audio, plan.sampleRate, opts.format, route.audio!.codec));
    } else {
      onProgress({ phase: 'Codificando audio (FFmpeg)', fraction: null });
      await ff.writeFile('audio.wav', encodeWav(audio, plan.sampleRate));
      await runFfmpeg(['-hide_banner', '-i', 'audio.wav', '-c:a', 'aac', '-b:a', '160k', aFile], signal);
      await ff.deleteFile('audio.wav');
    }
  }

  const workerResult = await new Promise<{ buffer: ArrayBuffer | null; mime: string; frames: number; renderMode: string }>((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Exportación cancelada', 'AbortError')));
    worker.onerror = (e) => reject(new Error(e.message || 'Fallo en el worker de exportación'));
    worker.onmessage = async (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      try {
        if (m.type === 'progress') onProgress({ phase: m.phase, fraction: m.total > 0 ? m.done / m.total : null });
        else if (m.type === 'error') reject(new Error(m.message));
        else if (m.type === 'done') resolve(m);
        else if (m.type === 'batch' && ff && vEncoder) {
          // Codifica el lote como segmento independiente y libera los JPEG.
          const names: string[] = [];
          for (let i = 0; i < m.frames.length; i++) {
            const name = `f_${String(i).padStart(5, '0')}.jpg`;
            await ff.writeFile(name, new Uint8Array(await m.frames[i]!.arrayBuffer()));
            names.push(name);
          }
          const seg = `seg_${String(m.index).padStart(4, '0')}.${ext}`;
          const codecArgs =
            vEncoder === 'libx264'
              ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-threads', '1'] // el core multihilo 0.12.10 falla con hilos de x264
              : vEncoder === 'libvpx-vp9'
                ? ['-c:v', 'libvpx-vp9', '-b:v', String(job.bitrate), '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p']
                : ['-c:v', 'libvpx', '-b:v', String(job.bitrate), '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p'];
          await runFfmpeg(['-hide_banner', '-framerate', String(fps), '-i', 'f_%05d.jpg', ...codecArgs, '-r', String(fps), seg], signal);
          for (const n of names) await ff.deleteFile(n);
          segments.push(seg);
          worker.postMessage({ type: 'ack' });
        }
      } catch (err) {
        reject(err);
      }
    };
    worker.postMessage({ type: 'start', job }, job.audio ? job.audio.channels.map((c) => c.buffer as ArrayBuffer) : []);
  }).finally(cleanup);
  abortIf();

  let blob: Blob;
  let mime: string;
  const audioEncoderArgs = route.audio!.via === 'ffmpeg' ? (route.audio!.encoder === 'aac' ? ['-c:a', 'aac', '-b:a', '160k'] : ['-c:a', 'libopus', '-b:a', '128k']) : null;
  if (videoViaFfmpeg && ff) {
    onProgress({ phase: 'Uniendo segmentos y agregando audio (FFmpeg)', fraction: null });
    await ff.writeFile('list.txt', segments.map((s) => `file '${s}'`).join('\n'));
    const out = `out.${ext}`;
    // Pasos cortos en lugar de uno: en el core multihilo 0.12.10, unir con concat y codificar
    // Opus en la misma orden se bloquea, y Opus después de libvpx también. El audio ya se codificó antes.
    await runFfmpeg(['-hide_banner', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', `v.${ext}`], signal);
    await runFfmpeg(['-hide_banner', '-i', `v.${ext}`, '-i', aFile, '-map', '0:v', '-map', '1:a', '-c', 'copy', ...(ext === 'mp4' ? ['-movflags', '+faststart'] : []), out], signal);
    const data = await ff.readFile(out);
    for (const f of [...segments, 'list.txt', aFile, `v.${ext}`, out]) await ff.deleteFile(f).catch(() => undefined);
    mime = opts.format === 'mp4' ? 'video/mp4' : 'video/webm';
    blob = new Blob([data as BlobPart], { type: mime });
  } else if (!audioViaWc && ff && workerResult.buffer) {
    onProgress({ phase: 'Agregando audio (FFmpeg)', fraction: null });
    await ff.writeFile(`v.${ext}`, new Uint8Array(workerResult.buffer));
    await ff.writeFile('audio.wav', encodeWav(audio, plan.sampleRate));
    const out = `out.${ext}`;
    await runFfmpeg(['-hide_banner', '-i', `v.${ext}`, '-i', 'audio.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...audioEncoderArgs!, ...(ext === 'mp4' ? ['-movflags', '+faststart'] : []), out], signal);
    const data = await ff.readFile(out);
    for (const f of [`v.${ext}`, 'audio.wav', out]) await ff.deleteFile(f).catch(() => undefined);
    mime = opts.format === 'mp4' ? 'video/mp4' : 'video/webm';
    blob = new Blob([data as BlobPart], { type: mime });
  } else {
    mime = workerResult.mime.split(';')[0] || (opts.format === 'mp4' ? 'video/mp4' : 'video/webm');
    blob = new Blob([workerResult.buffer!], { type: mime });
  }
  const safe = p.name.replace(/[^\p{L}\p{N}\- _]+/gu, '').trim() || 'video';
  return {
    blob,
    fileName: `${safe}-${opts.resolution}.${ext}`,
    mime,
    route,
    width,
    height,
    seconds,
    elapsedMs: performance.now() - t0,
    frames: workerResult.frames,
    renderMode: workerResult.renderMode,
  };
}

/** Codifica solo audio con WebCodecs (mediabunny) en un contenedor de una pista. */
async function encodeAudioOnly(channels: Float32Array[], sampleRate: number, format: 'mp4' | 'webm', codec: 'aac' | 'opus'): Promise<Uint8Array> {
  const output = new Output({ format: format === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat(), target: new BufferTarget() });
  const src = new AudioSampleSource({ codec, bitrate: 160_000 });
  output.addAudioTrack(src);
  await output.start();
  const n = channels[0]!.length;
  for (let off = 0; off < n; off += sampleRate) {
    const len = Math.min(sampleRate, n - off);
    const planar = new Float32Array(len * 2);
    planar.set(channels[0]!.subarray(off, off + len), 0);
    planar.set((channels[1] ?? channels[0]!).subarray(off, off + len), len);
    const sample = new AudioSample({ data: planar, format: 'f32-planar', numberOfChannels: 2, sampleRate, timestamp: off / sampleRate });
    await src.add(sample);
    sample.close();
  }
  src.close();
  await output.finalize();
  return new Uint8Array((output.target as BufferTarget).buffer!);
}
