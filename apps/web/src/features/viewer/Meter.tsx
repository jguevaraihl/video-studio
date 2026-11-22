/** Medidor de nivel del bus principal (pico, en dBFS). */
import { useEffect, useRef } from 'react';
import { getPlayer } from '../../lib/player-instance.ts';

export function Meter() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const buf = new Float32Array(1024);
    const draw = () => {
      const c = ref.current;
      const an = getPlayer().analyser.master;
      if (c) {
        const ctx = c.getContext('2d')!;
        ctx.clearRect(0, 0, c.width, c.height);
        let peak = 0;
        if (an && getPlayer().isPlaying) {
          an.getFloatTimeDomainData(buf);
          for (const v of buf) peak = Math.max(peak, Math.abs(v));
        }
        const db = peak > 0 ? 20 * Math.log10(peak) : -60;
        const frac = Math.max(0, Math.min(1, (db + 60) / 60));
        const g = ctx.createLinearGradient(0, 0, c.width, 0);
        g.addColorStop(0, '#22c55e');
        g.addColorStop(0.75, '#eab308');
        g.addColorStop(0.95, '#ef4444');
        ctx.fillStyle = '#1f2330';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, c.width * frac, c.height);
        c.setAttribute('aria-valuenow', db.toFixed(0));
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} width={120} height={8} className="rounded" role="meter" aria-label="Nivel de salida en dBFS" aria-valuemin={-60} aria-valuemax={0} />;
}
