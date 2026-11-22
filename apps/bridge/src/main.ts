/** Arranque del puente local. Variables: VS_BRIDGE_PORT (8787), VS_BRIDGE_HOST (127.0.0.1), VS_ALLOWED_ORIGINS. */
import { createBridge, VERSION } from './server.ts';

const port = Number(process.env.VS_BRIDGE_PORT ?? 8787);
const host = process.env.VS_BRIDGE_HOST ?? '127.0.0.1';
const origins = process.env.VS_ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);
if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
  console.warn('[puente] Atención: escuchar fuera de loopback expone el puente a la red local.');
}
const { server } = createBridge({ allowedOrigins: origins });
server.listen(port, host, () => {
  console.log(`[puente] v${VERSION} escuchando en http://${host}:${port} (solo memoria; la clave nunca se guarda en disco)`);
});
