/** Guardado, apertura, autoguardado y recuperación de proyectos. */
import { migrateProject, type Project } from '@vs/project';
import { db, kvGet, kvSet } from './db.ts';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
}

export async function saveProject(p: Project): Promise<void> {
  // Se guarda una copia JSON pura: nunca contiene credenciales.
  const data = JSON.parse(JSON.stringify(p)) as Project;
  await (await db()).put('projects', { id: p.id, name: p.name, updatedAt: p.updatedAt, data });
  await kvSet('lastProjectId', p.id);
}

export async function loadProject(id: string): Promise<Project | null> {
  const row = await (await db()).get('projects', id);
  if (!row) return null;
  return migrateProject(row.data);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const rows = await (await db()).getAll('projects');
  return rows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  await (await db()).delete('projects', id);
}

export async function lastProjectId(): Promise<string | undefined> {
  return kvGet<string>('lastProjectId');
}

/** Autoguardado con espera corta. flush() fuerza la escritura pendiente. */
export function createAutosaver(onStatus: (s: 'saving' | 'saved' | 'error', err?: unknown) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Project | null = null;
  let inflight: Promise<void> = Promise.resolve();
  const write = () => {
    if (!pending) return inflight;
    const p = pending;
    pending = null;
    onStatus('saving');
    inflight = inflight
      .then(() => saveProject(p))
      .then(() => onStatus('saved'))
      .catch((e) => onStatus('error', e));
    return inflight;
  };
  return {
    schedule(p: Project) {
      pending = p;
      if (timer) clearTimeout(timer);
      timer = setTimeout(write, 400);
    },
    flush(): Promise<void> {
      if (timer) clearTimeout(timer);
      timer = null;
      return write();
    },
  };
}
