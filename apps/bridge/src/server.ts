/**
 * Puente local opcional para IA (BYOK).
 * - Escucha en loopback (127.0.0.1) por defecto y solo acepta orígenes permitidos.
 * - Guarda la clave únicamente en memoria de proceso. Nunca la escribe en disco, logs ni respuestas.
 * - Reenvía solo a hosts oficiales de Alibaba Cloud (aliyuncs.com) y de la API de Gemini (generativelanguage.googleapis.com).
 * - Aplica la política de gasto antes de cada solicitud facturable.
 * El editor funciona sin este puente.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { z } from 'zod';
import {
  ALLOWED_UPSTREAM_HOST,
  isAllowedUpstream,
  AUX_MODELS,
  REGIONS,
  VIDEO_MODELS,
  ProviderError,
  RECOVERY,
  analyzeFrames,
  buildVideoBody,
  chat,
  createVideoTask,
  decide,
  findVideoModel,
  getTask,
  transcribe,
  VideoTaskRequestSchema,
  type Credentials,
  type FetchLike,
  type OperationPlan,
  type Region,
  type SpendPolicy,
} from '@vs/providers';

export const VERSION = '0.1.0';
const MAX_BODY = 40 * 1024 * 1024;
export const ALLOW_BILLING_PHRASE = 'PERMITIR CONSUMO';

interface Session {
  creds: Credentials;
  policy: SpendPolicy;
  maxSegmentsPerOperation: number;
  connectedAt: number;
}

interface SubmitRecord {
  state: 'submitting' | 'submitted' | 'ambiguous' | 'rejected';
  taskId?: string;
  model?: string;
}

export interface BridgeOptions {
  fetchFn?: FetchLike;
  allowedOrigins?: string[];
  log?: (line: string) => void;
}

const SessionBody = z.object({
  apiKey: z.string().min(8).max(300),
  provider: z.enum(['alibaba', 'gemini']).default('alibaba'),
  region: z.enum(['ap-southeast-1', 'cn-beijing']).default('ap-southeast-1'),
  workspaceId: z.string().regex(/^[\w-]{1,80}$/).nullable().optional(),
});
const PolicyBody = z.object({
  policy: z.enum(['free-only', 'allow-billing']),
  confirmPhrase: z.string().optional(),
  maxSegmentsPerOperation: z.number().int().min(1).max(20).optional(),
});

/** Quita cualquier rastro de la clave de un texto antes de registrarlo. */
export function redact(text: string, key?: string): string {
  let out = text.replace(/Bearer\s+[\w.-]+/gi, 'Bearer [oculto]').replace(/sk-[\w-]{6,}/g, 'sk-[oculto]');
  if (key) out = out.split(key).join('[oculto]');
  return out;
}

export function createBridge(opts: BridgeOptions = {}): { server: Server; state: { session: Session | null; submits: Map<string, SubmitRecord> } } {
  const fetchFn: FetchLike = opts.fetchFn ?? (async (url, init) => {
    const host = new URL(url).hostname;
    if (!isAllowedUpstream(host)) throw new Error(`Destino no permitido: ${host}`);
    const r = await fetch(url, init);
    return { ok: r.ok, status: r.status, headers: r.headers, text: () => r.text() };
  });
  const allowed = new Set(opts.allowedOrigins ?? ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5174', 'http://localhost:5174', 'http://127.0.0.1:4173', 'http://localhost:4173']);
  const log = opts.log ?? ((l: string) => console.log(l));
  const state = { session: null as Session | null, submits: new Map<string, SubmitRecord>() };

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin' });
    res.end(JSON.stringify(body));
  };
  const fail = (res: ServerResponse, e: unknown) => {
    if (e instanceof ProviderError) return send(res, e.kind === 'blocked-by-policy' ? 403 : e.status && e.status >= 400 && e.status < 600 ? e.status : 502, { error: { kind: e.kind, code: e.code, message: e.message, ambiguousSubmit: e.ambiguousSubmit } });
    if (e instanceof z.ZodError) return send(res, 400, { error: { kind: 'invalid-request', message: 'Solicitud no válida: ' + e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } });
    return send(res, 500, { error: { kind: 'unknown', message: redact(e instanceof Error ? e.message : String(e), state.session?.creds.apiKey) } });
  };

  const readBody = (req: IncomingMessage): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new ProviderError('invalid-request', 'La solicitud supera 40 MB.'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch {
          reject(new ProviderError('invalid-request', 'JSON no válido.'));
        }
      });
      req.on('error', reject);
    });

  const publicSession = () =>
    state.session
      ? {
          connected: true,
          provider: state.session.creds.provider ?? 'alibaba',
          region: state.session.creds.region,
          regionLabel: state.session.creds.provider === 'gemini' ? 'Google Gemini (nivel gratuito)' : REGIONS[state.session.creds.region].label,
          workspaceId: state.session.creds.workspaceId ?? null,
          policy: state.session.policy,
          maxSegmentsPerOperation: state.session.maxSegmentsPerOperation,
          keyHint: `…${state.session.creds.apiKey.slice(-4)}`,
          connectedAt: state.session.connectedAt,
        }
      : null;

  const requireSession = (): Session => {
    if (!state.session) throw new ProviderError('invalid-key', 'No hay sesión de IA. Pega tu clave en «Conexión de IA».', null, 401);
    return state.session;
  };

  const enforce = (s: Session, plan: OperationPlan) => {
    const d = decide(s.policy, { ...plan, provider: s.creds.provider ?? 'alibaba' }, { maxSegmentsPerOperation: s.maxSegmentsPerOperation });
    if (!d.allowed) throw new ProviderError('blocked-by-policy', d.reason, 'POLICY', 403);
    return d;
  };

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const host = req.headers.host ?? '';
    // Solo orígenes permitidos (o sin Origin: llamadas del proxy de Vite al mismo host local).
    if (origin && !allowed.has(origin)) return send(res, 403, { error: { kind: 'blocked-by-policy', message: 'Origen no permitido.' } });
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return send(res, 403, { error: { kind: 'blocked-by-policy', message: 'Host no permitido.' } });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE');
    }
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const url = new URL(req.url ?? '/', 'http://local');
    const path = url.pathname;
    log(`[puente] ${req.method} ${path}`);
    try {
      if (req.method === 'GET' && path === '/api/health') {
        return send(res, 200, { ok: true, version: VERSION, session: publicSession() });
      }
      if (req.method === 'GET' && path === '/api/catalog') {
        return send(res, 200, { video: VIDEO_MODELS, aux: AUX_MODELS, regions: Object.values(REGIONS).map((r) => ({ id: r.id, label: r.label, freeQuotaEligible: r.freeQuotaEligible })) });
      }
      if (req.method === 'POST' && path === '/api/session') {
        const b = SessionBody.parse(await readBody(req));
        // La clave no se verifica aquí para no gastar: se valida en la primera solicitud real.
        state.session = { creds: { apiKey: b.apiKey.trim(), region: b.region as Region, workspaceId: b.provider === 'gemini' ? null : (b.workspaceId ?? null), provider: b.provider }, policy: 'free-only', maxSegmentsPerOperation: 3, connectedAt: Date.now() };
        return send(res, 200, { session: publicSession() });
      }
      if (req.method === 'DELETE' && path === '/api/session') {
        state.session = null;
        state.submits.clear();
        return send(res, 200, { session: null });
      }
      if (req.method === 'POST' && path === '/api/policy') {
        const s = requireSession();
        const b = PolicyBody.parse(await readBody(req));
        if (b.policy === 'allow-billing' && b.confirmPhrase !== ALLOW_BILLING_PHRASE) {
          throw new ProviderError('blocked-by-policy', `Para permitir consumo escribe exactamente «${ALLOW_BILLING_PHRASE}».`, 'POLICY', 403);
        }
        s.policy = b.policy;
        if (b.maxSegmentsPerOperation) s.maxSegmentsPerOperation = b.maxSegmentsPerOperation;
        return send(res, 200, { session: publicSession() });
      }
      if (req.method === 'POST' && path === '/api/preflight') {
        const plan = { ...((await readBody(req)) as OperationPlan), provider: state.session?.creds.provider ?? 'alibaba' } as OperationPlan;
        const policy = state.session?.policy ?? 'free-only';
        const d = decide(policy, plan, { maxSegmentsPerOperation: state.session?.maxSegmentsPerOperation ?? 3 });
        return send(res, 200, { decision: d, connected: !!state.session });
      }
      if (req.method === 'POST' && path === '/api/video/preview-body') {
        // Muestra el JSON exacto que se enviaría (sin enviarlo). Los datos Base64 se acortan.
        const r = VideoTaskRequestSchema.parse(await readBody(req));
        const { body } = buildVideoBody(r);
        return send(res, 200, { body: JSON.parse(JSON.stringify(body, (_k, v) => (typeof v === 'string' && v.startsWith('data:') ? `${v.slice(0, 40)}… (${v.length} caracteres)` : v))) });
      }
      if (req.method === 'POST' && path === '/api/video/tasks') {
        const s = requireSession();
        const raw = (await readBody(req)) as { clientRequestId?: string; segments?: number };
        const clientRequestId = z.string().min(8).max(80).parse(raw.clientRequestId);
        const r = VideoTaskRequestSchema.parse(raw);
        if (s.creds.provider === 'gemini') throw new ProviderError('model-unavailable', 'Con Gemini la app no genera video. Conecta una clave de Alibaba Cloud para eso.', null, 400);
        const model = findVideoModel(r.model);
        enforce(s, { operation: r.operation, model: r.model, region: s.creds.region, maxRequests: Math.max(1, Number(raw.segments ?? 1)), videoSeconds: r.duration, resolution: r.resolution, dataOut: [] });
        if (!model?.regions.includes(s.creds.region)) throw new ProviderError('region-mismatch', RECOVERY['region-mismatch']);
        const prev = state.submits.get(clientRequestId);
        if (prev?.state === 'submitted') return send(res, 200, { taskId: prev.taskId, status: 'pending', deduplicated: true });
        if (prev && (prev.state === 'submitting' || prev.state === 'ambiguous')) {
          throw new ProviderError('network', 'Este envío ya se intentó y su resultado es incierto. No se reenvía automáticamente para no cobrar dos veces. Revisa las tareas en la consola de Alibaba o confirma un envío nuevo.', 'AMBIGUOUS_SUBMIT', 409, true);
        }
        state.submits.set(clientRequestId, { state: 'submitting', model: r.model });
        try {
          const t = await createVideoTask(fetchFn, s.creds, r);
          state.submits.set(clientRequestId, { state: 'submitted', taskId: t.taskId, model: r.model });
          return send(res, 200, { taskId: t.taskId, status: t.status.toLowerCase() });
        } catch (e) {
          state.submits.set(clientRequestId, { state: e instanceof ProviderError && e.ambiguousSubmit ? 'ambiguous' : 'rejected' });
          if (!(e instanceof ProviderError && e.ambiguousSubmit)) state.submits.delete(clientRequestId);
          throw e;
        }
      }
      const taskMatch = path.match(/^\/api\/video\/tasks\/([\w-]+)$/);
      if (req.method === 'GET' && taskMatch) {
        const s = requireSession();
        const t = await getTask(fetchFn, s.creds, taskMatch[1]!);
        return send(res, 200, { task: t });
      }
      const dlMatch = path.match(/^\/api\/video\/tasks\/([\w-]+)\/result$/);
      if (req.method === 'GET' && dlMatch) {
        // Descarga controlada: el puente vuelve a consultar la tarea y solo baja la URL oficial.
        const s = requireSession();
        const t = await getTask(fetchFn, s.creds, dlMatch[1]!);
        if (t.status !== 'succeeded' || !t.videoUrl) throw new ProviderError('expired', t.status === 'unknown' ? RECOVERY.expired : 'La tarea todavía no tiene resultado.');
        const u = new URL(t.videoUrl);
        if (u.protocol !== 'https:' || !ALLOWED_UPSTREAM_HOST.test(u.hostname)) throw new ProviderError('invalid-request', 'La URL del resultado no pertenece a Alibaba Cloud.');
        if (t.expiresAt && t.expiresAt < Date.now()) throw new ProviderError('expired', RECOVERY.expired);
        const up = await fetch(t.videoUrl);
        if (!up.ok || !up.body) throw new ProviderError(up.status === 403 ? 'expired' : 'network', up.status === 403 ? RECOVERY.expired : RECOVERY.network, null, up.status);
        res.writeHead(200, { 'Content-Type': up.headers.get('content-type') ?? 'video/mp4', 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Usage': JSON.stringify(t.usage ?? {}) });
        const reader = up.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        return res.end();
      }
      if (req.method === 'POST' && path === '/api/text/chat') {
        const s = requireSession();
        const b = z.object({ model: z.string(), messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(60_000) })).min(1).max(40), json: z.boolean().optional() }).parse(await readBody(req));
        enforce(s, { operation: 'text', model: b.model, region: s.creds.region, maxRequests: 1, dataOut: [] });
        const content = await chat(fetchFn, s.creds, b);
        return send(res, 200, { content });
      }
      if (req.method === 'POST' && path === '/api/vision/analyze') {
        const s = requireSession();
        const b = z.object({ model: z.string(), frames: z.array(z.object({ seconds: z.number().nonnegative(), dataUri: z.string().startsWith('data:image/') })).min(1).max(16) }).parse(await readBody(req));
        enforce(s, { operation: 'vision', model: b.model, region: s.creds.region, maxRequests: 1, dataOut: [] });
        return send(res, 200, await analyzeFrames(fetchFn, s.creds, b));
      }
      if (req.method === 'POST' && path === '/api/asr/transcribe') {
        const s = requireSession();
        const b = z.object({ model: z.string(), audioDataUri: z.string().startsWith('data:audio/'), language: z.string().default('es') }).parse(await readBody(req));
        enforce(s, { operation: 'asr', model: b.model, region: s.creds.region, maxRequests: 1, dataOut: [] });
        const r = await transcribe(fetchFn, s.creds, b);
        return send(res, 200, { segments: r.segments });
      }
      return send(res, 404, { error: { kind: 'invalid-request', message: 'Ruta no encontrada.' } });
    } catch (e) {
      log(`[puente] error en ${path}: ${redact(e instanceof Error ? `${e.name} ${e.message}` : String(e), state.session?.creds.apiKey)}`);
      return fail(res, e);
    }
  });
  return { server, state };
}
