import { z } from 'zod';

/**
 * Esquema versionado del proyecto.
 * Versión actual: 1. Las migraciones viven en migrations.ts.
 * Todos los tiempos son enteros en ticks (ver time.ts).
 */
export const SCHEMA_VERSION = 1;

const ticks = z.number().int();
const positiveTicks = z.number().int().nonnegative();

export const RationalSchema = z.object({
  num: z.number().int().positive(),
  den: z.number().int().positive(),
});

export const KeyframeSchema = z.object({
  /** Tiempo local del clip, en ticks desde el inicio del clip en el montaje. */
  t: positiveTicks,
  v: z.number(),
  ease: z.enum(['linear', 'easeInOut', 'hold']).default('linear'),
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

export const TransformSchema = z.object({
  /** Desplazamiento del centro, en fracción del ancho del proyecto. 0 = centrado. */
  x: z.number().default(0),
  /** Desplazamiento del centro, en fracción del alto del proyecto. */
  y: z.number().default(0),
  scale: z.number().positive().default(1),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  /** Recorte por borde, en fracción del tamaño de la fuente. */
  crop: z
    .object({
      left: z.number().min(0).max(0.95).default(0),
      top: z.number().min(0).max(0.95).default(0),
      right: z.number().min(0).max(0.95).default(0),
      bottom: z.number().min(0).max(0.95).default(0),
    })
    .default({ left: 0, top: 0, right: 0, bottom: 0 }),
  fit: z.enum(['contain', 'cover', 'fill']).default('contain'),
});
export type Transform = z.infer<typeof TransformSchema>;

export const KeyframesSchema = z
  .object({
    x: z.array(KeyframeSchema).optional(),
    y: z.array(KeyframeSchema).optional(),
    scale: z.array(KeyframeSchema).optional(),
    opacity: z.array(KeyframeSchema).optional(),
    rotation: z.array(KeyframeSchema).optional(),
  })
  .default({});
export type Keyframes = z.infer<typeof KeyframesSchema>;
export type AnimatableProp = keyof Keyframes;

export const ColorSchema = z.object({
  brightness: z.number().min(-1).max(1).default(0),
  contrast: z.number().min(-1).max(1).default(0),
  saturation: z.number().min(-1).max(1).default(0),
  temperature: z.number().min(-1).max(1).default(0),
  lut: z
    .object({ id: z.string(), intensity: z.number().min(0).max(1).default(1) })
    .nullable()
    .default(null),
});
export type ColorAdjust = z.infer<typeof ColorSchema>;

export const DenoiseSchema = z.object({
  enabled: z.boolean().default(false),
  /** Puerta de ruido: umbral en dBFS. */
  thresholdDb: z.number().min(-90).max(0).default(-45),
  attackMs: z.number().min(0.1).max(200).default(5),
  releaseMs: z.number().min(5).max(2000).default(120),
  /** Atenuación aplicada bajo el umbral, en dB (negativo). */
  reductionDb: z.number().min(-90).max(0).default(-30),
});
export type Denoise = z.infer<typeof DenoiseSchema>;

export const AudioPropsSchema = z.object({
  /** Ganancia del clip en dB. */
  gainDb: z.number().min(-60).max(24).default(0),
  muted: z.boolean().default(false),
  fadeIn: positiveTicks.default(0),
  fadeOut: positiveTicks.default(0),
  denoise: DenoiseSchema.default({
    enabled: false,
    thresholdDb: -45,
    attackMs: 5,
    releaseMs: 120,
    reductionDb: -30,
  }),
});
export type AudioProps = z.infer<typeof AudioPropsSchema>;

export const SpeedPointSchema = z.object({
  /** Posición normalizada dentro del clip (0 = inicio, 1 = final). */
  p: z.number().min(0).max(1),
  /** Velocidad en ese punto (1 = normal). */
  v: z.number().min(0.1).max(16),
});
export type SpeedPoint = z.infer<typeof SpeedPointSchema>;

export const SpeedSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('constant'),
    rate: z.number().min(0.1).max(16),
    /** true: audio con estiramiento temporal WSOLA (conserva tono). false: cambia el tono. */
    preservePitch: z.boolean().default(true),
  }),
  z.object({
    mode: z.literal('curve'),
    points: z.array(SpeedPointSchema).min(2),
  }),
]);
export type Speed = z.infer<typeof SpeedSchema>;

const ClipBase = {
  id: z.string(),
  trackId: z.string(),
  start: positiveTicks,
  name: z.string().default(''),
  /** Clips con el mismo grupo se mueven, cortan y borran juntos (imagen + sonido). */
  linkGroupId: z.string().nullable().default(null),
};

const VisualProps = {
  transform: TransformSchema,
  keyframes: KeyframesSchema,
  color: ColorSchema,
  /** Fundido desde/hacia negro (opacidad), en ticks. */
  fadeIn: positiveTicks.default(0),
  fadeOut: positiveTicks.default(0),
};

export const MediaClipSchema = z.object({
  ...ClipBase,
  kind: z.literal('media'),
  assetId: z.string(),
  /** Inicio del tramo usado en tiempo del medio (ticks desde el primer timestamp). */
  sourceIn: positiveTicks,
  /** Fin del tramo usado en tiempo del medio. */
  sourceOut: positiveTicks,
  speed: SpeedSchema,
  /** Interpolación por mezcla de fotogramas (útil en cámara lenta). */
  frameBlend: z.boolean().default(false),
  ...VisualProps,
  audio: AudioPropsSchema,
});
export type MediaClip = z.infer<typeof MediaClipSchema>;

export const ImageClipSchema = z.object({
  ...ClipBase,
  kind: z.literal('image'),
  assetId: z.string(),
  duration: positiveTicks,
  ...VisualProps,
});
export type ImageClip = z.infer<typeof ImageClipSchema>;

export const TextStyleSchema = z.object({
  fontFamily: z.string().default('Inter'),
  /** Tamaño en fracción del alto del proyecto. */
  fontSize: z.number().positive().default(0.08),
  color: z.string().default('#ffffff'),
  align: z.enum(['left', 'center', 'right']).default('center'),
  bold: z.boolean().default(true),
  italic: z.boolean().default(false),
  strokeColor: z.string().default('#000000'),
  strokeWidth: z.number().min(0).default(0),
  background: z.string().nullable().default(null),
  shadow: z.boolean().default(true),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const TextClipSchema = z.object({
  ...ClipBase,
  kind: z.literal('text'),
  text: z.string(),
  duration: positiveTicks,
  style: TextStyleSchema,
  ...VisualProps,
});
export type TextClip = z.infer<typeof TextClipSchema>;

export const ClipSchema = z.discriminatedUnion('kind', [MediaClipSchema, ImageClipSchema, TextClipSchema]);
export type Clip = z.infer<typeof ClipSchema>;
export type VisualClip = MediaClip | ImageClip | TextClip;

export const TrackSchema = z.object({
  id: z.string(),
  /** video: clips de imagen; audio: clips de sonido; text: títulos; overlay: imagen superpuesta. */
  kind: z.enum(['video', 'audio', 'text', 'overlay']),
  name: z.string(),
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  /** Ganancia de pista en dB. */
  gainDb: z.number().min(-60).max(24).default(0),
});
export type Track = z.infer<typeof TrackSchema>;
export type TrackKind = Track['kind'];

export const TransitionSchema = z.object({
  id: z.string(),
  kind: z.enum(['dissolve']),
  fromClipId: z.string(),
  toClipId: z.string(),
  /** Duración total, centrada en el corte. */
  duration: positiveTicks,
});
export type Transition = z.infer<typeof TransitionSchema>;

export const AssetSchema = z.object({
  id: z.string(),
  kind: z.enum(['video', 'audio', 'image']),
  name: z.string(),
  mime: z.string(),
  size: z.number().nonnegative(),
  /** Clave en el almacén de medios (OPFS o IndexedDB). Un archivo se guarda una sola vez. */
  storageKey: z.string(),
  /** Clave de la versión reducida para edición, si existe. */
  proxyKey: z.string().nullable().default(null),
  duration: positiveTicks.default(0),
  /** Primer timestamp del medio, en ticks. Los tiempos de clip se cuentan desde aquí. */
  firstTimestamp: ticks.default(0),
  width: z.number().int().nonnegative().default(0),
  height: z.number().int().nonnegative().default(0),
  /** Rotación de metadatos (celulares): 0, 90, 180 o 270. */
  rotation: z.number().int().default(0),
  fps: z.number().nonnegative().default(0),
  variableFps: z.boolean().default(false),
  hasVideo: z.boolean().default(false),
  hasAudio: z.boolean().default(false),
  videoCodec: z.string().nullable().default(null),
  audioCodec: z.string().nullable().default(null),
  sampleRate: z.number().nonnegative().default(0),
  channels: z.number().int().nonnegative().default(0),
  origin: z
    .object({
      type: z.enum(['import', 'sample', 'generated', 'extension', 'recording']),
      generationId: z.string().nullable().default(null),
    })
    .default({ type: 'import', generationId: null }),
  createdAt: z.number(),
});
export type Asset = z.infer<typeof AssetSchema>;

export const CueSchema = z.object({
  id: z.string(),
  start: positiveTicks,
  end: positiveTicks,
  text: z.string(),
  /** Si está vinculado, start/end se recalculan desde el tiempo del medio del clip. */
  link: z
    .object({
      clipId: z.string(),
      sourceStart: positiveTicks,
      sourceEnd: positiveTicks,
    })
    .nullable()
    .default(null),
});
export type Cue = z.infer<typeof CueSchema>;

export const SubtitleStyleSchema = z.object({
  fontFamily: z.string().default('Inter'),
  fontSize: z.number().positive().default(0.05),
  color: z.string().default('#ffffff'),
  background: z.string().nullable().default('rgba(0,0,0,0.55)'),
  /** Posición vertical del borde inferior, en fracción del alto. */
  bottom: z.number().min(0).max(0.5).default(0.08),
});

export const SubtitlesSchema = z.object({
  cues: z.array(CueSchema).default([]),
  style: SubtitleStyleSchema.default({
    fontFamily: 'Inter',
    fontSize: 0.05,
    color: '#ffffff',
    background: 'rgba(0,0,0,0.55)',
    bottom: 0.08,
  }),
  /** Quemar los subtítulos en la imagen exportada. */
  burnIn: z.boolean().default(false),
  visibleInViewer: z.boolean().default(true),
});
export type Subtitles = z.infer<typeof SubtitlesSchema>;

export const GenerationSchema = z.object({
  id: z.string(),
  operation: z.enum(['t2v', 'i2v', 'continuation', 'lastFrameChain']),
  provider: z.string(),
  model: z.string(),
  region: z.string(),
  prompt: z.string(),
  negativePrompt: z.string().default(''),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  status: z.enum(['draft', 'submitting', 'unknown-submit', 'pending', 'running', 'succeeded', 'failed', 'canceled', 'expired', 'imported']),
  taskId: z.string().nullable().default(null),
  /** Identificador local que evita reenvíos duplicados tras un corte de red. */
  clientRequestId: z.string(),
  submittedAt: z.number().nullable().default(null),
  finishedAt: z.number().nullable().default(null),
  resultUrlExpiresAt: z.number().nullable().default(null),
  resultUrl: z.string().nullable().default(null),
  assetId: z.string().nullable().default(null),
  sourceAssetId: z.string().nullable().default(null),
  chain: z
    .object({ chainId: z.string(), index: z.number().int(), total: z.number().int() })
    .nullable()
    .default(null),
  error: z.object({ code: z.string(), message: z.string() }).nullable().default(null),
  /** Duración real devuelta y tramo nuevo insertado (continuaciones). */
  measured: z
    .object({ returnedDuration: z.number(), newSegmentStart: z.number(), newSegmentDuration: z.number() })
    .nullable()
    .default(null),
  createdAt: z.number(),
});
export type Generation = z.infer<typeof GenerationSchema>;

export const SettingsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: RationalSchema,
  sampleRate: z.number().int().positive().default(48000),
  background: z.string().default('#000000'),
});
export type ProjectSettings = z.infer<typeof SettingsSchema>;

export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  settings: SettingsSchema,
  assets: z.record(z.string(), AssetSchema),
  /** Orden de dibujo: el índice mayor queda encima. */
  tracks: z.array(TrackSchema),
  clips: z.record(z.string(), ClipSchema),
  transitions: z.record(z.string(), TransitionSchema).default({}),
  subtitles: SubtitlesSchema,
  generations: z.record(z.string(), GenerationSchema).default({}),
  masterGainDb: z.number().min(-60).max(12).default(0),
});
export type Project = z.infer<typeof ProjectSchema>;

export function parseProject(data: unknown): Project {
  return ProjectSchema.parse(data);
}

export const defaultTransform = (): Transform => ({
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  crop: { left: 0, top: 0, right: 0, bottom: 0 },
  fit: 'contain',
});

export const defaultColor = (): ColorAdjust => ({
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  lut: null,
});

export const defaultAudio = (): AudioProps => ({
  gainDb: 0,
  muted: false,
  fadeIn: 0,
  fadeOut: 0,
  denoise: { enabled: false, thresholdDb: -45, attackMs: 5, releaseMs: 120, reductionDb: -30 },
});

export const defaultTextStyle = (): TextStyle => ({
  fontFamily: 'Inter',
  fontSize: 0.08,
  color: '#ffffff',
  align: 'center',
  bold: true,
  italic: false,
  strokeColor: '#000000',
  strokeWidth: 0,
  background: null,
  shadow: true,
});
