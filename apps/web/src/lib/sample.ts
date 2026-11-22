/**
 * Proyecto de ejemplo local: dos clips con movimiento y pulsos de audio,
 * música, un título animado, una disolución y subtítulos. No usa Internet.
 */
import {
  addAsset,
  addCue,
  addTextClip,
  addTransition,
  createProject,
  placeAsset,
  secondsToTicks as s,
  trimClip,
  updateClip,
  type Project,
} from '@vs/project';
import { importFile } from './media-service.ts';

async function fetchFile(url: string, name: string, type: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se encontró el material de ejemplo (${url}).`);
  return new File([await res.blob()], name, { type });
}

export async function buildSampleProject(): Promise<Project> {
  const [fa, fb, fm, fi] = await Promise.all([
    fetchFile('/sample/clip-a.webm', 'clip-a.webm', 'video/webm'),
    fetchFile('/sample/clip-b.webm', 'clip-b.webm', 'video/webm'),
    fetchFile('/sample/musica.ogg', 'musica.ogg', 'audio/ogg'),
    fetchFile('/sample/imagen.png', 'imagen.png', 'image/png'),
  ]);
  const origin = { type: 'sample' as const, generationId: null };
  const [a, b, m, i] = await Promise.all([
    importFile(fa, fa.name, origin),
    importFile(fb, fb.name, origin),
    importFile(fm, fm.name, origin),
    importFile(fi, fi.name, origin),
  ]);
  let p = createProject({ name: 'Ejemplo: mi primer video' });
  for (const asset of [a, b, m, i]) p = addAsset(p, asset);
  const video1 = p.tracks.find((t) => t.kind === 'video')!;
  const audio1 = p.tracks.find((t) => t.kind === 'audio')!;
  const audio2 = p.tracks.filter((t) => t.kind === 'audio')[1]!;

  // Clip A: 0 a 4 s (fuente 0.5 a 4.5 s).
  const ra = placeAsset(p, a.id, 0, { videoTrackId: video1.id, audioTrackId: audio1.id });
  p = ra.project;
  p = trimClip(p, ra.clipIds[0]!, 'start', s(0.5));
  p = trimClip(p, ra.clipIds[0]!, 'end', s(4.5));
  p = { ...p, clips: Object.fromEntries(Object.entries(p.clips).map(([k, c]) => [k, ra.clipIds.includes(k) ? { ...c, start: c.start - s(0.5) } : c])) };
  // Clip B justo después, con material previo para la disolución.
  const rb = placeAsset(p, b.id, s(4), { videoTrackId: video1.id, audioTrackId: audio1.id });
  p = rb.project;
  p = trimClip(p, rb.clipIds[0]!, 'start', s(4.5));
  p = { ...p, clips: Object.fromEntries(Object.entries(p.clips).map(([k, c]) => [k, rb.clipIds.includes(k) ? { ...c, start: c.start - s(0.5) } : c])) };
  p = addTransition(p, ra.clipIds[0]!, rb.clipIds[0]!, s(1)).project;
  p = addTransition(p, ra.clipIds[1]!, rb.clipIds[1]!, s(1)).project;
  // Música de fondo con volumen bajo y fundido de salida.
  const rm = placeAsset(p, m.id, 0, { audioTrackId: audio2.id });
  p = rm.project;
  const end = s(8.5);
  p = trimClip(p, rm.clipIds[0]!, 'end', end);
  const music = p.clips[rm.clipIds[0]!]!;
  if (music.kind === 'media') p = updateClip(p, music.id, { audio: { ...music.audio, gainDb: -10, fadeIn: s(0.5), fadeOut: s(1.5) } });
  // Título animado con keyframes de opacidad y escala.
  const rt = addTextClip(p, 'Mi primer video', s(0.3), s(3));
  p = rt.project;
  const title = p.clips[rt.clipId]!;
  if (title.kind === 'text') {
    p = updateClip(p, title.id, {
      transform: { ...title.transform, y: -0.3 },
      keyframes: {
        opacity: [
          { t: 0, v: 0, ease: 'easeInOut' },
          { t: s(0.6), v: 1, ease: 'linear' },
          { t: s(2.4), v: 1, ease: 'easeInOut' },
          { t: s(3), v: 0, ease: 'linear' },
        ],
        scale: [
          { t: 0, v: 0.8, ease: 'easeInOut' },
          { t: s(0.8), v: 1, ease: 'linear' },
        ],
      },
    });
  }
  p = addCue(p, { start: s(1), end: s(3), text: 'Cada destello coincide con un pitido.', link: null }).project;
  p = addCue(p, { start: s(4.5), end: s(7), text: 'Disolución entre el clip A y el clip B.', link: null }).project;
  return p;
}
