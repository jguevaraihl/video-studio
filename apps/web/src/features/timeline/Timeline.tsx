/** Línea de tiempo multipista: zoom, desplazamiento, cabezal, arrastre con ajuste magnético y recortes. */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TICKS_PER_SECOND,
  addTrack,
  clipDuration,
  clipEnd,
  deleteClips,
  duplicateClips,
  moveClips,
  projectDuration,
  resolveCues,
  snap,
  snapCandidates,
  splitAt,
  trimClip,
  unlinkClips,
  updateTrack,
  type Clip,
  type Project,
  type Track,
} from '@vs/project';
import { useStore } from '../../state/store.ts';
import { seek } from '../../lib/player-instance.ts';
import { IconButton } from '../../ui/kit.tsx';
import { ICopy, IEye, IEyeOff, ILock, IMagnet, IMute, IPlus, IScissors, ITrash, IVolume } from '../../ui/icons.tsx';
import { ClipVisual } from './ClipVisual.tsx';

const HEADER_W = 156;
const RULER_H = 26;
const ROW_H: Record<Track['kind'], number> = { video: 58, overlay: 50, text: 36, audio: 50 };
const CUE_ROW_H = 30;

interface DragState {
  kind: 'move' | 'trim-start' | 'trim-end';
  clipId: string;
  ids: string[];
  startX: number;
  origStart: number;
  origEnd: number;
  linked: boolean;
  moved: boolean;
}

export function Timeline({ compact }: { compact?: boolean }) {
  const project = useStore((s) => s.project)!;
  const zoom = useStore((s) => s.zoom);
  const playhead = useStore((s) => s.playhead);
  const selection = useStore((s) => s.selection);
  const snapping = useStore((s) => s.snapping);
  const selectedCueId = useStore((s) => s.selectedCueId);
  const selectedTransitionId = useStore((s) => s.selectedTransitionId);
  const inOut = useStore((s) => s.inOut);
  const st = useStore.getState();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [snapLine, setSnapLine] = useState<{ t: number; label: string } | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const tracks = useMemo(() => [...project.tracks].reverse(), [project.tracks]); // visual: arriba la capa superior
  const duration = projectDuration(project);
  const widthPx = Math.max(1200, ((duration / TICKS_PER_SECOND) + 30) * zoom);
  const tToX = useCallback((t: number) => (t / TICKS_PER_SECOND) * zoom, [zoom]);
  const xToT = useCallback((x: number) => Math.max(0, Math.round((x / zoom) * TICKS_PER_SECOND)), [zoom]);

  const rowTops = useMemo(() => {
    const tops: { track: Track; top: number; h: number }[] = [];
    let y = 0;
    for (const t of tracks) {
      const h = compact ? Math.min(44, ROW_H[t.kind]) : ROW_H[t.kind];
      tops.push({ track: t, top: y, h });
      y += h;
    }
    return { tops, total: y };
  }, [tracks, compact]);

  // Ctrl + rueda: zoom centrado en el puntero.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left + el.scrollLeft;
      const tAt = xToT(x);
      const z = useStore.getState().zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15);
      useStore.getState().setZoom(z);
      requestAnimationFrame(() => {
        el.scrollLeft = (tAt / TICKS_PER_SECOND) * useStore.getState().zoom - (e.clientX - rect.left);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [xToT]);

  const snapThreshold = (8 / zoom) * TICKS_PER_SECOND;

  const onClipPointerDown = (e: React.PointerEvent, clip: Clip, kind: DragState['kind']) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const track = project.tracks.find((t) => t.id === clip.trackId);
    if (!selection.includes(clip.id)) st.select([clip.id], e.shiftKey);
    if (track?.locked) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const ids = selection.includes(clip.id) && kind === 'move' ? selection : [clip.id];
    dragRef.current = { kind, clipId: clip.id, ids, startX: e.clientX, origStart: clip.start, origEnd: clipEnd(clip), linked: !e.altKey, moved: false };
    st.beginGesture();
  };

  const trackAtY = (clientY: number): Track | null => {
    const el = scrollRef.current;
    if (!el) return null;
    const y = clientY - el.getBoundingClientRect().top + el.scrollTop - RULER_H;
    return rowTops.tops.find((r) => y >= r.top && y < r.top + r.h)?.track ?? null;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < 3 && d.kind === 'move' && !trackAtY(e.clientY)) return;
    d.moved = true;
    const base = useStore.getState().gestureBase!;
    const exclude = new Set(d.linked ? d.ids.flatMap((id) => [id, ...Object.values(base.clips).filter((c) => c.linkGroupId && c.linkGroupId === base.clips[id]?.linkGroupId).map((c) => c.id)]) : d.ids);
    const cands = snapping ? snapCandidates(base, exclude, useStore.getState().playhead) : [];
    let delta = Math.round((dx / zoom) * TICKS_PER_SECOND);
    let shown: { t: number; label: string } | null = null;
    if (d.kind === 'move') {
      if (snapping) {
        const a = snap(d.origStart + delta, cands, snapThreshold);
        const b = snap(d.origEnd + delta, cands, snapThreshold);
        if (a.snapped && (!b.snapped || Math.abs(a.t - (d.origStart + delta)) <= Math.abs(b.t - (d.origEnd + delta)))) {
          delta = a.t - d.origStart;
          shown = { t: a.t, label: a.label! };
        } else if (b.snapped) {
          delta = b.t - d.origEnd;
          shown = { t: b.t, label: b.label! };
        }
      }
      const target = trackAtY(e.clientY);
      st.updateGesture((p) => moveClips(p, d.ids, delta, { primaryId: d.clipId, targetTrackId: target?.id, linked: d.linked }));
    } else {
      const edgeT = (d.kind === 'trim-start' ? d.origStart : d.origEnd) + delta;
      let t = edgeT;
      if (snapping) {
        const r = snap(edgeT, cands, snapThreshold);
        if (r.snapped) {
          t = r.t;
          shown = { t: r.t, label: r.label! };
        }
      }
      st.updateGesture((p) => trimClip(p, d.clipId, d.kind === 'trim-start' ? 'start' : 'end', t, { linked: d.linked }));
    }
    setSnapLine(shown);
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setSnapLine(null);
    st.endGesture(d.moved);
  };

  const onRulerDown = (e: React.PointerEvent) => {
    const el = scrollRef.current!;
    const update = (clientX: number) => seek(xToT(clientX - el.getBoundingClientRect().left + el.scrollLeft));
    update(e.clientX);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => update(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const cues = resolveCues(project);
  const linkedSel = selection.some((id) => project.clips[id]?.linkGroupId);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-ink-800 px-2 py-1">
        <IconButton label="Dividir en el cabezal" shortcut="S" onClick={() => st.apply((p) => splitAt(p, playhead, selection.length ? selection : undefined).project, 'Dividir')} data-testid="split"><IScissors /></IconButton>
        <IconButton label="Duplicar" shortcut="Ctrl+D" disabled={!selection.length} onClick={() => st.apply((p) => duplicateClips(p, selection).project, 'Duplicar')}><ICopy /></IconButton>
        <IconButton label="Borrar" shortcut="Supr" disabled={!selection.length} onClick={() => { st.apply((p) => deleteClips(p, selection), 'Borrar'); st.select([]); }}><ITrash /></IconButton>
        <IconButton label="Desvincular imagen y sonido" disabled={!linkedSel} onClick={() => st.apply((p) => unlinkClips(p, selection), 'Desvincular')}>⛓</IconButton>
        <span className="mx-1 h-5 w-px bg-ink-700" />
        <IconButton label="Ajuste magnético" shortcut="N" active={snapping} onClick={() => st.toggleSnapping()} data-testid="snap-toggle"><IMagnet /></IconButton>
        <span className="mx-1 h-5 w-px bg-ink-700" />
        {!compact && (
          <>
            <IconButton label="Agregar pista de video" onClick={() => st.apply((p) => addTrack(p, 'video'))}><IPlus /><span className="text-[10px]">V</span></IconButton>
            <IconButton label="Agregar pista de audio" onClick={() => st.apply((p) => addTrack(p, 'audio'))}><IPlus /><span className="text-[10px]">A</span></IconButton>
            <IconButton label="Agregar pista de texto" onClick={() => st.apply((p) => addTrack(p, 'text'))}><IPlus /><span className="text-[10px]">T</span></IconButton>
            <IconButton label="Agregar pista de superposición" onClick={() => st.apply((p) => addTrack(p, 'overlay'))}><IPlus /><span className="text-[10px]">S</span></IconButton>
          </>
        )}
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-xs text-ink-400">
          <span className="hidden sm:inline">Zoom</span>
          <input aria-label="Zoom de la línea de tiempo" type="range" min={8} max={800} value={zoom} onChange={(e) => st.setZoom(Number(e.target.value))} className="w-28" />
        </label>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="shrink-0 overflow-hidden border-r border-ink-800" style={{ width: compact ? 92 : HEADER_W }}>
          <div style={{ height: RULER_H }} className="border-b border-ink-800" />
          <TrackHeaders project={project} rows={rowTops.tops} compact={compact} scrollRef={scrollRef} />
        </div>
        <div
          ref={scrollRef}
          className="relative min-w-0 flex-1 overflow-auto"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerDown={() => st.select([])}
          data-testid="timeline-scroll"
        >
          <div style={{ width: widthPx, height: RULER_H + rowTops.total + CUE_ROW_H }} className="relative">
            <Ruler widthPx={widthPx} zoom={zoom} onPointerDown={onRulerDown} />
            {inOut.in !== null && inOut.out !== null && inOut.out > inOut.in && (
              <div className="pointer-events-none absolute z-0 bg-accent-400/10" style={{ left: tToX(inOut.in), width: tToX(inOut.out - inOut.in), top: 0, bottom: 0 }} />
            )}
            {rowTops.tops.map(({ track, top, h }) => (
              <div key={track.id} className={`absolute left-0 right-0 border-b border-ink-800/80 ${track.kind === 'audio' ? 'bg-emerald-950/10' : track.kind === 'text' ? 'bg-amber-950/10' : 'bg-sky-950/10'} ${track.locked ? 'opacity-60' : ''}`} style={{ top: RULER_H + top, height: h }} data-track={track.id} />
            ))}
            {Object.values(project.clips).map((clip) => {
              const row = rowTops.tops.find((r) => r.track.id === clip.trackId);
              if (!row) return null;
              return (
                <ClipBox
                  key={clip.id}
                  clip={clip}
                  project={project}
                  left={tToX(clip.start)}
                  width={Math.max(4, tToX(clipDuration(clip)))}
                  top={RULER_H + row.top + 2}
                  height={row.h - 4}
                  selected={selection.includes(clip.id)}
                  zoom={zoom}
                  onDown={onClipPointerDown}
                />
              );
            })}
            {Object.values(project.transitions).map((tr) => {
              const a = project.clips[tr.fromClipId];
              const row = a && rowTops.tops.find((r) => r.track.id === a.trackId);
              if (!a || !row) return null;
              const cut = clipEnd(a);
              return (
                <button
                  key={tr.id}
                  title={`Disolución ${(tr.duration / TICKS_PER_SECOND).toFixed(2)} s`}
                  aria-label="Transición de disolución"
                  onPointerDown={(e) => { e.stopPropagation(); st.selectTransition(tr.id); }}
                  className={`absolute z-20 rounded-sm border text-[9px] ${selectedTransitionId === tr.id ? 'border-white bg-brand-500' : 'border-brand-300/70 bg-brand-500/60'}`}
                  style={{ left: tToX(cut - tr.duration / 2), width: Math.max(8, tToX(tr.duration)), top: RULER_H + row.top + row.h / 2 - 7, height: 14 }}
                >⧖</button>
              );
            })}
            <div className="absolute left-0 right-0 border-t border-ink-800 bg-fuchsia-950/10" style={{ top: RULER_H + rowTops.total, height: CUE_ROW_H }}>
              {cues.map((c) => (
                <button
                  key={c.id}
                  onPointerDown={(e) => { e.stopPropagation(); st.selectCue(c.id); st.setLeftTab('subtitles'); }}
                  className={`absolute top-1 h-[22px] truncate rounded px-1 text-left text-[10px] ${c.visible ? '' : 'opacity-40'} ${selectedCueId === c.id ? 'bg-fuchsia-500 text-white' : 'bg-fuchsia-700/60 text-fuchsia-100'}`}
                  style={{ left: tToX(c.start), width: Math.max(6, tToX(c.end - c.start)) }}
                  title={c.text}
                >{c.text}</button>
              ))}
            </div>
            {snapLine && (
              <div className="pointer-events-none absolute top-0 z-30 w-px bg-yellow-300" style={{ left: tToX(snapLine.t), height: '100%' }} data-testid="snap-indicator">
                <span className="absolute left-1 top-7 whitespace-nowrap rounded bg-yellow-300 px-1 text-[10px] font-semibold text-black">{snapLine.label}</span>
              </div>
            )}
            <div className="pointer-events-none absolute top-0 z-40 w-px bg-rose-500" style={{ left: tToX(playhead), height: '100%' }}>
              <div className="absolute -left-1.5 top-0 h-3 w-3 rotate-45 bg-rose-500" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackHeaders({ project, rows, compact, scrollRef }: { project: Project; rows: { track: Track; top: number; h: number }[]; compact?: boolean; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const st = useStore.getState();
  const innerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => {
      if (innerRef.current) innerRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
    };
    el.addEventListener('scroll', sync);
    return () => el.removeEventListener('scroll', sync);
  }, [scrollRef]);
  return (
    <div ref={innerRef}>
      {rows.map(({ track, h }) => (
        <div key={track.id} className="flex items-center gap-0.5 border-b border-ink-800/80 px-1.5" style={{ height: h }}>
          <span className={`mr-auto truncate text-xs ${track.kind === 'audio' ? 'text-emerald-300' : track.kind === 'text' ? 'text-amber-300' : 'text-sky-300'}`} title={track.name}>{compact ? track.name.replace(/\D+/g, track.kind[0]!.toUpperCase()) : track.name}</span>
          {track.kind === 'audio' ? (
            <>
              <button aria-label={`Silenciar ${track.name}`} aria-pressed={track.muted} title="Silenciar pista (M)" className={`h-6 w-6 rounded text-[10px] font-bold ${track.muted ? 'bg-rose-600 text-white' : 'text-ink-400 hover:bg-ink-700'}`} onClick={() => st.apply((p) => updateTrack(p, track.id, { muted: !track.muted }))}>
                {track.muted ? <IMute /> : <IVolume />}
              </button>
              <button aria-label={`Solo ${track.name}`} aria-pressed={track.solo} title="Solo" className={`h-6 w-6 rounded text-[11px] font-bold ${track.solo ? 'bg-amber-500 text-black' : 'text-ink-400 hover:bg-ink-700'}`} onClick={() => st.apply((p) => updateTrack(p, track.id, { solo: !track.solo }))}>S</button>
            </>
          ) : (
            <button aria-label={`${track.hidden ? 'Mostrar' : 'Ocultar'} ${track.name}`} aria-pressed={track.hidden} className="h-6 w-6 rounded text-ink-400 hover:bg-ink-700" onClick={() => st.apply((p) => updateTrack(p, track.id, { hidden: !track.hidden }))}>
              {track.hidden ? <IEyeOff /> : <IEye />}
            </button>
          )}
          {!compact && (
            <button aria-label={`${track.locked ? 'Desbloquear' : 'Bloquear'} ${track.name}`} aria-pressed={track.locked} className={`h-6 w-6 rounded ${track.locked ? 'text-amber-300' : 'text-ink-500 hover:bg-ink-700'}`} onClick={() => st.apply((p) => updateTrack(p, track.id, { locked: !track.locked }))}>
              <ILock />
            </button>
          )}
        </div>
      ))}
      <div className="flex items-center px-2 text-xs text-fuchsia-300" style={{ height: CUE_ROW_H }}>Subtítulos</div>
      {project.tracks.length === 0 && <div className="p-2 text-xs text-ink-500">Sin pistas</div>}
    </div>
  );
}

const Ruler = memo(function Ruler({ widthPx, zoom, onPointerDown }: { widthPx: number; zoom: number; onPointerDown: (e: React.PointerEvent) => void }) {
  const step = zoom > 200 ? 0.5 : zoom > 60 ? 1 : zoom > 25 ? 5 : 10;
  const marks: number[] = [];
  for (let s = 0; s * zoom < widthPx; s += step) marks.push(s);
  return (
    <div className="sticky top-0 z-30 h-[26px] cursor-pointer border-b border-ink-800 bg-ink-900" onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e); }} aria-label="Regla de tiempo: haz clic para mover el cabezal" data-testid="ruler">
      {marks.map((s) => (
        <div key={s} className="absolute top-0 h-full border-l border-ink-700" style={{ left: s * zoom }}>
          <span className="ml-1 text-[10px] text-ink-400">{Math.floor(s / 60)}:{String(Math.floor(s % 60)).padStart(2, '0')}{s % 1 ? '.5' : ''}</span>
        </div>
      ))}
    </div>
  );
});

function ClipBox({ clip, project, left, width, top, height, selected, zoom, onDown }: {
  clip: Clip;
  project: Project;
  left: number;
  width: number;
  top: number;
  height: number;
  selected: boolean;
  zoom: number;
  onDown: (e: React.PointerEvent, clip: Clip, kind: DragState['kind']) => void;
}) {
  const track = project.tracks.find((t) => t.id === clip.trackId)!;
  const color = track.kind === 'audio' ? 'bg-emerald-700/70 border-emerald-500/60' : clip.kind === 'text' ? 'bg-amber-600/70 border-amber-400/60' : clip.kind === 'image' ? 'bg-indigo-700/70 border-indigo-400/60' : 'bg-sky-800/80 border-sky-400/60';
  const speed = clip.kind === 'media' ? (clip.speed.mode === 'constant' ? (clip.speed.rate !== 1 ? `${clip.speed.rate}×` : '') : 'curva') : '';
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Clip ${clip.name}`}
      aria-pressed={selected}
      data-clip={clip.id}
      className={`group absolute z-10 overflow-hidden rounded-md border text-[11px] text-white shadow ${color} ${selected ? 'ring-2 ring-white' : ''}`}
      style={{ left, width, top, height }}
      onPointerDown={(e) => onDown(e, clip, 'move')}
      onKeyDown={(e) => {
        if (e.key === 'Enter') useStore.getState().select([clip.id]);
      }}
    >
      <ClipVisual clip={clip} project={project} width={width} height={height} zoom={zoom} />
      <div className="pointer-events-none absolute inset-x-1 top-0.5 flex items-center gap-1 truncate font-medium drop-shadow">
        {clip.linkGroupId && <span aria-label="vinculado" title="Imagen y sonido vinculados">⛓</span>}
        <span className="truncate">{clip.kind === 'text' ? clip.text : clip.name}</span>
        {speed && <span className="rounded bg-black/40 px-1">{speed}</span>}
      </div>
      <div className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/30" onPointerDown={(e) => onDown(e, clip, 'trim-start')} aria-label="Recortar inicio" />
      <div className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/30" onPointerDown={(e) => onDown(e, clip, 'trim-end')} aria-label="Recortar final" />
    </div>
  );
}
