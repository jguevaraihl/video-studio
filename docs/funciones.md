# Funciones, implementación, evidencia y limitaciones

Estado al 22 de noviembre de 2026. «e2e» significa una prueba de Playwright en Chromium real. «Unitaria» o «contrato» son pruebas de Vitest sin navegador ni red.

Entorno de las pruebas: Chromium headless 1.63 en Linux, dentro de un contenedor. No se probó en Windows. Es el supuesto más débil de la parte local: los códecs disponibles en Chrome o Edge para Windows pueden cambiar la ruta de exportación (por ejemplo, AAC por WebCodecs en lugar de FFmpeg.wasm).

## Edición y exportación (sin IA)

| Función | Implementación | Evidencia | Limitación |
|---|---|---|---|
| Pantalla inicial: texto, imagen, importar, abrir, ejemplo | `features/home/Home.tsx` | e2e usan «ejemplo», «importar» y «abrir .zip» | |
| Material de ejemplo local con movimiento y audio identificable | `lib/sample.ts`, `scripts/make-fixtures.mjs` | `export.spec.ts` | Contenido sintético. |
| Importar video, audio e imagen | `engine/probe.ts` (mediabunny) | `sync.spec.ts`, `editing.spec.ts` (sin audio) | Los códecs dependen del navegador. |
| Base de tiempo entera (705 600 000 ticks/s) | `packages/project/src/time.ts` | Unitarias: sin deriva en 1 h a 29,97 fps | |
| FPS variable | Fotogramas por timestamp real (`engine/frames.ts`) | Detección en `probe.ts` | Sin prueba con un archivo VFR real. |
| Multipista, mover, recortar, dividir, duplicar, borrar con cierre de hueco | `packages/project/src/ops.ts`, `features/timeline/` | Unitarias (`ops.test.ts`) y e2e (`editing.spec.ts`) | |
| Ajuste magnético | `snap`, `snapCandidates` | Unitaria | Sin e2e del arrastre con imán. |
| Deshacer y rehacer; un arrastre = una entrada | `state/store.ts` (gestos) | e2e «recortar arrastrando crea una sola entrada» | Historial de 200 pasos. |
| Transformaciones y keyframes de texto | `engine/renderer.ts` | Título animado del ejemplo, en la evidencia exportada | Sin prueba de píxeles del keyframe. |
| Color y LUT 3D (WebGL2) | `engine/gl.ts`, `engine/luts.ts` | e2e `color.spec.ts`: la LUT cambia el color medido | El respaldo por CPU no se probó en e2e (Chromium trae WebGL2). |
| Disolución | `compose.ts`, `validateTransition` | Unitaria y ejemplo exportado | Solo disolución. |
| Velocidad constante y curva; audio con WSOLA | `timing.ts`, `dsp.ts` | Unitarias; e2e de ralentizar | La curva no tiene e2e. |
| Mezclador: volumen, silencio, solo, fundidos, medidor, ondas, puerta de ruido | `engine/audio.ts`, `viewer/Meter.tsx` | Unitarias de DSP y del plan de audio; audio audible en cada exportación | Medidor y ondas sin prueba automática. |
| Subtítulos SRT/VTT, quemado, vínculo a clips | `subtitles.ts`, `features/subtitles/` | Unitarias (ida y vuelta, vínculo) | Quemado sin prueba de píxeles. |
| Autoguardado (IndexedDB y OPFS) y recuperación | `storage/` | e2e «guardar, recargar y recuperar» | |
| Copia portátil (.zip sin credenciales) | `storage/portable.ts` | e2e de ida y vuelta en un navegador limpio | |
| Almacenamiento local insuficiente | `storage/media.ts` (`QuotaError`) | e2e con cuota simulada | Simulada. |
| Archivos faltantes y reubicar | `features/library/Library.tsx` | | Sin prueba automática. |
| Exportar MP4 (H.264 + AAC) y WebM (VP9/VP8 + Opus) | `engine/export/`, `workers/export.worker.ts` | e2e + ffprobe; `evidence/` | |
| 720p y 1080p | `outputSize` | e2e 720p y 1080p | |
| Detección real de rutas y FFmpeg.wasm de respaldo | `capabilities.ts`, `ffmpeg.ts` | e2e con FFmpeg forzado (MP4 y WebM) | FFmpeg.wasm usa el núcleo de un hilo y VP8. Ver nota 1. |
| Fases reales y cancelar | `ExportDialog.tsx` | e2e «cancelar deja el editor usable» | |
| Sincronía audio/video ≤ 1 fotograma | Mismo reloj de ticks para audio y video | e2e `sync.spec.ts`: 0 a 1 ms | |
| Escenario de 30 s a 720p | | e2e: 34 s de video en 10,8 s | Medido en el contenedor, no en tu PC. |
| Sin aislamiento entre orígenes (sin COOP/COEP) | `npm run dev:web:sin-aislamiento` | Suite de exportación completa en ese modo | |
| Extender A: ralentizar y bucle inteligente | `features/extend/` | e2e: la duración final coincide | El bucle busca similitud en gris de 32×18. |
| Interfaz para móvil | `Editor.tsx` | Captura a 390 px | Pensada para escritorio; en móvil hay menos controles. |

## IA gratuita (Google Gemini)

| Función | Implementación | Evidencia | Limitación |
|---|---|---|---|
| Proveedor Gemini para texto y visión | `catalog.ts` (`auxModelFor`), `dashscope.ts` (`chat`), `server.ts` | Contrato: URL y cabecera de Gemini, sin `response_format`, video y voz bloqueados sin llamar al proveedor | Sin prueba real. Usa la API compatible con OpenAI, en beta según Google. |
| Selector de proveedor en «Conexión de IA» | `AiSettingsModal.tsx` | Captura con conexión simulada | Disponibilidad en Chile sin confirmar. |

## IA (Alibaba Cloud Model Studio)

Ningún flujo de IA se probó contra la API real, por la regla de no consumir cuota. Las pruebas usan respuestas simuladas con la forma documentada.

| Función | Implementación | Evidencia | Limitación |
|---|---|---|---|
| Puente BYOK en 127.0.0.1, clave solo en memoria | `apps/bridge/src/server.ts` | Contrato: origen rechazado, clave ausente de respuestas y registros | |
| Políticas «Solo cuota gratuita» y «Permitir consumo» | `packages/providers/src/policy.ts` | Contrato: bloqueo sin llamar al proveedor; frase exacta | «Solo cuota gratuita» bloquea todo (ver nota 2). |
| Texto a video e imagen a video | `GeneratePanel.tsx`, `generation-service.ts` | Contrato: cuerpo y cabeceras documentados | Sin prueba real. |
| Estados, espera progresiva, descarga e importación | `generation-service.ts` | Contrato: límite de frecuencia y luego éxito | |
| Errores: clave, cuota, saldo, límite, vencido | `dashscope.ts` | Contrato, un caso por error | |
| Envío ambiguo sin duplicar | Puente (`clientRequestId`) y servicio | Contrato: un solo envío tras corte de red | |
| Recuperación tras recargar | `resumePendingGenerations` | | Sin e2e. |
| Mejorar prompt con comparación | `GeneratePanel.tsx` | | Sin prueba real. |
| Asistente con comandos tipados | `AssistantPanel.tsx`, `commands.ts` | Unitarias de validación y aplicación | Sin prueba real del modelo. |
| Capítulos con visión | `AssistantPanel.tsx`, `analyzeFrames` | Ajuste a los tiempos enviados | Sin prueba real. |
| Transcripción a subtítulos vinculados | `TranscribeButton.tsx` | | Formato de tiempos del modelo sin confirmar (nota 3). |
| Extender B: continuación nativa | `ExtendDialog.tsx` | Unitaria del cálculo del tramo nuevo | Requiere una URL pública que el usuario sube. |
| Extender C: cadena por último fotograma | `extend-service.ts` | Unitaria del plan de tramos | Sin prueba real. |
| Costo | `priceFor` | | Siempre «costo no verificado» (nota 4). |

## Notas

1. **FFmpeg.wasm 0.12.10.** En Chromium, el núcleo multihilo falló con libx264 («function signature mismatch»), cerró la pestaña con libvpx-vp9 y se bloqueó con libopus. El núcleo de un hilo codificó H.264 y VP8 a unos 29 fotogramas/s a 720p. VP9 en un hilo bajó de 1 fotograma/s. Por eso la ruta de respaldo usa siempre un hilo, VP8 para WebM y Opus por WebCodecs.
2. **Cuota gratuita.** Alibaba no ofrece API para consultar la cuota ni el interruptor «Free Quota Only». La app no puede acreditar la protección, así que en ese modo bloquea.
3. **Tiempos del ASR.** Si `qwen-audio-3.1-asr-flash` no devuelve tiempos, la app lo informa y no crea subtítulos.
4. **Tarifas.** No se encontraron tarifas por segundo verificables. Se añadirán con su fuente cuando las indiques en PREGUNTAS.txt.
