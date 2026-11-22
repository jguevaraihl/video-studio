/**
 * Asistente de edición: pide cambios en lenguaje natural y recibe comandos tipados.
 * Nada se aplica sin revisión. «Aplicar» crea una sola entrada de deshacer.
 * También detecta capítulos con visión a partir de fotogramas reducidos del clip elegido.
 */
import { useState } from 'react';
import { applyCommands, describeCommand, EditProposalSchema, projectSummaryForAssistant, secondsToTicks, ticksToSeconds, type EditProposal, type MediaClip } from '@vs/project';
import { ASSISTANT_SYSTEM, auxModelFor, safeJson } from '@vs/providers';
import { useStore } from '../../state/store.ts';
import { Button, Notice, Section, inputClass } from '../../ui/kit.tsx';
import { bridge, useBridgeStatus } from '../generate/bridge-client.ts';
import { blobForAssetId } from '../../lib/media-service.ts';
import { seek } from '../../lib/player-instance.ts';


/** Extrae fotogramas JPEG reducidos (lado mayor 512 px) de un clip, cada `every` segundos del tramo usado. */
async function sampleFrames(clip: MediaClip, every: number, max: number): Promise<{ seconds: number; dataUri: string }[]> {
  const blob = await blobForAssetId(clip.assetId);
  if (!blob) throw new Error('No se encuentra el archivo del clip.');
  const url = URL.createObjectURL(blob);
  try {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = url;
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error('El navegador no puede leer este video.'));
    });
    const scale = 512 / Math.max(v.videoWidth, v.videoHeight);
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    const g = c.getContext('2d')!;
    const inS = ticksToSeconds(clip.sourceIn);
    const outS = ticksToSeconds(clip.sourceOut);
    const out: { seconds: number; dataUri: string }[] = [];
    for (let s = inS; s < outS && out.length < max; s += every) {
      v.currentTime = s;
      await new Promise<void>((res) => (v.onseeked = () => res()));
      g.drawImage(v, 0, 0, c.width, c.height);
      // Tiempo en el proyecto (velocidad constante o media), redondeado a ms.
      out.push({ seconds: +(ticksToSeconds(clip.start) + (s - inS) / (clip.speed.mode === 'constant' ? clip.speed.rate : 1)).toFixed(3), dataUri: c.toDataURL('image/jpeg', 0.7) });
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function AssistantPanel() {
  const project = useStore((s) => s.project)!;
  const selection = useStore((s) => s.selection);
  const { session } = useBridgeStatus();
  const provider = session?.provider ?? 'alibaba';
  const CHAT_MODEL = auxModelFor(provider, 'text')!;
  const VISION_MODEL = auxModelFor(provider, 'vision')!;
  const costLabel = provider === 'gemini' ? 'Nivel gratuito de Gemini: Google usa estos datos para mejorar sus productos.' : 'Costo no verificado.';
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<EditProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chapters, setChapters] = useState<{ seconds: number; title: string; description: string }[] | null>(null);
  const st = useStore.getState();

  const selectedVideo = selection.map((id) => project.clips[id]).find((c): c is MediaClip => c?.kind === 'media' && !!project.assets[c.assetId]?.hasVideo) ?? null;

  const propose = async () => {
    setBusy(true);
    setError(null);
    setProposal(null);
    try {
      const r = await bridge.chat(
        CHAT_MODEL,
        [
          { role: 'system', content: ASSISTANT_SYSTEM },
          { role: 'user', content: `Proyecto (json): ${projectSummaryForAssistant(project)}\n\nPetición: ${ask}` },
        ],
        true,
      );
      const parsed = EditProposalSchema.safeParse(safeJson(r.content));
      if (!parsed.success) throw new Error('La respuesta no trae comandos válidos. No se aplicó nada.');
      // Valida en una copia antes de mostrar.
      applyCommands(project, parsed.data.commands);
      setProposal(parsed.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const detect = async () => {
    if (!selectedVideo) return;
    setBusy(true);
    setError(null);
    try {
      const frames = await sampleFrames(selectedVideo, 2, 16);
      const r = await bridge.vision(VISION_MODEL, frames);
      setChapters(r.chapters);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-3">
      {!session && <Notice kind="info">Conecta la IA en <button className="underline" onClick={() => st.setAiSettingsOpen(true)}>Ajustes de IA</button> para usar el asistente.</Notice>}
      <Section title="Pedir un cambio">
        <textarea className={`${inputClass} min-h-20`} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ej.: acorta el primer clip a 3 s y añade una disolución de 1 s" />
        <p className="mt-1 text-[11px] text-ink-500">Sale del equipo: tu petición y un resumen del montaje (nombres, tiempos y pistas). No salen archivos. Modelo {CHAT_MODEL}. 1 solicitud. {costLabel}</p>
        <Button className="mt-2" variant="primary" onClick={propose} disabled={!session || !ask.trim() || busy}>{busy ? 'Pensando…' : 'Proponer cambios'}</Button>
      </Section>
      {error && <Notice kind="error">{error}</Notice>}
      {proposal && (
        <Section title="Propuesta">
          {proposal.explanation && <p className="mb-2 text-xs text-ink-300">{proposal.explanation}</p>}
          <ol className="list-decimal pl-4 text-xs">
            {proposal.commands.map((c, i) => <li key={i}>{describeCommand(project, c)}</li>)}
          </ol>
          <div className="mt-2 flex gap-2">
            <Button variant="primary" size="sm" onClick={() => { if (st.apply((p) => applyCommands(p, proposal.commands), 'Asistente')) setProposal(null); }}>Aplicar todo</Button>
            <Button size="sm" onClick={() => setProposal(null)}>Descartar</Button>
          </div>
        </Section>
      )}
      <Section title="Capítulos con visión">
        <p className="text-[11px] text-ink-500">Selecciona un clip de video. Sale del equipo: hasta 16 fotogramas JPEG reducidos a 512 px, uno cada 2 s. Modelo {VISION_MODEL.split('#')[0]}. 1 solicitud. {costLabel}</p>
        <Button className="mt-2" size="sm" onClick={detect} disabled={!session || !selectedVideo || busy}>Detectar capítulos</Button>
        {chapters && (
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {chapters.map((c, i) => (
              <li key={i}>
                <button className="text-brand-300 hover:underline" onClick={() => seek(secondsToTicks(c.seconds))}>{c.seconds.toFixed(1)} s</button> <span className="font-medium">{c.title}</span> <span className="text-ink-400">{c.description}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
