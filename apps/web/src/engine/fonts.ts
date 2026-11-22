/** Tipografías locales: incluidas en la app y cargadas por el usuario (no se descargan de Internet). */
export interface FontSource {
  family: string;
  weight: string;
  url?: string;
  data?: ArrayBuffer;
}

export const BUILTIN_FONTS: FontSource[] = [
  { family: 'Inter', weight: '400', url: '/fonts/Inter-Regular.otf' },
  { family: 'Inter', weight: '700', url: '/fonts/Inter-Bold.otf' },
  { family: 'DejaVu Serif', weight: '700', url: '/fonts/DejaVuSerif-Bold.ttf' },
];

/** Fuentes del sistema habituales en Windows. Solo se usan si existen en el equipo. */
export const SYSTEM_FONTS = ['Arial', 'Georgia', 'Impact', 'Segoe UI', 'Times New Roman', 'Courier New'];

const userFonts: FontSource[] = [];

export function listFontFamilies(): string[] {
  return [...new Set([...BUILTIN_FONTS.map((f) => f.family), ...userFonts.map((f) => f.family), ...SYSTEM_FONTS])];
}

export async function addUserFont(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const family = file.name.replace(/\.(ttf|otf|woff2?)$/i, '');
  const face = new FontFace(family, data.slice(0));
  await face.load();
  document.fonts.add(face);
  userFonts.push({ family, weight: '400', data });
  return family;
}

export function fontSourcesForWorker(): FontSource[] {
  return [...BUILTIN_FONTS, ...userFonts.map((f) => ({ ...f, data: f.data!.slice(0) }))];
}

type FontSet = { add(f: FontFace): void };

export async function loadFontsInto(target: FontSet, sources: FontSource[], origin: string): Promise<void> {
  await Promise.all(
    sources.map(async (s) => {
      try {
        const face = s.data
          ? new FontFace(s.family, s.data, { weight: s.weight })
          : new FontFace(s.family, `url(${new URL(s.url!, origin).href})`, { weight: s.weight });
        await face.load();
        target.add(face);
      } catch {
        /* fuente no disponible: se usa la alternativa */
      }
    }),
  );
}
