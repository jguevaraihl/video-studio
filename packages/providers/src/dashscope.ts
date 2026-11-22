/**
 * Adaptadores DashScope: construcción de solicitudes, validación y normalización de respuestas,
 * y clasificación de errores. Sin efectos: reciben un fetch inyectado para poder probarlos
 * con respuestas documentadas sin consumir cuota.
 */
import { z } from 'zod';
import { apiModelId, baseUrl, findVideoModel, type Region, type VideoModel } from './catalog.ts';

export interface Credentials {
  apiKey: string;
  region: Region;
  workspaceId?: string | null;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

// ---------- errores normalizados ----------

export type ProviderErrorKind =
  | 'invalid-key'
  | 'quota-exhausted'
  | 'free-tier-only-exhausted'
  | 'rate-limited'
  | 'content-rejected'
  | 'model-unavailable'
  | 'region-mismatch'
  | 'invalid-request'
  | 'network'
  | 'expired'
  | 'blocked-by-policy'
  | 'unknown';

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly code: string | null = null,
    public readonly status: number | null = null,
    /** true si no es seguro reintentar automáticamente (pudo haberse aceptado y cobrado). */
    public readonly ambiguousSubmit = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Mensajes en español con la forma de recuperarse. */
export const RECOVERY: Record<ProviderErrorKind, string> = {
  'invalid-key': 'La clave no es válida o no pertenece a esta región. Revisa la clave y la región en «Conexión de IA».',
  'quota-exhausted': 'La cuenta no tiene saldo o cuota para este modelo. Revisa la facturación en la consola de Alibaba.',
  'free-tier-only-exhausted': 'Se agotó la cuota gratuita y la protección «Free Quota Only» de Alibaba detuvo la solicitud. No hubo cobro.',
  'rate-limited': 'Demasiadas solicitudes seguidas. Espera un momento; la app reintentará la consulta con espera progresiva.',
  'content-rejected': 'El proveedor rechazó el contenido (moderación). Reformula el texto o cambia la imagen.',
  'model-unavailable': 'El modelo no está disponible para esta cuenta o región. Elige otro modelo del catálogo.',
  'region-mismatch': 'La clave, el modelo y el endpoint deben ser de la misma región. Cambia la región en «Conexión de IA».',
  'invalid-request': 'El proveedor rechazó los parámetros. Revisa duración, resolución o el archivo de entrada.',
  network: 'No hubo conexión con el proveedor. Tu montaje y tu texto se conservan; vuelve a intentarlo.',
  expired: 'El resultado o la tarea ya caducó (24 h). Hay que generar de nuevo.',
  'blocked-by-policy': 'La política de gasto actual bloquea esta solicitud.',
  unknown: 'Error no reconocido del proveedor.',
};

export function classifyError(status: number | null, code: string | null, message: string): ProviderErrorKind {
  const c = (code ?? '').toLowerCase();
  const m = message.toLowerCase();
  if (c === 'allocationquota.freetieronly') return 'free-tier-only-exhausted';
  if (c.includes('invalidapikey') || status === 401 || m.includes('api-key') || m.includes('api key')) return 'invalid-key';
  if (c.includes('arrearage') || c.includes('quota') || m.includes('insufficient balance')) return 'quota-exhausted';
  if (c.includes('throttl') || status === 429) return 'rate-limited';
  if (c.includes('datainspection') || m.includes('inappropriate') || m.includes('green')) return 'content-rejected';
  if (c.includes('modelnotfound') || c.includes('model.accessdenied') || c.includes('model_not_supported') || m.includes('model not exist') || m.includes('does not exist')) return 'model-unavailable';
  if (m.includes('region') || m.includes('workspace')) return 'region-mismatch';
  if (c.includes('invalidparameter') || status === 400) return 'invalid-request';
  return 'unknown';
}

const ErrorBody = z.object({ code: z.string().optional(), message: z.string().optional(), request_id: z.string().optional() }).passthrough();

async function readJson(res: Awaited<ReturnType<FetchLike>>): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ProviderError('unknown', `Respuesta no JSON del proveedor (HTTP ${res.status}).`, null, res.status);
  }
}

function toError(status: number, body: unknown, ambiguous = false): ProviderError {
  const e = ErrorBody.safeParse(body);
  const code = e.success ? (e.data.code ?? null) : null;
  const msg = e.success ? (e.data.message ?? '') : '';
  const kind = classifyError(status, code, msg);
  return new ProviderError(kind, `${RECOVERY[kind]}${msg ? ` (Detalle: ${code ?? ''} ${msg})` : ''}`, code, status, ambiguous);
}

function headers(c: Credentials, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json', ...extra };
}

// ---------- video: creación de tareas ----------

export const VideoTaskRequestSchema = z.object({
  model: z.string(),
  operation: z.enum(['t2v', 'i2v', 'continuation']),
  prompt: z.string().max(5000),
  negativePrompt: z.string().max(500).optional(),
  resolution: z.string(),
  ratio: z.string().optional(),
  duration: z.number().int().positive(),
  promptExtend: z.boolean().default(false),
  /** Imagen inicial: data URI base64 o URL pública. Las URL blob: locales no sirven al proveedor. */
  imageUrl: z.string().optional(),
  /** Clip de referencia para continuación: URL pública. */
  clipUrl: z.string().optional(),
  seed: z.number().int().nonnegative().optional(),
});
export type VideoTaskRequest = z.infer<typeof VideoTaskRequestSchema>;

/** Valida contra el catálogo y devuelve el cuerpo JSON exacto que se enviará. */
export function buildVideoBody(req: VideoTaskRequest): { model: VideoModel; body: Record<string, unknown> } {
  const model = findVideoModel(req.model);
  if (!model) throw new ProviderError('model-unavailable', `El modelo «${req.model}» no está en el catálogo.`);
  if (model.operation !== req.operation) throw new ProviderError('invalid-request', `El modelo «${model.label}» no hace esta operación.`);
  if (!model.resolutions.includes(req.resolution)) throw new ProviderError('invalid-request', `Resolución no admitida: ${req.resolution}. Opciones: ${model.resolutions.join(', ')}.`);
  const d = model.durations;
  if (req.duration < d.min || req.duration > d.max) throw new ProviderError('invalid-request', `Duración fuera de rango (${d.min}–${d.max} s).`);
  if (req.prompt.length > model.promptMaxChars) throw new ProviderError('invalid-request', `El texto supera ${model.promptMaxChars} caracteres.`);
  const parameters: Record<string, unknown> = { duration: req.duration, watermark: false };
  if (model.supportsPromptExtend) parameters.prompt_extend = req.promptExtend;
  if (req.seed !== undefined) parameters.seed = req.seed;
  const input: Record<string, unknown> = { prompt: req.prompt };
  if (req.negativePrompt) input.negative_prompt = req.negativePrompt;
  switch (model.bodyStyle) {
    case 'size':
      parameters.size = model.sizes?.[req.resolution];
      if (!parameters.size) throw new ProviderError('invalid-request', 'Tamaño no definido para esa resolución.');
      break;
    case 'resolution-ratio':
      parameters.resolution = req.resolution;
      if (Array.isArray(model.aspectRatios)) {
        const ratio = req.ratio ?? model.aspectRatios[0]!;
        if (!model.aspectRatios.includes(ratio)) throw new ProviderError('invalid-request', `Proporción no admitida: ${ratio}.`);
        parameters.ratio = ratio;
      }
      break;
    case 'wan27-media': {
      parameters.resolution = req.resolution;
      const media: { type: string; url: string }[] = [];
      if (req.operation === 'i2v') {
        if (!req.imageUrl) throw new ProviderError('invalid-request', 'Falta la imagen inicial.');
        assertRemoteMedia(req.imageUrl, model.input.image?.base64 ?? false);
        media.push({ type: 'first_frame', url: req.imageUrl });
      } else if (req.operation === 'continuation') {
        if (!req.clipUrl) throw new ProviderError('invalid-request', 'Falta el clip de referencia.');
        assertRemoteMedia(req.clipUrl, model.input.video?.base64 ?? false);
        media.push({ type: 'first_clip', url: req.clipUrl });
      }
      input.media = media;
      break;
    }
  }
  return { model, body: { model: apiModelId(model.id), input, parameters } };
}

function assertRemoteMedia(url: string, base64Allowed: boolean): void {
  if (url.startsWith('blob:')) throw new ProviderError('invalid-request', 'Las URL blob: locales no son accesibles para el proveedor.');
  if (url.startsWith('data:')) {
    if (!base64Allowed) throw new ProviderError('invalid-request', 'Este modelo no acepta Base64 para esta entrada; necesita una URL pública.');
    return;
  }
  if (!/^https?:\/\//.test(url)) throw new ProviderError('invalid-request', 'La entrada debe ser una URL HTTP/HTTPS o Base64.');
}

const SubmitResponse = z.object({
  request_id: z.string().optional(),
  output: z.object({ task_id: z.string(), task_status: z.string() }),
});

export async function createVideoTask(fetchFn: FetchLike, c: Credentials, req: VideoTaskRequest, signal?: AbortSignal): Promise<{ taskId: string; status: string; requestId?: string }> {
  const { body } = buildVideoBody(req);
  const url = `${baseUrl(c.region, c.workspaceId)}/api/v1/services/aigc/video-generation/video-synthesis`;
  let res;
  try {
    res = await fetchFn(url, { method: 'POST', headers: headers(c, { 'X-DashScope-Async': 'enable' }), body: JSON.stringify(body), signal });
  } catch (e) {
    // El corte pudo ocurrir después de que el proveedor aceptó la tarea: no reintentar solo.
    throw new ProviderError('network', `${RECOVERY.network} El envío pudo haberse aceptado; revisa antes de volver a enviar para no pagar dos veces.`, null, null, true);
  }
  const json = await readJson(res);
  if (!res.ok) throw toError(res.status, json, res.status >= 500);
  const parsed = SubmitResponse.safeParse(json);
  if (!parsed.success) throw new ProviderError('unknown', 'La respuesta de creación no tiene task_id.', null, res.status, true);
  return { taskId: parsed.data.output.task_id, status: parsed.data.output.task_status, requestId: parsed.data.request_id };
}

// ---------- video: consulta de tareas ----------

export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'unknown';

export interface NormalizedTask {
  taskId: string;
  status: TaskStatus;
  videoUrl: string | null;
  /** Epoch ms en que caduca la URL (24 h según la documentación si no viene Expires). */
  expiresAt: number | null;
  usage: { duration?: number; inputVideoDuration?: number; outputVideoDuration?: number; resolution?: number } | null;
  error: { code: string; message: string; kind: ProviderErrorKind } | null;
  submitTime: string | null;
  endTime: string | null;
}

const TaskResponse = z.object({
  request_id: z.string().optional(),
  output: z
    .object({
      task_id: z.string(),
      task_status: z.string(),
      video_url: z.string().optional(),
      submit_time: z.string().optional(),
      end_time: z.string().optional(),
      code: z.string().optional(),
      message: z.string().optional(),
    })
    .passthrough(),
  usage: z
    .object({
      duration: z.number().optional(),
      input_video_duration: z.number().optional(),
      output_video_duration: z.number().optional(),
      SR: z.number().optional(),
    })
    .passthrough()
    .optional(),
});

export function normalizeTask(json: unknown, now = Date.now()): NormalizedTask {
  const p = TaskResponse.safeParse(json);
  if (!p.success) throw new ProviderError('unknown', 'Respuesta de tarea con formato inesperado.');
  const o = p.data.output;
  const status = (
    { PENDING: 'pending', RUNNING: 'running', SUCCEEDED: 'succeeded', FAILED: 'failed', CANCELED: 'canceled', UNKNOWN: 'unknown' } as Record<string, TaskStatus>
  )[o.task_status] ?? 'unknown';
  let expiresAt: number | null = null;
  if (o.video_url) {
    const m = o.video_url.match(/[?&]Expires=(\d+)/i);
    expiresAt = m ? Number(m[1]) * 1000 : now + 24 * 3600 * 1000;
  }
  const u = p.data.usage;
  return {
    taskId: o.task_id,
    status,
    videoUrl: o.video_url ?? null,
    expiresAt,
    usage: u ? { duration: u.duration, inputVideoDuration: u.input_video_duration, outputVideoDuration: u.output_video_duration, resolution: u.SR } : null,
    error: status === 'failed' ? { code: o.code ?? 'FAILED', message: o.message ?? '', kind: classifyError(null, o.code ?? null, o.message ?? '') } : null,
    submitTime: o.submit_time ?? null,
    endTime: o.end_time ?? null,
  };
}

export async function getTask(fetchFn: FetchLike, c: Credentials, taskId: string, signal?: AbortSignal): Promise<NormalizedTask> {
  if (!/^[\w-]+$/.test(taskId)) throw new ProviderError('invalid-request', 'Identificador de tarea no válido.');
  const url = `${baseUrl(c.region, c.workspaceId)}/api/v1/tasks/${taskId}`;
  let res;
  try {
    res = await fetchFn(url, { method: 'GET', headers: headers(c), signal });
  } catch {
    throw new ProviderError('network', RECOVERY.network);
  }
  const json = await readJson(res);
  if (!res.ok) throw toError(res.status, json);
  return normalizeTask(json);
}

/** Espera progresiva para consultar tareas: 5 s, 8 s, 12 s, 15 s... (la documentación sugiere ~15 s). */
export function pollDelayMs(attempt: number, rateLimited = false): number {
  const base = Math.min(15_000, 5_000 + attempt * 3_500);
  return rateLimited ? Math.min(60_000, base * 2) : base;
}

// ---------- texto (asistente y mejora de prompts) ----------

export const ChatResponse = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).passthrough().optional(),
});

export async function chat(
  fetchFn: FetchLike,
  c: Credentials,
  opts: { model: string; messages: { role: 'system' | 'user' | 'assistant'; content: unknown }[]; json?: boolean; signal?: AbortSignal },
): Promise<string> {
  const url = `${baseUrl(c.region, c.workspaceId)}/compatible-mode/v1/chat/completions`;
  const body: Record<string, unknown> = { model: opts.model, messages: opts.messages };
  if (opts.json) body.response_format = { type: 'json_object' };
  let res;
  try {
    res = await fetchFn(url, { method: 'POST', headers: headers(c), body: JSON.stringify(body), signal: opts.signal });
  } catch {
    throw new ProviderError('network', RECOVERY.network);
  }
  const json = await readJson(res);
  if (!res.ok) throw toError(res.status, (json as { error?: unknown }).error ?? json);
  const p = ChatResponse.safeParse(json);
  if (!p.success) throw new ProviderError('unknown', 'Respuesta de chat con formato inesperado.');
  return p.data.choices[0]!.message.content ?? '';
}

export const PROMPT_ENHANCE_SYSTEM =
  'Eres un director de fotografía. Reescribe la idea del usuario como un prompt para un modelo de texto a video. ' +
  'Escribe en español, en un solo párrafo de 60 a 120 palabras. Describe sujeto, acción, entorno, luz, encuadre y movimiento de cámara. ' +
  'No inventes marcas ni personas reales. Devuelve solo el prompt.';

export const ASSISTANT_SYSTEM =
  'Eres el asistente de edición de un editor de video. Responde SOLO con JSON con la forma ' +
  '{"explanation": string, "commands": Command[]}. Comandos permitidos (tiempos en segundos): ' +
  '{"type":"trimEnd","clipId","seconds"}, {"type":"trimStart","clipId","seconds"}, {"type":"split","atSeconds"}, ' +
  '{"type":"fade","clipId","edge":"in"|"out","seconds"}, {"type":"dissolveToNext","clipId","seconds"}, ' +
  '{"type":"setVolume","clipId","gainDb"}, {"type":"mute","clipId","muted"}, {"type":"setSpeed","clipId","rate"}, ' +
  '{"type":"color","clipId","brightness"?,"contrast"?,"saturation"?,"temperature"?} (valores -1 a 1), ' +
  '{"type":"addTitle","text","atSeconds","durationSeconds"}, {"type":"deleteClip","clipId"}. ' +
  'Usa solo clipId que existan en el proyecto. Si la petición no se puede hacer, devuelve commands vacío y explícalo.';

// ---------- visión ----------

export async function analyzeFrames(
  fetchFn: FetchLike,
  c: Credentials,
  opts: { model: string; frames: { seconds: number; dataUri: string }[]; signal?: AbortSignal },
): Promise<{ raw: string; chapters: { seconds: number; title: string; description: string }[] }> {
  const content: unknown[] = [];
  for (const f of opts.frames) {
    content.push({ type: 'text', text: `Fotograma en ${f.seconds.toFixed(2)} s:` });
    content.push({ type: 'image_url', image_url: { url: f.dataUri } });
  }
  content.push({
    type: 'text',
    text:
      'Analiza los fotogramas en orden. Devuelve JSON {"chapters":[{"seconds":number,"title":string,"description":string}]} ' +
      'usando exactamente los segundos indicados en los fotogramas donde empieza cada escena. Títulos cortos en español.',
  });
  const raw = await chat(fetchFn, c, { model: opts.model, messages: [{ role: 'user', content }], json: true, signal: opts.signal });
  const parsed = z
    .object({ chapters: z.array(z.object({ seconds: z.number(), title: z.string(), description: z.string().default('') })) })
    .safeParse(safeJson(raw));
  if (!parsed.success) throw new ProviderError('unknown', 'La respuesta de visión no tiene capítulos válidos.');
  // Asocia cada capítulo al fotograma enviado más cercano: no se aceptan tiempos inventados.
  const sent = opts.frames.map((f) => f.seconds);
  const chapters = parsed.data.chapters.map((ch) => ({ ...ch, seconds: sent.reduce((best, s) => (Math.abs(s - ch.seconds) < Math.abs(best - ch.seconds) ? s : best), sent[0] ?? 0) }));
  return { raw, chapters };
}

export function safeJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ---------- voz (ASR) ----------

export interface AsrSegment {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * Normaliza la respuesta ASR. Acepta las formas documentadas de resultados con
 * sentences[].begin_time/end_time en ms. Si la respuesta no trae marcas temporales,
 * lanza un error: la app no inventa tiempos.
 */
export function normalizeAsr(json: unknown): AsrSegment[] {
  const sentences: { begin_time?: number; end_time?: number; text?: string }[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const o = node as Record<string, unknown>;
    if (Array.isArray(o.sentences)) {
      for (const s of o.sentences as Record<string, unknown>[]) sentences.push({ begin_time: Number(s.begin_time), end_time: Number(s.end_time), text: String(s.text ?? '') });
      return;
    }
    for (const v of Object.values(o)) visit(v);
  };
  visit(json);
  const valid = sentences.filter((s) => Number.isFinite(s.begin_time) && Number.isFinite(s.end_time) && s.end_time! > s.begin_time! && s.text!.trim());
  if (!valid.length) {
    throw new ProviderError('unknown', 'La respuesta de transcripción no incluye marcas temporales por frase. No se crean subtítulos sin tiempos reales.');
  }
  return valid
    .map((s) => ({ startMs: s.begin_time!, endMs: s.end_time!, text: s.text!.trim() }))
    .sort((a, b) => a.startMs - b.startMs);
}

/** Resuelve solapamientos: el final de un segmento no pasa del inicio del siguiente. */
export function fixOverlaps(segs: AsrSegment[]): AsrSegment[] {
  const out = segs.map((s) => ({ ...s }));
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i]!.endMs > out[i + 1]!.startMs) out[i]!.endMs = Math.max(out[i]!.startMs + 100, out[i + 1]!.startMs);
  }
  return out;
}

/** Traslada segmentos del tiempo del audio extraído al tiempo del proyecto. */
export function asrToProjectSeconds(segs: AsrSegment[], extractStartInProjectSeconds: number): { start: number; end: number; text: string }[] {
  return segs.map((s) => ({ start: extractStartInProjectSeconds + s.startMs / 1000, end: extractStartInProjectSeconds + s.endMs / 1000, text: s.text }));
}

export async function transcribe(
  fetchFn: FetchLike,
  c: Credentials,
  opts: { model: string; audioDataUri: string; language: string; signal?: AbortSignal },
): Promise<{ segments: AsrSegment[]; raw: unknown }> {
  const url = `${baseUrl(c.region, c.workspaceId)}/api/v1/services/aigc/multimodal-generation/generation`;
  const body = {
    model: opts.model,
    input: { messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: opts.audioDataUri } }] }] },
    parameters: { format: 'wav', sample_rate: '16000', asr_options: { language: opts.language } },
  };
  let res;
  try {
    res = await fetchFn(url, { method: 'POST', headers: headers(c, { 'X-DashScope-SSE': 'disable' }), body: JSON.stringify(body), signal: opts.signal });
  } catch {
    throw new ProviderError('network', RECOVERY.network);
  }
  const json = await readJson(res);
  if (!res.ok) throw toError(res.status, json);
  return { segments: fixOverlaps(normalizeAsr(json)), raw: json };
}
