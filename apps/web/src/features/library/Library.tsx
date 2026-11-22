/** Biblioteca de medios: importar, ver estado, reubicar faltantes y agregar al montaje. */
import { useEffect, useRef, useState } from 'react';
import { placeAsset, removeAsset, ticksToSeconds, updateAsset, type Asset } from '@vs/project';
import { useStore } from '../../state/store.ts';
import { importFiles, findMissingAssets } from '../../lib/media-service.ts';
import { putMedia, QuotaError } from '../../storage/media.ts';
import { probeFile } from '../../engine/probe.ts';
import { thumbnail } from '../../lib/thumbs.ts';
import { getPlayer } from '../../lib/player-instance.ts';
import { Button, Notice } from '../../ui/kit.tsx';
import { IUpload } from '../../ui/icons.tsx';

export function Library() {
  const project = useStore((s) => s.project)!;
  const volatile = useStore((s) => s.volatileAssets);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const st = useStore.getState();
  const assets = Object.values(project.assets).sort((a, b) => b.createdAt - a.createdAt);

  useEffect(() => {
    void findMissingAssets(project).then((m) => setMissing(new Set(m)));
  }, [project.assets]);

  const relink = async (asset: Asset, file: File) => {
    try {
      const meta = await probeFile(file, file.name);
      if (meta.kind !== asset.kind) throw new Error('El archivo elegido no es del mismo tipo.');
      if (Math.abs(meta.duration - asset.duration) > 705_600_000 * 0.5 && asset.kind !== 'image') {
        st.toast('Atención: la duración del archivo no coincide con la original. Revisa los cortes.', 'error');
      }
      await putMedia(asset.storageKey, file).catch((e) => {
        if (!(e instanceof QuotaError)) throw e;
        st.markVolatile(asset.id, e.message);
      });
      getPlayer().forgetAsset(asset.id);
      st.apply((p) => updateAsset(p, asset.id, { size: file.size, mime: meta.mime }));
      setMissing((m) => {
        const n = new Set(m);
        n.delete(asset.id);
        return n;
      });
      st.toast(`«${asset.name}» reubicado.`, 'success');
    } catch (e) {
      st.toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  return (
    <div
      className={`flex min-h-full flex-col gap-3 p-3 ${dragOver ? 'bg-brand-500/10' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void importFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <Button variant="primary" onClick={() => input.current?.click()} data-testid="import-btn"><IUpload /> Importar archivos</Button>
      <input ref={input} type="file" multiple accept="video/*,audio/*,image/*" className="hidden" aria-label="Importar archivos" data-testid="import-input" onChange={(e) => { void importFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <p className="text-xs text-ink-500">Arrastra archivos aquí. Importar no sube nada a Internet.</p>
      {assets.length === 0 && <Notice>La biblioteca está vacía.</Notice>}
      <ul className="grid grid-cols-2 gap-2">
        {assets.map((a) => (
          <li key={a.id} className="group overflow-hidden rounded-lg border border-ink-800 bg-ink-850">
            <AssetThumb asset={a} missing={missing.has(a.id)} />
            <div className="p-1.5">
              <div className="truncate text-xs font-medium" title={a.name}>{a.name}</div>
              <div className="text-[10px] text-ink-500">
                {a.kind === 'image' ? `${a.width}×${a.height}` : `${ticksToSeconds(a.duration).toFixed(1)} s`}
                {a.kind === 'video' && ` · ${a.width}×${a.height}`}
                {a.hasAudio ? ' · audio' : a.kind === 'video' ? ' · sin audio' : ''}
                {a.variableFps ? ' · FPS variable' : ''}
                {a.origin.type === 'generated' ? ' · IA' : ''}
              </div>
              {volatile[a.id] && <div className="mt-1 text-[10px] text-amber-300" title={volatile[a.id]}>Solo en memoria (sin espacio)</div>}
              {missing.has(a.id) ? (
                <label className="mt-1 block cursor-pointer rounded bg-rose-700 px-2 py-1 text-center text-[11px] text-white">
                  Reubicar archivo
                  <input type="file" className="hidden" accept="video/*,audio/*,image/*" onChange={(e) => e.target.files?.[0] && relink(a, e.target.files[0])} />
                </label>
              ) : (
                <div className="mt-1 flex gap-1">
                  <Button
                    size="sm"
                    className="flex-1"
                    data-testid={`add-${a.name}`}
                    onClick={() => {
                      const { playhead } = useStore.getState();
                      st.apply((p) => placeAsset(p, a.id, playhead).project, 'Agregar');
                    }}
                  >
                    + Montaje
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Quitar ${a.name} de la biblioteca`} onClick={() => st.apply((p) => removeAsset(p, a.id), 'Quitar')}>✕</Button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AssetThumb({ asset, missing }: { asset: Asset; missing: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (missing) return;
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    let alive = true;
    const draw = (img: CanvasImageSource, w: number, h: number) => {
      const s = Math.min(c.width / w, c.height / h);
      ctx.drawImage(img, (c.width - w * s) / 2, (c.height - h * s) / 2, w * s, h * s);
    };
    if (asset.kind === 'video') void thumbnail(asset, Math.min(asset.duration / 3, 705_600_000)).then((b) => alive && b && draw(b, b.width, b.height));
    else if (asset.kind === 'image') void getPlayer().frames.image(asset).then((b) => alive && b && draw(b, b.width, b.height));
    else {
      ctx.fillStyle = '#064e3b';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#6ee7b7';
      ctx.font = 'bold 28px Inter';
      ctx.textAlign = 'center';
      ctx.fillText('♪', c.width / 2, c.height / 2 + 10);
    }
    return () => {
      alive = false;
    };
  }, [asset, missing]);
  return (
    <div className="relative aspect-video bg-black">
      {missing ? <div className="flex h-full items-center justify-center text-[11px] text-rose-300">Archivo faltante</div> : <canvas ref={ref} width={160} height={90} className="h-full w-full" aria-hidden />}
    </div>
  );
}
