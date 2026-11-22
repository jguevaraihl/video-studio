import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Cabeceras de aislamiento entre orígenes: habilitan SharedArrayBuffer
 * (FFmpeg.wasm multihilo). Sin ellas la app usa el core de un solo hilo.
 */
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const bridgeTarget = process.env.VS_BRIDGE_URL ?? "http://127.0.0.1:8787";

// «--mode sin-aislamiento» (o VS_NO_ISOLATION=1) sirve sin COOP/COEP para probar la ruta de un solo hilo.
export default defineConfig(({ mode }) => {
  const headers =
    mode === "sin-aislamiento" || process.env.VS_NO_ISOLATION === "1"
      ? {}
      : isolationHeaders;
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: false,
      headers,
      proxy: { "/api": { target: bridgeTarget, changeOrigin: false } },
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      headers,
      proxy: { "/api": { target: bridgeTarget, changeOrigin: false } },
    },
    optimizeDeps: {
      exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
    },
    worker: { format: "es" },
    build: {
      target: "es2022",
      chunkSizeWarningLimit: 1500,
    },
  };
});
