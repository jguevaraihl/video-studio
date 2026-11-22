/**
 * Ciclo de vida de una generación: creación, consulta con espera progresiva,
 * descarga antes de que caduque, importación a la biblioteca y recuperación tras recargar.
 * Un fallo nunca borra el prompt, los archivos ni el montaje.
 */
import { addAsset, newId, ticksToSeconds, type Generation, type Project } from '@vs/project';
import { pollDelayMs, continuationNewSegment, findVideoModel } from './provider-helpers.ts';
import { useStore } from '../../state/store.ts';
import { importFile } from '../../lib/media-service.ts';
import { bridge, BridgeError } from './bridge-client.ts';

const pollers = new Map<string, { stop: boolean }>();

function patchGen(id: string, patch: Partial<Generation>): void {
  useStore.getState().patchSilently((p: Project) => {
    const g = p.generations[id];
    if (!g) return p;
    return { ...p, generations: { ...p.generations, [id]: { ...g, ...patch } } };
  });
}

export function getGen(id: string): Generation | undefined {
  return useStore.getState().project?.generations[id];
}

export interface SubmitInput {
  operation: Generation['operation'];
  model: string;
  region: string;
  prompt: string;
  negativePrompt: string;
  params: { resolution: string; duration: number; ratio?: string; promptExtend: boolean; referenceSeconds?: number };
  imageDataUri?: string;
  clipUrl?: string;
  sourceAssetId?: string | null;
  chain?: Generation['chain'];
}

/** Crea el registro y envía. Devuelve el id local de la generación. */
export async function submitGeneration(input: SubmitInput): Promise<string> {
  const id = newId('gen');
  const gen: Generation = {
    id,
    operation: input.operation,
    provider: 'alibaba',
    model: input.model,
    region: input.region,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    params: { ...input.params, ratio: input.params.ratio ?? null },
    status: 'submitting',
    taskId: null,
    clientRequestId: newId('req'),
    submittedAt: Date.now(),
    finishedAt: null,
    resultUrlExpiresAt: null,
    resultUrl: null,
    assetId: null,
    sourceAssetId: input.sourceAssetId ?? null,
    chain: input.chain ?? null,
    error: null,
    measured: null,
    createdAt: Date.now(),
  };
  useStore.getState().patchSilently((p) => ({ ...p, generations: { ...p.generations, [id]: gen } }));
  await sendExisting(id, input);
  return id;
}

async function sendExisting(id: string, input: SubmitInput): Promise<void> {
  const gen = getGen(id)!;
  try {
    const r = await bridge.createTask({
      clientRequestId: gen.clientRequestId,
      model: input.model,
      operation: input.operation === 'lastFrameChain' ? 'i2v' : input.operation,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt || undefined,
      resolution: input.params.resolution,
      ratio: input.params.ratio,
      duration: input.params.duration,
      promptExtend: input.params.promptExtend,
      imageUrl: input.imageDataUri,
      clipUrl: input.clipUrl,
      segments: input.chain?.total ?? 1,
    });
    patchGen(id, { status: 'pending', taskId: r.taskId });
    void poll(id);
  } catch (e) {
    const err = e instanceof BridgeError ? e : new BridgeError('unknown', e instanceof Error ? e.message : String(e));
    if (err.ambiguousSubmit) patchGen(id, { status: 'unknown-submit', error: { code: err.kind, message: err.message } });
    else patchGen(id, { status: 'failed', error: { code: err.kind, message: err.message }, finishedAt: Date.now() });
  }
}

/** Consulta la tarea hasta terminar. «Dejar de esperar» detiene la consulta, no la tarea del proveedor. */
export async function poll(id: string): Promise<void> {
  if (pollers.has(id)) return;
  const ctl = { stop: false };
  pollers.set(id, ctl);
  let attempt = 0;
  let rateLimited = false;
  try {
    for (;;) {
      const gen = getGen(id);
      if (!gen?.taskId || ctl.stop) return;
      if (gen.submittedAt && Date.now() - gen.submittedAt > 24 * 3600 * 1000) {
        patchGen(id, { status: 'expired', error: { code: 'expired', message: 'La tarea superó las 24 h de validez.' } });
        return;
      }
      try {
        const { task } = await bridge.getTask(gen.taskId);
        rateLimited = false;
        if (task.status === 'pending' || task.status === 'running') patchGen(id, { status: task.status });
        else if (task.status === 'succeeded') {
          patchGen(id, { status: 'succeeded', resultUrl: task.videoUrl, resultUrlExpiresAt: task.expiresAt, finishedAt: Date.now() });
          await importResult(id, task.usage?.outputVideoDuration ?? task.usage?.duration ?? null);
          return;
        } else if (task.status === 'failed' || task.status === 'canceled') {
          patchGen(id, { status: task.status === 'failed' ? 'failed' : 'canceled', error: task.error ? { code: task.error.code, message: task.error.message } : { code: task.status, message: 'La tarea terminó sin resultado.' }, finishedAt: Date.now() });
          return;
        } else {
          patchGen(id, { status: 'expired', error: { code: 'UNKNOWN', message: 'El proveedor ya no reconoce la tarea (caducó tras 24 h).' } });
          return;
        }
      } catch (e) {
        if (e instanceof BridgeError && e.kind === 'rate-limited') rateLimited = true;
        else if (e instanceof BridgeError && (e.kind === 'invalid-key' || e.kind === 'bridge-offline')) {
          patchGen(id, { error: { code: e.kind, message: `${e.message} La tarea sigue en el proveedor; se reanudará al reconectar.` } });
          return;
        }
      }
      await new Promise((r) => setTimeout(r, pollDelayMs(attempt++, rateLimited)));
    }
  } finally {
    pollers.delete(id);
  }
}

export function stopWaiting(id: string): void {
  const p = pollers.get(id);
  if (p) p.stop = true;
}

export function isPolling(id: string): boolean {
  return pollers.has(id);
}

async function importResult(id: string, reportedSeconds: number | null): Promise<void> {
  const gen = getGen(id);
  if (!gen?.taskId || gen.assetId) return;
  const blob = await bridge.downloadResult(gen.taskId);
  const name = `${gen.operation === 't2v' ? 'texto' : gen.operation === 'i2v' ? 'imagen' : 'extension'}-${gen.taskId.slice(0, 8)}.mp4`;
  const asset = await importFile(new File([blob], name, { type: 'video/mp4' }), name, { type: gen.operation === 'continuation' || gen.operation === 'lastFrameChain' ? 'extension' : 'generated', generationId: id });
  useStore.getState().apply((p) => addAsset(p, asset), 'Importar resultado');
  const returned = ticksToSeconds(asset.duration);
  let measured: Generation['measured'] = null;
  if (gen.operation === 'continuation') {
    const model = findVideoModel(gen.model);
    const refSeconds = Number(gen.params.referenceSeconds ?? 0);
    const seg = continuationNewSegment({ referenceSeconds: refSeconds, returnedSeconds: returned, includesReference: !!model?.continuationIncludesReference });
    measured = { returnedDuration: returned, ...seg };
  } else {
    measured = { returnedDuration: returned, newSegmentStart: 0, newSegmentDuration: returned };
  }
  if (reportedSeconds !== null && Math.abs(reportedSeconds - returned) > 0.5) {
    useStore.getState().toast(`El proveedor informó ${reportedSeconds} s y el archivo dura ${returned.toFixed(2)} s. Se usa la duración real del archivo.`, 'info');
  }
  patchGen(id, { status: 'imported', assetId: asset.id, measured });
  useStore.getState().toast('Resultado descargado e importado a la biblioteca.', 'success');
}

/** Reanuda consultas pendientes al abrir el proyecto. No reenvía nada. */
export async function resumePendingGenerations(): Promise<void> {
  const p = useStore.getState().project;
  if (!p) return;
  for (const g of Object.values(p.generations)) {
    if (g.taskId && (g.status === 'pending' || g.status === 'running' || g.status === 'succeeded')) void poll(g.id);
    if (g.status === 'submitting') {
      // Se cerró la pestaña durante el envío: el resultado es incierto y no se repite solo.
      patchGen(g.id, { status: 'unknown-submit', error: { code: 'interrupted', message: 'El envío se interrumpió. Puede que el proveedor lo haya aceptado. No se reenvía automáticamente.' } });
    }
  }
}

/** Reintenta un envío fallido o incierto con un id nuevo (decisión explícita del usuario). */
export async function resubmit(id: string, input: SubmitInput): Promise<string> {
  patchGen(id, { status: getGen(id)?.status === 'unknown-submit' ? 'failed' : getGen(id)!.status });
  return submitGeneration(input);
}
