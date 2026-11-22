/** Atajos de teclado del editor (visibles en la ayuda y en los títulos de los botones). */
import { deleteClips, duplicateClips, frameDurationTicks, projectDuration, splitAt } from '@vs/project';
import { useStore } from '../../state/store.ts';
import { seek, togglePlay } from '../../lib/player-instance.ts';

export const SHORTCUTS: [string, string][] = [
  ['Espacio', 'Reproducir / pausar'],
  ['S', 'Dividir en el cabezal'],
  ['Supr / Retroceso', 'Borrar selección'],
  ['Mayús + Supr', 'Borrar y cerrar hueco'],
  ['Ctrl + D', 'Duplicar'],
  ['Ctrl + Z / Ctrl + Y', 'Deshacer / rehacer'],
  ['← / →', 'Fotograma anterior / siguiente'],
  ['Mayús + ← / →', 'Un segundo atrás / adelante'],
  ['Inicio / Fin', 'Ir al principio / final'],
  ['I / O', 'Marcar entrada / salida de reproducción'],
  ['N', 'Activar o desactivar ajuste magnético'],
  ['+ / −', 'Acercar / alejar la línea de tiempo'],
  ['Alt + arrastrar', 'Mover sin el clip vinculado'],
];

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function handleShortcut(e: KeyboardEvent): void {
  if (isTyping(e)) return;
  const st = useStore.getState();
  const p = st.project;
  if (!p) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const fd = frameDurationTicks(p.settings.fps);
  const key = e.key;
  if (key === ' ') {
    e.preventDefault();
    togglePlay();
  } else if (ctrl && key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault();
    st.undo();
  } else if (ctrl && (key.toLowerCase() === 'y' || (key.toLowerCase() === 'z' && e.shiftKey))) {
    e.preventDefault();
    st.redo();
  } else if (ctrl && key.toLowerCase() === 'd') {
    e.preventDefault();
    if (st.selection.length) st.apply((q) => duplicateClips(q, st.selection).project, 'Duplicar');
  } else if (key.toLowerCase() === 's' && !ctrl) {
    e.preventDefault();
    st.apply((q) => splitAt(q, st.playhead, st.selection.length ? st.selection : undefined).project, 'Dividir');
  } else if (key === 'Delete' || key === 'Backspace') {
    if (st.selection.length) {
      e.preventDefault();
      st.apply((q) => deleteClips(q, st.selection, { ripple: e.shiftKey }), 'Borrar');
      st.select([]);
    }
  } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
    e.preventDefault();
    const step = e.shiftKey ? fd * Math.round(p.settings.fps.num / p.settings.fps.den) : fd;
    seek(Math.max(0, st.playhead + (key === 'ArrowLeft' ? -step : step)));
  } else if (key === 'Home') {
    seek(0);
  } else if (key === 'End') {
    seek(projectDuration(p));
  } else if (key.toLowerCase() === 'i' && !ctrl) {
    st.setInOut({ ...st.inOut, in: st.playhead });
  } else if (key.toLowerCase() === 'o' && !ctrl) {
    st.setInOut({ ...st.inOut, out: st.playhead });
  } else if (key.toLowerCase() === 'n' && !ctrl) {
    st.toggleSnapping();
  } else if (key === '+' || key === '=') {
    st.setZoom(st.zoom * 1.25);
  } else if (key === '-') {
    st.setZoom(st.zoom / 1.25);
  }
}
