/**
 * Panel «Generar»: texto a video e imagen a video con el catálogo real.
 * Antes de enviar muestra qué sale del equipo, el modelo, las solicitudes y el costo.
 * Un fallo nunca borra el prompt ni el montaje.
 */
import { useEffect, useMemo, useState } from 'react';
import { placeAsset, type Generation } from '@vs/project';
import { useStore } from '../../state/store.ts';
import { Button, Field, Notice, Section, inputClass } from '../../ui/kit.tsx';
import { bridge, useBridgeStatus } from './bridge-client.ts';
import { videoModelsFor, findVideoModel, PROMPT_ENHANCE_SYSTEM, type PolicyDecision, type Region } from './provider-helpers.ts';
import { submitGeneration, stopWaiting, poll, isPolling, resubmit, type SubmitInput } from './generation-service.ts';
import { blobForAssetId } from '../../lib/media-service.ts';
import { insertAfterClip } from '../extend/extend-service.ts';

type Op = 't2v' | 'i2v';

const STATUS_LABEL: Record<Generation['status'], string> = {
  draft: 'Borrador',
  submitting: 'Enviando…',
  'unknown-submit': 'Envío incierto',
  pending: 'En cola del proveedor',
  running: 'Generando',
  succeeded: 'Listo, descargando…',
  failed: 'Falló',
  canceled: 'Cancelada',
  expired: 'Caducada',
  imported: 'En la biblioteca',
};

export async function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function GeneratePanel() {
  const project = useStore((s) => s.project)!;
  const st = useStore.getState();
  const bridgeStatus = useBridgeStatus();
  const session = bridgeStatus.session;
  const region = (session?.region ?? 'ap-southeast-1') as Region;
  const [op, setOp] = useState<Op>(() => (sessionStorage.getItem('vs:i2v-asset') ? 'i2v' : 't2v'));
  const models = useMemo(() => videoModelsFor(op, region), [op, region]);
  const [modelId, setModelId] = useState(models[0]?.id ?? '');
  const model = findVideoModel(modelId) ?? models[0];
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [resolution, setResolution] = useState(model?.defaultResolution ?? '720P');
  const [ratio, setRatio] = useState('16:9');
  const [duration, setDuration] = useState(model?.durations.default ?? 5);
  const [promptExtend, setPromptExtend] = useState(true);
  const [imageAssetId, setImageAssetId] = useState<string | null>(() => {
    const id = sessionStorage.getItem('vs:i2v-asset');
    sessionStorage.removeItem('vs:i2v-asset');
    return id;
  });
  const [enhanced, setEnhanced] = useState<string | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [decision, setDecision] = useState<PolicyDecision | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!models.find((m) => m.id === modelId)) setModelId(models[0]?.id ?? '');
  }, [models, modelId]);
  useEffect(() => {
    if (!model) return;
    if (!model.resolutions.includes(resolution)) setResolution(model.defaultResolution);
    if (duration < model.durations.min || duration > model.durations.max) setDuration(model.durations.default);
    if (Array.isArray(model.aspectRatios) && !model.aspectRatios.includes(ratio)) setRatio(model.aspectRatios[0] ?? '16:9');
  }, [model, resolution, duration, ratio]);

  const images = Object.values(project.assets).filter((a) => a.kind === 'image');
  const dataOut = useMemo(() => {
    const out = [`El prompt (${prompt.length} caracteres)${negative ? ' y el prompt negativo' : ''}.`];
    if (op === 'i2v') out.push('La imagen elegida, como data URI en base64.');
    out.push('Nada más del proyecto sale del equipo.');
    return out;
  }, [prompt, negative, op]);

  useEffect(() => {
    let alive = true;
    setDecision(null);
    setPreflightError(null);
    if (!model || !bridgeStatus.online) return;
    void bridge
      .preflight({ operation: op, model: model.id, region, maxRequests: 1, videoSeconds: duration, resolution, dataOut })
      .then((r) => alive && setDecision(r.decision))
      .catch((e) => alive && setPreflightError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [model, op, region, duration, resolution, dataOut, bridgeStatus.online, session?.policy]);

  const gens = Object.values(project.generations).sort((a, b) => b.createdAt - a.createdAt);

  const enhance = async () => {
    if (!prompt.trim()) return;
    setEnhancing(true);
    try {
      const r = await bridge.chat('qwen-plus', [
        { role: 'system', content: PROMPT_ENHANCE_SYSTEM },
        { role: 'user', content: prompt },
      ]);
      setEnhanced(r.content.trim());
    } catch (e) {
      st.toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setEnhancing(false);
    }
  };

  const buildInput = async (): Promise<SubmitInput | null> => {
    if (!model) return null;
    let imageDataUri: string | undefined;
    if (op === 'i2v') {
      if (!imageAssetId) {
        st.toast('Elige una imagen de la biblioteca.', 'error');
        return null;
      }
      const blob = await blobForAssetId(imageAssetId);
      if (!blob) {
        st.toast('No se encuentra el archivo de la imagen.', 'error');
        return null;
      }
      const lim = model.input.image;
      if (lim && blob.size > lim.maxBytes) {
        st.toast(`La imagen pesa ${(blob.size / 1e6).toFixed(1)} MB. El límite es ${(lim.maxBytes / 1e6).toFixed(0)} MB.`, 'error');
        return null;
      }
      imageDataUri = await blobToDataUri(blob);
    }
    return {
      operation: op,
      model: model.id,
      region,
      prompt,
      negativePrompt: negative,
      params: { resolution, duration, ratio: Array.isArray(model.aspectRatios) ? ratio : undefined, promptExtend },
      imageDataUri,
      sourceAssetId: imageAssetId,
    };
  };

  const send = async () => {
    setSending(true);
    try {
      const input = await buildInput();
      if (input) await submitGeneration(input);
    } finally {
      setSending(false);
    }
  };

  const toTimeline = (g: Generation) => {
    const assetId = g.assetId!;
    if (g.operation === 'continuation' && g.sourceAssetId) {
      const src = Object.values(useStore.getState().project!.clips).find((c) => c.kind === 'media' && c.assetId === g.sourceAssetId && project.tracks.find((t) => t.id === c.trackId)?.kind === 'video');
      if (src) {
        st.apply((p) => insertAfterClip(p, src.id, assetId, g.measured?.newSegmentStart ?? 0).project, 'Insertar continuación');
        return;
      }
    }
    st.apply((p) => placeAsset(p, assetId, useStore.getState().playhead).project, 'Llevar a la línea de tiempo');
  };

  const variant = async (g: Generation) => {
    const input: SubmitInput = {
      operation: g.operation === 'i2v' ? 'i2v' : 't2v',
      model: g.model,
      region: g.region,
      prompt: g.prompt,
      negativePrompt: g.negativePrompt,
      params: { resolution: String(g.params.resolution), duration: Number(g.params.duration), ratio: g.params.ratio ? String(g.params.ratio) : undefined, promptExtend: !!g.params.promptExtend },
    };
    if (g.operation === 'i2v' && g.sourceAssetId) {
      const blob = await blobForAssetId(g.sourceAssetId);
      if (blob) input.imageDataUri = await blobToDataUri(blob);
      input.sourceAssetId = g.sourceAssetId;
    }
    if (g.status === 'unknown-submit') {
      const ok = window.confirm('El primer envío pudo llegar al proveedor. Reintentar puede generar dos tareas y consumir cuota dos veces. ¿Reintentar?');
      if (!ok) return;
      await resubmit(g.id, input);
    } else await submitGeneration(input);
  };

  const canSend = !!model && prompt.trim().length > 0 && prompt.length <= (model?.promptMaxChars ?? 1e9) && !!decision?.allowed && !sending && (op === 't2v' || !!imageAssetId);

  return (
    <div className="flex flex-col gap-4 p-3" data-testid="generate-panel">
      {!bridgeStatus.online && (
        <Notice kind="warn">
          El puente local de IA no está en marcha. Inícialo con <code>npm run dev</code>. La edición funciona sin él.
        </Notice>
      )}
      {bridgeStatus.online && !session && (
        <Notice kind="info">
          Conecta tu clave de Alibaba Cloud Model Studio en <button className="underline" onClick={() => st.setAiSettingsOpen(true)}>Ajustes de IA</button>. La clave queda solo en el puente local, en memoria.
        </Notice>
      )}
      <div className="flex gap-2">
        <Button variant={op === 't2v' ? 'primary' : 'subtle'} aria-pressed={op === 't2v'} onClick={() => setOp('t2v')}>Desde texto</Button>
        <Button variant={op === 'i2v' ? 'primary' : 'subtle'} aria-pressed={op === 'i2v'} onClick={() => setOp('i2v')}>Animar imagen</Button>
      </div>

      {op === 'i2v' && (
        <Field label="Imagen de partida">
          {images.length === 0 ? (
            <p className="text-xs text-ink-400">Importa una imagen en la pestaña Medios.</p>
          ) : (
            <select className={inputClass} value={imageAssetId ?? ''} onChange={(e) => setImageAssetId(e.target.value || null)}>
              <option value="">Elegir…</option>
              {images.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.width}×{a.height})</option>
              ))}
            </select>
          )}
        </Field>
      )}

      <Field label={`Prompt (${prompt.length}/${model?.promptMaxChars ?? '?'})`}>
        <textarea className={`${inputClass} min-h-24`} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe la escena: sujeto, acción, entorno, luz y cámara." data-testid="gen-prompt" />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" onClick={enhance} disabled={!session || !prompt.trim() || enhancing}>{enhancing ? 'Mejorando…' : 'Mejorar prompt'}</Button>
      </div>
      {enhanced && (
        <div className="grid gap-2 rounded-lg border border-ink-800 p-2 text-xs">
          <div><div className="mb-1 text-ink-400">Original</div><p>{prompt}</p></div>
          <div><div className="mb-1 text-ink-400">Mejorado</div><p className="text-ink-100">{enhanced}</p></div>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => { setPrompt(enhanced); setEnhanced(null); }}>Usar el mejorado</Button>
            <Button size="sm" onClick={() => setEnhanced(null)}>Mantener el original</Button>
          </div>
        </div>
      )}
      <Field label="Prompt negativo (opcional)">
        <input className={inputClass} value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="Lo que no quieres ver" />
      </Field>

      <Section title="Parámetros">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Modelo">
            <select className={inputClass} value={model?.id ?? ''} onChange={(e) => setModelId(e.target.value)}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}{m.status === 'partial' ? ' (parcial)' : ''}</option>
              ))}
            </select>
          </Field>
          <Field label="Resolución">
            <select className={inputClass} value={resolution} onChange={(e) => setResolution(e.target.value)}>
              {model?.resolutions.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Proporción">
            {model && Array.isArray(model.aspectRatios) ? (
              <select className={inputClass} value={ratio} onChange={(e) => setRatio(e.target.value)}>
                {model.aspectRatios.map((r) => <option key={r}>{r}</option>)}
              </select>
            ) : (
              <p className="text-xs text-ink-400">Sigue a la imagen de entrada.</p>
            )}
          </Field>
          <Field label={`Duración: ${duration} s`}>
            <input type="range" min={model?.durations.min ?? 2} max={model?.durations.max ?? 10} step={model?.durations.step ?? 1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
          </Field>
        </div>
        {model?.supportsPromptExtend && (
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={promptExtend} onChange={(e) => setPromptExtend(e.target.checked)} />
            Dejar que el proveedor amplíe el prompt
          </label>
        )}
        {model && <p className="mt-2 text-[11px] text-ink-500">Catálogo verificado el {model.verifiedAt}. Audio: {model.audio === 'generated' ? 'el modelo genera sonido' : 'sin sonido'}.{model.notes ? ` ${model.notes}` : ''}</p>}
      </Section>

      <Section title="Antes de enviar">
        <ul className="list-disc pl-4 text-xs text-ink-300">
          {dataOut.map((d) => <li key={d}>{d}</li>)}
          <li>Modelo: {model?.label ?? 'ninguno'}. Solicitudes facturables: 1.</li>
          <li>Costo: {decision ? (decision.cost.verified ? `${decision.cost.amount} ${decision.cost.currency}` : decision.cost.label) : '—'}.</li>
          <li>Política: {session ? (session.policy === 'free-only' ? 'Solo cuota gratuita' : 'Permitir consumo según mi cuenta') : 'sin conexión'}.</li>
        </ul>
        {decision && !decision.allowed && <div className="mt-2"><Notice kind="warn">{decision.reason}</Notice></div>}
        {preflightError && <div className="mt-2"><Notice kind="error">{preflightError}</Notice></div>}
      </Section>

      <Button size="lg" variant="primary" onClick={send} disabled={!canSend} data-testid="gen-submit">
        {sending ? 'Enviando…' : 'Generar video'}
      </Button>

      {gens.length > 0 && (
        <Section title="Generaciones">
          <ul className="flex flex-col gap-2">
            {gens.map((g) => (
              <li key={g.id} className="rounded-lg border border-ink-800 p-2 text-xs" data-testid="gen-item">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink-100">{STATUS_LABEL[g.status]}</span>
                  <span className="text-ink-500">{new Date(g.createdAt).toLocaleTimeString()}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-ink-300">{g.prompt}</p>
                {g.error && <p className="mt-1 text-rose-300">{g.error.message}</p>}
                {g.measured && <p className="mt-1 text-ink-400">Duración real: {g.measured.returnedDuration.toFixed(2)} s</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {g.assetId && <Button size="sm" variant="primary" onClick={() => toTimeline(g)}>{g.operation === 'continuation' ? 'Insertar tras el clip' : 'Llevar a la línea de tiempo'}</Button>}
                  {(g.status === 'pending' || g.status === 'running') && (isPolling(g.id) ? <Button size="sm" onClick={() => stopWaiting(g.id)}>Dejar de esperar</Button> : <Button size="sm" onClick={() => void poll(g.id)}>Volver a consultar</Button>)}
                  {(g.status === 'imported' || g.status === 'failed' || g.status === 'unknown-submit' || g.status === 'expired' || g.status === 'canceled') && (
                    <Button size="sm" onClick={() => void variant(g)} disabled={!decision?.allowed}>{g.status === 'imported' ? 'Otra variante' : 'Reintentar'}</Button>
                  )}
                  <Button size="sm" onClick={() => { setPrompt(g.prompt); setNegative(g.negativePrompt); }}>Copiar prompt</Button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

