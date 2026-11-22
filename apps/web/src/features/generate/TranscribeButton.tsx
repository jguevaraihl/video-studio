/**
 * Transcripción con IA del clip seleccionado (o del clip con audio bajo el cabezal).
 * Envía solo el tramo usado del clip, en WAV mono de 16 kHz, hasta 5 minutos.
 * Los subtítulos quedan vinculados al clip: si el clip se mueve, se mueven con él.
 */
import { useState } from 'react';
import { addCue, clipEnd, linkCuesToClip, secondsToTicks, sourceToProject, ticksToSeconds, type MediaClip, type Project } from '@vs/project';
import { useStore } from '../../state/store.ts';
import { Button, Notice } from '../../ui/kit.tsx';
import { bridge, useBridgeStatus } from './bridge-client.ts';
import { blobForAssetId } from '../../lib/media-service.ts';
import { blobToDataUri } from './GeneratePanel.tsx';

const ASR_MODEL = 'qwen-audio-3.1-asr-flash';
const MAX_SECONDS = 300;
const RATE = 16000;

function pickClip(p: Project, selection: string[], playhead: number): MediaClip | null {
  const withAudio = (c: MediaClip) => !!p.assets[c.assetId]?.hasAudio;
  for (const id of selection) {
    const c = p.clips[id];
    if (c?.kind === 'media' && withAudio(c)) return c;
  }
  const under = Object.values(p.clips).filter((c): c is MediaClip => c.kind === 'media' && withAudio(c) && c.start <= playhead && clipEnd(c) > playhead);
  return under.find((c) => p.tracks.find((t) => t.id === c.trackId)?.kind === 'audio') ?? under[0] ?? null;
}

/** WAV PCM de 16 bits, mono. */
export function encodeWav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i]!)) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}

export function TranscribeButton() {
  const project = useStore((s) => s.project)!;
  const selection = useStore((s) => s.selection);
  const playhead = useStore((s) => s.playhead);
  const { session } = useBridgeStatus();
  const gemini = session?.provider === 'gemini';
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const clip = pickClip(project, selection, playhead);

  const run = async () => {
    if (!clip) return;
    const st = useStore.getState();
    setBusy(true);
    setNote(null);
    try {
      const blob = await blobForAssetId(clip.assetId);
      if (!blob) throw new Error('No se encuentra el archivo del clip.');
      const ctx = new OfflineAudioContext(1, 1, RATE);
      const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
      const inS = ticksToSeconds(clip.sourceIn);
      const outS = Math.min(ticksToSeconds(clip.sourceOut), inS + MAX_SECONDS);
      const a = Math.floor(inS * decoded.sampleRate);
      const b = Math.min(decoded.length, Math.ceil(outS * decoded.sampleRate));
      const mono = new Float32Array(b - a);
      for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
        const d = decoded.getChannelData(ch);
        for (let i = 0; i < mono.length; i++) mono[i]! += d[a + i]! / decoded.numberOfChannels;
      }
      const dataUri = await blobToDataUri(encodeWav(mono, decoded.sampleRate));
      const { segments } = await bridge.transcribe(ASR_MODEL, dataUri, 'es');
      if (!segments.length) {
        setNote('El modelo no devolvió texto para este tramo.');
        return;
      }
      st.apply((p) => {
        let next = p;
        const ids: string[] = [];
        for (const s of segments) {
          const start = sourceToProject(clip, clip.sourceIn + secondsToTicks(s.startMs / 1000));
          const end = sourceToProject(clip, clip.sourceIn + secondsToTicks(s.endMs / 1000));
          if (end <= start) continue;
          const r = addCue(next, { start, end, text: s.text, link: null });
          next = r.project;
          ids.push(r.id);
        }
        return linkCuesToClip(next, ids, clip.id);
      }, 'Transcribir');
      st.toast(`${segments.length} subtítulos creados y vinculados al clip.`, 'success');
      if (ticksToSeconds(clip.sourceOut) - inS > MAX_SECONDS) setNote(`Se transcribieron los primeros ${MAX_SECONDS / 60} minutos del clip.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Button size="sm" onClick={run} disabled={!session || gemini || !clip || busy} title={!session ? 'Conecta la IA en Ajustes de IA' : gemini ? 'Transcribir requiere una clave de Alibaba Cloud' : !clip ? 'Selecciona un clip con audio' : undefined}>
        {busy ? 'Transcribiendo…' : 'Transcribir con IA'}
      </Button>
      {gemini && <p className="text-[11px] text-ink-500">Con Gemini la app no transcribe. Esta función requiere Alibaba Cloud.</p>}
      {session && !gemini && clip && <p className="text-[11px] text-ink-500">Sale del equipo: el audio del tramo usado de «{project.assets[clip.assetId]?.name}», en WAV mono. Modelo {ASR_MODEL}. 1 solicitud. Costo no verificado.</p>}
      {note && <Notice kind="warn">{note}</Notice>}
    </div>
  );
}
