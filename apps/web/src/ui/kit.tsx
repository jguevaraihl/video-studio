/** Componentes básicos de interfaz con nombres accesibles y foco visible. */
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'subtle' | 'danger';

export function Button({ variant = 'subtle', size = 'md', className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  const v = {
    primary: 'bg-gradient-to-r from-brand-500 to-accent-500 text-white shadow-lg shadow-brand-600/20 hover:brightness-110',
    ghost: 'bg-transparent text-ink-200 hover:bg-ink-800',
    subtle: 'bg-ink-800 text-ink-100 hover:bg-ink-700 border border-ink-700',
    danger: 'bg-rose-600/90 text-white hover:bg-rose-600',
  }[variant];
  const s = { sm: 'h-7 px-2 text-xs', md: 'h-9 px-3 text-sm', lg: 'h-12 px-5 text-base' }[size];
  return (
    <button type="button" className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-40 disabled:pointer-events-none ${v} ${s} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function IconButton({ label, shortcut, children, className = '', active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; shortcut?: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-ink-200 transition hover:bg-ink-700 hover:text-white disabled:opacity-35 disabled:pointer-events-none ${active ? 'bg-ink-700 text-white' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Slider({ label, value, min, max, step = 0.01, onChange, onCommit, format, id }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
  format?: (v: number) => string;
  id?: string;
}) {
  const inputId = id ?? `sl-${label.replace(/\W+/g, '-')}`;
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1">
      <label htmlFor={inputId} className="text-xs text-ink-300">{label}</label>
      <span className="text-xs tabular-nums text-ink-400">{format ? format(value) : value.toFixed(2)}</span>
      <input
        id={inputId}
        type="range"
        className="col-span-2 w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onDoubleClick={() => {
          onChange(min < 0 && max > 0 ? 0 : min);
          onCommit?.();
        }}
      />
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-ink-300">
      <span>{label}</span>
      {children}
    </label>
  );
}

export const inputClass = 'h-8 rounded-md border border-ink-700 bg-ink-900 px-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-brand-500 focus:outline-none';

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-ink-800 px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{title}</h3>
        {right}
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`max-h-[92vh] w-full overflow-auto rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-800 bg-ink-900/95 px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton label="Cerrar" shortcut="Esc" onClick={onClose}>✕</IconButton>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const c = {
    info: 'border-sky-700/50 bg-sky-950/40 text-sky-200',
    warn: 'border-amber-700/50 bg-amber-950/40 text-amber-200',
    error: 'border-rose-700/50 bg-rose-950/40 text-rose-200',
    ok: 'border-emerald-700/50 bg-emerald-950/40 text-emerald-200',
  }[kind];
  return <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${c}`}>{children}</div>;
}
