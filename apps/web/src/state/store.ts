/**
 * Estado global: proyecto, historial (deshacer/rehacer), selección, cabezal y avisos.
 * Cada operación confirmada crea una entrada de historial.
 * Un arrastre usa beginGesture/updateGesture/endGesture y crea una sola entrada.
 */
import { create } from 'zustand';
import { EditError, type Project, type Ticks } from '@vs/project';

const HISTORY_LIMIT = 200;

export type Screen = 'home' | 'editor';
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

export type LeftTab = 'media' | 'generate' | 'text' | 'subtitles' | 'assistant';

interface State {
  screen: Screen;
  project: Project | null;
  past: Project[];
  future: Project[];
  gestureBase: Project | null;
  selection: string[];
  selectedCueId: string | null;
  selectedTransitionId: string | null;
  playhead: Ticks;
  playing: boolean;
  /** Píxeles por segundo en la línea de tiempo. */
  zoom: number;
  snapping: boolean;
  saveStatus: SaveStatus;
  toasts: Toast[];
  leftTab: LeftTab;
  exportOpen: boolean;
  aiSettingsOpen: boolean;
  extendClipId: string | null;
  /** Recursos que no se pudieron guardar en disco (solo en memoria esta sesión). */
  volatileAssets: Record<string, string>;
  inOut: { in: Ticks | null; out: Ticks | null };
  loop: boolean;

  setScreen(s: Screen): void;
  openProject(p: Project): void;
  closeProject(): void;
  /** Aplica una operación y la guarda en el historial. Devuelve false si falló (con aviso). */
  apply(fn: (p: Project) => Project, label?: string): boolean;
  beginGesture(): void;
  updateGesture(fn: (base: Project) => Project): boolean;
  endGesture(commit: boolean): void;
  undo(): void;
  redo(): void;
  select(ids: string[], additive?: boolean): void;
  selectCue(id: string | null): void;
  selectTransition(id: string | null): void;
  setPlayhead(t: Ticks): void;
  setPlaying(v: boolean): void;
  setZoom(z: number): void;
  toggleSnapping(): void;
  setSaveStatus(s: SaveStatus): void;
  toast(text: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
  setLeftTab(t: LeftTab): void;
  setExportOpen(v: boolean): void;
  setAiSettingsOpen(v: boolean): void;
  setExtendClip(id: string | null): void;
  markVolatile(assetId: string, reason: string | null): void;
  setInOut(v: { in: Ticks | null; out: Ticks | null }): void;
  setLoop(v: boolean): void;
  /** Reemplaza el proyecto sin historial (p. ej. al actualizar el estado de una tarea de IA). */
  patchSilently(fn: (p: Project) => Project): void;
}

let toastId = 0;

export const useStore = create<State>((set, get) => ({
  screen: 'home',
  project: null,
  past: [],
  future: [],
  gestureBase: null,
  selection: [],
  selectedCueId: null,
  selectedTransitionId: null,
  playhead: 0,
  playing: false,
  zoom: 80,
  snapping: true,
  saveStatus: 'idle',
  toasts: [],
  leftTab: 'media',
  exportOpen: false,
  aiSettingsOpen: false,
  extendClipId: null,
  volatileAssets: {},
  inOut: { in: null, out: null },
  loop: false,

  setScreen: (screen) => set({ screen }),
  openProject: (p) => set({ project: p, past: [], future: [], selection: [], playhead: 0, playing: false, screen: 'editor', saveStatus: 'idle' }),
  closeProject: () => set({ project: null, past: [], future: [], selection: [], screen: 'home', playing: false }),

  apply(fn, label) {
    const p = get().project;
    if (!p) return false;
    try {
      const next = fn(p);
      if (next === p) return true;
      set((s) => ({ project: next, past: [...s.past, p].slice(-HISTORY_LIMIT), future: [] }));
      return true;
    } catch (e) {
      get().toast(e instanceof EditError || e instanceof Error ? `${label ? label + ': ' : ''}${e.message}` : String(e), 'error');
      return false;
    }
  },
  beginGesture() {
    set({ gestureBase: get().project });
  },
  updateGesture(fn) {
    const base = get().gestureBase;
    if (!base) return false;
    try {
      set({ project: fn(base) });
      return true;
    } catch {
      return false;
    }
  },
  endGesture(commit) {
    const { gestureBase, project } = get();
    if (!gestureBase) return;
    if (!commit || project === gestureBase) set({ project: gestureBase, gestureBase: null });
    else set((s) => ({ past: [...s.past, gestureBase].slice(-HISTORY_LIMIT), future: [], gestureBase: null }));
  },
  undo() {
    const { past, project, future } = get();
    const prev = past[past.length - 1];
    if (!prev || !project) return;
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future] });
  },
  redo() {
    const { past, project, future } = get();
    const next = future[0];
    if (!next || !project) return;
    set({ project: next, past: [...past, project], future: future.slice(1) });
  },
  select(ids, additive) {
    set((s) => ({
      selection: additive ? [...new Set([...s.selection, ...ids])] : ids,
      selectedCueId: null,
      selectedTransitionId: null,
    }));
  },
  selectCue: (id) => set({ selectedCueId: id, selection: [], selectedTransitionId: null }),
  selectTransition: (id) => set({ selectedTransitionId: id, selection: [], selectedCueId: null }),
  setPlayhead: (t) => set({ playhead: Math.max(0, Math.round(t)) }),
  setPlaying: (v) => set({ playing: v }),
  setZoom: (z) => set({ zoom: Math.min(800, Math.max(8, z)) }),
  toggleSnapping: () => set((s) => ({ snapping: !s.snapping })),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  toast(text, kind = 'info') {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }].slice(-4) }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 4500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setLeftTab: (leftTab) => set({ leftTab }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setAiSettingsOpen: (aiSettingsOpen) => set({ aiSettingsOpen }),
  setExtendClip: (extendClipId) => set({ extendClipId }),
  markVolatile: (assetId, reason) =>
    set((s) => {
      const v = { ...s.volatileAssets };
      if (reason) v[assetId] = reason;
      else delete v[assetId];
      return { volatileAssets: v };
    }),
  setInOut: (inOut) => set({ inOut }),
  setLoop: (loop) => set({ loop }),
  patchSilently(fn) {
    const p = get().project;
    if (!p) return;
    const next = fn(p);
    // Aplica el mismo cambio al historial para no perderlo al deshacer.
    set((s) => ({ project: next, past: s.past.map(fn), future: s.future.map(fn) }));
  },
}));

export const getProject = (): Project => {
  const p = useStore.getState().project;
  if (!p) throw new Error('No hay proyecto abierto');
  return p;
};
