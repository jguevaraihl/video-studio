/** Conexión BYOK: clave en memoria del puente local, región, espacio de trabajo y política de gasto. */
import { useState } from 'react';
import { useStore } from '../../state/store.ts';
import { Button, Field, Modal, Notice, inputClass } from '../../ui/kit.tsx';
import { bridge, refreshBridge, useBridgeStatus } from './bridge-client.ts';

const PHRASE = 'PERMITIR CONSUMO';

export function AiSettingsModal() {
  const st = useStore.getState();
  const status = useBridgeStatus();
  const [key, setKey] = useState('');
  const [region, setRegion] = useState<'ap-southeast-1' | 'cn-beijing'>('ap-southeast-1');
  const [workspace, setWorkspace] = useState('');
  const [phrase, setPhrase] = useState('');
  const [maxSeg, setMaxSeg] = useState(status.session?.maxSegmentsPerOperation ?? 3);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const s = status.session;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await refreshBridge();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Conexión de IA (Alibaba Cloud Model Studio)" onClose={() => st.setAiSettingsOpen(false)} wide>
      <div className="flex flex-col gap-4 text-sm">
        {!status.online && (
          <Notice kind="warn">
            El puente local no está en marcha. Inícialo con <code>npm run dev</code> (editor + puente) o <code>npm run dev:bridge</code>. Sin puente puedes importar, editar y exportar con normalidad.
          </Notice>
        )}
        <Notice>
          La clave se envía solo al puente local (127.0.0.1) y queda en su memoria mientras esté abierto. No se guarda en el navegador, en el proyecto, en la copia portátil ni en registros. Al cerrar el puente o pulsar «Desconectar», se borra.
        </Notice>
        {s ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-700/50 bg-emerald-950/30 px-3 py-2">
            <span>Conectado · {s.regionLabel} · clave {s.keyHint}{s.workspaceId ? ` · espacio ${s.workspaceId}` : ' · dominio heredado'}</span>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => run(() => bridge.disconnect())}>Desconectar</Button>
          </div>
        ) : (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await bridge.connect(key, region, workspace.trim() || null);
                setKey('');
              });
            }}
          >
            <Field label="API key de Model Studio">
              <input className={inputClass} type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" aria-describedby="key-help" />
            </Field>
            <Field label="Región">
              <select className={inputClass} value={region} onChange={(e) => setRegion(e.target.value as typeof region)}>
                <option value="ap-southeast-1">Singapur (internacional, admite cuota gratuita)</option>
                <option value="cn-beijing">China (Pekín)</option>
              </select>
            </Field>
            <Field label="ID del espacio de trabajo (opcional, recomendado)">
              <input className={inputClass} value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder="Consola › Workspace Details" />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="primary" disabled={busy || key.length < 8 || !status.online}>Conectar</Button>
            </div>
            <p id="key-help" className="text-xs text-ink-400 sm:col-span-2">La clave no se comprueba al conectar, para no generar consumo. Se valida en la primera solicitud real. La clave, el modelo y el endpoint deben ser de la misma región.</p>
          </form>
        )}

        <section className="rounded-xl border border-ink-700 p-4">
          <h3 className="mb-2 font-semibold">Política de gasto</h3>
          <div className="flex flex-col gap-3">
            <label className="flex items-start gap-2">
              <input type="radio" name="policy" checked={!s || s.policy === 'free-only'} disabled={!s || busy} onChange={() => run(() => bridge.setPolicy('free-only'))} />
              <span>
                <b>Solo cuota gratuita</b> (predeterminada). La app no puede comprobar desde aquí que la protección oficial esté activa ni cuánta cuota queda, porque Alibaba solo lo muestra en su consola. Por eso, en este modo <b>no se envía ninguna solicitud</b> al proveedor.
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="policy" checked={s?.policy === 'allow-billing'} disabled />
              <span>
                <b>Permitir consumo según mi cuenta.</b> Antes de cada envío verás modelo, región, volumen y número máximo de solicitudes. No hay tarifa verificada en la app: se mostrará «costo no verificado». La app nunca cambia a este modo sola.
              </span>
            </label>
            {s && s.policy === 'free-only' && (
              <div className="flex flex-wrap items-end gap-2 pl-6">
                <Field label={`Escribe «${PHRASE}» para activar el consumo`}>
                  <input className={inputClass} value={phrase} onChange={(e) => setPhrase(e.target.value)} aria-label="Frase de confirmación" />
                </Field>
                <Button variant="danger" size="sm" disabled={phrase !== PHRASE || busy} onClick={() => run(() => bridge.setPolicy('allow-billing', phrase, maxSeg))}>Permitir consumo</Button>
              </div>
            )}
            <Field label="Máximo de solicitudes por operación (cadenas de tramos)">
              <input type="number" min={1} max={20} className={`${inputClass} w-24`} value={maxSeg} onChange={(e) => setMaxSeg(Number(e.target.value))} onBlur={() => s && run(() => bridge.setPolicy(s.policy, s.policy === 'allow-billing' ? PHRASE : undefined, maxSeg))} />
            </Field>
          </div>
          <details className="mt-3 text-xs text-ink-300">
            <summary className="cursor-pointer text-ink-200">Cómo activar la protección oficial «Free Quota Only» de Alibaba</summary>
            <ol className="ml-4 mt-2 list-decimal space-y-1">
              <li>Abre la consola de Model Studio en Singapur: Model usage › pestaña «Free Quota».</li>
              <li>Activa «Free Quota Only» para cada modelo que vayas a usar. Viene desactivada.</li>
              <li>El cambio puede tardar unos 30 minutos en aplicarse.</li>
              <li>Con la protección activa, al agotarse la cuota el servicio responde <code>AllocationQuota.FreeTierOnly</code> y no cobra. La app muestra ese error.</li>
              <li>Atención: desde octubre y noviembre de 2026 Alibaba retiró la cuota gratuita para cuentas nuevas en la mayoría de modelos Wan 2.5–2.7 y Qwen. Comprueba en la consola si tu cuenta tiene cuota.</li>
            </ol>
          </details>
        </section>
        {err && <Notice kind="error">{err}</Notice>}
      </div>
    </Modal>
  );
}
