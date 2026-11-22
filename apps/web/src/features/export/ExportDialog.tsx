/** Exportación: detecta rutas reales, estima recursos, muestra la fase real y permite cancelar. */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store.ts';
import { Button, Modal, Notice } from '../../ui/kit.tsx';
import { detectRoute, outputSize, type ExportFormat, type ExportRoute, type Resolution } from '../../engine/export/capabilities.ts';
import { estimateExport, exportProject, type ExportEstimate, type ExportProgress, type ExportResult } from '../../engine/export/exporter.ts';
import { ffmpegMode } from '../../engine/export/ffmpeg.ts';
import { blobForAssetId } from '../../lib/media-service.ts';
import { downloadBlob } from '../../lib/download.ts';
import { fpsValue } from '@vs/project';

declare global {
  interface Window {
    __vsLastExport?: { blob: Blob; result: Omit<ExportResult, 'blob'> };
  }
}

export function ExportDialog() {
  const project = useStore((s) => s.project)!;
  const st = useStore.getState();
  const [format, setFormat] = useState<ExportFormat>('mp4');
  const [res, setRes] = useState<Resolution>('720p');
  const [burn, setBurn] = useState(project.subtitles.burnIn);
  const [forceFfmpeg, setForceFfmpeg] = useState(false);
  const [routes, setRoutes] = useState<Partial<Record<ExportFormat, ExportRoute>>>({});
  const [estimate, setEstimate] = useState<ExportEstimate | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    const { width, height } = outputSize(project.settings.width, project.settings.height, res);
    setRoutes({});
    for (const f of ['mp4', 'webm'] as const) {
      void detectRoute(f, width, height, fpsValue(project.settings.fps), { forceFfmpeg }).then((r) => alive && setRoutes((prev) => ({ ...prev, [f]: r })));
    }
    void estimateExport(project, { format, resolution: res, burnSubtitles: burn }).then((e) => alive && setEstimate(e));
    return () => {
      alive = false;
    };
  }, [project, res, format, burn, forceFfmpeg]);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const route = routes[format];
  const other: ExportFormat = format === 'mp4' ? 'webm' : 'mp4';
  const running = !!progress && !result && !error;

  const start = async () => {
    setError(null);
    setResult(null);
    if (url) URL.revokeObjectURL(url);
    setUrl(null);
    const ac = new AbortController();
    abortRef.current = ac;
    setProgress({ phase: 'Preparando', fraction: null });
    try {
      const r = await exportProject(project, { format, resolution: res, burnSubtitles: burn, forceFfmpeg }, blobForAssetId, setProgress, ac.signal);
      setResult(r);
      setUrl(URL.createObjectURL(r.blob));
      const { blob, ...meta } = r;
      window.__vsLastExport = { blob, result: meta };
    } catch (e) {
      if ((e as Error).name === 'AbortError' || /cancelada/i.test(String((e as Error).message))) setError('Exportación cancelada. Puedes volver a exportar cuando quieras.');
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setProgress((p) => (p ? { ...p } : p));
    }
  };

  return (
    <Modal title="Exportar video" onClose={() => { abortRef.current?.abort(); st.setExportOpen(false); }} wide>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-4">
          <fieldset>
            <legend className="mb-1.5 text-xs text-ink-400">Formato</legend>
            <div className="flex gap-2">
              {(['mp4', 'webm'] as const).map((f) => (
                <Button key={f} variant={format === f ? 'primary' : 'subtle'} aria-pressed={format === f} onClick={() => setFormat(f)} disabled={running} data-testid={`fmt-${f}`}>
                  {f === 'mp4' ? 'MP4 (H.264 + AAC)' : 'WebM (VP9/VP8 + Opus)'}
                </Button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-xs text-ink-400">Resolución</legend>
            <div className="flex gap-2">
              {(['720p', '1080p'] as const).map((r) => {
                const { width, height } = outputSize(project.settings.width, project.settings.height, r);
                return (
                  <Button key={r} variant={res === r ? 'primary' : 'subtle'} aria-pressed={res === r} onClick={() => setRes(r)} disabled={running}>
                    {r} <span className="text-[10px] opacity-70">{width}×{height}</span>
                  </Button>
                );
              })}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={burn} onChange={(e) => setBurn(e.target.checked)} disabled={running} />
            Quemar subtítulos en la imagen
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-400">
            <input type="checkbox" checked={forceFfmpeg} onChange={(e) => setForceFfmpeg(e.target.checked)} disabled={running} data-testid="force-ffmpeg" />
            Forzar FFmpeg.wasm (ruta alternativa; más lenta)
          </label>
          <div className="rounded-lg border border-ink-800 p-3 text-xs">
            <div className="mb-1 font-semibold text-ink-200">Ruta detectada en este navegador</div>
            {route ? (
              route.ok ? <p className="text-emerald-300" data-testid="route-summary">{route.summary}</p> : (
                <div className="flex flex-col gap-2">
                  <p className="text-rose-300">{route.summary}</p>
                  {routes[other]?.ok && <Button size="sm" onClick={() => setFormat(other)}>Usar {other.toUpperCase()}, que sí está disponible</Button>}
                </div>
              )
            ) : (
              <p className="text-ink-400">Comprobando codificadores…</p>
            )}
            <p className="mt-2 text-ink-500">Aislamiento entre orígenes: {ffmpegMode() === 'multi' ? 'activo' : 'inactivo'}. FFmpeg.wasm usa el núcleo de un hilo, el más estable.</p>
          </div>
          {estimate && (
            <div className="text-xs text-ink-400">
              Duración {estimate.seconds.toFixed(2)} s · {estimate.frames} fotogramas · tamaño estimado {(estimate.estimatedBytes / 1e6).toFixed(1)} MB
              {estimate.warnings.map((w) => <div key={w} className="mt-2"><Notice kind="warn">{w}</Notice></div>)}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3">
          {!running && !result && (
            <Button size="lg" variant="primary" onClick={start} disabled={!route?.ok || (estimate?.seconds ?? 0) <= 0} data-testid="start-export">Exportar {format.toUpperCase()}</Button>
          )}
          {running && progress && (
            <div className="flex flex-col gap-2" role="status" aria-live="polite">
              <div className="text-sm font-medium" data-testid="export-phase">{progress.phase}</div>
              {progress.fraction !== null ? (
                <>
                  <div className="h-2 overflow-hidden rounded bg-ink-800"><div className="h-full bg-gradient-to-r from-brand-500 to-accent-500 transition-all" style={{ width: `${Math.round(progress.fraction * 100)}%` }} /></div>
                  <div className="text-xs text-ink-400">{Math.round(progress.fraction * 100)}%</div>
                </>
              ) : (
                <div className="text-xs text-ink-400">Esta fase no informa avance medible.</div>
              )}
              <Button variant="danger" onClick={() => abortRef.current?.abort()} data-testid="cancel-export">Cancelar</Button>
            </div>
          )}
          {error && <Notice kind="error">{error}</Notice>}
          {result && url && (
            <div className="flex flex-col gap-2" data-testid="export-done">
              <Notice kind="ok">
                Listo en {(result.elapsedMs / 1000).toFixed(1)} s · {result.width}×{result.height} · {(result.blob.size / 1e6).toFixed(2)} MB · {result.frames} fotogramas. {result.route.summary} Render: {result.renderMode === 'webgl2' ? 'WebGL2' : 'CPU'}.
              </Notice>
              <video src={url} controls className="w-full rounded-lg bg-black" data-testid="export-preview" />
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => downloadBlob(result.blob, result.fileName)} data-testid="download-export">Descargar {result.fileName}</Button>
                <Button onClick={() => { setResult(null); setProgress(null); }}>Exportar otra vez</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
