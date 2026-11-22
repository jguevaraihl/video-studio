/** Lectura de metadatos de un archivo importado, sin subirlo a ningún sitio. */
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { newId, secondsToTicks, type Asset } from '@vs/project';

const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif|bmp|avif)$/;

export class UnsupportedMediaError extends Error {}

export async function probeFile(file: File | Blob, name: string, origin: Asset['origin'] = { type: 'import', generationId: null }): Promise<Omit<Asset, 'storageKey'>> {
  const base = {
    id: newId('ast'),
    name,
    mime: file.type || guessMime(name),
    size: file.size,
    proxyKey: null,
    origin,
    createdAt: Date.now(),
  };
  if (IMAGE_TYPES.test(base.mime)) {
    const bmp = await createImageBitmap(file);
    const asset = {
      ...base,
      kind: 'image' as const,
      duration: 0,
      firstTimestamp: 0,
      width: bmp.width,
      height: bmp.height,
      rotation: 0,
      fps: 0,
      variableFps: false,
      hasVideo: true,
      hasAudio: false,
      videoCodec: null,
      audioCodec: null,
      sampleRate: 0,
      channels: 0,
    };
    bmp.close();
    return asset;
  }
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    if (!(await input.canRead())) throw new UnsupportedMediaError(`No se reconoce el formato de «${name}».`);
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!video && !audio) throw new UnsupportedMediaError(`«${name}» no tiene pistas de video ni de audio.`);
    if (video && !(await video.canDecode())) {
      throw new UnsupportedMediaError(
        `Este navegador no puede decodificar el video de «${name}» (códec ${video.codec ?? 'desconocido'}). Prueba con Chrome o Edge actualizados, o convierte el archivo a MP4 H.264.`,
      );
    }
    const audioOk = audio ? await audio.canDecode() : false;
    const tracks = [video, audioOk ? audio : null].filter((t): t is NonNullable<typeof t> => !!t);
    // Origen del tiempo del medio: el primer fotograma del video. El audio decodificado
    // (decodeAudioData) ya descarta el preroll del códec, así que su muestra 0 coincide con t = 0.
    // Usar el mínimo entre pistas adelantaría la imagen un fotograma en WebM con Opus.
    const first = video ? Math.max(0, await video.getFirstTimestamp()) : 0;
    const end = await input.computeDuration(tracks);
    let fps = 0;
    let variableFps = false;
    if (video) {
      const stats = await video.computePacketStats(240);
      fps = stats.averagePacketRate;
      // Estimación de FPS variable: compara duraciones de los primeros paquetes.
      variableFps = await detectVfr(video);
    }
    return {
      ...base,
      kind: video ? 'video' : 'audio',
      duration: secondsToTicks(Math.max(0, end - first)),
      firstTimestamp: secondsToTicks(first),
      width: video ? await video.getDisplayWidth() : 0,
      height: video ? await video.getDisplayHeight() : 0,
      rotation: video ? await video.getRotation() : 0,
      fps,
      variableFps,
      hasVideo: !!video,
      hasAudio: audioOk,
      videoCodec: video?.codec ?? null,
      audioCodec: audioOk ? (audio?.codec ?? null) : null,
      sampleRate: audioOk && audio ? await audio.getSampleRate() : 0,
      channels: audioOk && audio ? await audio.getNumberOfChannels() : 0,
    };
  } finally {
    input.dispose();
  }
}

async function detectVfr(track: import('mediabunny').InputVideoTrack): Promise<boolean> {
  const { EncodedPacketSink } = await import('mediabunny');
  const sink = new EncodedPacketSink(track);
  const durations: number[] = [];
  let count = 0;
  for await (const pkt of sink.packets(undefined, undefined, { metadataOnly: true })) {
    durations.push(pkt.duration);
    if (++count >= 120) break;
  }
  if (durations.length < 10) return false;
  const sorted = [...durations].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return durations.some((d) => Math.abs(d - median) > median * 0.25);
}

export function guessMime(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return (
    {
      mp4: 'video/mp4',
      m4v: 'video/mp4',
      mov: 'video/quicktime',
      webm: 'video/webm',
      mkv: 'video/x-matroska',
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      opus: 'audio/ogg',
      flac: 'audio/flac',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
    }[ext] ?? 'application/octet-stream'
  );
}
