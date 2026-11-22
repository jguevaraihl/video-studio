# Alibaba Cloud Model Studio (DashScope)

Fecha de verificación: **22 de noviembre de 2026**. Fuente: documentación oficial de Alibaba Cloud (enlaces al final). El catálogo tipado está en [`packages/providers/src/catalog.ts`](../packages/providers/src/catalog.ts). Cada modelo indica sus fuentes, su fecha y si está `verified` (campos contrastados) o `partial` (algún campo sin confirmar).

Durante el desarrollo no se envió ninguna solicitud real a Alibaba. Las pruebas de contrato usan respuestas simuladas con la forma documentada.

## Puntos de acceso

| Uso | URL |
|---|---|
| Base internacional con espacio de trabajo | `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com` |
| Base internacional heredada (sin espacio de trabajo) | `https://dashscope-intl.aliyuncs.com` |
| Crear tarea de video | `POST {base}/api/v1/services/aigc/video-generation/video-synthesis` con `X-DashScope-Async: enable` |
| Consultar tarea | `GET {base}/api/v1/tasks/{task_id}` |
| Chat compatible con OpenAI | `POST {base}/compatible-mode/v1/chat/completions` |
| ASR síncrono (qwen-audio) | `POST {base}/api/v1/services/aigc/multimodal-generation/generation` |

El puente solo acepta destinos `*.aliyuncs.com` o `*.alibabacloud.com` por HTTPS.

## Modelos de video del catálogo

| Id | Operación | Estado | Resolución | Proporción | Duración | Notas |
|---|---|---|---|---|---|---|
| `wan2.7-t2v-2026-04-25` | Texto a video | verified | 720P, 1080P | 16:9, 9:16, 1:1, 4:3, 3:4 | 2 a 15 s | Genera audio. `prompt_extend` activo por defecto. |
| `wan2.7-i2v-2026-04-25` | Imagen a video | verified | 720P, 1080P | Sigue a la imagen | 2 a 15 s | Imagen como data URI Base64 o URL pública, hasta 20 MB, lado de 240 a 8000 px. |
| `wan2.7-i2v-2026-04-25#continuation` | Continuación | verified | 720P, 1080P | Sigue al clip | Según modelo | `first_clip`: MP4 o MOV de 2 a 10 s, **solo URL pública**. La salida incluye la referencia. |
| `wan2.6-t2v` | Texto a video | verified | Usa `size` («1280*720») | | | Formato de parámetros distinto. |
| `wan3.0-video` | Texto a video | partial | | | | Existe en la documentación. Algunos campos sin confirmar. |

Auxiliares: `qwen-plus` (texto y mejora de prompt), `qwen3-vl-plus` (visión, imagen data URI hasta 10 MB), `qwen-audio-3.1-asr-flash` (voz a texto síncrona, hasta 5 min, español).

## Ciclo de una tarea

1. Estados: `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELED`, `UNKNOWN`.
2. El `task_id` y la `video_url` valen 24 horas. Pasado ese plazo la tarea aparece como `UNKNOWN`.
3. Intervalo de consulta sugerido: unos 15 s. La app empieza en 5 s, sube hasta 15 s y duplica la espera ante un límite de frecuencia.
4. No hay un punto de acceso documentado para cancelar. «Dejar de esperar» detiene la consulta, no la tarea.
5. La app descarga el resultado en cuanto termina, lo importa a la biblioteca y mide su duración real.

## Cuota gratuita y protección

- **Medio de pago obligatorio.** Para crear una clave, Alibaba exige completar los datos de facturación y vincular una tarjeta, PayPal, Google Pay o Apple Pay. Visto en la consola el 22 de noviembre de 2026. Sin eso no hay clave, ni siquiera para la cuota gratuita.
- La tabla de precios de Singapur (21-11-2026) muestra 1 millón de tokens gratis por 90 días para `qwen4-max`, `qwen3.8-max` y `qwen3.7-max`. La app usa `qwen3.8-max` para texto.
- `wan3.0-video` no está en la lista de cuotas retiradas, pero la página no indica cuántos segundos gratis da. No confirmado.

- El 29 de octubre de 2026 Alibaba retiró la cuota gratuita para cuentas nuevas en wan2.5, wan2.6, wan2.7, qwen-plus, qwen-max y qwen-vl.
- No existe API para consultar la cuota restante ni el estado del interruptor «Free Quota Only».
- El interruptor está en Consola › Model usage › pestaña Free Quota. Tarda unos 30 minutos en aplicarse.
- Con la protección activa, al agotarse la cuota Alibaba responde `403 AllocationQuota.FreeTierOnly`.

Consecuencia en la app: la política «Solo cuota gratuita» bloquea todo envío facturable, porque la app no puede acreditar que la protección esté activa. Para generar hay que elegir «Permitir consumo según mi cuenta» y escribir la frase de confirmación.

## Costos

No se encontraron tarifas por segundo publicadas y verificables para estos modelos en la fecha de verificación. La app muestra «costo no verificado». Si tienes la tarifa de tu consola, anótala en [PREGUNTAS.txt](../PREGUNTAS.txt). Se añadirá a `VERIFIED_PRICES` con su fuente.

## Errores

| Código o estado | Tipo en la app | Qué hace la app |
|---|---|---|
| `InvalidApiKey`, HTTP 401 | invalid-key | Pide revisar la clave. La tarea sigue en el proveedor si ya existía. |
| `AllocationQuota.FreeTierOnly`, HTTP 403 | free-tier-only-exhausted | Explica que la cuota gratuita se agotó con la protección activa. |
| `Arrearage`, saldo insuficiente | quota-exhausted | Pide revisar el saldo. |
| `Throttling`, HTTP 429 | rate-limited | Espera más antes de volver a consultar. |
| `DataInspectionFailed` | content-rejected | Pide cambiar el prompt o la imagen. |
| `ModelNotFound` 404, `Model.AccessDenied` 403 | model-unavailable | Sugiere otro modelo o región. |
| `InvalidParameter`, HTTP 400 | invalid-request | Muestra el detalle. |
| Corte de red al crear | network, envío ambiguo | No reenvía. Marca «Envío incierto» y pide confirmación explícita. |

## Datos que salen del equipo

| Acción | Qué se envía |
|---|---|
| Texto a video | Prompt y prompt negativo |
| Imagen a video | Prompt y la imagen elegida (Base64) |
| Continuación | Prompt y la URL pública que indiques |
| Cadena por último fotograma | Prompt y el último fotograma (PNG), una vez por tramo |
| Mejorar prompt | El prompt |
| Asistente | La petición y un resumen del montaje (nombres, tiempos, pistas). Ningún archivo. |
| Capítulos con visión | Hasta 16 fotogramas JPEG de 512 px |
| Transcribir | El audio del tramo usado del clip, en WAV mono, hasta 5 min |

## Supuestos débiles

1. **Formato de las marcas de tiempo del ASR.** La documentación de `qwen-audio-3.1-asr-flash` no muestra con claridad cómo devuelve los tiempos. Si la respuesta no trae tiempos, la app lo dice y no inventa subtítulos.
2. **wan3.0-video.** Algunos campos no se pudieron confirmar. Está marcado como parcial.
3. **Ningún flujo de IA se probó contra la API real**, por la regla de no consumir cuota. La primera generación real es la verificación pendiente más importante.

## Fuentes

- Texto a video, referencia de la API: https://www.alibabacloud.com/help/en/model-studio/text-to-video-api-reference
- Texto a video, guía: https://www.alibabacloud.com/help/en/model-studio/text-to-video-guide
- Imagen a video, referencia: https://www.alibabacloud.com/help/en/model-studio/image-to-video-general-api-reference
- Modelos de generación y edición de video: https://www.alibabacloud.com/help/en/model-studio/video-generate-edit-model/
- Cuota gratuita: https://www.alibabacloud.com/help/en/model-studio/new-free-quota
- Salida estructurada (JSON): https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output
- Visión: https://www.alibabacloud.com/help/en/model-studio/vision
- Reconocimiento de voz: https://www.alibabacloud.com/help/en/model-studio/asr-model/
- Qwen ASR, referencia: https://www.alibabacloud.com/help/en/model-studio/qwen-asr-api-reference
- Reconocimiento no en tiempo real: https://www.alibabacloud.com/help/en/model-studio/non-realtime-speech-recognition-user-guide
