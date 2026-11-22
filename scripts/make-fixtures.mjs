// Genera material de prueba y de ejemplo reproducible con FFmpeg nativo.
// Uso: npm run fixtures   (requiere ffmpeg en el PATH; los archivos ya vienen versionados)
// Diseño de los clips de sincronía:
// - 30 fps constantes, caja en movimiento, número de fotograma y tiempo visibles.
// - En cada segundo entero desde 1 s: un fotograma blanco y un pitido de 1 kHz de 50 ms.
//   Sirve para medir desfase imagen/sonido, imagen congelada y pista muda.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sample = join(root, 'apps/web/public/sample');
const fixtures = join(root, 'fixtures');
mkdirSync(sample, { recursive: true });
mkdirSync(fixtures, { recursive: true });
const font = process.env.FIXTURE_FONT ?? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

function ff(args) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

function syncClip(out, { seconds, bg, box, label, freq }) {
  const v =
    `color=c=${bg}:s=1280x720:r=30:d=${seconds}[bg];` +
    `color=c=${box}:s=160x160:r=30:d=${seconds}[box];` +
    `[bg][box]overlay=x='mod(t*320\\,1120)':y='280+120*sin(t*2)'[mv];` +
    `[mv]drawtext=fontfile=${font}:text='${label}':x=40:y=40:fontsize=56:fontcolor=white,` +
    `drawtext=fontfile=${font}:text='f %{frame_num}  t %{pts\\:flt}':x=40:y=640:fontsize=40:fontcolor=white,` +
    `drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='gte(t\\,0.99)*lt(mod(n\\,30)\\,1)',format=yuv420p[v]`;
  const a = `aevalsrc='if(gte(t\\,1)*lt(mod(t\\,1)\\,0.05)\\,0.7*sin(2*PI*1000*t)\\,0.08*sin(2*PI*${freq}*t))':s=48000:d=${seconds},aformat=channel_layouts=stereo[a]`;
  ff(['-f', 'lavfi', '-i', `nullsrc=s=16x16:d=${seconds}`, '-filter_complex', `${v};${a}`, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libvpx', '-b:v', '1.2M', '-deadline', 'good', '-cpu-used', '4', '-g', '30', '-c:a', 'libopus', '-b:a', '96k', out]);
}

syncClip(join(sample, 'clip-a.webm'), { seconds: 6, bg: '0x1e3a8a', box: 'orange', label: 'CLIP A', freq: 220 });
syncClip(join(sample, 'clip-b.webm'), { seconds: 5, bg: '0x14532d', box: '0xf43f5e', label: 'CLIP B', freq: 330 });

// Música: acordes simples (do-la-fa-sol) en Opus/Ogg, 12 s.
const chord = (t0, f1, f2, f3) => `between(t\\,${t0}\\,${t0 + 3})*(sin(2*PI*${f1}*t)+sin(2*PI*${f2}*t)+sin(2*PI*${f3}*t))`;
const expr = `0.12*(${chord(0, 261.6, 329.6, 392)}+${chord(3, 220, 261.6, 329.6)}+${chord(6, 174.6, 220, 261.6)}+${chord(9, 196, 246.9, 293.7)})*(0.6+0.4*sin(2*PI*2*t))`;
ff(['-f', 'lavfi', '-i', `aevalsrc='${expr}':s=48000:d=12`, '-af', 'aformat=channel_layouts=stereo,afade=t=out:st=11:d=1', '-c:a', 'libopus', '-b:a', '96k', join(sample, 'musica.ogg')]);

// Imagen fija para "Animar una imagen" y para clips de imagen.
ff(['-f', 'lavfi', '-i', 'gradients=s=1280x720:c0=0x0ea5e9:c1=0xf97316:x0=0:y0=0:x1=1280:y1=720:d=1', '-frames:v', '1',
  '-vf', `format=rgb24,drawtext=fontfile=${font}:text='Imagen de ejemplo':x=(w-tw)/2:y=(h-th)/2:fontsize=72:fontcolor=white`, join(sample, 'imagen.png')]);

// Fixture corto para pruebas de sincronía (mismo diseño que clip A, 4 s).
syncClip(join(fixtures, 'sync-30fps.webm'), { seconds: 4, bg: '0x312e81', box: 'yellow', label: 'SYNC', freq: 220 });
// Fixture sin pista de audio.
ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=3', '-pix_fmt', 'yuv420p', '-c:v', 'libvpx', '-b:v', '600k', join(fixtures, 'sin-audio.webm')]);
// Fixture H.264/AAC (similar a un celular) para navegadores con códecs propietarios.
ff(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=3', '-f', 'lavfi', '-i', 'sine=f=440:d=3:r=48000', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(fixtures, 'h264-aac.mp4')]);
// Subtítulos de ejemplo.
console.log('Fixtures generados en apps/web/public/sample y fixtures/.');
