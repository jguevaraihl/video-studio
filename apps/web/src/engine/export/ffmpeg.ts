/**
 * FFmpeg.wasm servido desde el mismo origen (/ffmpeg/st o /ffmpeg/mt).
 * Multihilo solo si crossOriginIsolated es true (requiere SharedArrayBuffer).
 * Se usa como alternativa local cuando falta un codificador WebCodecs.
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';

export interface FfmpegInfo {
  threads: 'multi' | 'single';
  encoders: { libx264: boolean; aac: boolean; libvpx: boolean; libvpxVp9: boolean; libopus: boolean };
}

let instance: Promise<{ ff: FFmpeg; info: FfmpegInfo }> | null = null;

export function ffmpegMode(): 'multi' | 'single' {
  return typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined' ? 'multi' : 'single';
}

export function loadFfmpeg(): Promise<{ ff: FFmpeg; info: FfmpegInfo }> {
  instance ??= (async () => {
    const ff = new FFmpeg();
    // Se usa siempre el core de un hilo. Medido en Chromium con @ffmpeg/core-mt 0.12.10:
    // libx264 con hilos falla («function signature mismatch»), libvpx-vp9 cierra la pestaña
    // y libopus se bloquea tras varias órdenes con libvpx. El core de un hilo codifica VP8 y
    // H.264 a la misma velocidad (x264 ya iba con -threads 1) y no presenta esos fallos.
    const mode = 'single' as const;
    const base = new URL('/ffmpeg/st/', location.origin).href;
    await ff.load({
      coreURL: `${base}ffmpeg-core.js`,
      wasmURL: `${base}ffmpeg-core.wasm`,
    });
    const log: string[] = [];
    const onLog = ({ message }: { message: string }) => log.push(message);
    ff.on('log', onLog);
    await ff.exec(['-hide_banner', '-encoders']);
    ff.off('log', onLog);
    const text = log.join('\n');
    const has = (name: string) => new RegExp(`^\\s*[VAS][\\.A-Z]{5}\\s+${name}\\s`, 'm').test(text);
    const info: FfmpegInfo = {
      threads: mode,
      encoders: { libx264: has('libx264'), aac: has('aac'), libvpx: has('libvpx'), libvpxVp9: has('libvpx-vp9'), libopus: has('libopus') },
    };
    return { ff, info };
  })();
  instance.catch(() => {
    instance = null;
  });
  return instance;
}

/** Termina el proceso (cancela una codificación en curso). La siguiente llamada vuelve a cargar. */
export async function terminateFfmpeg(): Promise<void> {
  if (!instance) return;
  const cur = instance;
  instance = null;
  try {
    (await cur).ff.terminate();
  } catch {
    /* ya terminado */
  }
}

export async function runFfmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  const { ff } = await loadFfmpeg();
  const onAbort = () => void terminateFfmpeg();
  signal?.addEventListener('abort', onAbort, { once: true });
  const logs: string[] = [];
  const onLog = ({ message }: { message: string }) => {
    logs.push(message);
    if ((globalThis as { __vsDebugFfmpeg?: boolean }).__vsDebugFfmpeg) console.debug("[ffmpeg]", message);
    if (logs.length > 60) logs.shift();
  };
  ff.on('log', onLog);
  try {
    const code = await ff.exec(args);
    if (signal?.aborted) throw new DOMException('Exportación cancelada', 'AbortError');
    if (code !== 0) throw new Error(`FFmpeg terminó con código ${code}: ${logs.slice(-6).join(' | ')}`);
  } finally {
    ff.off('log', onLog);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Codifica audio PCM a WAV (16 bits) para entregarlo a FFmpeg. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const n = channels[0]!.length;
  const chs = channels.length;
  const buffer = new ArrayBuffer(44 + n * chs * 2);
  const v = new DataView(buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * chs * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, chs, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * chs * 2, true);
  v.setUint16(32, chs * 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * chs * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < chs; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]![i]!));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(buffer);
}
