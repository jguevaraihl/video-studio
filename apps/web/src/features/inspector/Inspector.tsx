/** Inspector contextual: muestra solo los controles pertinentes a la selección. */
import { useRef, useState } from 'react';
import {
  ASPECT_PRESETS,
  TICKS_PER_SECOND,
  addTransition,
  clipDuration,
  dbToGain,
  maxTransitionDuration,
  nextAdjacentClip,
  removeTransition,
  secondsToTicks,
  setSpeed,
  ticksToSeconds,
  updateClip,
  updateTrack,
  validateTransition,
  averageSpeed,
  type AnimatableProp,
  type Clip,
  type MediaClip,
  type Project,
  type TextClip,
  type VisualClip,
} from '@vs/project';
import { useStore } from '../../state/store.ts';
import { Button, Field, Notice, Section, Slider, inputClass } from '../../ui/kit.tsx';
import { addUserLut, listLuts } from '../../engine/luts.ts';
import { addUserFont, listFontFamilies } from '../../engine/fonts.ts';
import { SpeedCurveEditor } from './SpeedCurveEditor.tsx';
import { IExtend } from '../../ui/icons.tsx';

/** Edición en vivo: arrastrar un deslizador crea una sola entrada de historial. */
function useLive() {
  const st = useStore.getState();
  const active = useRef(false);
  return {
    change(fn: (p: Project) => Project) {
      if (!active.current) {
        st.beginGesture();
        active.current = true;
      }
      st.updateGesture(fn);
    },
    commit() {
      if (!active.current) return;
      active.current = false;
      st.endGesture(true);
    },
  };
}

const sec = (t: number) => ticksToSeconds(t).toFixed(2);

export function Inspector() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const trId = useStore((s) => s.selectedTransitionId);
  if (!project) return null;
  if (trId && project.transitions[trId]) return <TransitionInspector project={project} id={trId} />;
  const clip = selection.length === 1 ? project.clips[selection[0]!] : undefined;
  if (!clip) return <ProjectInspector project={project} count={selection.length} />;
  return <ClipInspector key={clip.id} project={project} clip={clip} />;
}

function ProjectInspector({ project, count }: { project: Project; count: number }) {
  const st = useStore.getState();
  const live = useLive();
  return (
    <div>
      {count > 1 && <div className="px-3 pt-3"><Notice>{count} clips seleccionados. Puedes moverlos, duplicarlos o borrarlos juntos.</Notice></div>}
      <Section title="Proyecto">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(ASPECT_PRESETS) as (keyof typeof ASPECT_PRESETS)[]).map((k) => {
            const { width, height } = ASPECT_PRESETS[k];
            const active = project.settings.width === width && project.settings.height === height;
            return (
              <Button key={k} size="sm" variant={active ? 'primary' : 'subtle'} aria-pressed={active} onClick={() => st.apply((p) => ({ ...p, settings: { ...p.settings, width, height } }), 'Formato')}>
                {k}
              </Button>
            );
          })}
        </div>
        <Field label="Fotogramas por segundo">
          <select
            className={inputClass}
            value={`${project.settings.fps.num}/${project.settings.fps.den}`}
            onChange={(e) => {
              const [num, den] = e.target.value.split('/').map(Number) as [number, number];
              st.apply((p) => ({ ...p, settings: { ...p.settings, fps: { num, den } } }));
            }}
          >
            <option value="24/1">24</option>
            <option value="25/1">25</option>
            <option value="30000/1001">29,97</option>
            <option value="30/1">30</option>
            <option value="60/1">60</option>
          </select>
        </Field>
        <Field label="Color de fondo">
          <input type="color" className="h-8 w-16 rounded" value={project.settings.background} onChange={(e) => st.apply((p) => ({ ...p, settings: { ...p.settings, background: e.target.value } }))} />
        </Field>
      </Section>
      <Section title="Mezclador">
        <Slider label="Volumen general" min={-60} max={12} step={0.5} value={project.masterGainDb} format={(v) => `${v.toFixed(1)} dB`} onChange={(v) => live.change((p) => ({ ...p, masterGainDb: v }))} onCommit={live.commit} />
        {project.tracks
          .filter((t) => t.kind === 'audio')
          .map((t) => (
            <div key={t.id} className="rounded-md border border-ink-800 p-2">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-emerald-300">{t.name}</span>
                <span className="flex gap-1">
                  <Button size="sm" variant={t.muted ? 'danger' : 'ghost'} aria-pressed={t.muted} onClick={() => st.apply((p) => updateTrack(p, t.id, { muted: !t.muted }))}>Silencio</Button>
                  <Button size="sm" variant={t.solo ? 'primary' : 'ghost'} aria-pressed={t.solo} onClick={() => st.apply((p) => updateTrack(p, t.id, { solo: !t.solo }))}>Solo</Button>
                </span>
              </div>
              <Slider label="Volumen de pista" id={`tg-${t.id}`} min={-60} max={12} step={0.5} value={t.gainDb} format={(v) => `${v.toFixed(1)} dB`} onChange={(v) => live.change((p) => updateTrack(p, t.id, { gainDb: v }))} onCommit={live.commit} />
            </div>
          ))}
      </Section>
      <Section title="Consejo">
        <p className="text-xs leading-relaxed text-ink-400">Selecciona un clip para ver sus controles. Arrastra medios desde la biblioteca al montaje o usa «Agregar al montaje».</p>
      </Section>
    </div>
  );
}

function TransitionInspector({ project, id }: { project: Project; id: string }) {
  const tr = project.transitions[id]!;
  const st = useStore.getState();
  const live = useLive();
  const max = maxTransitionDuration(project, tr.fromClipId, tr.toClipId);
  return (
    <Section title="Transición: disolución">
      <Slider
        label="Duración"
        min={0.04}
        max={Math.max(0.05, ticksToSeconds(max))}
        step={0.02}
        value={ticksToSeconds(tr.duration)}
        format={(v) => `${v.toFixed(2)} s`}
        onChange={(v) => live.change((p) => addTransition(p, tr.fromClipId, tr.toClipId, secondsToTicks(v)).project)}
        onCommit={live.commit}
      />
      <p className="text-xs text-ink-400">Máximo según el material disponible: {sec(max)} s. Usa los extremos recortados de ambos clips.</p>
      <Button variant="danger" size="sm" onClick={() => { st.apply((p) => removeTransition(p, id)); st.selectTransition(null); }}>Quitar transición</Button>
    </Section>
  );
}

function ClipInspector({ project, clip }: { project: Project; clip: Clip }) {
  const track = project.tracks.find((t) => t.id === clip.trackId)!;
  const isAudioTrack = track.kind === 'audio';
  return (
    <div>
      <div className="border-b border-ink-800 px-3 py-2">
        <div className="truncate text-sm font-semibold">{clip.kind === 'text' ? clip.text : clip.name}</div>
        <div className="text-xs text-ink-500">
          {track.name} · inicio {sec(clip.start)} s · duración {sec(clipDuration(clip))} s
        </div>
      </div>
      {clip.kind === 'text' && <TextSection clip={clip} />}
      {!isAudioTrack && <TransformSection clip={clip as VisualClip} project={project} />}
      {!isAudioTrack && clip.kind !== 'text' && <ColorSection clip={clip as VisualClip} />}
      {!isAudioTrack && <FadeSection clip={clip as VisualClip} />}
      {clip.kind === 'media' && <SpeedSection clip={clip} />}
      {clip.kind === 'media' && isAudioTrack && <AudioSection clip={clip} />}
      <TransitionSection project={project} clip={clip} />
      {clip.kind === 'media' && !isAudioTrack && (
        <Section title="Extender clip">
          <Button onClick={() => useStore.getState().setExtendClip(clip.id)}><IExtend /> Extender…</Button>
          <p className="text-xs text-ink-400">Ralentizar, bucle inteligente o continuación con IA.</p>
        </Section>
      )}
    </div>
  );
}

function TextSection({ clip }: { clip: TextClip }) {
  const st = useStore.getState();
  const live = useLive();
  const fonts = listFontFamilies();
  const fontInput = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<TextClip['style']>) => st.apply((p) => updateClip(p, clip.id, { style: { ...clip.style, ...patch } } as Partial<Clip>));
  return (
    <Section title="Texto">
      <textarea
        aria-label="Contenido del texto"
        className={`${inputClass} h-20 py-1`}
        value={clip.text}
        onChange={(e) => live.change((p) => updateClip(p, clip.id, { text: e.target.value, name: e.target.value.slice(0, 24) } as Partial<Clip>))}
        onBlur={live.commit}
      />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Tipografía">
          <select className={inputClass} value={clip.style.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>
            {fonts.map((f) => <option key={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Color">
          <input type="color" className="h-8 w-full rounded" value={clip.style.color} onChange={(e) => set({ color: e.target.value })} />
        </Field>
      </div>
      <Button size="sm" variant="ghost" onClick={() => fontInput.current?.click()}>Cargar tipografía local (.ttf/.otf)</Button>
      <input
        ref={fontInput}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        className="hidden"
        aria-label="Cargar tipografía"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            const fam = await addUserFont(f);
            set({ fontFamily: fam });
            st.toast(`Tipografía «${fam}» cargada en esta sesión.`, 'success');
          } catch {
            st.toast('No se pudo leer la tipografía.', 'error');
          }
        }}
      />
      <Slider label="Tamaño" min={0.02} max={0.3} step={0.005} value={clip.style.fontSize} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => live.change((p) => updateClip(p, clip.id, { style: { ...clip.style, fontSize: v } } as Partial<Clip>))} onCommit={live.commit} />
      <div className="flex flex-wrap gap-1">
        {(['left', 'center', 'right'] as const).map((a) => (
          <Button key={a} size="sm" variant={clip.style.align === a ? 'primary' : 'subtle'} aria-pressed={clip.style.align === a} onClick={() => set({ align: a })}>
            {{ left: 'Izquierda', center: 'Centro', right: 'Derecha' }[a]}
          </Button>
        ))}
        <Button size="sm" variant={clip.style.bold ? 'primary' : 'subtle'} aria-pressed={clip.style.bold} onClick={() => set({ bold: !clip.style.bold })}>Negrita</Button>
        <Button size="sm" variant={clip.style.italic ? 'primary' : 'subtle'} aria-pressed={clip.style.italic} onClick={() => set({ italic: !clip.style.italic })}>Cursiva</Button>
        <Button size="sm" variant={clip.style.background ? 'primary' : 'subtle'} aria-pressed={!!clip.style.background} onClick={() => set({ background: clip.style.background ? null : 'rgba(0,0,0,0.6)' })}>Fondo</Button>
      </div>
      <Slider label="Contorno" min={0} max={2} step={0.05} value={clip.style.strokeWidth} onChange={(v) => live.change((p) => updateClip(p, clip.id, { style: { ...clip.style, strokeWidth: v } } as Partial<Clip>))} onCommit={live.commit} />
      <Field label="Duración (s)">
        <input type="number" min={0.1} step={0.1} className={inputClass} value={ticksToSeconds(clip.duration).toFixed(2)} onChange={(e) => st.apply((p) => updateClip(p, clip.id, { duration: secondsToTicks(Math.max(0.1, Number(e.target.value))) } as Partial<Clip>))} />
      </Field>
    </Section>
  );
}

const PROPS: { key: AnimatableProp; label: string; min: number; max: number; step: number; fmt: (v: number) => string }[] = [
  { key: 'x', label: 'Posición X', min: -1, max: 1, step: 0.005, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'y', label: 'Posición Y', min: -1, max: 1, step: 0.005, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'scale', label: 'Escala', min: 0.05, max: 4, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'rotation', label: 'Rotación', min: -180, max: 180, step: 0.5, fmt: (v) => `${v.toFixed(1)}°` },
  { key: 'opacity', label: 'Opacidad', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
];

function TransformSection({ clip, project }: { clip: VisualClip; project: Project }) {
  const st = useStore.getState();
  const live = useLive();
  const playhead = useStore((s) => s.playhead);
  const local = Math.max(0, Math.min(clipDuration(clip), playhead - clip.start));
  const inClip = playhead >= clip.start && playhead <= clip.start + clipDuration(clip);
  const setProp = (key: AnimatableProp, v: number) => {
    const kfs = clip.keyframes[key];
    if (kfs && kfs.length) {
      // Con keyframes, el deslizador edita (o crea) el keyframe del cabezal.
      const others = kfs.filter((k) => Math.abs(k.t - local) > 1000);
      return updateClip(project, clip.id, { keyframes: { ...clip.keyframes, [key]: [...others, { t: local, v, ease: 'easeInOut' }].sort((a, b) => a.t - b.t) } } as Partial<Clip>);
    }
    return updateClip(project, clip.id, { transform: { ...clip.transform, [key]: v } } as Partial<Clip>);
  };
  return (
    <Section title="Transformación">
      {PROPS.map((pr) => {
        const kfs = clip.keyframes[pr.key];
        const hasKf = !!kfs?.length;
        const atKf = kfs?.some((k) => Math.abs(k.t - local) <= 1000);
        const value = hasKf ? evalAt(kfs!, local, clip.transform[pr.key] as number) : (clip.transform[pr.key] as number);
        return (
          <div key={pr.key} className="flex items-end gap-1">
            <div className="flex-1">
              <Slider label={pr.label} min={pr.min} max={pr.max} step={pr.step} value={value} format={pr.fmt} onChange={(v) => live.change(() => setProp(pr.key, v))} onCommit={live.commit} />
            </div>
            <button
              aria-label={`${atKf ? 'Quitar' : 'Agregar'} keyframe de ${pr.label} en el cabezal`}
              title={inClip ? 'Keyframe en el cabezal' : 'Coloca el cabezal sobre el clip'}
              disabled={!inClip}
              className={`mb-0.5 h-6 w-6 rounded text-sm disabled:opacity-30 ${atKf ? 'text-amber-300' : hasKf ? 'text-amber-600' : 'text-ink-500'} hover:bg-ink-700`}
              onClick={() =>
                st.apply((p) => {
                  const list = clip.keyframes[pr.key] ?? [];
                  const next = atKf ? list.filter((k) => Math.abs(k.t - local) > 1000) : [...list, { t: local, v: value, ease: 'easeInOut' as const }].sort((a, b) => a.t - b.t);
                  return updateClip(p, clip.id, { keyframes: { ...clip.keyframes, [pr.key]: next.length ? next : undefined } } as Partial<Clip>);
                }, 'Keyframe')
              }
            >◆</button>
          </div>
        );
      })}
      {clip.kind !== 'text' && (
        <>
          <Field label="Encaje">
            <select className={inputClass} value={clip.transform.fit} onChange={(e) => st.apply((p) => updateClip(p, clip.id, { transform: { ...clip.transform, fit: e.target.value as 'contain' } } as Partial<Clip>))}>
              <option value="contain">Encajar (sin recortar)</option>
              <option value="cover">Rellenar (recorta bordes)</option>
              <option value="fill">Estirar</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
              <Slider
                key={side}
                label={`Recorte ${{ left: 'izq.', right: 'der.', top: 'sup.', bottom: 'inf.' }[side]}`}
                min={0}
                max={0.45}
                step={0.005}
                value={clip.transform.crop[side]}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => live.change((p) => updateClip(p, clip.id, { transform: { ...clip.transform, crop: { ...clip.transform.crop, [side]: v } } } as Partial<Clip>))}
                onCommit={live.commit}
              />
            ))}
          </div>
        </>
      )}
      <Button size="sm" variant="ghost" onClick={() => st.apply((p) => updateClip(p, clip.id, { transform: { ...clip.transform, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } }, keyframes: {} } as Partial<Clip>))}>
        Restablecer transformación
      </Button>
    </Section>
  );
}

function evalAt(kfs: NonNullable<VisualClip['keyframes']['x']>, u: number, fallback: number): number {
  const sorted = [...kfs].sort((a, b) => a.t - b.t);
  if (!sorted.length) return fallback;
  if (u <= sorted[0]!.t) return sorted[0]!.v;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (u < b.t) return a.v + ((b.v - a.v) * (u - a.t)) / (b.t - a.t);
  }
  return sorted[sorted.length - 1]!.v;
}

function ColorSection({ clip }: { clip: VisualClip }) {
  const st = useStore.getState();
  const live = useLive();
  const lutInput = useRef<HTMLInputElement>(null);
  const [, force] = useState(0);
  const c = clip.color;
  const setColor = (patch: Partial<typeof c>) => (p: Project) => updateClip(p, clip.id, { color: { ...c, ...patch } } as Partial<Clip>);
  return (
    <Section title="Color">
      {(['brightness', 'contrast', 'saturation', 'temperature'] as const).map((k) => (
        <Slider key={k} label={{ brightness: 'Brillo', contrast: 'Contraste', saturation: 'Saturación', temperature: 'Temperatura' }[k]} min={-1} max={1} step={0.01} value={c[k]} format={(v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`} onChange={(v) => live.change(setColor({ [k]: v }))} onCommit={live.commit} />
      ))}
      <Field label="LUT 3D">
        <select
          className={inputClass}
          value={c.lut?.id ?? ''}
          onChange={(e) => st.apply(setColor({ lut: e.target.value ? { id: e.target.value, intensity: c.lut?.intensity ?? 1 } : null }), 'LUT')}
          data-testid="lut-select"
        >
          <option value="">Sin LUT</option>
          {listLuts().map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
        </select>
      </Field>
      {c.lut && <Slider label="Intensidad de la LUT" min={0} max={1} step={0.01} value={c.lut.intensity} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => live.change(setColor({ lut: { ...c.lut!, intensity: v } }))} onCommit={live.commit} />}
      <Button size="sm" variant="ghost" onClick={() => lutInput.current?.click()}>Cargar LUT .cube</Button>
      <input
        ref={lutInput}
        type="file"
        accept=".cube"
        className="hidden"
        aria-label="Cargar LUT"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            const lut = await addUserLut(f);
            st.apply(setColor({ lut: { id: lut.id, intensity: 1 } }), 'LUT');
            force((n) => n + 1);
          } catch (err) {
            st.toast(err instanceof Error ? err.message : 'LUT no válida', 'error');
          }
        }}
      />
    </Section>
  );
}

function FadeSection({ clip }: { clip: VisualClip }) {
  const live = useLive();
  const max = Math.min(10, ticksToSeconds(clipDuration(clip)));
  return (
    <Section title="Fundidos de imagen">
      <Slider label="Fundido de entrada" min={0} max={max} step={0.05} value={ticksToSeconds(clip.fadeIn)} format={(v) => `${v.toFixed(2)} s`} onChange={(v) => live.change((p) => updateClip(p, clip.id, { fadeIn: secondsToTicks(v) } as Partial<Clip>))} onCommit={live.commit} />
      <Slider label="Fundido de salida" min={0} max={max} step={0.05} value={ticksToSeconds(clip.fadeOut)} format={(v) => `${v.toFixed(2)} s`} onChange={(v) => live.change((p) => updateClip(p, clip.id, { fadeOut: secondsToTicks(v) } as Partial<Clip>))} onCommit={live.commit} />
    </Section>
  );
}

function SpeedSection({ clip }: { clip: MediaClip }) {
  const st = useStore.getState();
  const live = useLive();
  const sp = clip.speed;
  const span = ticksToSeconds(clip.sourceOut - clip.sourceIn);
  return (
    <Section title="Velocidad">
      <div className="flex gap-1">
        <Button size="sm" variant={sp.mode === 'constant' ? 'primary' : 'subtle'} aria-pressed={sp.mode === 'constant'} onClick={() => st.apply((p) => setSpeed(p, clip.id, { mode: 'constant', rate: averageSpeed(sp), preservePitch: true }))}>Constante</Button>
        <Button size="sm" variant={sp.mode === 'curve' ? 'primary' : 'subtle'} aria-pressed={sp.mode === 'curve'} onClick={() => st.apply((p) => setSpeed(p, clip.id, { mode: 'curve', points: [{ p: 0, v: 1 }, { p: 0.5, v: 2 }, { p: 1, v: 1 }] }))}>Curva</Button>
      </div>
      {sp.mode === 'constant' ? (
        <>
          <Slider label="Velocidad" min={0.1} max={4} step={0.05} value={sp.rate} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => live.change((p) => setSpeed(p, clip.id, { ...sp, rate: v }))} onCommit={live.commit} />
          <label className="flex items-center gap-2 text-xs text-ink-300">
            <input type="checkbox" checked={sp.preservePitch} onChange={(e) => st.apply((p) => setSpeed(p, clip.id, { ...sp, preservePitch: e.target.checked }))} />
            Conservar el tono del audio (WSOLA). Sin marcar, el tono cambia con la velocidad.
          </label>
        </>
      ) : (
        <>
          <SpeedCurveEditor points={sp.points} onChange={(pts) => live.change((p) => setSpeed(p, clip.id, { mode: 'curve', points: pts }))} onCommit={live.commit} />
          <Notice kind="warn">Con curva, el audio se remuestrea y su tono cambia con la velocidad.</Notice>
        </>
      )}
      <p className="text-xs text-ink-400">
        Material usado: {span.toFixed(2)} s. Duración en el montaje: {sec(clipDuration(clip))} s (= material ÷ velocidad media {averageSpeed(sp).toFixed(2)}×).
      </p>
      <label className="flex items-center gap-2 text-xs text-ink-300">
        <input type="checkbox" checked={clip.frameBlend} onChange={(e) => st.apply((p) => updateClip(p, clip.id, { frameBlend: e.target.checked } as Partial<Clip>))} />
        Interpolar por mezcla de fotogramas (suaviza la cámara lenta)
      </label>
    </Section>
  );
}

function AudioSection({ clip }: { clip: MediaClip }) {
  const st = useStore.getState();
  const live = useLive();
  const a = clip.audio;
  const set = (patch: Partial<typeof a>) => (p: Project) => updateClip(p, clip.id, { audio: { ...a, ...patch } } as Partial<Clip>);
  const max = Math.min(10, ticksToSeconds(clipDuration(clip)));
  return (
    <Section title="Audio del clip">
      <Slider label="Volumen" min={-60} max={24} step={0.5} value={a.gainDb} format={(v) => `${v.toFixed(1)} dB (×${dbToGain(v).toFixed(2)})`} onChange={(v) => live.change(set({ gainDb: v }))} onCommit={live.commit} />
      <label className="flex items-center gap-2 text-xs text-ink-300">
        <input type="checkbox" checked={a.muted} onChange={(e) => st.apply(set({ muted: e.target.checked }))} /> Silenciar este clip
      </label>
      <Slider label="Fundido de entrada" min={0} max={max} step={0.05} value={ticksToSeconds(a.fadeIn)} format={(v) => `${v.toFixed(2)} s`} onChange={(v) => live.change(set({ fadeIn: secondsToTicks(v) }))} onCommit={live.commit} />
      <Slider label="Fundido de salida" min={0} max={max} step={0.05} value={ticksToSeconds(a.fadeOut)} format={(v) => `${v.toFixed(2)} s`} onChange={(v) => live.change(set({ fadeOut: secondsToTicks(v) }))} onCommit={live.commit} />
      <div className="rounded-md border border-ink-800 p-2">
        <label className="mb-2 flex items-center gap-2 text-xs font-medium text-ink-200">
          <input type="checkbox" checked={a.denoise.enabled} onChange={(e) => st.apply(set({ denoise: { ...a.denoise, enabled: e.target.checked } }))} data-testid="denoise-toggle" />
          Reducción de ruido: puerta de ruido
        </label>
        <p className="mb-2 text-[11px] text-ink-500">Técnica: puerta de ruido. Atenúa el sonido cuando su nivel baja del umbral. No es un filtro espectral.</p>
        {a.denoise.enabled && (
          <div className="flex flex-col gap-2">
            <Slider label="Umbral" min={-90} max={0} step={1} value={a.denoise.thresholdDb} format={(v) => `${v} dBFS`} onChange={(v) => live.change(set({ denoise: { ...a.denoise, thresholdDb: v } }))} onCommit={live.commit} />
            <Slider label="Ataque" min={0.5} max={100} step={0.5} value={a.denoise.attackMs} format={(v) => `${v} ms`} onChange={(v) => live.change(set({ denoise: { ...a.denoise, attackMs: v } }))} onCommit={live.commit} />
            <Slider label="Liberación" min={10} max={1000} step={5} value={a.denoise.releaseMs} format={(v) => `${v} ms`} onChange={(v) => live.change(set({ denoise: { ...a.denoise, releaseMs: v } }))} onCommit={live.commit} />
            <Slider label="Atenuación" min={-90} max={0} step={1} value={a.denoise.reductionDb} format={(v) => `${v} dB`} onChange={(v) => live.change(set({ denoise: { ...a.denoise, reductionDb: v } }))} onCommit={live.commit} />
          </div>
        )}
      </div>
    </Section>
  );
}

function TransitionSection({ project, clip }: { project: Project; clip: Clip }) {
  const st = useStore.getState();
  const next = nextAdjacentClip(project, clip.id);
  if (!next) return null;
  const existing = Object.values(project.transitions).find((t) => t.fromClipId === clip.id);
  const err = validateTransition(project, { fromClipId: clip.id, toClipId: next.id, duration: secondsToTicks(0.5) });
  return (
    <Section title="Transición al siguiente clip">
      {existing ? (
        <Button size="sm" onClick={() => st.selectTransition(existing.id)}>Editar disolución ({sec(existing.duration)} s)</Button>
      ) : err ? (
        <Notice kind="warn">{err}</Notice>
      ) : (
        <Button size="sm" data-testid="add-dissolve" onClick={() => st.apply((p) => addTransition(p, clip.id, next.id, Math.min(secondsToTicks(1), maxTransitionDuration(p, clip.id, next.id))).project, 'Transición')}>
          Agregar disolución
        </Button>
      )}
      <p className="text-[11px] text-ink-500">La disolución se centra en el corte y usa {`material extra de ambos clips`}. Hasta {(maxTransitionDuration(project, clip.id, next.id) / TICKS_PER_SECOND).toFixed(2)} s.</p>
    </Section>
  );
}
