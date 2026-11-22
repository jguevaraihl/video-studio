import { useStore } from '../state/store.ts';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex max-w-sm flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur ${
            t.kind === 'error' ? 'border-rose-700/60 bg-rose-950/90 text-rose-100' : t.kind === 'success' ? 'border-emerald-700/60 bg-emerald-950/90 text-emerald-100' : 'border-ink-700 bg-ink-850/95 text-ink-100'
          }`}
        >
          <span className="flex-1 leading-snug">{t.text}</span>
          <button className="text-ink-400 hover:text-white" aria-label="Cerrar aviso" onClick={() => dismiss(t.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}
