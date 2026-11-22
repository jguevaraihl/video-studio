/** Visor: dibuja la composición con el mismo motor que la exportación. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatTimecode, projectDuration } from '@vs/project';
import { useStore } from '../../state/store.ts';
import { getPlayer, seek, togglePlay } from '../../lib/player-instance.ts';
import { IconButton } from '../../ui/kit.tsx';
import { ILoop, IPause, IPlay, ISkipBack, ISkipFwd } from '../../ui/icons.tsx';
import { Meter } from './Meter.tsx';

export function Viewer({ compact }: { compact?: boolean }) {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const inOut = useStore((s) => s.inOut);
  const loop = useStore((s) => s.loop);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 360 });
  const W = project?.settings.width ?? 1280;
  const H = project?.settings.height ?? 720;

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const scale = Math.min(r.width / W, r.height / H);
      setSize({ w: Math.max(2, Math.floor(W * scale)), h: Math.max(2, Math.floor(H * scale)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  useEffect(() => {
    getPlayer().attach(canvasRef.current);
    return () => getPlayer().attach(null);
  }, []);

  // Repinta en pausa cuando cambia el proyecto, el cabezal o el tamaño.
  useEffect(() => {
    const pl = getPlayer();
    if (!pl.isPlaying) void pl.paint(playhead, true);
  }, [project, playhead, size]);

  if (!project) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const duration = projectDuration(project);
  const fps = project.settings.fps;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={boxRef} className="relative flex min-h-0 flex-1 items-center justify-center bg-black p-2">
        <canvas
          ref={canvasRef}
          data-testid="viewer-canvas"
          width={Math.round(size.w * dpr)}
          height={Math.round(size.h * dpr)}
          style={{ width: size.w, height: size.h }}
          className="checker shadow-2xl"
          aria-label="Vista previa del video"
          onClick={() => togglePlay()}
        />
      </div>
      <div className="flex items-center gap-1 border-t border-ink-800 bg-ink-900 px-2 py-1.5">
        <IconButton label="Ir al inicio" shortcut="Inicio" onClick={() => seek(0)}><ISkipBack /></IconButton>
        <IconButton label={playing ? 'Pausar' : 'Reproducir'} shortcut="Espacio" onClick={() => togglePlay()} data-testid="play"><>{playing ? <IPause /> : <IPlay />}</></IconButton>
        <IconButton label="Ir al final" shortcut="Fin" onClick={() => seek(duration)}><ISkipFwd /></IconButton>
        <IconButton label="Repetir entrada-salida" active={loop} onClick={() => useStore.getState().setLoop(!loop)}><ILoop /></IconButton>
        <span className="ml-2 font-mono text-xs tabular-nums text-ink-200" aria-label="Tiempo actual">{formatTimecode(playhead, fps)}</span>
        <span className="font-mono text-xs text-ink-500">/ {formatTimecode(duration, fps)}</span>
        {(inOut.in !== null || inOut.out !== null) && !compact && (
          <button className="ml-2 rounded bg-ink-800 px-2 py-0.5 text-[11px] text-ink-300 hover:bg-ink-700" onClick={() => useStore.getState().setInOut({ in: null, out: null })} title="Quitar marcas de entrada y salida">
            E/S {inOut.in !== null ? formatTimecode(inOut.in, fps) : '—'} → {inOut.out !== null ? formatTimecode(inOut.out, fps) : '—'} ✕
          </button>
        )}
        <div className="flex-1" />
        {!compact && <Meter />}
        <span className="ml-2 hidden text-[11px] text-ink-500 sm:inline">{W}×{H} · {(fps.num / fps.den).toFixed(2)} fps</span>
      </div>
    </div>
  );
}
