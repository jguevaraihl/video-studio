/**
 * Detección real de rutas de exportación en este navegador.
 * Para cada formato elige, por orden: WebCodecs (acelerado) y luego FFmpeg.wasm.
 */
import { canEncodeAudio, canEncodeVideo } from 'mediabunny';
import { loadFfmpeg, type FfmpegInfo } from './ffmpeg.ts';

export type ExportFormat = 'mp4' | 'webm';
export type Resolution = '720p' | '1080p';

export interface ExportRoute {
  format: ExportFormat;
  video: { via: 'webcodecs'; codec: 'avc' | 'vp9' | 'vp8' } | { via: 'ffmpeg'; encoder: 'libx264' | 'libvpx-vp9' | 'libvpx' } | null;
  audio: { via: 'webcodecs'; codec: 'aac' | 'opus' } | { via: 'ffmpeg'; encoder: 'aac' | 'libopus' } | null;
  /** Explicación legible de la ruta o del motivo por el que no hay ruta. */
  summary: string;
  ok: boolean;
}

export function outputSize(projectW: number, projectH: number, res: Resolution): { width: number; height: number } {
  const short = res === '720p' ? 720 : 1080;
  const scale = short / Math.min(projectW, projectH);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(projectW * scale), height: even(projectH * scale) };
}

let ffInfo: Promise<FfmpegInfo | null> | null = null;
export function ffmpegInfo(): Promise<FfmpegInfo | null> {
  ffInfo ??= loadFfmpeg()
    .then((r) => r.info)
    .catch(() => null);
  return ffInfo;
}

export async function detectRoute(format: ExportFormat, width: number, height: number, fps: number, opts: { forceFfmpeg?: boolean } = {}): Promise<ExportRoute> {
  const hasWebCodecs = typeof VideoEncoder !== 'undefined';
  const vOpts = { width, height, bitrate: width * height * fps * 0.1, frameRate: fps };
  const aOpts = { numberOfChannels: 2, sampleRate: 48000, bitrate: 160_000 };
  let video: ExportRoute['video'] = null;
  let audio: ExportRoute['audio'] = null;
  const wc = async (fn: () => Promise<boolean>) => (hasWebCodecs && !opts.forceFfmpeg ? fn().catch(() => false) : false);
  if (format === 'mp4') {
    if (await wc(() => canEncodeVideo('avc', vOpts))) video = { via: 'webcodecs', codec: 'avc' };
    if (await wc(() => canEncodeAudio('aac', aOpts))) audio = { via: 'webcodecs', codec: 'aac' };
  } else {
    if (await wc(() => canEncodeVideo('vp9', vOpts))) video = { via: 'webcodecs', codec: 'vp9' };
    else if (await wc(() => canEncodeVideo('vp8', vOpts))) video = { via: 'webcodecs', codec: 'vp8' };
    // Opus siempre por WebCodecs, también con FFmpeg forzado: libopus en FFmpeg.wasm 0.12.10
    // cierra la pestaña al codificar desde WAV (medido en Chromium). Chrome y Edge traen Opus.
    if (hasWebCodecs && (await canEncodeAudio('opus', aOpts).catch(() => false))) audio = { via: 'webcodecs', codec: 'opus' };
  }
  if (!video || !audio) {
    const info = await ffmpegInfo();
    if (info) {
      if (!video) {
        if (format === 'mp4' && info.encoders.libx264) video = { via: 'ffmpeg', encoder: 'libx264' };
        // VP8 primero: en FFmpeg.wasm 0.12.10, libvpx-vp9 cierra la pestaña en el core multihilo
        // y codifica a menos de 1 fotograma/s en el de un hilo (medido a 720p en Chromium).
        if (format === 'webm' && info.encoders.libvpx) video = { via: 'ffmpeg', encoder: 'libvpx' };
        else if (format === 'webm' && info.encoders.libvpxVp9) video = { via: 'ffmpeg', encoder: 'libvpx-vp9' };
      }
      if (!audio) {
        if (format === 'mp4' && info.encoders.aac) audio = { via: 'ffmpeg', encoder: 'aac' };
      }
    }
  }
  const name = (r: ExportRoute['video'] | ExportRoute['audio']) =>
    !r ? 'no disponible' : r.via === 'webcodecs' ? `WebCodecs ${'codec' in r ? r.codec.toUpperCase() : ''}` : `FFmpeg.wasm ${'encoder' in r ? r.encoder : ''}`;
  const ok = !!video && !!audio;
  const summary = ok
    ? `Video: ${name(video)}. Audio: ${name(audio)}.`
    : `Este navegador no puede producir ${format.toUpperCase()} (${!video ? 'falta codificador de video' : ''}${!video && !audio ? ' y ' : ''}${!audio ? 'falta codificador de audio' : ''}).`;
  return { format, video, audio, summary, ok };
}
