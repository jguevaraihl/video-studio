/**
 * Catálogo tipado de modelos de Alibaba Cloud Model Studio (DashScope).
 * La interfaz se construye a partir de este catálogo: duraciones, resoluciones,
 * relaciones de aspecto y entradas salen de aquí, no de valores fijos en la UI.
 *
 * Cada entrada guarda sus fuentes oficiales y la fecha de verificación.
 * "status: verified" = campos contrastados con la documentación en esa fecha.
 * "status: partial" = el modelo existe en la documentación pero algún campo no se pudo confirmar;
 *   la UI lo muestra con aviso y no lo usa por defecto.
 */

export type Region = 'ap-southeast-1' | 'cn-beijing';
export type Operation = 't2v' | 'i2v' | 'continuation' | 'text' | 'vision' | 'asr';

export interface RegionInfo {
  id: Region;
  label: string;
  /** Dominio con espacio de trabajo (recomendado por Alibaba). */
  workspaceBase: (workspaceId: string) => string;
  /** Dominio heredado, aún disponible. */
  legacyBase: string;
  freeQuotaEligible: boolean;
}

export const REGIONS: Record<Region, RegionInfo> = {
  'ap-southeast-1': {
    id: 'ap-southeast-1',
    label: 'Singapur (internacional)',
    workspaceBase: (w) => `https://${w}.ap-southeast-1.maas.aliyuncs.com`,
    legacyBase: 'https://dashscope-intl.aliyuncs.com',
    freeQuotaEligible: true,
  },
  'cn-beijing': {
    id: 'cn-beijing',
    label: 'China (Pekín)',
    workspaceBase: (w) => `https://${w}.cn-beijing.maas.aliyuncs.com`,
    legacyBase: 'https://dashscope.aliyuncs.com',
    freeQuotaEligible: false,
  },
};

/** Hosts a los que el puente puede reenviar solicitudes o de los que puede descargar resultados. */
export const ALLOWED_UPSTREAM_HOST = /^([a-z0-9-]+\.)*(aliyuncs\.com|alibabacloud\.com)$/i;

export type BodyStyle =
  /** wan2.7 I2V: input.media[] con first_frame / first_clip; parameters.resolution y duration. */
  | 'wan27-media'
  /** wan2.7/2.6 T2V con resolución: parameters.resolution + duration (+ratio en wan3.0). */
  | 'resolution-ratio'
  /** wan2.6 T2V documentado con parameters.size "1280*720". */
  | 'size';

export interface VideoModel {
  id: string;
  label: string;
  operation: 't2v' | 'i2v' | 'continuation';
  regions: Region[];
  status: 'verified' | 'partial';
  bodyStyle: BodyStyle;
  resolutions: string[];
  defaultResolution: string;
  /** Tamaños "ancho*alto" cuando el modelo usa parameters.size. */
  sizes?: Record<string, string>;
  durations: { min: number; max: number; step: number; default: number };
  /** 'from-input' cuando la proporción sigue a la imagen o video de entrada. */
  aspectRatios: string[] | 'from-input';
  audio: 'generated' | 'silent';
  fps: number;
  input: {
    image?: { formats: string[]; maxBytes: number; minSide: number; maxSide: number; base64: boolean; publicUrl: boolean };
    video?: { formats: string[]; minSeconds: number; maxSeconds: number; maxBytes: number; base64: boolean; publicUrl: boolean };
  };
  promptMaxChars: number;
  negativePromptMaxChars?: number;
  supportsPromptExtend: boolean;
  /** Continuación: la respuesta incluye el clip de referencia. */
  continuationIncludesReference?: boolean;
  resultUrlValidHours: number;
  /** Cuota gratuita para cuentas nuevas según la página de cuota gratuita. */
  freeQuotaForNewUsers: 'removed' | 'not-listed-as-removed' | 'unknown';
  sources: string[];
  verifiedAt: string;
  notes?: string;
}

export interface AuxModel {
  id: string;
  label: string;
  operation: 'text' | 'vision' | 'asr';
  regions: Region[];
  status: 'verified' | 'partial';
  languages?: string[];
  timestamps?: 'sentence' | 'word' | 'none';
  input?: { base64: boolean; publicUrl: boolean; maxSeconds?: number; maxBytes?: number };
  freeQuotaForNewUsers: 'removed' | 'not-listed-as-removed' | 'unknown';
  sources: string[];
  verifiedAt: string;
  notes?: string;
}

const VERIFIED = '2026-11-22';
const SRC_CATALOG = 'https://www.alibabacloud.com/help/en/model-studio/video-generate-edit-model/';
const SRC_I2V = 'https://www.alibabacloud.com/help/en/model-studio/image-to-video-general-api-reference';
const SRC_T2V = 'https://www.alibabacloud.com/help/en/model-studio/text-to-video-guide';
const SRC_FREE = 'https://www.alibabacloud.com/help/en/model-studio/new-free-quota';
const SRC_T2V_API = 'https://www.alibabacloud.com/help/en/model-studio/text-to-video-api-reference';
const SRC_ASR_API = 'https://www.alibabacloud.com/help/en/model-studio/qwen-asr-api-reference';
const SRC_VISION = 'https://www.alibabacloud.com/help/en/model-studio/vision';
const SRC_JSON = 'https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output';
const SRC_ASR = 'https://www.alibabacloud.com/help/en/model-studio/non-realtime-speech-recognition-user-guide';

export const VIDEO_MODELS: VideoModel[] = [
  {
    id: 'wan2.7-t2v-2026-04-25',
    label: 'Wan 2.7 · texto a video',
    operation: 't2v',
    regions: ['ap-southeast-1', 'cn-beijing'],
    status: 'verified',
    bodyStyle: 'resolution-ratio',
    resolutions: ['720P', '1080P'],
    defaultResolution: '720P',
    durations: { min: 2, max: 15, step: 1, default: 5 },
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    audio: 'generated',
    fps: 30,
    input: {},
    promptMaxChars: 5000,
    negativePromptMaxChars: 500,
    supportsPromptExtend: true,
    resultUrlValidHours: 24,
    freeQuotaForNewUsers: 'removed',
    sources: [SRC_T2V_API, SRC_T2V, SRC_FREE],
    verifiedAt: VERIFIED,
    notes: 'wan2.7 ya no usa size: usa resolution + ratio. Genera audio si no se envía audio_url.',
  },
  {
    id: 'wan2.7-i2v-2026-04-25',
    label: 'Wan 2.7 · imagen a video',
    operation: 'i2v',
    regions: ['ap-southeast-1', 'cn-beijing'],
    status: 'verified',
    bodyStyle: 'wan27-media',
    resolutions: ['720P', '1080P'],
    defaultResolution: '720P',
    durations: { min: 2, max: 15, step: 1, default: 5 },
    aspectRatios: 'from-input',
    audio: 'generated',
    fps: 30,
    input: {
      image: { formats: ['image/jpeg', 'image/png', 'image/bmp', 'image/webp'], maxBytes: 20 * 1024 * 1024, minSide: 240, maxSide: 8000, base64: true, publicUrl: true },
    },
    promptMaxChars: 5000,
    negativePromptMaxChars: 500,
    supportsPromptExtend: true,
    resultUrlValidHours: 24,
    freeQuotaForNewUsers: 'removed',
    sources: [SRC_I2V, SRC_CATALOG, SRC_FREE],
    verifiedAt: VERIFIED,
    notes: 'La salida sigue la proporción de la imagen; dimensiones múltiplo de 16.',
  },
  {
    id: 'wan2.7-i2v-2026-04-25#continuation',
    label: 'Wan 2.7 · continuación de video (first_clip)',
    operation: 'continuation',
    regions: ['ap-southeast-1', 'cn-beijing'],
    status: 'verified',
    bodyStyle: 'wan27-media',
    resolutions: ['720P', '1080P'],
    defaultResolution: '720P',
    durations: { min: 2, max: 15, step: 1, default: 10 },
    aspectRatios: 'from-input',
    audio: 'generated',
    fps: 30,
    input: {
      video: { formats: ['video/mp4', 'video/quicktime'], minSeconds: 2, maxSeconds: 10, maxBytes: 100 * 1024 * 1024, base64: false, publicUrl: true },
    },
    promptMaxChars: 5000,
    negativePromptMaxChars: 500,
    supportsPromptExtend: true,
    continuationIncludesReference: true,
    resultUrlValidHours: 24,
    freeQuotaForNewUsers: 'removed',
    sources: [SRC_I2V],
    verifiedAt: VERIFIED,
    notes: 'El clip de referencia debe ser una URL pública HTTP/HTTPS. La duración pedida incluye la referencia (3 s + duration=15 devuelve 12 s nuevos).',
  },
  {
    id: 'wan2.6-t2v',
    label: 'Wan 2.6 · texto a video',
    operation: 't2v',
    regions: ['ap-southeast-1', 'cn-beijing'],
    status: 'verified',
    bodyStyle: 'size',
    resolutions: ['720P', '1080P'],
    defaultResolution: '720P',
    sizes: { '720P': '1280*720', '1080P': '1920*1080' },
    durations: { min: 2, max: 15, step: 1, default: 5 },
    aspectRatios: ['16:9'],
    audio: 'generated',
    fps: 30,
    input: {},
    promptMaxChars: 5000,
    supportsPromptExtend: true,
    resultUrlValidHours: 24,
    freeQuotaForNewUsers: 'removed',
    sources: [SRC_T2V, SRC_CATALOG, SRC_FREE],
    verifiedAt: VERIFIED,
    notes: 'Ejemplo oficial con size "1280*720". Solo se confirmó 16:9 con tamaño explícito.',
  },
  {
    id: 'wan3.0-video',
    label: 'Wan 3.0 · texto a video',
    operation: 't2v',
    regions: ['ap-southeast-1'],
    status: 'partial',
    bodyStyle: 'resolution-ratio',
    resolutions: ['480P', '720P', '1080P'],
    defaultResolution: '720P',
    durations: { min: 2, max: 30, step: 1, default: 5 },
    aspectRatios: ['16:9'],
    audio: 'generated',
    fps: 30,
    input: {},
    promptMaxChars: 5000,
    supportsPromptExtend: false,
    resultUrlValidHours: 24,
    freeQuotaForNewUsers: 'not-listed-as-removed',
    sources: [SRC_T2V, SRC_CATALOG, SRC_FREE],
    verifiedAt: VERIFIED,
    notes: 'Cuerpo confirmado con resolution "720P" y ratio "16:9". La lista completa de proporciones y la disponibilidad regional no se confirmaron.',
  },
];

export const AUX_MODELS: AuxModel[] = [
  {
    id: 'qwen-plus',
    label: 'Qwen Plus · texto',
    operation: 'text',
    regions: ['ap-southeast-1', 'cn-beijing'],
    status: 'partial',
    freeQuotaForNewUsers: 'removed',
    sources: [SRC_JSON, SRC_FREE],
    verifiedAt: VERIFIED,
    notes: 'API compatible con OpenAI en {dominio}/compatible-mode/v1/chat/completions. response_format json_object exige la palabra «json» en los mensajes.',
  },
  {
    id: 'qwen3-vl-plus',
    label: 'Qwen3-VL Plus · visión',
    operation: 'vision',
    regions: ['ap-southeast-1', 'cn-beijing'],
    status: 'partial',
    freeQuotaForNewUsers: 'removed',
    input: { base64: true, publicUrl: true, maxBytes: 10 * 1024 * 1024 },
    sources: [SRC_VISION, SRC_JSON, SRC_FREE],
    verifiedAt: VERIFIED,
  },
  {
    id: 'qwen-audio-3.1-asr-flash',
    label: 'Qwen Audio 3.1 ASR Flash · voz',
    operation: 'asr',
    regions: ['ap-southeast-1'],
    status: 'partial',
    languages: ['es', 'en', 'zh'],
    timestamps: 'sentence',
    input: { base64: true, publicUrl: true, maxSeconds: 300, maxBytes: 2 * 1024 ** 3 },
    freeQuotaForNewUsers: 'unknown',
    sources: [SRC_ASR, SRC_ASR_API, 'https://www.alibabacloud.com/help/en/model-studio/asr-model/'],
    verifiedAt: VERIFIED,
    notes: 'Admite URL o Base64 (máx. 5 min). La presencia de marcas temporales en la respuesta síncrona se valida en cada respuesta: si faltan, la app no inventa tiempos.',
  },
];

export function videoModelsFor(operation: VideoModel['operation'], region: Region): VideoModel[] {
  return VIDEO_MODELS.filter((m) => m.operation === operation && m.regions.includes(region));
}

export function findVideoModel(id: string): VideoModel | undefined {
  return VIDEO_MODELS.find((m) => m.id === id);
}

export function apiModelId(id: string): string {
  return id.split('#')[0]!;
}

export function baseUrl(region: Region, workspaceId?: string | null): string {
  const r = REGIONS[region];
  return workspaceId ? r.workspaceBase(workspaceId) : r.legacyBase;
}

/**
 * Precio por segundo: no se pudo verificar una tarifa vigente desde la documentación consultada.
 * La interfaz muestra «costo no verificado». Si se confirma una tarifa, agréguela aquí con su fuente.
 */
export interface VerifiedPrice {
  modelId: string;
  resolution: string;
  perSecond: number;
  currency: string;
  source: string;
  verifiedAt: string;
}
export const VERIFIED_PRICES: VerifiedPrice[] = [];

export function priceFor(modelId: string, resolution: string): VerifiedPrice | null {
  return VERIFIED_PRICES.find((p) => p.modelId === apiModelId(modelId) && p.resolution === resolution) ?? null;
}
