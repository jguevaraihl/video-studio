/// <reference lib="webworker" />
/** Calcula picos de forma de onda fuera del hilo principal. */
import { computePeaks } from '@vs/project';

self.onmessage = (e: MessageEvent<{ id: number; channels: Float32Array[]; buckets: number }>) => {
  const { id, channels, buckets } = e.data;
  const peaks = computePeaks(channels, buckets);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, peaks }, [peaks.buffer]);
};
