/**
 * Comandos tipados que el asistente puede proponer.
 * El modelo devuelve JSON; aquí se valida forma, rangos y referencias.
 * La interfaz muestra la lista y aplica todo como una sola operación deshacible.
 */
import { z } from 'zod';
import type { Project } from './schema.ts';
import { addTextClip, addTransition, EditError, getClip, nextAdjacentClip, splitAt, trimClip, updateClip, deleteClips, setSpeed } from './ops.ts';
import { clipDuration, clipEnd } from './timing.ts';
import { secondsToTicks, ticksToSeconds } from './time.ts';

const clipRef = z.string().min(1);
const seconds = z.number().finite();

export const EditCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('trimEnd'), clipId: clipRef, seconds: seconds.positive().max(3600) }),
  z.object({ type: z.literal('trimStart'), clipId: clipRef, seconds: seconds.positive().max(3600) }),
  z.object({ type: z.literal('split'), atSeconds: seconds.nonnegative() }),
  z.object({ type: z.literal('fade'), clipId: clipRef, edge: z.enum(['in', 'out']), seconds: seconds.positive().max(30) }),
  z.object({ type: z.literal('dissolveToNext'), clipId: clipRef, seconds: seconds.positive().max(10) }),
  z.object({ type: z.literal('setVolume'), clipId: clipRef, gainDb: z.number().min(-60).max(24) }),
  z.object({ type: z.literal('mute'), clipId: clipRef, muted: z.boolean() }),
  z.object({ type: z.literal('setSpeed'), clipId: clipRef, rate: z.number().min(0.1).max(16) }),
  z.object({
    type: z.literal('color'),
    clipId: clipRef,
    brightness: z.number().min(-1).max(1).optional(),
    contrast: z.number().min(-1).max(1).optional(),
    saturation: z.number().min(-1).max(1).optional(),
    temperature: z.number().min(-1).max(1).optional(),
  }),
  z.object({ type: z.literal('addTitle'), text: z.string().min(1).max(200), atSeconds: seconds.nonnegative(), durationSeconds: seconds.positive().max(60) }),
  z.object({ type: z.literal('deleteClip'), clipId: clipRef }),
]);
export type EditCommand = z.infer<typeof EditCommandSchema>;

export const EditProposalSchema = z.object({
  explanation: z.string().max(2000).default(''),
  commands: z.array(EditCommandSchema).max(20),
});
export type EditProposal = z.infer<typeof EditProposalSchema>;

/** Descripción en español de cada comando, para mostrarla antes de aplicar. */
export function describeCommand(p: Project, c: EditCommand): string {
  const name = 'clipId' in c ? `«${p.clips[c.clipId]?.name ?? c.clipId}»` : '';
  switch (c.type) {
    case 'trimEnd':
      return `Cortar los últimos ${c.seconds} s de ${name}`;
    case 'trimStart':
      return `Cortar los primeros ${c.seconds} s de ${name}`;
    case 'split':
      return `Dividir en ${c.atSeconds} s`;
    case 'fade':
      return `Fundido de ${c.edge === 'in' ? 'entrada' : 'salida'} de ${c.seconds} s en ${name}`;
    case 'dissolveToNext':
      return `Disolución de ${c.seconds} s entre ${name} y el clip siguiente`;
    case 'setVolume':
      return `Volumen de ${name} a ${c.gainDb} dB`;
    case 'mute':
      return `${c.muted ? 'Silenciar' : 'Activar sonido de'} ${name}`;
    case 'setSpeed':
      return `Velocidad de ${name} a ${c.rate}×`;
    case 'color':
      return `Ajustar color de ${name}`;
    case 'addTitle':
      return `Título «${c.text}» en ${c.atSeconds} s durante ${c.durationSeconds} s`;
    case 'deleteClip':
      return `Borrar ${name}`;
  }
}

/** Aplica comandos en orden. Lanza EditError con el número de comando si alguno no es válido. */
export function applyCommands(p: Project, commands: EditCommand[]): Project {
  let next = p;
  commands.forEach((c, i) => {
    try {
      next = applyOne(next, c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new EditError(`Comando ${i + 1} (${c.type}): ${msg}`);
    }
  });
  return next;
}

function applyOne(p: Project, c: EditCommand): Project {
  switch (c.type) {
    case 'trimEnd': {
      const clip = getClip(p, c.clipId);
      const d = secondsToTicks(c.seconds);
      if (d >= clipDuration(clip)) throw new EditError(`El clip dura ${ticksToSeconds(clipDuration(clip)).toFixed(2)} s.`);
      return trimClip(p, clip.id, 'end', clipEnd(clip) - d);
    }
    case 'trimStart': {
      const clip = getClip(p, c.clipId);
      const d = secondsToTicks(c.seconds);
      if (d >= clipDuration(clip)) throw new EditError(`El clip dura ${ticksToSeconds(clipDuration(clip)).toFixed(2)} s.`);
      return trimClip(p, clip.id, 'start', clip.start + d);
    }
    case 'split':
      return splitAt(p, secondsToTicks(c.atSeconds)).project;
    case 'fade': {
      const clip = getClip(p, c.clipId);
      const d = Math.min(secondsToTicks(c.seconds), clipDuration(clip));
      const key = c.edge === 'in' ? 'fadeIn' : 'fadeOut';
      let next = updateClip(p, clip.id, { [key]: d } as never);
      if (clip.linkGroupId) {
        for (const other of Object.values(next.clips)) {
          if (other.linkGroupId === clip.linkGroupId && other.kind === 'media' && other.id !== clip.id) {
            next = updateClip(next, other.id, { audio: { ...other.audio, [key]: d } } as never);
          }
        }
      }
      if (clip.kind === 'media') {
        const cur = next.clips[clip.id];
        if (cur?.kind === 'media') next = updateClip(next, clip.id, { audio: { ...cur.audio, [key]: d } } as never);
      }
      return next;
    }
    case 'dissolveToNext': {
      const nxt = nextAdjacentClip(p, c.clipId);
      if (!nxt) throw new EditError('No hay un clip contiguo después.');
      return addTransition(p, c.clipId, nxt.id, secondsToTicks(c.seconds)).project;
    }
    case 'setVolume': {
      const clip = getClip(p, c.clipId);
      if (clip.kind !== 'media') throw new EditError('El clip no tiene audio.');
      return updateClip(p, clip.id, { audio: { ...clip.audio, gainDb: c.gainDb } } as never);
    }
    case 'mute': {
      const clip = getClip(p, c.clipId);
      if (clip.kind !== 'media') throw new EditError('El clip no tiene audio.');
      return updateClip(p, clip.id, { audio: { ...clip.audio, muted: c.muted } } as never);
    }
    case 'setSpeed': {
      const clip = getClip(p, c.clipId);
      if (clip.kind !== 'media') throw new EditError('Solo los clips de video o audio tienen velocidad.');
      return setSpeed(p, clip.id, { mode: 'constant', rate: c.rate, preservePitch: true });
    }
    case 'color': {
      const clip = getClip(p, c.clipId);
      if (clip.kind === 'text') throw new EditError('Los textos no tienen corrección de color.');
      const { type: _t, clipId: _c, ...rest } = c;
      return updateClip(p, clip.id, { color: { ...clip.color, ...rest } } as never);
    }
    case 'addTitle':
      return addTextClip(p, c.text, secondsToTicks(c.atSeconds), secondsToTicks(c.durationSeconds)).project;
    case 'deleteClip':
      getClip(p, c.clipId);
      return deleteClips(p, [c.clipId]);
  }
}

/** Resumen compacto del proyecto para el asistente (sin rutas ni datos de archivos). */
export function projectSummaryForAssistant(p: Project): string {
  const tracks = p.tracks.map((t) => {
    const clips = Object.values(p.clips)
      .filter((c) => c.trackId === t.id)
      .sort((a, b) => a.start - b.start)
      .map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        start: +ticksToSeconds(c.start).toFixed(3),
        duration: +ticksToSeconds(clipDuration(c)).toFixed(3),
      }));
    return { track: t.name, kind: t.kind, clips };
  });
  return JSON.stringify({ fps: p.settings.fps, width: p.settings.width, height: p.settings.height, tracks });
}
