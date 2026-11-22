/**
 * Operaciones de edición puras: (proyecto, argumentos) -> proyecto nuevo.
 * No mutan la entrada. El historial (deshacer/rehacer) guarda proyectos completos.
 *
 * Reglas de montaje:
 * - Una pista no admite solapamientos. Mover o recortar sobre otro clip lo sobrescribe:
 *   el clip de debajo se recorta, se divide o se elimina (modo "sobrescribir").
 * - Orden de capas: la pista con índice mayor se dibuja encima.
 * - Vínculo imagen/sonido: clips con el mismo linkGroupId se mueven, dividen,
 *   recortan y borran juntos. "Desvincular" quita el grupo.
 */
import { createImageClip, createMediaClip, createTextClip, createTrack, newId } from './factory.ts';
import type { Asset, Clip, Cue, MediaClip, Project, Track, TrackKind, Transition } from './schema.ts';
import { clipDuration, clipEnd, localToSource, mediaClipDuration, sourceToProject } from './timing.ts';
import type { Ticks } from './time.ts';

export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditError';
  }
}

const MIN_CLIP = 1000; // ~1.4 µs, evita clips de duración cero

function touch(p: Project): Project {
  return { ...p, updatedAt: Date.now() };
}

export function getTrack(p: Project, trackId: string): Track {
  const t = p.tracks.find((x) => x.id === trackId);
  if (!t) throw new EditError(`La pista ${trackId} no existe.`);
  return t;
}

export function getClip(p: Project, clipId: string): Clip {
  const c = p.clips[clipId];
  if (!c) throw new EditError(`El clip ${clipId} no existe.`);
  return c;
}

export function clipsOnTrack(p: Project, trackId: string): Clip[] {
  return Object.values(p.clips)
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.start - b.start);
}

export function projectDuration(p: Project): Ticks {
  let end = 0;
  for (const c of Object.values(p.clips)) end = Math.max(end, clipEnd(c));
  for (const cue of p.subtitles.cues) end = Math.max(end, cue.end);
  return end;
}

/** Expande una selección con los clips vinculados. */
export function expandLinked(p: Project, ids: string[]): string[] {
  const out = new Set(ids);
  const groups = new Set(ids.map((id) => p.clips[id]?.linkGroupId).filter((g): g is string => !!g));
  if (groups.size) {
    for (const c of Object.values(p.clips)) if (c.linkGroupId && groups.has(c.linkGroupId)) out.add(c.id);
  }
  return [...out];
}

export function trackAcceptsClip(track: Track, clip: Clip, p: Project): boolean {
  if (clip.kind === 'text') return track.kind === 'text' || track.kind === 'overlay';
  if (clip.kind === 'image') return track.kind === 'video' || track.kind === 'overlay';
  const asset = p.assets[clip.assetId];
  if (track.kind === 'audio') return !!asset?.hasAudio;
  if (track.kind === 'video' || track.kind === 'overlay') return !!asset?.hasVideo;
  return false;
}

// ---------- recortes de bajo nivel ----------

/** Recorta el inicio de un clip hasta el instante de proyecto newStart (puede ampliar si hay material). */
export function withStart(p: Project, clip: Clip, newStart: Ticks): Clip {
  const end = clipEnd(clip);
  if (newStart > end - MIN_CLIP) throw new EditError('El recorte deja el clip sin duración.');
  const delta = newStart - clip.start;
  if (clip.kind === 'media') {
    const newIn = Math.round(localToSource(clip, delta));
    if (newIn < 0) throw new EditError('No hay material de origen antes del inicio.');
    const shifted: MediaClip = { ...clip, start: newStart, sourceIn: newIn };
    return { ...shifted, keyframes: shiftKeyframes(clip.keyframes, -delta) };
  }
  if (newStart < 0) throw new EditError('El clip no puede empezar antes de 0.');
  return { ...clip, start: newStart, duration: clip.duration - delta, keyframes: shiftKeyframes(clip.keyframes, -delta) };
}

/** Recorta el final de un clip hasta el instante de proyecto newEnd. */
export function withEnd(p: Project, clip: Clip, newEnd: Ticks): Clip {
  if (newEnd < clip.start + MIN_CLIP) throw new EditError('El recorte deja el clip sin duración.');
  if (clip.kind === 'media') {
    const newOut = Math.round(localToSource(clip, newEnd - clip.start));
    const asset = p.assets[clip.assetId];
    const max = asset ? asset.duration : Number.POSITIVE_INFINITY;
    if (newOut > max + 1) throw new EditError('No hay material de origen después del final.');
    return { ...clip, sourceOut: Math.min(newOut, max) };
  }
  return { ...clip, duration: newEnd - clip.start };
}

function shiftKeyframes(k: Clip['keyframes'], delta: Ticks): Clip['keyframes'] {
  const out: Clip['keyframes'] = {};
  for (const [prop, list] of Object.entries(k) as [keyof Clip['keyframes'], NonNullable<Clip['keyframes']['x']>][]) {
    if (!list) continue;
    out[prop] = list.map((f) => ({ ...f, t: Math.max(0, f.t + delta) }));
  }
  return out;
}

/**
 * Libera el rango [start, end) en una pista sobrescribiendo lo que haya.
 * Los clips en exceptIds no se tocan.
 */
export function clearRange(p: Project, trackId: string, start: Ticks, end: Ticks, exceptIds: Set<string>): Project {
  let clips = { ...p.clips };
  let next = { ...p, clips };
  for (const c of clipsOnTrack(p, trackId)) {
    if (exceptIds.has(c.id)) continue;
    const cs = c.start;
    const ce = clipEnd(c);
    if (ce <= start || cs >= end) continue;
    if (cs >= start && ce <= end) {
      delete clips[c.id];
    } else if (cs < start && ce > end) {
      const left = withEnd(next, c, start);
      const right = { ...withStart(next, c, end), id: newId('clp') };
      clips[left.id] = left;
      clips[right.id] = right;
    } else if (cs < start) {
      clips[c.id] = withEnd(next, c, start);
    } else {
      clips[c.id] = withStart(next, c, end);
    }
    next = { ...next, clips };
  }
  return pruneTransitions({ ...next, clips });
}

/** Quita transiciones cuyos clips ya no son contiguos o no tienen material suficiente. */
export function pruneTransitions(p: Project): Project {
  const transitions: Record<string, Transition> = {};
  for (const tr of Object.values(p.transitions)) {
    if (validateTransition(p, tr) === null) transitions[tr.id] = tr;
  }
  return { ...p, transitions };
}

// ---------- operaciones públicas ----------

export function addTrack(p: Project, kind: TrackKind, name?: string): Project {
  const count = p.tracks.filter((t) => t.kind === kind).length + 1;
  const label = { video: 'Video', audio: 'Audio', text: 'Texto', overlay: 'Superposición' }[kind];
  const track = createTrack(kind, name ?? `${label} ${count}`);
  // Las pistas de audio quedan al final; las visuales, antes de la primera de audio.
  const tracks = [...p.tracks];
  if (kind === 'audio') tracks.push(track);
  else {
    const firstAudio = tracks.findIndex((t) => t.kind === 'audio');
    tracks.splice(firstAudio === -1 ? tracks.length : firstAudio, 0, track);
  }
  return touch({ ...p, tracks });
}

export function removeTrack(p: Project, trackId: string): Project {
  const clips = Object.fromEntries(Object.entries(p.clips).filter(([, c]) => c.trackId !== trackId));
  return touch(pruneTransitions({ ...p, tracks: p.tracks.filter((t) => t.id !== trackId), clips }));
}

export function updateTrack(p: Project, trackId: string, patch: Partial<Omit<Track, 'id' | 'kind'>>): Project {
  getTrack(p, trackId);
  return touch({ ...p, tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)) });
}

export function addAsset(p: Project, asset: Asset): Project {
  return touch({ ...p, assets: { ...p.assets, [asset.id]: asset } });
}

export function updateAsset(p: Project, assetId: string, patch: Partial<Asset>): Project {
  const a = p.assets[assetId];
  if (!a) throw new EditError('El recurso no existe.');
  return touch({ ...p, assets: { ...p.assets, [assetId]: { ...a, ...patch } } });
}

/** Borra un recurso solo si ningún clip lo usa. */
export function removeAsset(p: Project, assetId: string): Project {
  if (Object.values(p.clips).some((c) => c.kind !== 'text' && c.assetId === assetId)) {
    throw new EditError('El recurso está en uso en la línea de tiempo.');
  }
  const assets = { ...p.assets };
  delete assets[assetId];
  return touch({ ...p, assets });
}

function firstTrackOf(p: Project, kind: TrackKind): Track | undefined {
  return p.tracks.find((t) => t.kind === kind);
}

/** Inserta un clip en una pista y sobrescribe lo que esté debajo. */
export function insertClip(p: Project, clip: Clip): Project {
  const track = getTrack(p, clip.trackId);
  if (track.locked) throw new EditError(`La pista «${track.name}» está bloqueada.`);
  if (!trackAcceptsClip(track, clip, p)) throw new EditError(`La pista «${track.name}» no admite este tipo de clip.`);
  const cleared = clearRange(p, clip.trackId, clip.start, clipEnd(clip), new Set());
  return touch({ ...cleared, clips: { ...cleared.clips, [clip.id]: clip } });
}

/**
 * Coloca un recurso en el montaje. Un video con sonido crea dos clips vinculados:
 * uno en una pista de video y otro en una pista de audio.
 */
export function placeAsset(
  p: Project,
  assetId: string,
  at: Ticks,
  opts: { videoTrackId?: string; audioTrackId?: string } = {},
): { project: Project; clipIds: string[] } {
  const asset = p.assets[assetId];
  if (!asset) throw new EditError('El recurso no existe.');
  let next = p;
  const ids: string[] = [];
  if (asset.kind === 'image') {
    const tId = opts.videoTrackId ?? firstTrackOf(next, 'video')?.id;
    if (!tId) throw new EditError('No hay pista de video.');
    const c = createImageClip(asset, tId, at);
    next = insertClip(next, c);
    ids.push(c.id);
    return { project: next, clipIds: ids };
  }
  const group = asset.hasVideo && asset.hasAudio ? newId('lnk') : null;
  if (asset.hasVideo) {
    const tId = opts.videoTrackId ?? firstTrackOf(next, 'video')?.id;
    if (!tId) throw new EditError('No hay pista de video.');
    const c = createMediaClip(asset, tId, at, { linkGroupId: group });
    next = insertClip(next, c);
    ids.push(c.id);
  }
  if (asset.hasAudio) {
    let tId = opts.audioTrackId ?? firstTrackOf(next, 'audio')?.id;
    if (!tId) {
      next = addTrack(next, 'audio');
      tId = firstTrackOf(next, 'audio')!.id;
    }
    const c = createMediaClip(asset, tId, at, { linkGroupId: group });
    next = insertClip(next, c);
    ids.push(c.id);
  }
  return { project: next, clipIds: ids };
}

export function addTextClip(p: Project, text: string, at: Ticks, duration: Ticks, trackId?: string): { project: Project; clipId: string } {
  let next = p;
  let tId = trackId ?? firstTrackOf(next, 'text')?.id;
  if (!tId) {
    next = addTrack(next, 'text');
    tId = firstTrackOf(next, 'text')!.id;
  }
  const c = createTextClip(text, tId, at, duration);
  return { project: insertClip(next, c), clipId: c.id };
}

/**
 * Mueve clips (y sus vinculados) delta ticks. targetTrackId cambia la pista del clip principal.
 * Lo que quede debajo en destino se sobrescribe.
 */
export function moveClips(
  p: Project,
  ids: string[],
  delta: Ticks,
  opts: { primaryId?: string; targetTrackId?: string; linked?: boolean } = {},
): Project {
  const all = opts.linked === false ? ids : expandLinked(p, ids);
  const moving = all.map((id) => getClip(p, id));
  const minStart = Math.min(...moving.map((c) => c.start));
  const d = Math.max(delta, -minStart);
  const clips = { ...p.clips };
  for (const c of moving) delete clips[c.id];
  let next: Project = { ...p, clips };
  const moved: Clip[] = moving.map((c) => {
    let trackId = c.trackId;
    if (opts.targetTrackId && c.id === opts.primaryId) {
      const target = getTrack(p, opts.targetTrackId);
      if (trackAcceptsClip(target, c, p)) trackId = target.id;
    }
    const track = getTrack(p, trackId);
    if (track.locked) throw new EditError(`La pista «${track.name}» está bloqueada.`);
    return { ...c, start: c.start + d, trackId };
  });
  const movedIds = new Set(moved.map((c) => c.id));
  for (const c of moved) next = clearRange(next, c.trackId, c.start, clipEnd(c), movedIds);
  const finalClips = { ...next.clips };
  for (const c of moved) finalClips[c.id] = c;
  return touch(pruneTransitions(relinkCuesAfterEdit({ ...next, clips: finalClips })));
}

/** Recorta el inicio (edge='start') o el final (edge='end') hasta el instante t. Afecta a los vinculados. */
export function trimClip(p: Project, clipId: string, edge: 'start' | 'end', t: Ticks, opts: { linked?: boolean } = {}): Project {
  const ids = opts.linked === false ? [clipId] : expandLinked(p, [clipId]);
  const main = getClip(p, clipId);
  const delta = edge === 'start' ? t - main.start : t - clipEnd(main);
  let next = p;
  const touched = new Set(ids);
  for (const id of ids) {
    const c = getClip(next, id);
    const updated = edge === 'start' ? withStart(next, c, c.start + delta) : withEnd(next, c, clipEnd(c) + delta);
    next = { ...next, clips: { ...next.clips, [id]: updated } };
    next = clearRange(next, updated.trackId, updated.start, clipEnd(updated), touched);
  }
  return touch(pruneTransitions(relinkCuesAfterEdit(next)));
}

/** Divide en el instante t los clips indicados (o todos los que lo cruzan si ids está vacío). */
export function splitAt(p: Project, t: Ticks, ids?: string[]): { project: Project; created: string[] } {
  const candidates = (ids && ids.length ? expandLinked(p, ids).map((id) => getClip(p, id)) : Object.values(p.clips)).filter(
    (c) => c.start + MIN_CLIP < t && clipEnd(c) - MIN_CLIP > t && !getTrack(p, c.trackId).locked,
  );
  if (!candidates.length) return { project: p, created: [] };
  const clips = { ...p.clips };
  const transitions = { ...p.transitions };
  const newGroups = new Map<string, string>();
  const created: string[] = [];
  const pieceMap = new Map<string, string>();
  for (const c of candidates) {
    const left = withEnd(p, c, t);
    let right = { ...withStart(p, c, t), id: newId('clp') } as Clip;
    if (c.linkGroupId) {
      if (!newGroups.has(c.linkGroupId)) newGroups.set(c.linkGroupId, newId('lnk'));
      right = { ...right, linkGroupId: newGroups.get(c.linkGroupId)! };
    }
    // Fundidos: el de entrada queda en la izquierda y el de salida en la derecha.
    if ('fadeOut' in left) (left as { fadeOut: number }).fadeOut = 0;
    if ('fadeIn' in right) (right as { fadeIn: number }).fadeIn = 0;
    if (left.kind === 'media' && right.kind === 'media') {
      left.audio = { ...left.audio, fadeOut: 0 };
      right.audio = { ...right.audio, fadeIn: 0 };
    }
    clips[left.id] = left;
    clips[right.id] = right;
    created.push(right.id);
    pieceMap.set(c.id, right.id);
    for (const tr of Object.values(transitions)) {
      if (tr.fromClipId === c.id) transitions[tr.id] = { ...tr, fromClipId: right.id };
    }
  }
  let next: Project = { ...p, clips, transitions };
  // Subtítulos vinculados: pasan a la pieza derecha si su inicio queda en ella.
  next = {
    ...next,
    subtitles: {
      ...next.subtitles,
      cues: next.subtitles.cues.map((cue) => {
        if (!cue.link) return cue;
        const rightId = pieceMap.get(cue.link.clipId);
        if (!rightId) return cue;
        const right = clips[rightId];
        if (right?.kind === 'media' && cue.link.sourceStart >= right.sourceIn) {
          return { ...cue, link: { ...cue.link, clipId: rightId } };
        }
        return cue;
      }),
    },
  };
  return { project: touch(pruneTransitions(relinkCuesAfterEdit(next))), created };
}

export function deleteClips(p: Project, ids: string[], opts: { ripple?: boolean; linked?: boolean } = {}): Project {
  const all = opts.linked === false ? ids : expandLinked(p, ids);
  const clips = { ...p.clips };
  const removed = all.map((id) => getClip(p, id));
  for (const c of removed) delete clips[c.id];
  // Los subtítulos vinculados conservan su última posición y quedan libres.
  const resolved = resolveCues(p);
  const cues = p.subtitles.cues.map((cue, i) =>
    cue.link && removed.some((c) => c.id === cue.link!.clipId)
      ? { ...cue, start: resolved[i]!.start, end: resolved[i]!.end, link: null }
      : cue,
  );
  let next: Project = { ...p, clips, subtitles: { ...p.subtitles, cues } };
  if (opts.ripple) {
    for (const c of removed) {
      const gapStart = c.start;
      const gap = clipDuration(c);
      const after = clipsOnTrack(next, c.trackId).filter((x) => x.start >= gapStart);
      const nc = { ...next.clips };
      for (const x of after) nc[x.id] = { ...x, start: x.start - gap };
      next = { ...next, clips: nc };
    }
  }
  return touch(pruneTransitions(relinkCuesAfterEdit(next)));
}

export function duplicateClips(p: Project, ids: string[]): { project: Project; created: string[] } {
  const all = expandLinked(p, ids).map((id) => getClip(p, id));
  const end = Math.max(...all.map(clipEnd));
  const start = Math.min(...all.map((c) => c.start));
  const offset = end - start;
  const groups = new Map<string, string>();
  let next = p;
  const created: string[] = [];
  for (const c of all) {
    const group = c.linkGroupId ? (groups.get(c.linkGroupId) ?? groups.set(c.linkGroupId, newId('lnk')).get(c.linkGroupId)!) : null;
    const copy = { ...structuredClone(c), id: newId('clp'), start: c.start + offset, linkGroupId: group } as Clip;
    next = insertClip(next, copy);
    created.push(copy.id);
  }
  return { project: next, created };
}

export function updateClip(p: Project, clipId: string, patch: Partial<Clip>): Project {
  const c = getClip(p, clipId);
  const updated = { ...c, ...patch, id: c.id, kind: c.kind } as Clip;
  let next: Project = { ...p, clips: { ...p.clips, [clipId]: updated } };
  if (patch.start !== undefined || (updated.kind === 'media' && ('speed' in patch || 'sourceOut' in patch || 'sourceIn' in patch)) || 'duration' in patch) {
    next = clearRange(next, updated.trackId, updated.start, clipEnd(updated), new Set([clipId]));
  }
  return touch(pruneTransitions(relinkCuesAfterEdit(next)));
}

export function unlinkClips(p: Project, ids: string[]): Project {
  const all = expandLinked(p, ids);
  const clips = { ...p.clips };
  for (const id of all) clips[id] = { ...getClip(p, id), linkGroupId: null };
  return touch({ ...p, clips });
}

/** Cambia la velocidad conservando el inicio. Aplica a los vinculados (imagen y sonido iguales). */
export function setSpeed(p: Project, clipId: string, speed: MediaClip['speed']): Project {
  let next = p;
  for (const id of expandLinked(p, [clipId])) {
    const c = getClip(next, id);
    if (c.kind !== 'media') continue;
    const updated: MediaClip = { ...c, speed };
    next = { ...next, clips: { ...next.clips, [id]: updated } };
    next = clearRange(next, updated.trackId, updated.start, clipEnd(updated), new Set([id]));
  }
  return touch(pruneTransitions(relinkCuesAfterEdit(next)));
}

// ---------- transiciones ----------

/** Devuelve null si la transición es válida o un mensaje que explica por qué no. */
export function validateTransition(p: Project, tr: Pick<Transition, 'fromClipId' | 'toClipId' | 'duration'>): string | null {
  const a = p.clips[tr.fromClipId];
  const b = p.clips[tr.toClipId];
  if (!a || !b) return 'Uno de los clips ya no existe.';
  if (a.trackId !== b.trackId) return 'Los clips deben estar en la misma pista.';
  if (Math.abs(clipEnd(a) - b.start) > 1) return 'Los clips deben estar contiguos.';
  const half = tr.duration / 2;
  if (tr.duration <= 0) return 'La duración debe ser mayor que cero.';
  if (half > clipDuration(a) || half > clipDuration(b)) return 'La transición es más larga que uno de los clips.';
  if (a.kind === 'media') {
    const asset = p.assets[a.assetId];
    const need = localToSource(a, mediaClipDuration(a) + half);
    if (asset && need > asset.duration + 1) {
      return `Falta material al final de «${a.name}»: se necesitan ${(half / 705_600_000).toFixed(2)} s extra.`;
    }
  }
  if (b.kind === 'media') {
    const need = localToSource(b, -half);
    if (need < -1) return `Falta material al inicio de «${b.name}»: recorta su entrada al menos ${(half / 705_600_000).toFixed(2)} s.`;
  }
  return null;
}

/** Duración máxima posible para una transición entre dos clips contiguos. */
export function maxTransitionDuration(p: Project, fromClipId: string, toClipId: string): Ticks {
  let lo = 0;
  let hi = Math.min(clipDuration(getClip(p, fromClipId)), clipDuration(getClip(p, toClipId))) * 2;
  for (let i = 0; i < 40; i++) {
    const mid = Math.floor((lo + hi) / 2);
    if (validateTransition(p, { fromClipId, toClipId, duration: mid }) === null) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function addTransition(p: Project, fromClipId: string, toClipId: string, duration: Ticks): { project: Project; id: string } {
  const err = validateTransition(p, { fromClipId, toClipId, duration });
  if (err) throw new EditError(err);
  const existing = Object.values(p.transitions).find((t) => t.fromClipId === fromClipId && t.toClipId === toClipId);
  const id = existing?.id ?? newId('trn');
  const tr: Transition = { id, kind: 'dissolve', fromClipId, toClipId, duration };
  return { project: touch({ ...p, transitions: { ...p.transitions, [id]: tr } }), id };
}

export function removeTransition(p: Project, id: string): Project {
  const transitions = { ...p.transitions };
  delete transitions[id];
  return touch({ ...p, transitions });
}

/** Busca el clip contiguo siguiente en la misma pista. */
export function nextAdjacentClip(p: Project, clipId: string): Clip | null {
  const c = getClip(p, clipId);
  const end = clipEnd(c);
  return clipsOnTrack(p, c.trackId).find((x) => x.id !== c.id && Math.abs(x.start - end) <= 1) ?? null;
}

// ---------- subtítulos ----------

/** Tiempos efectivos de cada subtítulo en el montaje (vinculados o libres). */
export function resolveCues(p: Project): { id: string; start: Ticks; end: Ticks; text: string; visible: boolean }[] {
  return p.subtitles.cues.map((cue) => {
    if (!cue.link) return { id: cue.id, start: cue.start, end: cue.end, text: cue.text, visible: true };
    const clip = p.clips[cue.link.clipId];
    if (!clip || clip.kind !== 'media') return { id: cue.id, start: cue.start, end: cue.end, text: cue.text, visible: true };
    const s = Math.max(cue.link.sourceStart, clip.sourceIn);
    const e = Math.min(cue.link.sourceEnd, clip.sourceOut);
    if (e <= s) return { id: cue.id, start: cue.start, end: cue.end, text: cue.text, visible: false };
    return { id: cue.id, start: sourceToProject(clip, s), end: sourceToProject(clip, e), text: cue.text, visible: true };
  });
}

/**
 * Tras una edición, un subtítulo vinculado cuyo tramo cayó en otra pieza
 * del mismo recurso (por ejemplo tras dividir) se vuelve a vincular a esa pieza.
 */
function relinkCuesAfterEdit(p: Project): Project {
  let changed = false;
  const cues = p.subtitles.cues.map((cue) => {
    if (!cue.link) return cue;
    const clip = p.clips[cue.link.clipId];
    if (clip && clip.kind === 'media' && cue.link.sourceStart >= clip.sourceIn && cue.link.sourceStart < clip.sourceOut) return cue;
    const assetId = clip?.kind === 'media' ? clip.assetId : null;
    const trackId = clip?.trackId;
    if (!assetId) return cue;
    const other = Object.values(p.clips).find(
      (c) =>
        c.kind === 'media' &&
        c.assetId === assetId &&
        c.trackId === trackId &&
        cue.link!.sourceStart >= c.sourceIn &&
        cue.link!.sourceStart < c.sourceOut,
    );
    if (!other) return cue;
    changed = true;
    return { ...cue, link: { ...cue.link, clipId: other.id } };
  });
  return changed ? { ...p, subtitles: { ...p.subtitles, cues } } : p;
}

export function addCue(p: Project, cue: Omit<Cue, 'id'> & { id?: string }): { project: Project; id: string } {
  if (cue.end <= cue.start) throw new EditError('La salida debe ser posterior a la entrada.');
  const id = cue.id ?? newId('cue');
  const cues = [...p.subtitles.cues, { ...cue, id }].sort((a, b) => a.start - b.start);
  return { project: touch({ ...p, subtitles: { ...p.subtitles, cues } }), id };
}

export function updateCue(p: Project, id: string, patch: Partial<Omit<Cue, 'id'>>): Project {
  const cues = p.subtitles.cues.map((c) => {
    if (c.id !== id) return c;
    const next = { ...c, ...patch };
    // Editar tiempos a mano de un subtítulo vinculado actualiza su tramo de origen.
    if (c.link && (patch.start !== undefined || patch.end !== undefined)) {
      const clip = p.clips[c.link.clipId];
      if (clip?.kind === 'media') {
        next.link = {
          clipId: clip.id,
          sourceStart: Math.round(localToSource(clip, next.start - clip.start)),
          sourceEnd: Math.round(localToSource(clip, next.end - clip.start)),
        };
      }
    }
    if (next.end <= next.start) throw new EditError('La salida debe ser posterior a la entrada.');
    return next;
  });
  return touch({ ...p, subtitles: { ...p.subtitles, cues: cues.sort((a, b) => a.start - b.start) } });
}

export function deleteCue(p: Project, id: string): Project {
  return touch({ ...p, subtitles: { ...p.subtitles, cues: p.subtitles.cues.filter((c) => c.id !== id) } });
}

/** Vincula subtítulos al clip de medio que los contiene, para que sigan cortes y velocidad. */
export function linkCuesToClip(p: Project, cueIds: string[], clipId: string): Project {
  const clip = getClip(p, clipId);
  if (clip.kind !== 'media') throw new EditError('Solo se puede vincular a clips de video o audio.');
  const cues = p.subtitles.cues.map((c) => {
    if (!cueIds.includes(c.id)) return c;
    return {
      ...c,
      link: {
        clipId,
        sourceStart: Math.round(localToSource(clip, c.start - clip.start)),
        sourceEnd: Math.round(localToSource(clip, c.end - clip.start)),
      },
    };
  });
  return touch({ ...p, subtitles: { ...p.subtitles, cues } });
}

// ---------- ajuste magnético ----------

export interface SnapResult {
  t: Ticks;
  snapped: boolean;
  target: Ticks | null;
  label: string | null;
}

/** Puntos de ajuste: inicio, cabezal, bordes de clips y subtítulos. */
export function snapCandidates(p: Project, excludeIds: Set<string>, playhead: Ticks): { t: Ticks; label: string }[] {
  const out: { t: Ticks; label: string }[] = [
    { t: 0, label: 'Inicio' },
    { t: playhead, label: 'Cabezal' },
  ];
  for (const c of Object.values(p.clips)) {
    if (excludeIds.has(c.id)) continue;
    out.push({ t: c.start, label: `Inicio de «${c.name}»` });
    out.push({ t: clipEnd(c), label: `Final de «${c.name}»` });
  }
  return out;
}

export function snap(t: Ticks, candidates: { t: Ticks; label: string }[], threshold: Ticks): SnapResult {
  let best: { t: Ticks; label: string } | null = null;
  let bestD = threshold + 1;
  for (const c of candidates) {
    const d = Math.abs(c.t - t);
    if (d <= threshold && d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best ? { t: best.t, snapped: true, target: best.t, label: best.label } : { t, snapped: false, target: null, label: null };
}

/** Abre un hueco: desplaza duration ticks todo lo que empieza en at o después (todas las pistas). */
export function insertGap(p: Project, at: Ticks, duration: Ticks): Project {
  const clips = { ...p.clips };
  for (const c of Object.values(p.clips)) if (c.start >= at) clips[c.id] = { ...c, start: c.start + duration };
  const cues = p.subtitles.cues.map((c) => (!c.link && c.start >= at ? { ...c, start: c.start + duration, end: c.end + duration } : c));
  return touch({ ...p, clips, subtitles: { ...p.subtitles, cues } });
}
