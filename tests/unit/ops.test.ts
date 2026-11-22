import { describe, expect, it } from 'vitest';
import {
  placeAsset,
  splitAt,
  trimClip,
  moveClips,
  deleteClips,
  duplicateClips,
  clipsOnTrack,
  clipEnd,
  clipDuration,
  addTransition,
  validateTransition,
  maxTransitionDuration,
  setSpeed,
  mediaClipDuration,
  localToSource,
  sourceToLocal,
  addCue,
  resolveCues,
  linkCuesToClip,
  snap,
  snapCandidates,
  EditError,
  type MediaClip,
} from '@vs/project';
import { fakeAsset, projectWith, s } from './helpers.ts';

function setup() {
  const a = fakeAsset({ seconds: 10 });
  const b = fakeAsset({ seconds: 6 });
  let p = projectWith(a, b);
  const r1 = placeAsset(p, a.id, 0);
  p = r1.project;
  const r2 = placeAsset(p, b.id, s(10));
  p = r2.project;
  return { p, a, b, aClips: r1.clipIds, bClips: r2.clipIds };
}

describe('colocación y vínculo imagen/sonido', () => {
  it('un video con sonido crea dos clips vinculados', () => {
    const { p, aClips } = setup();
    expect(aClips).toHaveLength(2);
    const [v, au] = aClips.map((id) => p.clips[id]!);
    expect(v!.linkGroupId).toBeTruthy();
    expect(v!.linkGroupId).toBe(au!.linkGroupId);
    expect(p.tracks.find((t) => t.id === au!.trackId)!.kind).toBe('audio');
  });

  it('reutilizar un recurso no copia sus bytes: los clips comparten assetId', () => {
    const { p, a } = setup();
    const again = placeAsset(p, a.id, s(20)).project;
    const users = Object.values(again.clips).filter((c) => c.kind === 'media' && c.assetId === a.id);
    expect(users.length).toBe(4);
    expect(Object.keys(again.assets)).toHaveLength(2);
  });
});

describe('dividir y recortar', () => {
  it('divide imagen y sonido en el cabezal', () => {
    const { p, aClips } = setup();
    const { project, created } = splitAt(p, s(4), [aClips[0]!]);
    expect(created).toHaveLength(2);
    const left = project.clips[aClips[0]!] as MediaClip;
    const right = project.clips[created[0]!] as MediaClip;
    expect(clipEnd(left)).toBe(s(4));
    expect(right.start).toBe(s(4));
    expect(right.sourceIn).toBe(s(4));
    expect(project.clips[created[0]!]!.linkGroupId).toBe(project.clips[created[1]!]!.linkGroupId);
    expect(project.clips[created[0]!]!.linkGroupId).not.toBe(left.linkGroupId);
  });

  it('recorta ambos extremos y respeta el material disponible', () => {
    const { p, aClips } = setup();
    const id = aClips[0]!;
    let q = trimClip(p, id, 'start', s(1));
    expect((q.clips[id] as MediaClip).sourceIn).toBe(s(1));
    q = trimClip(q, id, 'end', s(8));
    expect(clipDuration(q.clips[id]!)).toBe(s(7));
    expect(() => trimClip(q, id, 'start', s(-1))).toThrow(EditError);
  });

  it('mover sobre otro clip lo sobrescribe sin solapamientos', () => {
    const { p, bClips, aClips } = setup();
    const q = moveClips(p, [bClips[0]!], -s(4), { primaryId: bClips[0]! });
    const track = q.clips[aClips[0]!]!.trackId;
    const clips = clipsOnTrack(q, track);
    for (let i = 1; i < clips.length; i++) expect(clips[i]!.start).toBeGreaterThanOrEqual(clipEnd(clips[i - 1]!));
    expect(clipEnd(q.clips[aClips[0]!]!)).toBe(s(6));
  });

  it('borrar con cierre de hueco desplaza lo siguiente', () => {
    const { p, aClips, bClips } = setup();
    const q = deleteClips(p, [aClips[0]!], { ripple: true });
    expect(q.clips[bClips[0]!]!.start).toBe(0);
  });

  it('duplicar coloca la copia después', () => {
    const { p, bClips } = setup();
    const { project, created } = duplicateClips(p, [bClips[0]!]);
    expect(project.clips[created[0]!]!.start).toBe(s(16));
  });
});

describe('velocidad', () => {
  it('velocidad constante cambia la duración', () => {
    const { p, aClips } = setup();
    const q = setSpeed(p, aClips[0]!, { mode: 'constant', rate: 2, preservePitch: true });
    expect(clipDuration(q.clips[aClips[0]!]!)).toBe(s(5));
    // el vinculado de audio cambia igual
    expect(clipDuration(q.clips[aClips[1]!]!)).toBe(s(5));
  });

  it('curva de velocidad: duración = tramo / velocidad media y mapa invertible', () => {
    const clip = { sourceIn: 0, sourceOut: s(10), speed: { mode: 'curve' as const, points: [{ p: 0, v: 1 }, { p: 0.5, v: 3 }, { p: 1, v: 1 }] } };
    // promedio = 2 -> 5 s
    expect(mediaClipDuration(clip)).toBe(s(5));
    expect(localToSource(clip, s(5))).toBeCloseTo(s(10), -2);
    const mid = localToSource(clip, s(2.5));
    expect(mid).toBeCloseTo(s(5), -2);
    expect(Math.abs(sourceToLocal(clip, s(7)) - s(3.25))).toBeLessThan(s(0.2));
    const u = s(1.7);
    expect(Math.abs(sourceToLocal(clip, localToSource(clip, u)) - u)).toBeLessThanOrEqual(2);
  });
});

describe('transiciones', () => {
  it('valida el material disponible y acepta con material suficiente', () => {
    const a = fakeAsset({ seconds: 10 });
    let p = projectWith(a);
    p = placeAsset(p, a.id, 0).project;
    const [v] = Object.values(p.clips).filter((c) => p.tracks.find((t) => t.id === c.trackId)!.kind === 'video');
    // Sin recorte no hay material extra al final del primer clip.
    const { project, created } = splitAt(p, s(5), [v!.id]);
    const left = v!.id;
    const right = created.find((id) => project.tracks.find((t) => t.id === project.clips[id]!.trackId)!.kind === 'video')!;
    expect(validateTransition(project, { fromClipId: left, toClipId: right, duration: s(1) })).toBeNull();
    expect(maxTransitionDuration(project, left, right)).toBeGreaterThan(s(5) - 1000);
    const r = addTransition(project, left, right, s(1));
    expect(Object.keys(r.project.transitions)).toHaveLength(1);
  });

  it('rechaza una transición sin material de entrada', () => {
    const a = fakeAsset({ seconds: 4 });
    const b = fakeAsset({ seconds: 4 });
    let p = projectWith(a, b);
    p = placeAsset(p, a.id, 0, {}).project;
    p = placeAsset(p, b.id, s(4), {}).project;
    const vids = Object.values(p.clips).filter((c) => p.tracks.find((t) => t.id === c.trackId)!.kind === 'video').sort((x, y) => x.start - y.start);
    const msg = validateTransition(p, { fromClipId: vids[0]!.id, toClipId: vids[1]!.id, duration: s(1) });
    expect(msg).toMatch(/Falta material/);
  });
});

describe('subtítulos vinculados', () => {
  it('siguen al clip al mover, dividir y cambiar velocidad', () => {
    const { p, aClips } = setup();
    const v = aClips[0]!;
    let q = addCue(p, { start: s(6), end: s(7), text: 'hola', link: null }).project;
    const cueId = q.subtitles.cues[0]!.id;
    q = linkCuesToClip(q, [cueId], v);
    q = moveClips(q, [v], s(2), { primaryId: v });
    expect(resolveCues(q)[0]!.start).toBe(s(8));
    const split = splitAt(q, s(5), [v]);
    q = split.project;
    expect(q.subtitles.cues[0]!.link!.clipId).not.toBe(v);
    expect(resolveCues(q)[0]!.start).toBe(s(8));
    const right = q.subtitles.cues[0]!.link!.clipId;
    q = setSpeed(q, right, { mode: 'constant', rate: 2, preservePitch: true });
    // el clip derecho empieza en 5 s con fuente 3 s; el subtítulo en fuente 6 s -> 5 + 3/2 = 6.5 s
    expect(resolveCues(q)[0]!.start).toBe(s(6.5));
  });
});

describe('ajuste magnético', () => {
  it('ajusta al borde más cercano dentro del umbral', () => {
    const { p } = setup();
    const cands = snapCandidates(p, new Set(), s(3));
    expect(snap(s(9.95), cands, s(0.1)).t).toBe(s(10));
    expect(snap(s(9.5), cands, s(0.1)).snapped).toBe(false);
  });
});
