import { useEffect } from 'react';
import { useStore } from './state/store.ts';
import { Home } from './features/home/Home.tsx';
import { Editor } from './features/editor/Editor.tsx';
import { Toasts } from './ui/Toasts.tsx';
import { createAutosaver } from './storage/projects.ts';
import { loadBuiltinLuts } from './engine/luts.ts';

const autosaver = createAutosaver((s, err) => {
  useStore.getState().setSaveStatus(s);
  if (s === 'error') useStore.getState().toast(`No se pudo guardar: ${err instanceof Error ? err.message : String(err)}. Tus cambios siguen en pantalla.`, 'error');
});

// Expuesto para pruebas automatizadas y depuración.
declare global {
  interface Window {
    __vs?: { store: typeof useStore; flush: () => Promise<void> };
  }
}
window.__vs = { store: useStore, flush: () => autosaver.flush() };

export function App() {
  const screen = useStore((s) => s.screen);
  useEffect(() => {
    void loadBuiltinLuts();
    let prev = useStore.getState().project;
    const unsub = useStore.subscribe((s) => {
      if (s.project && s.project !== prev && !s.gestureBase) autosaver.schedule(s.project);
      prev = s.project;
    });
    const flush = () => void autosaver.flush();
    const onVis = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', flush);
    return () => {
      unsub();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', flush);
    };
  }, []);
  return (
    <>
      {screen === 'home' ? <Home /> : <Editor />}
      <Toasts />
    </>
  );
}
