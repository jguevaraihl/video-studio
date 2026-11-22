/** Registro de LUT 3D: la incluida en la app y las .cube que cargue el usuario. */
import { parseCube, type Lut3D } from '@vs/project';

const registry = new Map<string, Lut3D>();
let builtinLoaded: Promise<void> | null = null;

export const BUILTIN_LUTS = [{ id: 'teal-orange', url: '/luts/teal-orange.cube' }];

export function loadBuiltinLuts(): Promise<void> {
  builtinLoaded ??= Promise.all(
    BUILTIN_LUTS.map(async (l) => {
      const text = await (await fetch(l.url)).text();
      registry.set(l.id, parseCube(l.id, text));
    }),
  ).then(() => undefined);
  return builtinLoaded;
}

export function getLut(id: string): Lut3D | null {
  return registry.get(id) ?? null;
}

export function listLuts(): { id: string; title: string }[] {
  return [...registry.values()].map((l) => ({ id: l.id, title: l.title }));
}

export async function addUserLut(file: File): Promise<Lut3D> {
  const id = `user-${file.name.replace(/\W+/g, '-').toLowerCase()}`;
  const lut = parseCube(id, await file.text());
  registry.set(id, lut);
  return lut;
}

export function registerLut(lut: Lut3D): void {
  registry.set(lut.id, lut);
}

export function allLuts(): Lut3D[] {
  return [...registry.values()];
}
