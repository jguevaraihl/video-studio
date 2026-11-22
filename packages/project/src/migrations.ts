/**
 * Migraciones del esquema. Cada función lleva un documento de la versión N a N+1.
 * La versión 0 corresponde a los borradores sin campo schemaVersion.
 */
import { ProjectSchema, SCHEMA_VERSION, type Project } from './schema.ts';

type AnyDoc = Record<string, unknown>;

const migrations: Record<number, (d: AnyDoc) => AnyDoc> = {
  0: (d) => ({ ...d, schemaVersion: 1, transitions: d.transitions ?? {}, generations: d.generations ?? {} }),
};

export function migrateProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new Error('El archivo de proyecto no es un objeto JSON.');
  let doc = raw as AnyDoc;
  let version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 0;
  if (version > SCHEMA_VERSION) {
    throw new Error(`El proyecto usa la versión ${version} del esquema y esta app solo conoce hasta la ${SCHEMA_VERSION}. Actualiza la app.`);
  }
  while (version < SCHEMA_VERSION) {
    const m = migrations[version];
    if (!m) throw new Error(`No hay migración desde la versión ${version}.`);
    doc = m(doc);
    version++;
  }
  return ProjectSchema.parse(doc);
}
