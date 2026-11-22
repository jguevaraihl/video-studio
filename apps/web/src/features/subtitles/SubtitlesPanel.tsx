/** Subtítulos: edición de tiempos y texto, SRT/WebVTT, vínculo a clips y quemado en el video. */
import { useRef } from 'react';
import {
  addCue,
  clipEnd,
  deleteCue,
  linkCuesToClip,
  parseSubtitles,
  resolveCues,
  secondsToTicks,
  ticksToSeconds,
  toSrt,
  toVtt,
  updateCue,
  type Project,
} from '@vs/project';
import { useStore } from '../../state/store.ts';
import { Button, Notice, Slider, inputClass } from '../../ui/kit.tsx';
import { downloadBlob } from '../../lib/download.ts';
import { seek } from '../../lib/player-instance.ts';
import { TranscribeButton } from '../generate/TranscribeButton.tsx';

export function SubtitlesPanel() {
  const project = useStore((s) => s.project)!;
  const selected = useStore((s) => s.selectedCueId);
  const playhead = useStore((s) => s.playhead);
  const st = useStore.getState();
  const fileRef = useRef<HTMLInputElement>(null);
  const resolved = resolveCues(project);
  const subs = project.subtitles;

  const mediaClipAtPlayhead = (p: Project) =>
    Object.values(p.clips).find((c) => c.kind === 'media' && p.tracks.find((t) => t.id === c.trackId)?.kind !== 'audio' && c.start <= playhead && clipEnd(c) > playhead);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="primary" data-testid="add-cue" onClick={() => st.apply((p) => { const r = addCue(p, { start: playhead, end: playhead + secondsToTicks(2), text: 'Nuevo subtítulo', link: null }); st.selectCue(r.id); return r.project; })}>+ En el cabezal</Button>
        <Button size="sm" onClick={() => fileRef.current?.click()}>Importar SRT/VTT</Button>
        <Button size="sm" disabled={!subs.cues.length} onClick={() => downloadBlob(new Blob([toSrt(resolved.filter((c) => c.visible))], { type: 'application/x-subrip' }), `${project.name}.srt`)}>SRT</Button>
        <Button size="sm" disabled={!subs.cues.length} onClick={() => downloadBlob(new Blob([toVtt(resolved.filter((c) => c.visible))], { type: 'text/vtt' }), `${project.name}.vtt`)}>VTT</Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".srt,.vtt,text/vtt"
        className="hidden"
        aria-label="Importar subtítulos"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const cues = parseSubtitles(f.name, await f.text());
            st.apply((p) => cues.reduce((acc, c) => addCue(acc, { ...c, link: null }).project, p), 'Subtítulos');
            st.toast(`${cues.length} subtítulos importados.`, 'success');
          } catch (err) {
            st.toast(err instanceof Error ? err.message : String(err), 'error');
          }
        }}
      />
      <TranscribeButton />
      <label className="flex items-center gap-2 text-xs text-ink-200">
        <input type="checkbox" checked={subs.burnIn} data-testid="burn-in" onChange={(e) => st.apply((p) => ({ ...p, subtitles: { ...p.subtitles, burnIn: e.target.checked } }))} />
        Quemar subtítulos en el video exportado
      </label>
      <label className="flex items-center gap-2 text-xs text-ink-200">
        <input type="checkbox" checked={subs.visibleInViewer} onChange={(e) => st.apply((p) => ({ ...p, subtitles: { ...p.subtitles, visibleInViewer: e.target.checked } }))} />
        Mostrar en el visor
      </label>
      <Slider label="Tamaño" min={0.025} max={0.12} step={0.005} value={subs.style.fontSize} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => st.patchSilently((p) => ({ ...p, subtitles: { ...p.subtitles, style: { ...p.subtitles.style, fontSize: v } } }))} />
      <Slider label="Margen inferior" min={0} max={0.4} step={0.01} value={subs.style.bottom} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => st.patchSilently((p) => ({ ...p, subtitles: { ...p.subtitles, style: { ...p.subtitles.style, bottom: v } } }))} />
      {subs.cues.length === 0 && <Notice>No hay subtítulos. Agrega uno, impórtalos o transcribe el audio con IA.</Notice>}
      <ul className="flex flex-col gap-2">
        {subs.cues.map((cue, i) => {
          const r = resolved[i]!;
          return (
            <li key={cue.id} className={`rounded-lg border p-2 ${selected === cue.id ? 'border-fuchsia-500 bg-fuchsia-950/20' : 'border-ink-800'}`} onClick={() => st.selectCue(cue.id)}>
              <div className="mb-1 flex items-center gap-1 text-[11px] text-ink-400">
                <button className="hover:text-white" onClick={() => seek(r.start)} aria-label="Ir al subtítulo">▶</button>
                <label className="flex items-center gap-1">
                  Entrada
                  <input aria-label="Entrada (s)" type="number" step={0.04} className={`${inputClass} h-6 w-16 text-xs`} value={ticksToSeconds(r.start).toFixed(2)} onChange={(e) => st.apply((p) => updateCue(p, cue.id, { start: secondsToTicks(Number(e.target.value)), end: r.end }), 'Subtítulo')} />
                </label>
                <label className="flex items-center gap-1">
                  Salida
                  <input aria-label="Salida (s)" type="number" step={0.04} className={`${inputClass} h-6 w-16 text-xs`} value={ticksToSeconds(r.end).toFixed(2)} onChange={(e) => st.apply((p) => updateCue(p, cue.id, { start: r.start, end: secondsToTicks(Number(e.target.value)) }), 'Subtítulo')} />
                </label>
                <button className="ml-auto text-ink-500 hover:text-rose-400" aria-label="Borrar subtítulo" onClick={(e) => { e.stopPropagation(); st.apply((p) => deleteCue(p, cue.id)); }}>✕</button>
              </div>
              <textarea aria-label="Texto del subtítulo" className={`${inputClass} h-12 w-full py-1 text-xs`} value={cue.text} onChange={(e) => st.patchSilently((p) => updateCue(p, cue.id, { text: e.target.value }))} />
              <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-500">
                {cue.link ? (
                  <>
                    <span>Vinculado a «{project.clips[cue.link.clipId]?.name ?? 'clip'}»{!r.visible && ' (fuera del tramo visible)'}</span>
                    <button className="underline" onClick={() => st.apply((p) => updateCue(p, cue.id, { link: null, start: r.start, end: r.end }))}>Desvincular</button>
                  </>
                ) : (
                  <button
                    className="underline"
                    onClick={() => {
                      const c = mediaClipAtPlayhead(project);
                      if (!c) return st.toast('Coloca el cabezal sobre un clip de video para vincular.', 'error');
                      st.apply((p) => linkCuesToClip(p, [cue.id], c.id), 'Vincular');
                    }}
                  >
                    Vincular al clip del cabezal (sigue cortes y velocidad)
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
