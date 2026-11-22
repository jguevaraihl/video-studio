/**
 * Renderizador compartido por visor y exportación.
 * Recibe una FrameDescription (de @vs/project) y dibuja en un contexto 2D
 * con coordenadas del proyecto (ancho x alto de salida).
 */
import { isNeutralColor, type Asset, type FrameDescription, type Layer, type TextStyle } from '@vs/project';
import type { ColorProcessor } from './gl.ts';
import type { Drawable, FrameProvider } from './frames.ts';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface RenderEnv {
  assets: Record<string, Asset>;
  frames: FrameProvider;
  color: ColorProcessor;
  /** true: espera fotogramas exactos (exportación/pausa). false: no bloquea (reproducción). */
  exact: boolean;
  /** Clave de flujo por clip: separa visor y exportación. */
  streamPrefix: string;
}

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

let blendCanvas: AnyCanvas | null = null;

function sizeOf(d: Drawable): { w: number; h: number } {
  return { w: (d as { width: number }).width, h: (d as { height: number }).height };
}

interface ResolvedSource {
  layer: Layer;
  image: Drawable | null;
  missing: boolean;
}

/** Obtiene en paralelo las imágenes de todas las capas. */
async function resolveSources(desc: FrameDescription, env: RenderEnv): Promise<ResolvedSource[]> {
  return Promise.all(
    desc.layers.map(async (layer): Promise<ResolvedSource> => {
      if (layer.type === 'media') {
        const asset = env.assets[layer.assetId];
        if (!asset) return { layer, image: null, missing: true };
        const pair = await env.frames.frame(asset, `${env.streamPrefix}:${layer.clipId}`, layer.sourceTime, layer.blend, env.exact);
        if (!pair) return { layer, image: null, missing: !env.exact ? false : true };
        if (pair.b && pair.w > 0.001) {
          // Interpolación por mezcla de fotogramas.
          const { w, h } = sizeOf(pair.a);
          blendCanvas ??= makeCanvas(w, h);
          if (blendCanvas.width !== w || blendCanvas.height !== h) {
            blendCanvas.width = w;
            blendCanvas.height = h;
          }
          const bctx = blendCanvas.getContext('2d') as Ctx2D;
          bctx.globalAlpha = 1;
          bctx.drawImage(pair.a as CanvasImageSource, 0, 0, w, h);
          bctx.globalAlpha = pair.w;
          bctx.drawImage(pair.b as CanvasImageSource, 0, 0, w, h);
          bctx.globalAlpha = 1;
          // Copia para no compartir el lienzo entre capas.
          const copy = makeCanvas(w, h);
          (copy.getContext('2d') as Ctx2D).drawImage(blendCanvas as CanvasImageSource, 0, 0);
          return { layer, image: copy, missing: false };
        }
        return { layer, image: pair.a, missing: false };
      }
      if (layer.type === 'image') {
        const asset = env.assets[layer.assetId];
        const bmp = asset ? await env.frames.image(asset) : null;
        return { layer, image: bmp, missing: !bmp };
      }
      return { layer, image: null, missing: false };
    }),
  );
}

export async function renderFrame(ctx: Ctx2D, desc: FrameDescription, env: RenderEnv): Promise<void> {
  const sources = await resolveSources(desc, env);
  drawResolved(ctx, desc, sources, env);
}

function drawResolved(ctx: Ctx2D, desc: FrameDescription, sources: ResolvedSource[], env: RenderEnv): void {
  const W = desc.width;
  const H = desc.height;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = desc.background;
  ctx.fillRect(0, 0, W, H);
  for (const s of sources) {
    const l = s.layer;
    if (l.type === 'media' || l.type === 'image') {
      if (s.missing) drawMissing(ctx, W, H, env.assets[l.assetId]?.name ?? 'archivo');
      else if (s.image) drawVisual(ctx, W, H, s.image, l, env);
    } else if (l.type === 'text') {
      drawText(ctx, W, H, l.text, l.style, l.transform);
    } else {
      drawSubtitle(ctx, W, H, l.text, l.style);
    }
  }
  ctx.restore();
}

function drawVisual(ctx: Ctx2D, W: number, H: number, image: Drawable, l: Extract<Layer, { type: 'media' | 'image' }>, env: RenderEnv): void {
  const t = l.transform;
  const { w: iw, h: ih } = sizeOf(image);
  let src: Drawable | AnyCanvas = image;
  if (!isNeutralColor(l.color)) src = env.color.process(image, iw, ih, l.color);
  const cx = t.crop.left * iw;
  const cy = t.crop.top * ih;
  const cw = Math.max(1, iw * (1 - t.crop.left - t.crop.right));
  const ch = Math.max(1, ih * (1 - t.crop.top - t.crop.bottom));
  let dw: number;
  let dh: number;
  const ar = cw / ch;
  if (t.fit === 'fill') {
    dw = W;
    dh = H;
  } else if ((t.fit === 'contain') === ar > W / H) {
    dw = W;
    dh = W / ar;
  } else {
    dh = H;
    dw = H * ar;
  }
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, t.opacity));
  ctx.translate(W / 2 + t.x * W, H / 2 + t.y * H);
  ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.scale(t.scale, t.scale);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src as CanvasImageSource, cx, cy, cw, ch, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

function drawMissing(ctx: Ctx2D, W: number, H: number, name: string): void {
  ctx.save();
  ctx.fillStyle = '#2a1f2f';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f0abfc';
  ctx.font = `bold ${Math.round(H * 0.045)}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(`Archivo faltante: ${name}`, W / 2, H / 2);
  ctx.font = `${Math.round(H * 0.03)}px Inter, sans-serif`;
  ctx.fillText('Reubícalo desde la biblioteca para recuperarlo', W / 2, H / 2 + H * 0.06);
  ctx.restore();
}

export function fontString(style: Pick<TextStyle, 'bold' | 'italic' | 'fontFamily'>, px: number): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? '700' : '400'} ${Math.round(px)}px "${style.fontFamily}", Inter, sans-serif`;
}

function drawText(ctx: Ctx2D, W: number, H: number, text: string, style: TextStyle, t: Extract<Layer, { type: 'text' }>['transform']): void {
  const px = style.fontSize * H;
  const lines = text.split('\n');
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, t.opacity));
  ctx.translate(W / 2 + t.x * W, H / 2 + t.y * H);
  ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.scale(t.scale, t.scale);
  ctx.font = fontString(style, px);
  ctx.textAlign = style.align;
  ctx.textBaseline = 'middle';
  const lineH = px * 1.2;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const maxW = Math.max(...widths, 1);
  const totalH = lineH * lines.length;
  const anchorX = style.align === 'left' ? -maxW / 2 : style.align === 'right' ? maxW / 2 : 0;
  if (style.background) {
    ctx.fillStyle = style.background;
    const pad = px * 0.3;
    ctx.fillRect(-maxW / 2 - pad, -totalH / 2 - pad * 0.6, maxW + pad * 2, totalH + pad * 1.2);
  }
  lines.forEach((line, i) => {
    const y = -totalH / 2 + lineH * (i + 0.5);
    if (style.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = px * 0.15;
      ctx.shadowOffsetY = px * 0.04;
    }
    if (style.strokeWidth > 0) {
      ctx.lineWidth = style.strokeWidth * px * 0.1;
      ctx.strokeStyle = style.strokeColor;
      ctx.lineJoin = 'round';
      ctx.strokeText(line, anchorX, y);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, anchorX, y);
    ctx.shadowColor = 'transparent';
  });
  ctx.restore();
}

function wrap(ctx: Ctx2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

function drawSubtitle(ctx: Ctx2D, W: number, H: number, text: string, style: Extract<Layer, { type: 'subtitle' }>['style']): void {
  const px = style.fontSize * H;
  ctx.save();
  ctx.font = `700 ${Math.round(px)}px "${style.fontFamily}", Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrap(ctx, text, W * 0.86);
  const lineH = px * 1.25;
  const bottom = H * (1 - style.bottom);
  lines.forEach((line, i) => {
    const y = bottom - lineH * (lines.length - i - 0.5);
    const w = ctx.measureText(line).width;
    if (style.background) {
      ctx.fillStyle = style.background;
      ctx.fillRect(W / 2 - w / 2 - px * 0.3, y - lineH / 2, w + px * 0.6, lineH);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, W / 2, y);
  });
  ctx.restore();
}
