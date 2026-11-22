/** Editor de curva de velocidad: puntos arrastrables (posición en el clip × velocidad). */
import { useRef } from 'react';
import type { SpeedPoint } from '@vs/project';

const W = 260;
const H = 110;
const VMAX = 4;
const VMIN = 0.1;

const toY = (v: number) => H - ((Math.log(v) - Math.log(VMIN)) / (Math.log(VMAX) - Math.log(VMIN))) * H;
const fromY = (y: number) => Math.exp(Math.log(VMIN) + ((H - y) / H) * (Math.log(VMAX) - Math.log(VMIN)));

export function SpeedCurveEditor({ points, onChange, onCommit }: { points: SpeedPoint[]; onChange: (p: SpeedPoint[]) => void; onCommit: () => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const sorted = [...points].sort((a, b) => a.p - b.p);
  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.min(W, Math.max(0, ((e.clientX - r.left) / r.width) * W)), y: Math.min(H, Math.max(0, ((e.clientY - r.top) / r.height) * H)) };
  };
  return (
    <div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none rounded-md bg-ink-950"
        role="img"
        aria-label="Curva de velocidad. Doble clic agrega un punto; clic derecho lo quita."
        onDoubleClick={(e) => {
          const { x, y } = pos(e as unknown as React.PointerEvent);
          onChange([...sorted, { p: x / W, v: +fromY(y).toFixed(2) }].sort((a, b) => a.p - b.p));
          onCommit();
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const { x, y } = pos(e);
          const i = drag.current;
          const next = sorted.map((pt, j) => (j === i ? { p: i === 0 ? 0 : i === sorted.length - 1 ? 1 : x / W, v: +fromY(y).toFixed(2) } : pt));
          onChange(next);
        }}
        onPointerUp={() => {
          if (drag.current !== null) onCommit();
          drag.current = null;
        }}
      >
        {[0.25, 0.5, 1, 2, 4].map((v) => (
          <g key={v}>
            <line x1={0} x2={W} y1={toY(v)} y2={toY(v)} stroke={v === 1 ? '#4b536a' : '#252a38'} />
            <text x={3} y={toY(v) - 2} fontSize={8} fill="#6f7891">{v}×</text>
          </g>
        ))}
        <polyline fill="none" stroke="#a78bfa" strokeWidth={2} points={sorted.map((pt) => `${pt.p * W},${toY(pt.v)}`).join(' ')} />
        {sorted.map((pt, i) => (
          <circle
            key={i}
            cx={pt.p * W}
            cy={toY(pt.v)}
            r={6}
            fill="#22d3ee"
            stroke="#0b0d12"
            className="cursor-grab"
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.target as Element).setPointerCapture(e.pointerId);
              drag.current = i;
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (sorted.length > 2 && i > 0 && i < sorted.length - 1) {
                onChange(sorted.filter((_, j) => j !== i));
                onCommit();
              }
            }}
          >
            <title>{`Posición ${(pt.p * 100).toFixed(0)}% · ${pt.v.toFixed(2)}×`}</title>
          </circle>
        ))}
      </svg>
      <p className="mt-1 text-[11px] text-ink-500">Doble clic: agregar punto. Clic derecho: quitarlo. La duración del clip cambia según la velocidad media.</p>
    </div>
  );
}
