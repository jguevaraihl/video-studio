/** Agregar títulos con estilos predefinidos y animación de entrada. */
import { addTextClip, secondsToTicks as s, updateClip, type Clip } from '@vs/project';
import { useStore } from '../../state/store.ts';
import { Button } from '../../ui/kit.tsx';

const PRESETS: { name: string; text: string; patch: (c: Extract<Clip, { kind: 'text' }>) => Partial<Clip> }[] = [
  { name: 'Título grande', text: 'Título', patch: (c) => ({ style: { ...c.style, fontSize: 0.12 }, keyframes: { opacity: [{ t: 0, v: 0, ease: 'easeInOut' }, { t: s(0.5), v: 1, ease: 'linear' }] } }) },
  { name: 'Subtítulo inferior', text: 'Nombre · cargo', patch: (c) => ({ style: { ...c.style, fontSize: 0.05, background: 'rgba(0,0,0,0.6)', align: 'left' }, transform: { ...c.transform, x: -0.25, y: 0.35 }, keyframes: { x: [{ t: 0, v: -0.6, ease: 'easeInOut' }, { t: s(0.6), v: -0.25, ease: 'linear' }] } }) },
  { name: 'Cita en serif', text: '«Una idea clara»', patch: (c) => ({ style: { ...c.style, fontFamily: 'DejaVu Serif', fontSize: 0.07, italic: true }, keyframes: { scale: [{ t: 0, v: 0.85, ease: 'easeInOut' }, { t: s(1), v: 1, ease: 'linear' }] } }) },
  { name: 'Contorno llamativo', text: '¡AHORA!', patch: (c) => ({ style: { ...c.style, fontSize: 0.14, color: '#facc15', strokeWidth: 1, strokeColor: '#000000' } }) },
];

export function TextPanel() {
  const st = useStore.getState();
  return (
    <div className="flex flex-col gap-2 p-3">
      <p className="text-xs text-ink-400">Se agrega en el cabezal, en la pista de texto. Edita el contenido y la animación en el inspector.</p>
      {PRESETS.map((pr) => (
        <Button
          key={pr.name}
          className="justify-start"
          data-testid={`text-preset-${pr.name}`}
          onClick={() =>
            st.apply((p) => {
              const r = addTextClip(p, pr.text, useStore.getState().playhead, s(3));
              const c = r.project.clips[r.clipId] as Extract<Clip, { kind: 'text' }>;
              st.select([r.clipId]);
              return updateClip(r.project, r.clipId, pr.patch(c));
            }, 'Texto')
          }
        >
          {pr.name}
        </Button>
      ))}
    </div>
  );
}
