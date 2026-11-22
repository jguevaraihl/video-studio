/**
 * Contrato del puente con respuestas simuladas según la documentación de DashScope.
 * Ninguna prueba llega a Internet: fetchFn es un doble que registra cada llamada.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createBridge, ALLOW_BILLING_PHRASE, redact } from '../../apps/bridge/src/server.ts';
import { decide, normalizeTask, pollDelayMs } from '@vs/providers';

type Reply = { status: number; body: unknown } | Error;
const KEY = 'sk-prueba-1234567890abcdef';

let replies: Reply[] = [];
let calls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
let logs: string[] = [];
let base = '';
let close: () => Promise<void>;

const fetchFn = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
  calls.push({ url, init });
  const r = replies.shift();
  if (!r) throw new Error('Sin respuesta simulada');
  if (r instanceof Error) throw r;
  return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: new Headers(), text: async () => JSON.stringify(r.body) };
};

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173', ...(init.headers ?? {}) } });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

const videoReq = (id = 'req_0000000001') => ({
  clientRequestId: id,
  model: 'wan2.7-t2v-2026-04-25',
  operation: 't2v',
  prompt: 'Un faro al atardecer',
  resolution: '720P',
  ratio: '16:9',
  duration: 5,
  promptExtend: true,
});

async function connect(policy: 'free-only' | 'allow-billing' = 'allow-billing') {
  await api('/api/session', { method: 'POST', body: JSON.stringify({ apiKey: KEY, region: 'ap-southeast-1', workspaceId: null }) });
  if (policy === 'allow-billing') await api('/api/policy', { method: 'POST', body: JSON.stringify({ policy, confirmPhrase: ALLOW_BILLING_PHRASE }) });
}

beforeEach(async () => {
  replies = [];
  calls = [];
  logs = [];
  const { server } = createBridge({ fetchFn, log: (l) => logs.push(l) });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((r) => server.close(() => r()));
});
afterEach(() => close());

describe('puente local', () => {
  it('rechaza orígenes no permitidos', async () => {
    const r = await api('/api/health', { headers: { Origin: 'https://evil.example' } });
    expect(r.status).toBe(403);
  });

  it('no devuelve la clave y la política inicial es «solo cuota gratuita»', async () => {
    const r = await api('/api/session', { method: 'POST', body: JSON.stringify({ apiKey: KEY, region: 'ap-southeast-1' }) });
    expect(JSON.stringify(r.json)).not.toContain(KEY);
    expect(r.json.session.policy).toBe('free-only');
    expect(r.json.session.keyHint).toBe('…cdef');
  });

  it('bloquea la generación en «solo cuota gratuita» sin llamar al proveedor', async () => {
    await connect('free-only');
    const r = await api('/api/video/tasks', { method: 'POST', body: JSON.stringify(videoReq()) });
    expect(r.status).toBe(403);
    expect(r.json.error.kind).toBe('blocked-by-policy');
    expect(calls).toHaveLength(0);
  });

  it('exige la frase exacta para permitir consumo', async () => {
    await connect('free-only');
    const r = await api('/api/policy', { method: 'POST', body: JSON.stringify({ policy: 'allow-billing', confirmPhrase: 'si' }) });
    expect(r.status).toBe(403);
  });

  it('crea la tarea con el cuerpo y las cabeceras documentadas', async () => {
    await connect();
    replies.push({ status: 200, body: { output: { task_id: 'task-abc', task_status: 'PENDING' }, request_id: 'r1' } });
    const r = await api('/api/video/tasks', { method: 'POST', body: JSON.stringify(videoReq()) });
    expect(r.json).toMatchObject({ taskId: 'task-abc', status: 'pending' });
    const c = calls[0]!;
    expect(c.url).toBe('https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis');
    expect(c.init?.headers?.['X-DashScope-Async']).toBe('enable');
    expect(c.init?.headers?.Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(c.init!.body!);
    expect(body).toMatchObject({ model: 'wan2.7-t2v-2026-04-25', input: { prompt: 'Un faro al atardecer' }, parameters: { resolution: '720P', ratio: '16:9', duration: 5, prompt_extend: true } });
  });

  it('el mismo clientRequestId no crea una segunda tarea', async () => {
    await connect();
    replies.push({ status: 200, body: { output: { task_id: 'task-abc', task_status: 'PENDING' } } });
    await api('/api/video/tasks', { method: 'POST', body: JSON.stringify(videoReq()) });
    const r2 = await api('/api/video/tasks', { method: 'POST', body: JSON.stringify(videoReq()) });
    expect(r2.json).toMatchObject({ taskId: 'task-abc', deduplicated: true });
    expect(calls).toHaveLength(1);
  });

  it('envío ambiguo (corte de red): no se reenvía solo', async () => {
    await connect();
    replies.push(new Error('socket hang up'));
    const r1 = await api('/api/video/tasks', { method: 'POST', body: JSON.stringify(videoReq()) });
    expect(r1.json.error.ambiguousSubmit).toBe(true);
    const r2 = await api('/api/video/tasks', { method: 'POST', body: JSON.stringify(videoReq()) });
    expect(r2.status).toBe(409);
    expect(r2.json.error.ambiguousSubmit).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('clave inválida (401 InvalidApiKey)', async () => {
    await connect();
    replies.push({ status: 401, body: { code: 'InvalidApiKey', message: 'Invalid API-key provided.' } });
    const r = await api('/api/video/tasks', { method: 'POST', body: JSON.stringify(videoReq()) });
    expect(r.status).toBe(401);
    expect(r.json.error.kind).toBe('invalid-key');
    expect(r.json.error.ambiguousSubmit).toBe(false);
  });

  it('cuota agotada con la protección activa (403 AllocationQuota.FreeTierOnly)', async () => {
    await connect();
    replies.push({ status: 403, body: { code: 'AllocationQuota.FreeTierOnly', message: 'The free tier of the model has been exhausted.' } });
    const r = await api('/api/video/tasks', { method: 'POST', body: JSON.stringify(videoReq()) });
    expect(r.json.error.kind).toBe('free-tier-only-exhausted');
  });

  it('saldo insuficiente (Arrearage)', async () => {
    await connect();
    replies.push({ status: 400, body: { code: 'Arrearage', message: 'Access denied, please make sure your account is in good standing.' } });
    const r = await api('/api/video/tasks', { method: 'POST', body: JSON.stringify(videoReq()) });
    expect(r.json.error.kind).toBe('quota-exhausted');
  });

  it('consulta: límite de frecuencia y luego éxito', async () => {
    await connect();
    replies.push({ status: 429, body: { code: 'Throttling', message: 'Requests throttling triggered.' } });
    replies.push({ status: 200, body: { output: { task_id: 'task-abc', task_status: 'SUCCEEDED', video_url: 'https://dashscope-result.oss-ap-southeast-1.aliyuncs.com/x.mp4?Expires=9999999999' }, usage: { duration: 5, SR: 720 } } });
    const r1 = await api('/api/video/tasks/task-abc');
    expect(r1.json.error.kind).toBe('rate-limited');
    expect(pollDelayMs(1, true)).toBeGreaterThan(pollDelayMs(1, false));
    const r2 = await api('/api/video/tasks/task-abc');
    expect(r2.json.task).toMatchObject({ status: 'succeeded', usage: { duration: 5 } });
    expect(calls[1]!.url).toBe('https://dashscope-intl.aliyuncs.com/api/v1/tasks/task-abc');
  });

  it('resultado vencido: no intenta descargar', async () => {
    await connect();
    replies.push({ status: 200, body: { output: { task_id: 'task-old', task_status: 'SUCCEEDED', video_url: 'https://dashscope-result.oss-ap-southeast-1.aliyuncs.com/x.mp4?Expires=1000' } } });
    const r = await api('/api/video/tasks/task-old/result');
    expect(r.json.error.kind).toBe('expired');
  });

  it('tarea desconocida tras 24 h (UNKNOWN)', () => {
    const t = normalizeTask({ output: { task_id: 't', task_status: 'UNKNOWN' } });
    expect(t.status).toBe('unknown');
  });

  it('la URL de resultado ajena a Alibaba se rechaza', async () => {
    await connect();
    replies.push({ status: 200, body: { output: { task_id: 'task-x', task_status: 'SUCCEEDED', video_url: 'https://example.com/x.mp4' } } });
    const r = await api('/api/video/tasks/task-x/result');
    expect(r.json.error.kind).toBe('invalid-request');
  });

  it('los registros no contienen la clave', async () => {
    await connect();
    replies.push({ status: 500, body: { code: 'InternalError', message: `fallo con Bearer ${KEY}` } });
    await api('/api/video/tasks', { method: 'POST', body: JSON.stringify(videoReq('req_0000000002')) });
    expect(logs.join('\n')).not.toContain(KEY);
    expect(redact(`Authorization: Bearer ${KEY}`, KEY)).not.toContain(KEY);
  });
});

describe('política de gasto', () => {
  const plan = { operation: 't2v' as const, model: 'wan2.7-t2v-2026-04-25', region: 'ap-southeast-1' as const, maxRequests: 1, dataOut: [] };
  it('solo cuota gratuita bloquea porque no se puede acreditar la protección', () => {
    const d = decide('free-only', plan, { maxSegmentsPerOperation: 3 });
    expect(d.allowed).toBe(false);
  });
  it('permitir consumo respeta el límite de tramos y marca el costo como no verificado', () => {
    expect(decide('allow-billing', { ...plan, maxRequests: 4 }, { maxSegmentsPerOperation: 3 }).allowed).toBe(false);
    const d = decide('allow-billing', plan, { maxSegmentsPerOperation: 3 });
    expect(d.allowed).toBe(true);
    expect(d.cost).toEqual({ verified: false, label: 'costo no verificado' });
  });
});

describe('Gemini (nivel gratuito, solo texto y visión)', () => {
  const GKEY = 'AIzaPrueba-1234567890abcdef';
  const connectGemini = () => api('/api/session', { method: 'POST', body: JSON.stringify({ apiKey: GKEY, provider: 'gemini' }) });

  it('en «Solo cuota gratuita» envía el chat a la API de Gemini con Bearer y sin response_format', async () => {
    const s = await connectGemini();
    expect(s.json.session.provider).toBe('gemini');
    expect(s.json.session.policy).toBe('free-only');
    replies.push({ status: 200, body: { choices: [{ message: { role: 'assistant', content: '{"explanation":"ok","commands":[]}' } }] } });
    const r = await api('/api/text/chat', { method: 'POST', body: JSON.stringify({ model: 'gemini-3.5-flash', messages: [{ role: 'user', content: 'hola json' }], json: true }) });
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(calls[0]!.init!.headers!.Authorization).toBe(`Bearer ${GKEY}`);
    const body = JSON.parse(calls[0]!.init!.body!);
    expect(body.model).toBe('gemini-3.5-flash');
    expect(body.response_format).toBeUndefined();
    expect(body.messages[0].role).toBe('system');
    expect(JSON.stringify(r.json)).not.toContain(GKEY);
  });

  it('visión usa el id real del modelo (sin sufijo)', async () => {
    await connectGemini();
    replies.push({ status: 200, body: { choices: [{ message: { role: 'assistant', content: '{"chapters":[{"seconds":0,"title":"Inicio","description":""}]}' } }] } });
    const r = await api('/api/vision/analyze', { method: 'POST', body: JSON.stringify({ model: 'gemini-3.5-flash#vision', frames: [{ seconds: 0, dataUri: 'data:image/jpeg;base64,AAAA' }] }) });
    expect(r.status).toBe(200);
    expect(JSON.parse(calls[0]!.init!.body!).model).toBe('gemini-3.5-flash');
  });

  it('no genera video ni transcribe, y no llama al proveedor', async () => {
    await connectGemini();
    const v = await api('/api/video/tasks', { method: 'POST', body: JSON.stringify(videoReq()) });
    expect(v.status).toBeGreaterThanOrEqual(400);
    const a = await api('/api/asr/transcribe', { method: 'POST', body: JSON.stringify({ model: 'qwen-audio-3.1-asr-flash', audioDataUri: 'data:audio/wav;base64,AAAA' }) });
    expect(a.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('la política de Alibaba no cambia: «Solo cuota gratuita» sigue bloqueando el texto', async () => {
    await connect('free-only');
    const r = await api('/api/text/chat', { method: 'POST', body: JSON.stringify({ model: 'qwen3.8-max', messages: [{ role: 'user', content: 'hola' }] }) });
    expect(r.status).toBe(403);
    expect(calls).toHaveLength(0);
    expect(decide('free-only', { operation: 'text', model: 'gemini-3.5-flash', region: 'ap-southeast-1', provider: 'gemini', maxRequests: 1, dataOut: [] }, { maxSegmentsPerOperation: 3 }).allowed).toBe(true);
  });
});
