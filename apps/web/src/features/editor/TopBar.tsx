import { useState } from 'react';
import { useStore } from '../../state/store.ts';
import { Button, IconButton, Kbd, Modal } from '../../ui/kit.tsx';
import { IDownload, IHome, IKey, IRedo, IUndo } from '../../ui/icons.tsx';
import { SHORTCUTS } from './shortcuts.ts';
import { exportPortable } from '../../storage/portable.ts';
import { downloadBlob } from '../../lib/download.ts';
import { useBridgeStatus } from '../generate/bridge-client.ts';

export function TopBar() {
  const name = useStore((s) => s.project?.name ?? '');
  const saveStatus = useStore((s) => s.saveStatus);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const st = useStore.getState();
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const bridge = useBridgeStatus();
  const saveLabel = { idle: 'Sin cambios', saving: 'Guardando…', saved: 'Guardado en este navegador', error: 'Error al guardar' }[saveStatus];

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-ink-800 bg-ink-900 px-2">
      <IconButton label="Inicio" onClick={() => st.closeProject()}><IHome /></IconButton>
      <input
        aria-label="Nombre del proyecto"
        className="h-8 w-40 rounded-md bg-transparent px-2 text-sm font-semibold hover:bg-ink-800 focus:bg-ink-800 focus:outline-none sm:w-64"
        value={name}
        onChange={(e) => {
          const v = e.target.value;
          st.patchSilently((p) => ({ ...p, name: v, updatedAt: Date.now() }));
        }}
      />
      <span className={`hidden text-xs sm:inline ${saveStatus === 'error' ? 'text-rose-400' : 'text-ink-500'}`} role="status">{saveLabel}</span>
      <div className="ml-2 flex items-center">
        <IconButton label="Deshacer" shortcut="Ctrl+Z" disabled={!canUndo} onClick={() => st.undo()}><IUndo /></IconButton>
        <IconButton label="Rehacer" shortcut="Ctrl+Y" disabled={!canRedo} onClick={() => st.redo()}><IRedo /></IconButton>
      </div>
      <div className="flex-1" />
      <Button variant="ghost" size="sm" onClick={() => setHelp(true)} aria-label="Atajos de teclado">Atajos <Kbd>?</Kbd></Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        title="Descarga un .zip con el proyecto y sus medios para abrirlo en otro navegador"
        onClick={async () => {
          const p = useStore.getState().project;
          if (!p) return;
          setBusy(true);
          try {
            const blob = await exportPortable(p);
            downloadBlob(blob, `${p.name.replace(/[^\p{L}\p{N}\- _]+/gu, '') || 'proyecto'}.zip`);
            st.toast('Copia portátil descargada. No incluye claves ni credenciales.', 'success');
          } catch (e) {
            st.toast(e instanceof Error ? e.message : String(e), 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        Copia portátil
      </Button>
      <Button variant="ghost" size="sm" onClick={() => st.setAiSettingsOpen(true)} aria-label="Conexión de IA">
        <IKey /> <span className="hidden sm:inline">IA</span>
        <span className={`h-2 w-2 rounded-full ${bridge.session ? 'bg-emerald-400' : bridge.online ? 'bg-amber-400' : 'bg-ink-500'}`} aria-hidden />
      </Button>
      <Button variant="primary" size="sm" onClick={() => st.setExportOpen(true)} data-testid="open-export"><IDownload /> Exportar</Button>
      {help && (
        <Modal title="Atajos de teclado" onClose={() => setHelp(false)}>
          <ul className="grid gap-1.5 text-sm">
            {SHORTCUTS.map(([k, d]) => (
              <li key={k} className="flex justify-between gap-4"><span className="text-ink-300">{d}</span><Kbd>{k}</Kbd></li>
            ))}
          </ul>
        </Modal>
      )}
    </header>
  );
}
