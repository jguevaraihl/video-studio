# Estudio de Video

Editor de video en el navegador. La IA es opcional y usa tu propia clave: Google Gemini gratis para texto y visión, o Alibaba Cloud Model Studio para generar video (de pago).

- Edita en local: tus archivos no salen del equipo.
- Exporta MP4 (H.264 + AAC) y WebM (VP9 o VP8 + Opus) a 720p o 1080p.
- La IA es opcional. Antes de cada envío la app muestra qué sale del equipo, el modelo, el número de solicitudes y el costo.
- Interfaz en español. Funciona en Chrome o Edge para Windows.

Primera exportación hecha por la propia app: [`evidence/`](evidence/LEEME.md).

## Requisitos

| Programa | Versión | Para qué |
|---|---|---|
| Windows 10 u 11 | | |
| Google Chrome o Microsoft Edge | Actualizado | Abrir la app |
| Node.js | 20.19 o superior (recomendado 22 LTS) | Ejecutar la app |
| Git | Cualquiera reciente | Descargar el código |
| FFmpeg | Opcional | Solo para verificar exportaciones y regenerar el material de prueba |

## Instalación en Windows (PowerShell)

Abre PowerShell. No hace falta abrirlo como administrador.

### 1. Instala Node.js y Git (una sola vez)

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Cierra PowerShell y ábrelo de nuevo, para que reconozca los comandos. Comprueba:

```powershell
node -v    # debe mostrar v20.19 o superior
git --version
```

### 2. Descarga el proyecto

```powershell
cd $HOME\Documents
git clone https://github.com/jguevaraihl/video-studio.git
cd video-studio
git checkout claude/project-thread-uumj9w
```

### 3. Instala las dependencias

```powershell
npm install
```

Tarda unos minutos la primera vez. Al final copia FFmpeg.wasm a `apps/web/public/ffmpeg/`.

### 4. Inicia la app

Editor y puente de IA juntos:

```powershell
npm run dev
```

Solo el editor (sin IA):

```powershell
npm run dev:web
```

Abre Chrome o Edge en **http://127.0.0.1:5173**. Para detener la app, vuelve a PowerShell y pulsa `Ctrl + C`.

### 5. Primer uso

Sigue la guía [Mi primer video](docs/mi-primer-video.md). Son cinco minutos.

## Conectar la IA (opcional)

### Opción gratuita: Google Gemini (texto y visión)

Sirve para «Mejorar prompt», el asistente de edición y los capítulos con visión. No genera video ni transcribe.

1. Entra a https://aistudio.google.com/apikey con tu cuenta de Google y crea una clave. Usa un proyecto **sin facturación activada**. Así no hay cobros: al llegar al límite diario, Google rechaza la solicitud.
2. En la app, pulsa **IA**, elige «Google Gemini, nivel gratuito» y pega la clave.
3. En el nivel gratuito, Google usa lo que envías para mejorar sus productos. No envíes material confidencial.

Para crear clips de video sin pagar, usa un generador web con nivel gratuito, descarga el video e impórtalo en la pestaña Medios.

### Opción de pago: Alibaba Cloud Model Studio (video)

1. Crea una clave en Alibaba Cloud Model Studio (Consola › API Keys). Alibaba exige completar los datos de facturación y vincular un medio de pago antes de crear la clave.
2. En la app, pulsa **IA**, elige «Alibaba Cloud Model Studio» y pega la clave. Elige la región: Singapur (internacional) o Pekín.

En ambos casos la clave queda solo en la memoria del puente local. No se guarda en disco, en el proyecto ni en el navegador. Al cerrar el puente se borra.

**Política de gasto.** La app arranca en «Solo cuota gratuita». Alibaba no ofrece una API para comprobar la cuota gratuita ni el interruptor «Free Quota Only». Por eso, en ese modo, la app bloquea todo envío facturable. Para generar, elige «Permitir consumo según mi cuenta» y escribe la frase de confirmación. Fija también el máximo de tramos por operación. Detalles en [docs/alibaba.md](docs/alibaba.md).

Si quieres proteger tu cuenta del lado de Alibaba: Consola › Model usage › pestaña Free Quota › activa «Free Quota Only». Tarda unos 30 minutos en aplicarse. Con esa protección, Alibaba responde «AllocationQuota.FreeTierOnly» al agotarse la cuota y la app lo muestra.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Editor y puente de IA |
| `npm run dev:web` | Solo el editor |
| `npm run dev:web:sin-aislamiento` | Editor sin cabeceras COOP/COEP, en el puerto 5174 (prueba de compatibilidad) |
| `npm run dev:bridge` | Solo el puente de IA |
| `npm run build` | Compila para producción en `apps/web/dist` |
| `npm run typecheck` | Comprueba tipos |
| `npm test` | Pruebas unitarias y de contrato (sin red) |
| `npm run test:e2e` | Pruebas en navegador con Playwright (requiere FFmpeg en el PATH) |
| `npm run verify:export -- archivo.mp4` | Verifica un video exportado con ffprobe |

Para las pruebas e2e en Windows, instala antes el navegador de Playwright y FFmpeg:

```powershell
npx playwright install chromium
winget install Gyan.FFmpeg
```

## Estructura

```
apps/web          Editor (React, Vite, TypeScript, Tailwind)
apps/bridge       Puente local de IA (Node, solo 127.0.0.1)
packages/project  Esquema del proyecto, base de tiempo, edición, composición (sin DOM)
packages/providers Catálogo de modelos y adaptadores de DashScope (sin DOM)
tests/            Pruebas unitarias, de contrato y e2e
evidence/         Exportaciones generadas por la app y su verificación
docs/             Guías y notas técnicas
deploy/           Ejemplos de cabeceras para publicar la app
```

## Documentación

- [Mi primer video](docs/mi-primer-video.md): guía paso a paso.
- [Funciones, implementación, evidencia y limitaciones](docs/funciones.md).
- [Alibaba Cloud: modelos, cuota, errores y fuentes](docs/alibaba.md).
- [Publicar en un servidor](docs/publicar.md).
- [PREGUNTAS.txt](PREGUNTAS.txt): decisiones pendientes. Basta con escribir la respuesta debajo de cada pregunta.

## Privacidad y seguridad

- Importar, editar y exportar no usa la red.
- La clave de IA nunca se escribe en disco, registros, URL, `localStorage`, proyectos ni copias portátiles.
- El puente solo escucha en 127.0.0.1, solo acepta los orígenes del editor y solo reenvía a dominios oficiales de Alibaba Cloud (`aliyuncs.com`) y de la API de Gemini (`generativelanguage.googleapis.com`).
- Un envío con resultado incierto (por ejemplo, un corte de red) no se repite solo, para no cobrar dos veces.
