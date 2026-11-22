/** Cliente del puente local (/api, mismo origen vía proxy). El editor funciona sin él. */
import { useEffect, useState } from 'react';
import type { AuxModel, OperationPlan, PolicyDecision, VideoModel, NormalizedTask } from '@vs/providers';

export interface BridgeSession {
  connected: true;
  provider: 'alibaba' | 'gemini';
  region: 'ap-southeast-1' | 'cn-beijing';
  regionLabel: string;
  workspaceId: string | null;
  policy: 'free-only' | 'allow-billing';
  maxSegmentsPerOperation: number;
  keyHint: string;
  connectedAt: number;
}

export class BridgeError extends Error {
  constructor(public kind: string, message: string, public ambiguousSubmit = false, public status = 0) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  } catch {
    throw new BridgeError('bridge-offline', 'El puente local de IA no responde. Inícialo con «npm run dev» (o «npm run dev:bridge»). La edición sigue funcionando sin él.');
  }
  if (res.status === 502 || res.status === 504) {
    const text = await res.text();
    if (!text.startsWith('{')) throw new BridgeError('bridge-offline', 'El puente local de IA no está en marcha. Inícialo con «npm run dev:bridge». La edición sigue funcionando sin él.');
    const j = JSON.parse(text) as { error?: { kind: string; message: string; ambiguousSubmit?: boolean } };
    throw new BridgeError(j.error?.kind ?? 'unknown', j.error?.message ?? text, !!j.error?.ambiguousSubmit, res.status);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('json')) {
    if (!res.ok) throw new BridgeError('bridge-offline', 'El puente local de IA no está en marcha.');
    return res as unknown as T;
  }
  const j = (await res.json()) as T & { error?: { kind: string; message: string; ambiguousSubmit?: boolean } };
  if (!res.ok || j.error) throw new BridgeError(j.error?.kind ?? 'unknown', j.error?.message ?? `HTTP ${res.status}`, !!j.error?.ambiguousSubmit, res.status);
  return j;
}

export const bridge = {
  health: () => call<{ ok: boolean; version: string; session: BridgeSession | null }>('/health'),
  catalog: () => call<{ video: VideoModel[]; aux: AuxModel[]; regions: { id: string; label: string; freeQuotaEligible: boolean }[] }>('/catalog'),
  connect: (apiKey: string, region: string, workspaceId: string | null, provider: 'alibaba' | 'gemini' = 'alibaba') =>
    call<{ session: BridgeSession }>('/session', { method: 'POST', body: JSON.stringify({ apiKey, region, workspaceId, provider }) }),
  disconnect: () => call<{ session: null }>('/session', { method: 'DELETE' }),
  setPolicy: (policy: 'free-only' | 'allow-billing', confirmPhrase?: string, maxSegmentsPerOperation?: number) =>
    call<{ session: BridgeSession }>('/policy', { method: 'POST', body: JSON.stringify({ policy, confirmPhrase, maxSegmentsPerOperation }) }),
  preflight: (plan: OperationPlan) => call<{ decision: PolicyDecision; connected: boolean }>('/preflight', { method: 'POST', body: JSON.stringify(plan) }),
  previewBody: (req: unknown) => call<{ body: unknown }>('/video/preview-body', { method: 'POST', body: JSON.stringify(req) }),
  createTask: (req: unknown) => call<{ taskId: string; status: string; deduplicated?: boolean }>('/video/tasks', { method: 'POST', body: JSON.stringify(req) }),
  getTask: (id: string) => call<{ task: NormalizedTask }>(`/video/tasks/${id}`),
  downloadResult: async (id: string): Promise<Blob> => {
    const res = (await call<Response>(`/video/tasks/${id}/result`)) as Response;
    return res.blob();
  },
  chat: (model: string, messages: { role: 'system' | 'user' | 'assistant'; content: string }[], json = false) =>
    call<{ content: string }>('/text/chat', { method: 'POST', body: JSON.stringify({ model, messages, json }) }),
  vision: (model: string, frames: { seconds: number; dataUri: string }[]) =>
    call<{ chapters: { seconds: number; title: string; description: string }[] }>('/vision/analyze', { method: 'POST', body: JSON.stringify({ model, frames }) }),
  transcribe: (model: string, audioDataUri: string, language = 'es') =>
    call<{ segments: { startMs: number; endMs: number; text: string }[] }>('/asr/transcribe', { method: 'POST', body: JSON.stringify({ model, audioDataUri, language }) }),
};

type Status = { online: boolean; session: BridgeSession | null; checked: boolean };
let status: Status = { online: false, session: null, checked: false };
const listeners = new Set<(s: Status) => void>();

export async function refreshBridge(): Promise<Status> {
  try {
    const h = await bridge.health();
    status = { online: true, session: h.session, checked: true };
  } catch {
    status = { online: false, session: null, checked: true };
  }
  listeners.forEach((l) => l(status));
  return status;
}

export function useBridgeStatus(): Status {
  const [s, setS] = useState(status);
  useEffect(() => {
    listeners.add(setS);
    if (!status.checked) void refreshBridge();
    const id = setInterval(() => void refreshBridge(), 20_000);
    return () => {
      listeners.delete(setS);
      clearInterval(id);
    };
  }, []);
  return s;
}
