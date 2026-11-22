# Publicar en un servidor

La app es estática. El puente de IA no se publica: corre en el equipo de cada usuario, en 127.0.0.1.

## Compilar

```powershell
npm run build
```

El resultado queda en `apps/web/dist`. Incluye FFmpeg.wasm en `dist/ffmpeg/`.

## Cabeceras

Para activar el aislamiento entre orígenes, el servidor debe enviar:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Ejemplos listos: [`deploy/_headers`](../deploy/_headers) (Netlify o Cloudflare Pages) y [`deploy/nginx.conf`](../deploy/nginx.conf).

Sin esas cabeceras la app funciona igual. La exportación no depende del aislamiento: FFmpeg.wasm usa siempre el núcleo de un hilo.

## IA desde una app publicada

El navegador llama a `/api` en el mismo origen. En desarrollo, Vite reenvía `/api` al puente local. En un servidor publicado no hay puente, así que la pestaña Generar mostrará «El puente local de IA no está en marcha». Para usar IA, ejecuta la app en tu equipo con `npm run dev`.

## Probar la versión compilada en tu equipo

```powershell
npm run build
npm run preview
```

Abre http://127.0.0.1:4173. El puente (`npm run dev:bridge`) acepta también ese origen.
