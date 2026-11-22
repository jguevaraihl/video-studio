#!/usr/bin/env node
/**
 * Verifica un video exportado con ffprobe y ffmpeg (deben estar en el PATH).
 * Uso: node scripts/verify-export.mjs <archivo> [--sync] [--expect-seconds=N] [--width=W --height=H]
 * --sync mide el desfase entre destellos blancos y pitidos (fixture de sincronía).
 * Sale con código 1 si alguna comprobación falla.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function probe(file) {
  const j = JSON.parse(run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]));
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  return {
    format: j.format.format_name,
    duration: Number(j.format.duration),
    video: v && { codec: v.codec_name, width: v.width, height: v.height, fps: v.avg_frame_rate, frames: Number(v.nb_frames ?? NaN), duration: Number(v.duration ?? j.format.duration), pixFmt: v.pix_fmt },
    audio: a && { codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: a.channels, duration: Number(a.duration ?? j.format.duration) },
  };
}

/** ffmpeg escribe los resultados de los filtros en stderr: se juntan ambas salidas. */
function output(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return (r.stdout ?? '') + (r.stderr ?? '');
}

/** Volumen medio y máximo (dBFS) del audio decodificado. */
export function volume(file) {
  const txt = output('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
  const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(txt)?.[1] ?? -Infinity);
  const max = Number(/max_volume: (-?[\d.]+) dB/.exec(txt)?.[1] ?? -Infinity);
  return { mean, max };
}

/** Instantes (s) de los fotogramas con luminancia media alta (destellos). */
export function flashTimes(file) {
  const out = output('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-an', '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-']);
  const times = [];
  let t = null;
  for (const line of out.split('\n')) {
    const m = /pts_time:([\d.]+)/.exec(line);
    if (m) t = Number(m[1]);
    const y = /YAVG=([\d.]+)/.exec(line);
    if (y && t !== null && Number(y[1]) > 200) times.push(t);
  }
  // Un destello por grupo de fotogramas contiguos.
  return times.filter((x, i) => i === 0 || x - times[i - 1] > 0.2);
}

/** Inicios (s) de los pitidos: ventanas de 1 ms con RMS > -12 dBFS tras silencio relativo. */
export function beepTimes(file) {
  const out = output('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-af', 'asetnsamples=n=48:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-', '-f', 'null', '-']);
  const times = [];
  let t = null;
  let prevLoud = false;
  for (const line of out.split('\n')) {
    const m = /pts_time:([\d.]+)/.exec(line);
    if (m) t = Number(m[1]);
    const r = /RMS_level=(-?[\d.inf]+)/.exec(line);
    if (r && t !== null) {
      const loud = Number(r[1]) > -12;
      if (loud && !prevLoud && (times.length === 0 || t - times[times.length - 1] > 0.3)) times.push(t);
      prevLoud = loud;
    }
  }
  return times;
}

/** Empareja cada destello con el pitido más cercano y devuelve los desfases (s). */
export function syncOffsets(file) {
  const flashes = flashTimes(file);
  const beeps = beepTimes(file);
  return flashes.map((f) => {
    const b = beeps.reduce((best, x) => (Math.abs(x - f) < Math.abs(best - f) ? x : best), Infinity);
    return { flash: f, beep: b, offset: b - f };
  });
}

function ratio(s) {
  const [n, d] = String(s).split('/').map(Number);
  return d ? n / d : n;
}

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) {
    console.error('Uso: node scripts/verify-export.mjs <archivo> [--sync] [--expect-seconds=N] [--width=W --height=H]');
    process.exit(2);
  }
  const opt = Object.fromEntries(flags.map((f) => f.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
  const p = probe(file);
  const vol = volume(file);
  const checks = [];
  const ok = (name, pass, detail) => checks.push({ name, pass, detail });
  ok('Tiene video', !!p.video, p.video ? `${p.video.codec} ${p.video.width}×${p.video.height} ${p.video.fps}` : 'sin pista de video');
  ok('Tiene audio', !!p.audio, p.audio ? `${p.audio.codec} ${p.audio.sampleRate} Hz ${p.audio.channels} canales` : 'sin pista de audio');
  if (p.audio) ok('Audio audible', vol.max > -40, `media ${vol.mean} dB, pico ${vol.max} dB`);
  if (opt.width) ok('Dimensiones', p.video?.width === Number(opt.width) && p.video?.height === Number(opt.height), `${p.video?.width}×${p.video?.height}`);
  if (opt['expect-seconds']) {
    const fps = p.video ? ratio(p.video.fps) : 30;
    ok('Duración', Math.abs(p.duration - Number(opt['expect-seconds'])) <= 1.5 / fps, `${p.duration.toFixed(3)} s (esperado ${opt['expect-seconds']} s)`);
  }
  if (opt.sync) {
    const fps = p.video ? ratio(p.video.fps) : 30;
    const offs = syncOffsets(file);
    const worst = offs.reduce((m, o) => Math.max(m, Math.abs(o.offset)), 0);
    ok('Destellos detectados', offs.length > 0, `${offs.length}`);
    ok('Desfase audio/video ≤ 1 fotograma', offs.length > 0 && worst <= 1 / fps + 1e-3, offs.map((o) => `${o.flash.toFixed(3)}→${(o.offset * 1000).toFixed(1)} ms`).join(', '));
  }
  console.log(JSON.stringify({ file, probe: p, volume: vol, checks }, null, 2));
  for (const c of checks) console.log(`${c.pass ? 'OK   ' : 'FALLA'} ${c.name}: ${c.detail}`);
  process.exit(checks.every((c) => c.pass) ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
