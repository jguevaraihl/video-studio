/**
 * Procesador de color en WebGL2: brillo, contraste, saturación, temperatura y LUT 3D.
 * Mismas fórmulas que adjustPixel/sampleLut en @vs/project/color.ts.
 * Si WebGL2 no está disponible se usa applyColorCpu.
 */
import { applyColorCpu, type ColorAdjust, type Lut3D } from '@vs/project';
import type { Drawable } from './frames.ts';

const VERT = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() {
  uv = vec2((pos.x + 1.0) * 0.5, 1.0 - (pos.y + 1.0) * 0.5);
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv;
out vec4 outColor;
uniform sampler2D src;
uniform sampler3D lut;
uniform float brightness, contrast, saturation, temperature, lutMix, lutSize;
void main() {
  vec4 c = texture(src, uv);
  vec3 rgb = c.rgb + brightness * 0.4;
  rgb = (rgb - 0.5) * (1.0 + contrast) + 0.5;
  float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = vec3(l) + (rgb - vec3(l)) * (1.0 + saturation);
  rgb.r += temperature * 0.1;
  rgb.b -= temperature * 0.1;
  rgb = clamp(rgb, 0.0, 1.0);
  if (lutMix > 0.0) {
    vec3 coord = rgb * ((lutSize - 1.0) / lutSize) + 0.5 / lutSize;
    vec3 graded = texture(lut, coord).rgb;
    rgb = mix(rgb, graded, lutMix);
  }
  outColor = vec4(rgb, c.a);
}`;

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export class ColorProcessor {
  private canvas: AnyCanvas;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private srcTex: WebGLTexture | null = null;
  private lutTextures = new Map<string, WebGLTexture>();
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private cpuCanvas: AnyCanvas | null = null;
  readonly mode: 'webgl2' | 'cpu';

  constructor(private getLut: (id: string) => Lut3D | null) {
    this.canvas = makeCanvas(2, 2);
    this.gl = (this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null) ?? null;
    if (this.gl && this.init(this.gl)) this.mode = 'webgl2';
    else {
      this.gl = null;
      this.mode = 'cpu';
    }
  }

  private init(gl: WebGL2RenderingContext): boolean {
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    try {
      const p = gl.createProgram()!;
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return false;
      this.program = p;
      gl.useProgram(p);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(p, 'pos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      for (const n of ['src', 'lut', 'brightness', 'contrast', 'saturation', 'temperature', 'lutMix', 'lutSize']) this.uniforms[n] = gl.getUniformLocation(p, n);
      gl.uniform1i(this.uniforms.src!, 0);
      gl.uniform1i(this.uniforms.lut!, 1);
      this.srcTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // Textura 3D vacía para cuando no hay LUT.
      this.lutTexture({ id: '__none', title: '', size: 2, data: new Float32Array(24) });
      return true;
    } catch {
      return false;
    }
  }

  private lutTexture(lut: Lut3D): WebGLTexture {
    const gl = this.gl!;
    let t = this.lutTextures.get(lut.id);
    if (t) return t;
    t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data);
    gl.activeTexture(gl.TEXTURE0);
    this.lutTextures.set(lut.id, t);
    return t;
  }

  /** Devuelve un lienzo con el color aplicado. El lienzo se reutiliza: dibújalo antes de la siguiente llamada. */
  process(src: Drawable, w: number, h: number, color: ColorAdjust): AnyCanvas {
    const lut = color.lut ? this.getLut(color.lut.id) : null;
    if (!this.gl) return this.processCpu(src, w, h, color, lut);
    const gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as TexImageSource);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture(lut ?? { id: '__none', title: '', size: 2, data: new Float32Array(24) }));
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(this.uniforms.brightness!, color.brightness);
    gl.uniform1f(this.uniforms.contrast!, color.contrast);
    gl.uniform1f(this.uniforms.saturation!, color.saturation);
    gl.uniform1f(this.uniforms.temperature!, color.temperature);
    gl.uniform1f(this.uniforms.lutMix!, lut ? (color.lut?.intensity ?? 1) : 0);
    gl.uniform1f(this.uniforms.lutSize!, lut?.size ?? 2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }

  private processCpu(src: Drawable, w: number, h: number, color: ColorAdjust, lut: Lut3D | null): AnyCanvas {
    this.cpuCanvas ??= makeCanvas(w, h);
    const c = this.cpuCanvas;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(src as CanvasImageSource, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    applyColorCpu(img.data, color, lut);
    ctx.putImageData(img, 0, 0);
    return c;
  }
}
