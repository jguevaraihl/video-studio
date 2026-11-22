/** Miniaturas y formas de onda a demanda, con caché acotada. */
import type { Asset } from '@vs/project';
import { FrameProvider } from '../engine/frames.ts';
import { blobForAsset } from './media-service.ts';
import { getPlayer } from './player-instance.ts';

const thumbFrames = new FrameProvider(blobForAsset, { maxWidth: 160 });
const thumbCache = new Map<string, Promise<ImageBitmap | null>>();
const THUMB_LIMIT = 400;

export function thumbnail(asset: Asset, sourceTicks: number): Promise<ImageBitmap | null> {
  const key = `${asset.id}:${Math.round(sourceTicks / 705_600_000)}`;
  let p = thumbCache.get(key);
  if (!p) {
    p = thumbFrames
      .still(asset, sourceTicks)
      .then((w) => (w ? createImageBitmap(w.canvas) : null))
      .catch(() => null);
    thumbCache.set(key, p);
    if (thumbCache.size > THUMB_LIMIT) {
      const first = thumbCache.keys().next().value!;
      void thumbCache.get(first)?.then((b) => b?.close());
      thumbCache.delete(first);
    }
  }
  return p;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (p: Float32Array) => void>();
const peakCache = new Map<string, Promise<{ peaks: Float32Array; perSecond: number } | null>>();
const PEAKS_PER_SECOND = 100;

export function waveform(asset: Asset): Promise<{ peaks: Float32Array; perSecond: number } | null> {
  let p = peakCache.get(asset.id);
  if (!p) {
    p = (async () => {
      const buf = await getPlayer().audio.buffer(asset);
      if (!buf) return null;
      worker ??= (() => {
        const w = new Worker(new URL('../workers/peaks.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<{ id: number; peaks: Float32Array }>) => {
          pending.get(e.data.id)?.(e.data.peaks);
          pending.delete(e.data.id);
        };
        return w;
      })();
      const id = ++seq;
      const channels = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i).slice());
      const buckets = Math.max(1, Math.round(buf.duration * PEAKS_PER_SECOND));
      const peaks = await new Promise<Float32Array>((resolve) => {
        pending.set(id, resolve);
        worker!.postMessage({ id, channels, buckets }, channels.map((c) => c.buffer));
      });
      return { peaks, perSecond: PEAKS_PER_SECOND };
    })().catch(() => null);
    peakCache.set(asset.id, p);
  }
  return p;
}
