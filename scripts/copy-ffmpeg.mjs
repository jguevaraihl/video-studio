// Copia el core de FFmpeg.wasm al directorio público para servirlo desde el mismo origen.
// Se ejecuta en "npm install" (postinstall) y antes de compilar. Es idempotente.
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outBase = join(root, 'apps/web/public/ffmpeg');

const jobs = [
  { pkg: '@ffmpeg/core', dest: 'st', files: ['ffmpeg-core.js', 'ffmpeg-core.wasm'] },
  { pkg: '@ffmpeg/core-mt', dest: 'mt', files: ['ffmpeg-core.js', 'ffmpeg-core.wasm', 'ffmpeg-core.worker.js'] },
];

let copied = 0;
for (const job of jobs) {
  // El paquete no exporta package.json: se busca en node_modules de la app y de la raíz.
  const pkgDir = [join(root, 'apps/web/node_modules', job.pkg), join(root, 'node_modules', job.pkg)].find((d) => existsSync(d));
  if (!pkgDir) {
    console.warn(`[copy-ffmpeg] ${job.pkg} no está instalado todavía. Se omite.`);
    continue;
  }
  const src = join(pkgDir, 'dist', 'esm');
  const dest = join(outBase, job.dest);
  mkdirSync(dest, { recursive: true });
  for (const f of job.files) {
    const from = join(src, f);
    if (!existsSync(from)) {
      console.warn(`[copy-ffmpeg] Falta ${from}`);
      continue;
    }
    const to = join(dest, f);
    if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
    cpSync(from, to);
    copied++;
  }
}
console.log(`[copy-ffmpeg] Listo (${copied} archivos copiados a apps/web/public/ffmpeg).`);
