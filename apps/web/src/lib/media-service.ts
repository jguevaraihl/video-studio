/** Importación de archivos y acceso a sus bytes. Importar nunca sube nada a Internet. */
import { addAsset, newId, type Asset, type Project } from '@vs/project';
import { probeFile, UnsupportedMediaError } from '../engine/probe.ts';
import { getMedia, putMedia, QuotaError } from '../storage/media.ts';
import { useStore } from '../state/store.ts';

export async function importFile(file: File | Blob, name: string, origin?: Asset['origin']): Promise<Asset> {
  const meta = await probeFile(file, name, origin);
  const storageKey = newId('media');
  const asset: Asset = { ...meta, storageKey };
  try {
    await putMedia(storageKey, file);
    useStore.getState().markVolatile(asset.id, null);
  } catch (e) {
    if (e instanceof QuotaError) {
      useStore.getState().markVolatile(asset.id, e.message);
      useStore.getState().toast(e.message, 'error');
    } else throw e;
  }
  return asset;
}

export async function importFiles(files: File[]): Promise<Asset[]> {
  const st = useStore.getState();
  const out: Asset[] = [];
  for (const f of files) {
    try {
      const a = await importFile(f, f.name);
      st.apply((p: Project) => addAsset(p, a));
      out.push(a);
    } catch (e) {
      const msg = e instanceof UnsupportedMediaError ? e.message : `No se pudo importar «${f.name}»: ${e instanceof Error ? e.message : String(e)}`;
      st.toast(msg, 'error');
    }
  }
  if (out.length) st.toast(`${out.length} archivo(s) importado(s). Nada salió de tu equipo.`, 'success');
  return out;
}

export function blobForAsset(asset: Asset): Promise<Blob | null> {
  return getMedia(asset.storageKey);
}

export async function blobForAssetId(assetId: string): Promise<Blob | null> {
  const a = useStore.getState().project?.assets[assetId];
  return a ? getMedia(a.storageKey) : null;
}

/** Comprueba qué recursos del proyecto no tienen bytes disponibles. */
export async function findMissingAssets(p: Project): Promise<string[]> {
  const missing: string[] = [];
  for (const a of Object.values(p.assets)) if (!(await getMedia(a.storageKey))) missing.push(a.id);
  return missing;
}
