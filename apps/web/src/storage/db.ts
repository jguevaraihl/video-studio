/** Base IndexedDB: metadatos de proyectos, blobs de respaldo y valores sueltos. */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Project } from '@vs/project';

interface VsDB extends DBSchema {
  projects: { key: string; value: { id: string; name: string; updatedAt: number; data: Project } };
  blobs: { key: string; value: Blob };
  kv: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<VsDB>> | null = null;

export function db(): Promise<IDBPDatabase<VsDB>> {
  dbPromise ??= openDB<VsDB>('video-studio', 1, {
    upgrade(d, oldVersion) {
      // Migraciones de la base local. v1: creación inicial.
      if (oldVersion < 1) {
        d.createObjectStore('projects', { keyPath: 'id' });
        d.createObjectStore('blobs');
        d.createObjectStore('kv');
      }
    },
  });
  return dbPromise;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key)) as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', value, key);
}
