# Evidencia: primera exportación local

La propia app generó estos archivos en Chromium, sin red y sin IA.
Proyecto: «Probar con material de ejemplo» (dos clips con disolución, música, título animado y subtítulos).

| Archivo | Contenido | Verificación |
|---|---|---|
| `primera-exportacion-720p.mp4` | H.264 High + AAC LC, 1280×720, 30 fps, 8,53 s | `primera-exportacion-720p.mp4.verificacion.txt` |
| `primera-exportacion-720p.webm` | VP9 + Opus, 1280×720, 30 fps, 8,52 s | `primera-exportacion-720p.webm.verificacion.txt` |
| `sincronia-mp4.txt`, `sincronia-webm.txt` | Desfase entre destello y pitido en el fixture de sincronía | 0 a 1 ms (límite: 33,3 ms, un fotograma) |

Ruta usada en Chromium headless (Linux): video con WebCodecs (AVC o VP9). El audio AAC salió por FFmpeg.wasm porque ese Chromium no trae codificador AAC. En Chrome o Edge para Windows el AAC suele salir por WebCodecs.

## Cómo abrir el video

1. En GitHub, abre `evidence/primera-exportacion-720p.mp4` y pulsa «View raw» o «Download».
2. En Windows, haz doble clic en el archivo. Se abre con «Fotos» o «Reproductor multimedia».
3. Con el repositorio clonado, en PowerShell: `start .\evidence\primera-exportacion-720p.mp4`

## Cómo repetir la verificación

```powershell
node scripts/verify-export.mjs evidence/primera-exportacion-720p.mp4 --expect-seconds=8.5 --width=1280 --height=720
```

Requiere ffmpeg y ffprobe en el PATH.
