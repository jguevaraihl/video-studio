/**
 * Reproducción en el visor. El reloj es el AudioContext: la imagen sigue al audio.
 * En pausa o al buscar, renderiza el fotograma exacto (misma ruta que la exportación).
 */
import { describeAudio, describeFrame, projectDuration, secondsToTicks, ticksToSeconds, type Project, type Ticks } from '@vs/project';
import { AudioLibrary, schedulePlan } from './audio.ts';
import { FrameProvider } from './frames.ts';
import { ColorProcessor } from './gl.ts';
import { getLut } from './luts.ts';
import { renderFrame } from './renderer.ts';
import { blobForAsset } from '../lib/media-service.ts';

export interface PlayerHooks {
  getProject(): Project;
  onTime(t: Ticks): void;
  onEnded(): void;
  getRange(): { from: Ticks; to: Ticks | null; loop: boolean };
}

export class Player {
  readonly frames = new FrameProvider(blobForAsset, { maxWidth: 1280 });
  readonly audio = new AudioLibrary(blobForAsset, 48000);
  readonly color = new ColorProcessor(getLut);
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  readonly analyser: { master: AnalyserNode | null; tracks: Map<string, AnalyserNode> } = { master: null, tracks: new Map() };
  private trackNodes = new Map<string, GainNode>();
  private sources: AudioBufferSourceNode[] = [];
  private playing = false;
  private startCtxTime = 0;
  private startProject = 0;
  private raf = 0;
  private renderToken = 0;
  private canvas: HTMLCanvasElement | null = null;
  private lastPaint: Promise<void> = Promise.resolve();
  private renderBusy = false;

  constructor(private hooks: PlayerHooks) {}

  attach(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
  }

  private audioCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      const an = this.ctx.createAnalyser();
      an.fftSize = 1024;
      this.master.connect(an).connect(this.ctx.destination);
      this.analyser.master = an;
    }
    return this.ctx;
  }

  private trackNode(trackId: string): AudioNode {
    let n = this.trackNodes.get(trackId);
    if (!n) {
      const ctx = this.audioCtx();
      n = ctx.createGain();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      n.connect(an);
      n.connect(this.master!);
      this.analyser.tracks.set(trackId, an);
      this.trackNodes.set(trackId, n);
    }
    return n;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  currentTime(): Ticks {
    if (!this.playing || !this.ctx) return this.startProject;
    return this.startProject + secondsToTicks(this.ctx.currentTime - this.startCtxTime);
  }

  async play(from: Ticks): Promise<void> {
    const p = this.hooks.getProject();
    const ctx = this.audioCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    this.stopSources();
    const range = this.hooks.getRange();
    const end = range.to ?? projectDuration(p);
    let start = from;
    if (start >= end - 1000) start = range.from;
    const plan = describeAudio(p);
    const lead = 0.12; // margen para preparar y programar el audio
    const when = ctx.currentTime + lead;
    this.startProject = start;
    this.startCtxTime = when;
    this.playing = true;
    this.sources = await schedulePlan(ctx, plan, this.audio, p.assets, {
      projectFrom: ticksToSeconds(start),
      projectTo: ticksToSeconds(end),
      when,
      destination: (id) => this.trackNode(id),
    });
    // Si la preparación tardó más que el margen, se resincroniza el reloj.
    if (ctx.currentTime > when) {
      this.stopSources();
      const late = ctx.currentTime + 0.05;
      this.startCtxTime = late;
      this.sources = await schedulePlan(ctx, plan, this.audio, p.assets, {
        projectFrom: ticksToSeconds(start),
        projectTo: ticksToSeconds(end),
        when: late,
        destination: (id) => this.trackNode(id),
      });
    }
    if (!this.playing) {
      this.stopSources();
      return;
    }
    const loop = () => {
      if (!this.playing) return;
      const t = this.currentTime();
      const r = this.hooks.getRange();
      const stopAt = r.to ?? projectDuration(this.hooks.getProject());
      if (t >= stopAt) {
        if (r.loop) {
          void this.play(r.from);
          return;
        }
        this.pause(stopAt);
        this.hooks.onEnded();
        return;
      }
      this.hooks.onTime(t);
      if (!this.renderBusy) {
        this.renderBusy = true;
        void this.paint(t, false).finally(() => (this.renderBusy = false));
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause(at?: Ticks): Ticks {
    const t = at ?? this.currentTime();
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.stopSources();
    this.startProject = t;
    void this.paint(t, true);
    return t;
  }

  private stopSources(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* ya detenida */
      }
      s.disconnect();
    }
    this.sources = [];
  }

  /** Renderiza el instante t. exact=true espera los fotogramas exactos. */
  paint(t: Ticks, exact: boolean): Promise<void> {
    const token = ++this.renderToken;
    const canvas = this.canvas;
    if (!canvas) return Promise.resolve();
    const p = this.hooks.getProject();
    const run = async () => {
      if (token !== this.renderToken && exact) return;
      const desc = describeFrame(p, t, { includeSubtitles: p.subtitles.visibleInViewer || p.subtitles.burnIn });
      // Render fuera de pantalla y copia final: evita parpadeos entre capas.
      const off = new OffscreenCanvas(canvas.width, canvas.height);
      const octx = off.getContext('2d')!;
      octx.setTransform(canvas.width / p.settings.width, 0, 0, canvas.height / p.settings.height, 0, 0);
      await renderFrame(octx, desc, { assets: p.assets, frames: this.frames, color: this.color, exact, streamPrefix: 'view' });
      if (exact && token !== this.renderToken) return;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(off, 0, 0);
      if (!exact) this.frames.gc(5000);
    };
    this.lastPaint = exact ? this.lastPaint.then(run, run) : run();
    return this.lastPaint;
  }

  forgetAsset(id: string): void {
    this.frames.forget(id);
    this.audio.forget(id);
  }

  dispose(): void {
    this.pause();
    this.frames.dispose();
    void this.ctx?.close();
  }
}
