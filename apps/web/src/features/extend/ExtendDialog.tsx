/**
 * Extender un clip. Tres caminos:
 * A. Local (sin IA): ralentizar con mezcla de fotogramas o bucle inteligente.
 * B. Continuación nativa del modelo (requiere una URL pública del fragmento final).
 * C. Cadena por último fotograma (imagen a video, un tramo por solicitud).
 * Cada opción muestra duración original, segundos agregados y duración final antes de actuar.
 */
import { useEffect, useMemo, useState } from 'react';
import { chainPlan, clipDuration, findLoopCandidates, loopSummary, slowdownSummary, ticksToSeconds, type LoopCandidate, type MediaClip } from '@vs/project';
import { useStore } from '../../state/store.ts';
import { Button, Field, Modal, Notice, Section, inputClass } from '../../ui/kit.tsx';
import { applyLoop, applySlowdown, runLastFrameChain, sampleGrayFrames } from './extend-service.ts';
import { bridge, useBridgeStatus } from '../generate/bridge-client.ts';
import { videoModelsFor, findVideoModel, type PolicyDecision, type Region } from '../generate/provider-helpers.ts';
import { submitGeneration } from '../generate/generation-service.ts';

type Mode = 'slow' | 'loop' | 'continuation' | 'chain';

function Summary({ original, added, final }: { original: number; added: number; final: number }) {
  return (
    <div className="grid grid-cols-3 gap-2 rounded-lg bg-ink-900 p-2 text-center text-xs" data-testid="extend-summary">
      <div><div className="text-ink-400">Original</div><div className="font-semibold">{original.toFixed(2)} s</div></div>
      <div><div className="text-ink-400">Se agregan</div><div className="font-semibold text-emerald-300">+{added.toFixed(2)} s</div></div>
      <div><div className="text-ink-400">Final</div><div className="font-semibold">{final.toFixed(2)} s</div></div>
    </div>
  );
}

export function ExtendDialog({ clipId }: { clipId: string }) {
  const project = useStore((s) => s.project)!;
  const st = useStore.getState();
  const clip = project.clips[clipId] as MediaClip | undefined;
  const { session, online } = useBridgeStatus();
  const [mode, setMode] = useState<Mode>('slow');
  const close = () => st.setExtendClip(null);
  const original = clip ? ticksToSeconds(clipDuration(clip)) : 0;

  // A1
  const [target, setTarget] = useState(Math.round(original * 1.5 * 10) / 10);
  const [blend, setBlend] = useState(true);
  const slow = slowdownSummary(original, Math.max(original, target));

  // A2
  const [cands, setCands] = useState<LoopCandidate[] | null>(null);
  const [pick, setPick] = useState(0);
  const [repeats, setRepeats] = useState(1);
  const [analyzing, setAnalyzing] = useState(false);

  // B y C
  const region = (session?.region ?? 'ap-southeast-1') as Region;
  const contModels = useMemo(() => videoModelsFor('continuation', region), [region]);
  const i2vModels = useMemo(() => videoModelsFor('i2v', region), [region]);
  const [prompt, setPrompt] = useState('Continúa la escena de forma natural, misma luz y cámara.');
  const [clipUrl, setClipUrl] = useState('');
  const [refSeconds, setRefSeconds] = useState(3);
  const [contSeconds, setContSeconds] = useState(10);
  const [addSeconds, setAddSeconds] = useState(5);
  const [chainRunning, setChainRunning] = useState<string | null>(null);
  const [decision, setDecision] = useState<PolicyDecision | null>(null);

  const contModel = contModels[0];
  const i2vModel = i2vModels[0];
  const segSeconds = i2vModel?.durations.default ?? 5;
  const fps = project.settings.fps.num / project.settings.fps.den;
  const plan = chainPlan({ targetAddSeconds: addSeconds, segmentSeconds: segSeconds, fps, dropJoinFrame: true, maxSegments: session?.maxSegmentsPerOperation ?? 1 });

  useEffect(() => {
    setDecision(null);
    if (!online || (mode !== 'continuation' && mode !== 'chain')) return;
    const m = mode === 'continuation' ? contModel : i2vModel;
    if (!m) return;
    let alive = true;
    void bridge
      .preflight({
        operation: mode === 'continuation' ? 'continuation' : 'lastFrameChain',
        model: m.id,
        region,
        maxRequests: mode === 'chain' ? plan.segments : 1,
        videoSeconds: mode === 'chain' ? plan.segments * segSeconds : contSeconds,
        resolution: m.defaultResolution,
        dataOut: mode === 'chain' ? ['El último fotograma del clip (PNG) y el prompt, una vez por tramo.'] : ['La URL pública que indiques y el prompt.'],
      })
      .then((r) => alive && setDecision(r.decision))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [mode, online, region, plan.segments, contSeconds, contModel, i2vModel, segSeconds, session?.policy]);

  if (!clip || clip.kind !== 'media') {
    return (
      <Modal title="Extender clip" onClose={close}>
        <Notice kind="warn">Selecciona un clip de video para extenderlo.</Notice>
      </Modal>
    );
  }

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const { frames, times } = await sampleGrayFrames(clip);
      setCands(findLoopCandidates(frames, times, { minLoopSeconds: Math.min(1, original / 3), maxCandidates: 5 }));
      setPick(0);
    } catch (e) {
      st.toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setAnalyzing(false);
    }
  };
  const cand = cands?.[pick];
  const loop = cand ? loopSummary(original, cand, repeats) : null;

  const sendContinuation = async () => {
    if (!contModel) return;
    await submitGeneration({
      operation: 'continuation',
      model: contModel.id,
      region,
      prompt,
      negativePrompt: '',
      params: { resolution: contModel.defaultResolution, duration: contSeconds, promptExtend: true, referenceSeconds: refSeconds },
      clipUrl,
      sourceAssetId: clip.assetId,
    });
    st.toast('Continuación enviada. Sigue su estado en el panel Generar; al terminar, «Insertar tras el clip».', 'info');
    st.setLeftTab('generate');
    close();
  };

  const startChain = async () => {
    if (!i2vModel) return;
    setChainRunning('Iniciando…');
    const r = await runLastFrameChain({ clipId, segments: plan.segments, model: i2vModel.id, region, prompt, resolution: i2vModel.defaultResolution, segmentSeconds: segSeconds, onProgress: setChainRunning });
    setChainRunning(null);
    if (r.error) st.toast(`Cadena detenida tras ${r.done} tramo(s): ${r.error} Los tramos ya insertados se conservan.`, 'error');
    else st.toast(`Cadena completa: ${r.done} tramo(s) insertados.`, 'success');
  };

  const validUrl = /^https:\/\/\S+\.(mp4|mov)(\?\S*)?$/i.test(clipUrl);

  return (
    <Modal title={`Extender «${clip.name}»`} onClose={close} wide>
      <div className="mb-4 flex flex-wrap gap-2">
        {([
          ['slow', 'Ralentizar (local)'],
          ['loop', 'Bucle inteligente (local)'],
          ['continuation', 'Continuación con IA'],
          ['chain', 'Cadena por último fotograma'],
        ] as const).map(([m, l]) => (
          <Button key={m} variant={mode === m ? 'primary' : 'subtle'} aria-pressed={mode === m} onClick={() => setMode(m)}>{l}</Button>
        ))}
      </div>

      {mode === 'slow' && (
        <div className="flex flex-col gap-3">
          <Field label={`Duración final: ${target.toFixed(1)} s`}>
            <input type="range" min={original} max={original * 4} step={0.1} value={target} onChange={(e) => setTarget(Number(e.target.value))} />
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={blend} onChange={(e) => setBlend(e.target.checked)} /> Mezclar fotogramas (movimiento más suave)</label>
          <Summary original={original} added={slow.addedSeconds} final={slow.finalSeconds} />
          <p className="text-xs text-ink-400">Velocidad resultante: {(slow.rate * 100).toFixed(0)} %. El audio vinculado se estira y conserva el tono. Se abre un hueco: el clip siguiente no se pisa.</p>
          <Button variant="primary" disabled={slow.addedSeconds <= 0} onClick={() => { if (st.apply((p) => applySlowdown(p, clipId, slow.finalSeconds, blend), 'Ralentizar')) close(); }} data-testid="apply-slow">Aplicar</Button>
        </div>
      )}

      {mode === 'loop' && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-ink-400">Busca dos instantes con imagen parecida, uno cerca del final y otro cerca del inicio. El clip salta de uno a otro con una disolución corta.</p>
          <Button onClick={analyze} disabled={analyzing}>{analyzing ? 'Analizando fotogramas…' : 'Buscar puntos de bucle'}</Button>
          {cands && cands.length === 0 && <Notice kind="warn">No hay puntos de bucle aceptables en este clip.</Notice>}
          {cands && cands.length > 0 && (
            <>
              <Field label="Punto de bucle">
                <select className={inputClass} value={pick} onChange={(e) => setPick(Number(e.target.value))}>
                  {cands.map((c, i) => <option key={i} value={i}>Salta de {c.fromTime.toFixed(2)} s a {c.toTime.toFixed(2)} s · diferencia {(c.difference * 100).toFixed(1)} %</option>)}
                </select>
              </Field>
              <Field label={`Repeticiones: ${repeats}`}>
                <input type="range" min={1} max={6} step={1} value={repeats} onChange={(e) => setRepeats(Number(e.target.value))} />
              </Field>
              {loop && <Summary original={original} added={loop.addedSeconds} final={loop.finalSeconds} />}
              {cand && cand.difference > 0.15 && <Notice kind="warn">La diferencia es alta: el salto puede notarse.</Notice>}
              <Button variant="primary" onClick={() => { if (cand && st.apply((p) => applyLoop(p, clipId, cand.fromTime, cand.toTime, repeats, 0.2), 'Bucle inteligente')) close(); }}>Aplicar</Button>
            </>
          )}
        </div>
      )}

      {(mode === 'continuation' || mode === 'chain') && !session && (
        <Notice kind="info">Conecta la IA en <button className="underline" onClick={() => st.setAiSettingsOpen(true)}>Ajustes de IA</button>.</Notice>
      )}

      {mode === 'continuation' && (
        <div className="flex flex-col gap-3">
          {!contModel ? (
            <Notice kind="warn">No hay un modelo de continuación verificado en esta región.</Notice>
          ) : (
            <>
              <Notice kind="info">
                {findVideoModel(contModel.id)?.label} solo acepta el clip de referencia como URL pública HTTPS (MP4 o MOV de 2 a 10 s). Exporta el final del clip, súbelo a un almacenamiento propio y pega aquí el enlace. La respuesta incluye la referencia: la app inserta solo el tramo nuevo.
              </Notice>
              <Field label="URL pública del fragmento final"><input className={inputClass} value={clipUrl} onChange={(e) => setClipUrl(e.target.value.trim())} placeholder="https://…/final.mp4" /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={`Duración de la referencia: ${refSeconds} s`}><input type="range" min={2} max={10} step={1} value={refSeconds} onChange={(e) => setRefSeconds(Number(e.target.value))} /></Field>
                <Field label={`Duración total pedida: ${contSeconds} s`}><input type="range" min={Math.max(contModel.durations.min, refSeconds + 1)} max={contModel.durations.max} step={1} value={contSeconds} onChange={(e) => setContSeconds(Number(e.target.value))} /></Field>
              </div>
              <Field label="Prompt"><textarea className={`${inputClass} min-h-16`} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></Field>
              <Summary original={original} added={Math.max(0, contSeconds - refSeconds)} final={original + Math.max(0, contSeconds - refSeconds)} />
              <p className="text-[11px] text-ink-500">Estimación. La app mide la duración real del archivo devuelto antes de insertar. Costo: {decision ? (decision.cost.verified ? `${decision.cost.amount} ${decision.cost.currency}` : decision.cost.label) : '—'}.</p>
              {decision && !decision.allowed && <Notice kind="warn">{decision.reason}</Notice>}
              <Button variant="primary" disabled={!validUrl || !decision?.allowed} onClick={sendContinuation}>Enviar continuación</Button>
            </>
          )}
        </div>
      )}

      {mode === 'chain' && (
        <div className="flex flex-col gap-3">
          {!i2vModel ? (
            <Notice kind="warn">No hay un modelo de imagen a video en esta región.</Notice>
          ) : (
            <>
              <Field label={`Segundos a agregar: ${addSeconds} s`}><input type="range" min={1} max={60} step={1} value={addSeconds} onChange={(e) => setAddSeconds(Number(e.target.value))} /></Field>
              <Field label="Prompt para cada tramo"><textarea className={`${inputClass} min-h-16`} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></Field>
              <Summary original={original} added={plan.addedSeconds} final={original + plan.addedSeconds} />
              <p className="text-xs text-ink-400">
                {plan.segments} tramo(s) de {segSeconds} s con {i2vModel.label}. Cada tramo es una solicitud facturable. Se descarta el fotograma de unión repetido. Si un tramo falla, los anteriores se conservan.
              </p>
              {plan.exceedsLimit && <Notice kind="warn">Tu límite es {session?.maxSegmentsPerOperation ?? 1} tramo(s) por operación. Súbelo en Ajustes de IA para llegar a {addSeconds} s.</Notice>}
              {decision && !decision.allowed && <Notice kind="warn">{decision.reason}</Notice>}
              {chainRunning ? <Notice kind="info">{chainRunning}</Notice> : <Button variant="primary" disabled={!decision?.allowed} onClick={startChain}>Generar {plan.segments} tramo(s)</Button>}
            </>
          )}
        </div>
      )}
      {(mode === 'continuation' || mode === 'chain') && <Section title="Duraciones"><p className="text-[11px] text-ink-500">Las cifras previas son estimaciones del catálogo. La duración real se mide en el archivo descargado.</p></Section>}
    </Modal>
  );
}
