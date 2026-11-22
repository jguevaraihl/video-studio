/** Distribución del editor: biblioteca, visor, inspector y línea de tiempo redimensionable. */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store.ts';
import { handleShortcut } from './shortcuts.ts';
import { TopBar } from './TopBar.tsx';
import { LeftPanel } from '../library/LeftPanel.tsx';
import { Viewer } from '../viewer/Viewer.tsx';
import { Inspector } from '../inspector/Inspector.tsx';
import { Timeline } from '../timeline/Timeline.tsx';
import { ExportDialog } from '../export/ExportDialog.tsx';
import { AiSettingsModal } from '../generate/AiSettingsModal.tsx';
import { ExtendDialog } from '../extend/ExtendDialog.tsx';
import { getPlayer } from '../../lib/player-instance.ts';
import { findMissingAssets } from '../../lib/media-service.ts';
import { resumePendingGenerations } from '../generate/generation-service.ts';

type MobileTab = 'library' | 'inspector' | 'timeline';

export function Editor() {
  const exportOpen = useStore((s) => s.exportOpen);
  const aiOpen = useStore((s) => s.aiSettingsOpen);
  const extendId = useStore((s) => s.extendClipId);
  const [timelineH, setTimelineH] = useState(() => Number(localStorage.getItem('vs:tlh')) || 300);
  const [mobileTab, setMobileTab] = useState<MobileTab>('timeline');
  const dragRef = useRef<{ y: number; h: number } | null>(null);

  useEffect(() => {
    window.addEventListener('keydown', handleShortcut);
    const p = useStore.getState().project;
    if (p) {
      void findMissingAssets(p).then((missing) => {
        if (missing.length) useStore.getState().toast(`${missing.length} archivo(s) no están disponibles en este navegador. Aparecen marcados en la biblioteca para reubicarlos. Tus ediciones se conservan.`, 'error');
      });
      void resumePendingGenerations();
    }
    return () => {
      window.removeEventListener('keydown', handleShortcut);
      const pl = getPlayer();
      if (pl.isPlaying) pl.pause();
      useStore.getState().setPlaying(false);
    };
  }, []);

  const onResizeDown = (e: React.PointerEvent) => {
    dragRef.current = { y: e.clientY, h: timelineH };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const h = Math.min(window.innerHeight - 220, Math.max(140, dragRef.current.h - (e.clientY - dragRef.current.y)));
    setTimelineH(h);
  };
  const onResizeUp = () => {
    dragRef.current = null;
    localStorage.setItem('vs:tlh', String(timelineH));
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-ink-950">
      <TopBar />
      {/* Escritorio */}
      <div className="hidden min-h-0 flex-1 flex-col lg:flex">
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[320px] shrink-0 flex-col border-r border-ink-800 bg-ink-900" aria-label="Biblioteca">
            <LeftPanel />
          </aside>
          <main className="flex min-w-0 flex-1 flex-col" aria-label="Visor">
            <Viewer />
          </main>
          <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-ink-800 bg-ink-900" aria-label="Inspector">
            <Inspector />
          </aside>
        </div>
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Redimensionar línea de tiempo"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') setTimelineH((h) => Math.min(window.innerHeight - 220, h + 20));
            if (e.key === 'ArrowDown') setTimelineH((h) => Math.max(140, h - 20));
          }}
          className="h-1.5 cursor-row-resize bg-ink-800 hover:bg-brand-500/60"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
        />
        <section style={{ height: timelineH }} className="shrink-0 border-t border-ink-800 bg-ink-900" aria-label="Línea de tiempo">
          <Timeline />
        </section>
      </div>
      {/* Pantallas pequeñas: visor arriba y una sección a la vez */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <div className="h-[38vh] shrink-0">
          <Viewer compact />
        </div>
        <nav className="flex border-y border-ink-800 bg-ink-900" aria-label="Secciones">
          {(
            [
              ['library', 'Medios y generar'],
              ['timeline', 'Montaje'],
              ['inspector', 'Ajustes'],
            ] as [MobileTab, string][]
          ).map(([k, label]) => (
            <button key={k} aria-pressed={mobileTab === k} onClick={() => setMobileTab(k)} className={`flex-1 py-2.5 text-sm ${mobileTab === k ? 'border-b-2 border-brand-400 text-white' : 'text-ink-400'}`}>
              {label}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-auto bg-ink-900">
          {mobileTab === 'library' && <LeftPanel />}
          {mobileTab === 'timeline' && <Timeline compact />}
          {mobileTab === 'inspector' && <Inspector />}
        </div>
      </div>
      {exportOpen && <ExportDialog />}
      {aiOpen && <AiSettingsModal />}
      {extendId && <ExtendDialog clipId={extendId} />}
    </div>
  );
}
