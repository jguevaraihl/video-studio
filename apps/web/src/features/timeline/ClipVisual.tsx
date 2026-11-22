/** Fondo de un clip: forma de onda (audio) o tira de miniaturas (video e imagen). */
import { useEffect, useRef } from 'react';
import { TICKS_PER_SECOND, localToSource, type Clip, type Project } from '@vs/project';
import { thumbnail, waveform } from '../../lib/thumbs.ts';

export function ClipVisual({ clip, project, width, height, zoom }: { clip: Clip; project: Project; width: number; height: number; zoom: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const track = project.tracks.find((t) => t.id === clip.trackId);
  const asset = clip.kind !== 'text' ? project.assets[clip.assetId] : undefined;
  const w = Math.min(4000, Math.max(1, Math.round(width)));

  useEffect(() => {
    const c = ref.current;
    if (!c || !asset) return;
    let cancelled = false;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (track?.kind === 'audio' && clip.kind === 'media') {
      void waveform(asset).then((wf) => {
        if (!wf || cancelled) return;
        ctx.fillStyle = 'rgba(209,250,229,0.75)';
        const mid = c.height / 2 + 6;
        const amp = (c.height - 14) / 2;
        const gain = Math.pow(10, clip.audio.gainDb / 20);
        for (let x = 0; x < c.width; x++) {
          const local = (x / zoom) * TICKS_PER_SECOND;
          const src = localToSource(clip, local) / TICKS_PER_SECOND;
          const v = Math.min(1, (wf.peaks[Math.floor(src * wf.perSecond)] ?? 0) * gain);
          ctx.fillRect(x, mid - v * amp, 1, Math.max(1, v * amp * 2));
        }
      });
    } else if (clip.kind === 'media' || clip.kind === 'image') {
      const thumbW = Math.max(40, Math.round(height * (asset.width / Math.max(1, asset.height))));
      const count = Math.min(40, Math.ceil(c.width / thumbW));
      void (async () => {
        for (let i = 0; i < count && !cancelled; i++) {
          const local = ((i * thumbW) / zoom) * TICKS_PER_SECOND;
          const bmp = clip.kind === 'media' ? await thumbnail(asset, Math.max(0, localToSource(clip, local))) : await createImageBitmapSafe(project, asset.id);
          if (cancelled || !bmp) continue;
          ctx.globalAlpha = 0.55;
          ctx.drawImage(bmp, i * thumbW, 0, thumbW, c.height);
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [clip, asset, track?.kind, w, height, zoom, project]);

  if (!asset) return null;
  return <canvas ref={ref} width={w} height={Math.max(1, Math.round(height))} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}

const imageCache = new Map<string, Promise<ImageBitmap | null>>();
async function createImageBitmapSafe(project: Project, assetId: string): Promise<ImageBitmap | null> {
  let p = imageCache.get(assetId);
  if (!p) {
    const asset = project.assets[assetId]!;
    const { getPlayer } = await import('../../lib/player-instance.ts');
    p = getPlayer().frames.image(asset);
    imageCache.set(assetId, p);
  }
  return p;
}
