import { describe, expect, it } from 'vitest';
import {
  parseSrt,
  parseVtt,
  toSrt,
  toVtt,
  noiseGate,
  wsola,
  detectOnsets,
  rms,
  parseCube,
  serializeCube,
  makeTealOrangeLut,
  sampleLut,
  applyColorCpu,
  defaultColor,
  continuationNewSegment,
  chainPlan,
  findLoopCandidates,
  EditProposalSchema,
  applyCommands,
  placeAsset,
  clipDuration,
  describeFrame,
  describeAudio,
  migrateProject,
  createProject,
  addTextClip,
  splitAt,
  addTransition,
} from '@vs/project';
import { fakeAsset, projectWith, s } from './helpers.ts';

describe('SRT y WebVTT', () => {
  const srt = '1\n00:00:01,000 --> 00:00:02,500\nHola mundo\n\n2\n00:00:03,000 --> 00:00:04,000\nSegunda\nlínea\n';
  it('ida y vuelta SRT', () => {
    const cues = parseSrt(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0]!.start).toBe(s(1));
    expect(cues[1]!.text).toBe('Segunda\nlínea');
    expect(parseSrt(toSrt(cues))).toEqual(cues);
  });
  it('ida y vuelta VTT', () => {
    const cues = parseSrt(srt);
    const vtt = toVtt(cues);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(parseVtt(vtt)).toEqual(cues);
  });
});

describe('DSP', () => {
  const sr = 48000;
  function tone(seconds: number, amp: number) {
    const d = new Float32Array(sr * seconds);
    for (let i = 0; i < d.length; i++) d[i] = amp * Math.sin((2 * Math.PI * 440 * i) / sr);
    return d;
  }
  it('la puerta atenúa el ruido bajo el umbral y deja pasar la señal', () => {
    const noise = tone(1, 0.003);
    const signal = tone(1, 0.5);
    const joined = new Float32Array(sr * 2);
    joined.set(noise, 0);
    joined.set(signal, sr);
    const [out] = noiseGate([joined], sr, { thresholdDb: -40, attackMs: 2, releaseMs: 50, reductionDb: -40 });
    expect(rms(out!, 0, sr * 0.9) / rms(joined, 0, sr * 0.9)).toBeLessThan(0.05);
    expect(rms(out!, sr * 1.1, sr * 2) / rms(joined, sr * 1.1, sr * 2)).toBeGreaterThan(0.95);
  });
  it('WSOLA cambia la duración y conserva la energía', () => {
    const t = tone(1, 0.5);
    const out = wsola(t, 2, sr);
    expect(out.length).toBe(sr / 2);
    expect(rms(out, 2000, out.length - 2000)).toBeGreaterThan(0.3);
  });
  it('detecta pulsos', () => {
    const d = new Float32Array(sr * 3);
    for (const at of [0.5, 1.5, 2.5]) for (let i = 0; i < 2400; i++) d[Math.round(at * sr) + i] = 0.5 * Math.sin(i / 3);
    const on = detectOnsets(d, sr);
    expect(on.map((x) => Math.round(x * 100) / 100)).toEqual([0.5, 1.5, 2.5]);
  });
});

describe('LUT', () => {
  it('serializa y vuelve a leer un .cube', () => {
    const lut = makeTealOrangeLut(9);
    const back = parseCube('x', serializeCube(lut));
    expect(back.size).toBe(9);
    expect(Math.abs(back.data[100]! - lut.data[100]!)).toBeLessThan(1e-5);
  });
  it('identidad deja el color igual', () => {
    const size = 5;
    const data = new Float32Array(size ** 3 * 3);
    for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
      const i = (r + g * size + b * size * size) * 3;
      data[i] = r / 4; data[i + 1] = g / 4; data[i + 2] = b / 4;
    }
    const out = sampleLut({ id: 'id', title: 'id', size, data }, [0.3, 0.6, 0.9]);
    out.forEach((v, i) => expect(v).toBeCloseTo([0.3, 0.6, 0.9][i]!, 5));
  });
  it('aplica la LUT cálida: un gris medio se vuelve más cálido', () => {
    const px = new Uint8ClampedArray([180, 180, 180, 255]);
    applyColorCpu(px, { ...defaultColor(), lut: { id: 'teal-orange', intensity: 1 } }, makeTealOrangeLut());
    expect(px[0]!).toBeGreaterThan(px[2]!);
  });
});

describe('extensión', () => {
  it('continuación nativa: 2 s de referencia y 12 s devueltos agregan 10 s', () => {
    expect(continuationNewSegment({ referenceSeconds: 2, returnedSeconds: 12, includesReference: true })).toEqual({ newSegmentStart: 2, newSegmentDuration: 10 });
  });
  it('cadena por último fotograma calcula generaciones antes de enviar', () => {
    expect(chainPlan({ targetAddSeconds: 12, segmentSeconds: 5, fps: 30, dropJoinFrame: true, maxSegments: 5 })).toMatchObject({ segments: 3, exceedsLimit: false });
    expect(chainPlan({ targetAddSeconds: 60, segmentSeconds: 5, fps: 30, dropJoinFrame: false, maxSegments: 4 }).exceedsLimit).toBe(true);
  });
  it('bucle inteligente elige el par más parecido', () => {
    const frames = Array.from({ length: 10 }, (_, i) => new Uint8Array(16).fill(i * 20));
    frames[9] = new Uint8Array(16).fill(21); // parecido al fotograma 1
    const times = frames.map((_, i) => i * 0.5);
    const best = findLoopCandidates(frames, times, { minLoopSeconds: 1 })[0]!;
    expect(best.fromTime).toBe(4.5);
    expect(best.toTime).toBe(0.5);
  });
});

describe('asistente: comandos tipados', () => {
  it('«corta los últimos dos segundos y agrega un fundido» se valida y aplica', () => {
    const a = fakeAsset({ seconds: 10 });
    let p = projectWith(a);
    const { project, clipIds } = placeAsset(p, a.id, 0);
    p = project;
    const proposal = EditProposalSchema.parse({
      explanation: 'ok',
      commands: [
        { type: 'trimEnd', clipId: clipIds[0], seconds: 2 },
        { type: 'fade', clipId: clipIds[0], edge: 'out', seconds: 1 },
      ],
    });
    const q = applyCommands(p, proposal.commands);
    expect(clipDuration(q.clips[clipIds[0]!]!)).toBe(s(8));
    expect(q.clips[clipIds[0]!]!.kind === 'media' && q.clips[clipIds[0]!]!.fadeOut).toBe(s(1));
  });
  it('rechaza referencias inexistentes y rangos inválidos', () => {
    const p = projectWith();
    expect(() => applyCommands(p, [{ type: 'deleteClip', clipId: 'nope' }])).toThrow(/Comando 1/);
    expect(EditProposalSchema.safeParse({ commands: [{ type: 'setSpeed', clipId: 'x', rate: 100 }] }).success).toBe(false);
  });
});

describe('composición compartida', () => {
  it('describe capas con disolución y audio con envolvente', () => {
    const a = fakeAsset({ seconds: 10 });
    let p = projectWith(a);
    const placed = placeAsset(p, a.id, 0);
    p = placed.project;
    const sp = splitAt(p, s(5), [placed.clipIds[0]!]);
    p = sp.project;
    const right = sp.created[0]!;
    p = addTransition(p, placed.clipIds[0]!, right, s(1)).project;
    p = addTextClip(p, 'Título', s(1), s(2)).project;
    const f = describeFrame(p, s(5), { includeSubtitles: false });
    const media = f.layers.filter((l) => l.type === 'media');
    expect(media).toHaveLength(2);
    expect(media[1]!.transform.opacity).toBeCloseTo(0.5, 2);
    expect(describeFrame(p, s(1.5), { includeSubtitles: false }).layers.some((l) => l.type === 'text')).toBe(true);
    const audio = describeAudio(p);
    expect(audio.segments).toHaveLength(2);
  });
  it('mute y solo de pista afectan el plan de audio', () => {
    const a = fakeAsset({ seconds: 3 });
    let p = projectWith(a);
    p = placeAsset(p, a.id, 0).project;
    const audioTrack = p.tracks.find((t) => t.kind === 'audio')!;
    expect(describeAudio({ ...p, tracks: p.tracks.map((t) => (t.id === audioTrack.id ? { ...t, muted: true } : t)) }).segments).toHaveLength(0);
    const other = p.tracks.filter((t) => t.kind === 'audio')[1]!;
    expect(describeAudio({ ...p, tracks: p.tracks.map((t) => (t.id === other.id ? { ...t, solo: true } : t)) }).segments).toHaveLength(0);
  });
});

describe('migraciones', () => {
  it('migra la versión 0 y valida', () => {
    const p = createProject();
    const { schemaVersion: _v, ...old } = p;
    expect(migrateProject(old).schemaVersion).toBe(1);
  });
  it('rechaza versiones futuras con mensaje claro', () => {
    expect(() => migrateProject({ ...createProject(), schemaVersion: 99 })).toThrow(/Actualiza la app/);
  });
});
