/**
 * Proveedor de fotogramas. Decodifica con WebCodecs (vía mediabunny) y respeta
 * los timestamps reales del archivo, incluido FPS variable.
 * Funciona en el hilo principal (visor) y en workers (exportación).
 *
 * Cada clip usa un flujo secuencial con una cola acotada de fotogramas.
 * Un salto hacia atrás o lejano reinicia el flujo desde el fotograma clave previo.
 */
import { ALL_FORMATS, BlobSource, CanvasSink, Input, type InputVideoTrack, type WrappedCanvas } from 'mediabunny';
import { TICKS_PER_SECOND, type Asset } from '@vs/project';

export type Drawable = HTMLCanvasElement | OffscreenCanvas | ImageBitmap;

export interface FramePair {
  /** Fotograma con timestamp <= instante pedido. */
  a: Drawable;
  /** Fotograma siguiente, solo si se pidió mezcla. */
  b: Drawable | null;
  /** Peso de b en la mezcla (0..1). */
  w: number;
  timestamp: number;
}

const QUEUE_MAX = 4;
const POOL = QUEUE_MAX + 4;

class ClipStream {
  private iter: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
  private queue: WrappedCanvas[] = [];
  private current: WrappedCanvas | null = null;
  private pumping: Promise<void> | null = null;
  private ended = false;
  private startedAt = -1;
  lastUsed = 0;

  constructor(private sink: CanvasSink) {}

  private restart(fromSeconds: number): void {
    void this.iter?.return(undefined);
    this.iter = this.sink.canvases(fromSeconds);
    this.queue = [];
    this.current = null;
    this.ended = false;
    this.startedAt = fromSeconds;
    this.pumping = null;
  }

  private pump(): Promise<void> {
    if (this.pumping || this.ended || !this.iter) return this.pumping ?? Promise.resolve();
    const iter = this.iter;
    this.pumping = (async () => {
      while (this.queue.length < QUEUE_MAX && iter === this.iter) {
        const r = await iter.next();
        if (iter !== this.iter) return;
        if (r.done) {
          this.ended = true;
          break;
        }
        this.queue.push(r.value);
      }
    })().finally(() => {
      if (iter === this.iter) this.pumping = null;
    });
    return this.pumping;
  }

  /** Avanza la cola hasta el instante ts (segundos absolutos del archivo). */
  private advance(ts: number): void {
    while (this.queue.length && this.queue[0]!.timestamp <= ts + 1e-6) this.current = this.queue.shift()!;
  }

  private needsRestart(ts: number): boolean {
    if (!this.iter) return true;
    if (ts < this.startedAt - 1e-6) return true;
    if (this.current && ts < this.current.timestamp - 1e-6) return true;
    const last = this.queue[this.queue.length - 1] ?? this.current;
    return !!last && ts > last.timestamp + 1.0 && !this.ended;
  }

  /**
   * wait=true (exportación o pausa): espera hasta tener el fotograma exacto.
   * wait=false (reproducción): devuelve el mejor fotograma disponible sin bloquear.
   */
  async frameAt(ts: number, blend: boolean, wait: boolean): Promise<FramePair | null> {
    this.lastUsed = performance.now();
    if (this.needsRestart(ts)) this.restart(Math.max(0, ts - 0.0005));
    if (wait) {
      for (;;) {
        this.advance(ts);
        const nextReady = this.queue.length > 0 || this.ended;
        if (this.current && nextReady) break;
        if (this.ended && !this.current && !this.queue.length) return null;
        await this.pump();
        if (this.ended && !this.queue.length) {
          this.advance(ts);
          break;
        }
      }
    } else {
      this.advance(ts);
      void this.pump();
    }
    const cur = this.current;
    if (!cur) return null;
    const next = this.queue[0] ?? null;
    let w = 0;
    if (blend && next && next.timestamp > cur.timestamp) w = Math.min(1, Math.max(0, (ts - cur.timestamp) / (next.timestamp - cur.timestamp)));
    return { a: cur.canvas, b: blend && next ? next.canvas : null, w, timestamp: cur.timestamp };
  }

  dispose(): void {
    void this.iter?.return(undefined);
    this.iter = null;
    this.queue = [];
    this.current = null;
  }
}

interface AssetEntry {
  input: Input;
  track: InputVideoTrack;
  firstSeconds: number;
  streams: Map<string, ClipStream>;
  still: CanvasSink;
}

export interface FrameProviderOptions {
  /** Ancho máximo de decodificación (visor: reducido; exportación: original). */
  maxWidth?: number;
}

export class FrameProvider {
  private assets = new Map<string, Promise<AssetEntry | null>>();
  private images = new Map<string, Promise<ImageBitmap | null>>();

  constructor(
    private getBlob: (asset: Asset) => Promise<Blob | null>,
    private opts: FrameProviderOptions = {},
  ) {}

  private entry(asset: Asset): Promise<AssetEntry | null> {
    let e = this.assets.get(asset.id);
    if (!e) {
      e = (async () => {
        const blob = await this.getBlob(asset);
        if (!blob) return null;
        const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track) return null;
        const w = await track.getDisplayWidth();
        const h = await track.getDisplayHeight();
        const scale = this.opts.maxWidth && w > this.opts.maxWidth ? this.opts.maxWidth / w : 1;
        const size = { width: Math.round((w * scale) / 2) * 2, height: Math.round((h * scale) / 2) * 2 };
        return {
          input,
          track,
          firstSeconds: asset.firstTimestamp / TICKS_PER_SECOND,
          streams: new Map(),
          still: new CanvasSink(track, { ...size, fit: 'fill', poolSize: 0 }),
          size,
        } as AssetEntry & { size: { width: number; height: number } };
      })().catch((err: unknown) => {
        console.warn('[frames] No se pudo abrir el video:', err);
        return null;
      });
      this.assets.set(asset.id, e);
    }
    return e;
  }

  async image(asset: Asset): Promise<ImageBitmap | null> {
    let p = this.images.get(asset.id);
    if (!p) {
      p = (async () => {
        const blob = await this.getBlob(asset);
        return blob ? createImageBitmap(blob) : null;
      })().catch(() => null);
      this.images.set(asset.id, p);
    }
    return p;
  }

  /** Fotograma para una capa. sourceTicks se cuenta desde el primer timestamp del medio. */
  async frame(asset: Asset, streamKey: string, sourceTicks: number, blend: boolean, wait: boolean): Promise<FramePair | null> {
    const e = (await this.entry(asset)) as (AssetEntry & { size: { width: number; height: number } }) | null;
    if (!e) return null;
    let s = e.streams.get(streamKey);
    if (!s) {
      s = new ClipStream(new CanvasSink(e.track, { ...e.size, fit: 'fill', poolSize: POOL }));
      e.streams.set(streamKey, s);
    }
    return s.frameAt(e.firstSeconds + sourceTicks / TICKS_PER_SECOND, blend, wait);
  }

  /** Fotograma aislado (miniaturas, último fotograma). Devuelve un lienzo propio. */
  async still(asset: Asset, sourceTicks: number): Promise<WrappedCanvas | null> {
    const e = await this.entry(asset);
    if (!e) return null;
    return e.still.getCanvas(e.firstSeconds + sourceTicks / TICKS_PER_SECOND);
  }

  /** Último fotograma decodificable (para continuar una generación). */
  async lastFrame(asset: Asset): Promise<WrappedCanvas | null> {
    const e = await this.entry(asset);
    if (!e) return null;
    const end = await e.track.computeDuration();
    // getCanvas devuelve el último fotograma con inicio <= instante.
    return e.still.getCanvas(end);
  }

  /** Cierra flujos que no se usan desde hace un rato (libera memoria de video). */
  gc(maxIdleMs = 4000): void {
    const now = performance.now();
    for (const p of this.assets.values()) {
      void p.then((e) => {
        if (!e) return;
        for (const [k, s] of e.streams) {
          if (now - s.lastUsed > maxIdleMs) {
            s.dispose();
            e.streams.delete(k);
          }
        }
      });
    }
  }

  forget(assetId: string): void {
    const p = this.assets.get(assetId);
    this.assets.delete(assetId);
    void p?.then((e) => {
      e?.streams.forEach((s) => s.dispose());
      e?.input.dispose();
    });
    const img = this.images.get(assetId);
    this.images.delete(assetId);
    void img?.then((b) => b?.close());
  }

  dispose(): void {
    for (const id of [...this.assets.keys(), ...this.images.keys()]) this.forget(id);
  }
}
