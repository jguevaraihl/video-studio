/**
 * Copia portátil: un .zip con project.json y los medios. Sirve para moverse
 * a otro navegador o equipo. Nunca incluye credenciales: el proyecto no las guarda
 * y aquí se verifica antes de escribir.
 */
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { migrateProject, newId, type Project } from '@vs/project';
import { getMedia, putMedia, QuotaError } from './media.ts';

const FORBIDDEN = /(api[_-]?key|authorization|bearer\s+[a-z0-9]|sk-[a-z0-9]{8,})/i;

export async function exportPortable(p: Project, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const json = JSON.stringify(p, null, 2);
  if (FORBIDDEN.test(json)) throw new Error('El proyecto contiene un texto con forma de credencial. Se canceló la exportación.');
  const files: Record<string, Uint8Array> = {
    'project.json': strToU8(json),
    'LEEME.txt': strToU8('Proyecto portátil de Estudio de Video. Ábrelo con «Abrir proyecto».\n'),
  };
  const assets = Object.values(p.assets);
  let i = 0;
  const missing: string[] = [];
  for (const a of assets) {
    const blob = await getMedia(a.storageKey);
    if (blob) files[`media/${a.storageKey}`] = new Uint8Array(await blob.arrayBuffer());
    else missing.push(a.name);
    onProgress?.(++i, assets.length);
  }
  if (missing.length) files['FALTANTES.txt'] = strToU8(`Archivos que no estaban disponibles:\n${missing.join('\n')}\n`);
  // Nivel 0: los videos ya están comprimidos.
  const zipped = zipSync(files, { level: 0 });
  return new Blob([zipped as BlobPart], { type: 'application/zip' });
}

export async function importPortable(file: Blob): Promise<{ project: Project; warnings: string[] }> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const raw = entries['project.json'];
  if (!raw) throw new Error('El archivo no contiene project.json. ¿Es una copia portátil de esta app?');
  const project = migrateProject(JSON.parse(strFromU8(raw)));
  const warnings: string[] = [];
  for (const a of Object.values(project.assets)) {
    const data = entries[`media/${a.storageKey}`];
    if (!data) {
      warnings.push(`Falta el archivo «${a.name}». Puedes reubicarlo desde la biblioteca.`);
      continue;
    }
    try {
      await putMedia(a.storageKey, new Blob([data as BlobPart], { type: a.mime }));
    } catch (e) {
      if (e instanceof QuotaError) warnings.push(`«${a.name}»: ${e.message}`);
      else throw e;
    }
  }
  // Nuevo id para no pisar un proyecto existente con el mismo origen.
  return { project: { ...project, id: newId('prj'), name: `${project.name} (importado)`, updatedAt: Date.now() }, warnings };
}
