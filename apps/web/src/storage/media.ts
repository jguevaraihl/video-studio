/**
 * Almacén de medios. Cada archivo se guarda una vez bajo una clave.
 * Preferencia: OPFS (sistema de archivos privado del origen). Respaldo: blobs en IndexedDB.
 * Si falta cuota, el archivo queda solo en memoria durante la sesión y la edición sigue.
 */
import { db } from './db.ts';

export class QuotaError extends Error {
  constructor(public readonly needed: number, public readonly available: number | null) {
    super(
      `No hay espacio local suficiente para guardar el archivo (${fmt(needed)} necesarios` +
        (available !== null ? `, ${fmt(available)} libres` : '') +
        '). Sigue disponible en esta sesión. Libera espacio o exporta el proyecto portátil para no perderlo.',
    );
    this.name = 'QuotaError';
  }
}

function fmt(bytes: number): string {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

const memory = new Map<string, Blob>();
let opfsRoot: Promise<FileSystemDirectoryHandle | null> | null = null;

async function mediaDir(): Promise<FileSystemDirectoryHandle | null> {
  opfsRoot ??= (async () => {
    try {
      if (!navigator.storage?.getDirectory) return null;
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('media', { create: true });
      // Comprueba que se puede escribir (algunos modos privados lo bloquean).
      const probe = await dir.getFileHandle('.probe', { create: true });
      if (!('createWritable' in probe)) return null;
      return dir;
    } catch {
      return null;
    }
  })();
  return opfsRoot;
}

export async function storageBackend(): Promise<'opfs' | 'indexeddb'> {
  return (await mediaDir()) ? 'opfs' : 'indexeddb';
}

export async function estimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

/** Para pruebas: simula una cuota agotada. */
let simulateQuota = false;
export function setSimulatedQuotaFull(v: boolean): void {
  simulateQuota = v;
}

function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22);
}

export async function putMedia(key: string, blob: Blob): Promise<'opfs' | 'indexeddb'> {
  memory.set(key, blob);
  const est = await estimate();
  const available = est ? est.quota - est.usage : null;
  if (simulateQuota || (available !== null && available < blob.size * 1.05)) {
    throw new QuotaError(blob.size, simulateQuota ? 0 : available);
  }
  try {
    const dir = await mediaDir();
    if (dir) {
      const fh = await dir.getFileHandle(key, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      return 'opfs';
    }
    await (await db()).put('blobs', blob, key);
    return 'indexeddb';
  } catch (e) {
    if (isQuotaError(e)) throw new QuotaError(blob.size, available);
    throw e;
  }
}

export async function getMedia(key: string): Promise<Blob | null> {
  const m = memory.get(key);
  if (m) return m;
  try {
    const dir = await mediaDir();
    if (dir) {
      try {
        const fh = await dir.getFileHandle(key);
        const f = await fh.getFile();
        memory.set(key, f);
        return f;
      } catch {
        /* no está en OPFS: probar IndexedDB */
      }
    }
    const b = await (await db()).get('blobs', key);
    if (b) memory.set(key, b);
    return b ?? null;
  } catch {
    return null;
  }
}

export async function hasPersistedMedia(key: string): Promise<boolean> {
  const dir = await mediaDir();
  if (dir) {
    try {
      await dir.getFileHandle(key);
      return true;
    } catch {
      /* sigue */
    }
  }
  return !!(await (await db()).getKey('blobs', key));
}

export async function deleteMedia(key: string): Promise<void> {
  memory.delete(key);
  const dir = await mediaDir();
  if (dir) await dir.removeEntry(key).catch(() => undefined);
  await (await db()).delete('blobs', key).catch(() => undefined);
}

/** Libera la copia en memoria (el archivo sigue guardado). */
export function dropFromMemory(key: string): void {
  memory.delete(key);
}
