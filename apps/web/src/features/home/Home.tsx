/** Pantalla inicial: tres acciones principales, abrir proyecto y material de ejemplo. */
import { useEffect, useRef, useState } from 'react';
import { addAsset, createProject, placeAsset, ASPECT_PRESETS, type AspectPreset } from '@vs/project';
import { useStore } from '../../state/store.ts';
import { deleteProject, lastProjectId, listProjects, loadProject, type ProjectSummary } from '../../storage/projects.ts';
import { importPortable } from '../../storage/portable.ts';
import { buildSampleProject } from '../../lib/sample.ts';
import { importFile } from '../../lib/media-service.ts';
import { Button } from '../../ui/kit.tsx';
import { IFilm, IFolder, IImage, ISpark, IUpload } from '../../ui/icons.tsx';

export function Home() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [aspect, setAspect] = useState<AspectPreset>('16:9');
  const [recoverId, setRecoverId] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const openRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const st = useStore();

  useEffect(() => {
    void listProjects().then(setProjects);
    void lastProjectId().then((id) => id && setRecoverId(id));
  }, []);

  const newProject = (name?: string) => {
    const { width, height } = ASPECT_PRESETS[aspect];
    return createProject({ name, width, height });
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      st.toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const open = (id: string) =>
    run('Abriendo proyecto…', async () => {
      const p = await loadProject(id);
      if (!p) throw new Error('No se encontró el proyecto.');
      st.openProject(p);
    });

  const onImport = (files: FileList | null) =>
    files?.length &&
    run('Importando…', async () => {
      let p = newProject('Proyecto importado');
      let at = 0;
      for (const f of Array.from(files)) {
        try {
          const a = await importFile(f, f.name);
          p = addAsset(p, a);
          const r = placeAsset(p, a.id, at);
          p = r.project;
          at = Math.max(...Object.values(p.clips).map((c) => c.start + (c.kind === 'media' ? Math.round((c.sourceOut - c.sourceIn) / (c.speed.mode === 'constant' ? c.speed.rate : 1)) : c.duration)));
        } catch (e) {
          st.toast(e instanceof Error ? e.message : String(e), 'error');
        }
      }
      st.openProject(p);
    });

  const onOpenFile = (files: FileList | null) =>
    files?.[0] &&
    run('Restaurando copia portátil…', async () => {
      const { project, warnings } = await importPortable(files[0]!);
      warnings.forEach((w) => st.toast(w, 'error'));
      st.openProject(project);
    });

  const onImage = (files: FileList | null) =>
    files?.[0] &&
    run('Preparando imagen…', async () => {
      let p = newProject('Animación de imagen');
      const a = await importFile(files[0]!, files[0]!.name);
      p = addAsset(p, a);
      st.openProject(p);
      st.setLeftTab('generate');
      sessionStorage.setItem('vs:i2v-asset', a.id);
    });

  return (
    <main className="min-h-full bg-[radial-gradient(ellipse_at_top,_#1b1440_0%,_#0b0d12_55%)]">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-5 py-10 sm:py-16">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="" className="h-10 w-10" />
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Estudio de Video</h1>
          </div>
          <p className="max-w-2xl text-ink-300">
            Edita en tu navegador sin cuenta ni pagos. Tus archivos no salen del equipo salvo que uses la generación con IA, y siempre verás antes qué se enviará.
          </p>
        </header>

        {recoverId && projects.some((p) => p.id === recoverId) && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-500/40 bg-brand-500/10 px-4 py-3 text-sm">
            <span>Tu última sesión quedó guardada: «{projects.find((p) => p.id === recoverId)?.name}».</span>
            <Button variant="primary" size="sm" onClick={() => open(recoverId)}>Recuperar sesión</Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-300">
          <span>Formato del proyecto:</span>
          {(Object.keys(ASPECT_PRESETS) as AspectPreset[]).map((k) => (
            <button
              key={k}
              aria-pressed={aspect === k}
              onClick={() => setAspect(k)}
              className={`rounded-full border px-3 py-1 ${aspect === k ? 'border-brand-400 bg-brand-500/20 text-white' : 'border-ink-700 hover:border-ink-500'}`}
            >
              {k} {k === '16:9' ? 'horizontal' : k === '9:16' ? 'vertical' : 'cuadrado'}
            </button>
          ))}
        </div>

        <section className="grid gap-4 sm:grid-cols-3" aria-label="Acciones principales">
          <BigAction
            icon={<ISpark />}
            title="Generar desde texto"
            text="Describe una escena y genera planos con IA (requiere tu clave de Alibaba)."
            onClick={() => {
              st.openProject(newProject('Generación desde texto'));
              st.setLeftTab('generate');
            }}
          />
          <BigAction icon={<IImage />} title="Animar una imagen" text="Carga una imagen inicial y conviértela en video." onClick={() => imageRef.current?.click()} />
          <BigAction icon={<IUpload />} title="Importar para editar" text="Abre tus videos, audios e imágenes. Todo se edita en local." onClick={() => importRef.current?.click()} />
        </section>

        <div className="flex flex-wrap gap-3">
          <Button size="lg" onClick={() => openRef.current?.click()}><IFolder /> Abrir proyecto (.zip)</Button>
          <Button
            size="lg"
            variant="primary"
            data-testid="sample"
            onClick={() =>
              run('Preparando el ejemplo…', async () => {
                st.openProject(await buildSampleProject());
              })
            }
          >
            <IFilm /> Probar con material de ejemplo
          </Button>
          <Button size="lg" variant="ghost" onClick={() => st.openProject(newProject())}>Proyecto vacío</Button>
        </div>

        <input ref={importRef} type="file" multiple accept="video/*,audio/*,image/*" className="hidden" aria-label="Importar archivos" onChange={(e) => onImport(e.target.files)} />
        <input ref={openRef} type="file" accept=".zip,application/zip" className="hidden" aria-label="Abrir copia portátil" onChange={(e) => onOpenFile(e.target.files)} />
        <input ref={imageRef} type="file" accept="image/*" className="hidden" aria-label="Imagen inicial" onChange={(e) => onImage(e.target.files)} />

        {busy && <p role="status" className="text-sm text-accent-400">{busy}</p>}

        <section aria-label="Proyectos recientes">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-400">Proyectos guardados en este navegador</h2>
          {projects.length === 0 ? (
            <p className="text-sm text-ink-500">Todavía no hay proyectos.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between rounded-lg border border-ink-800 bg-ink-900/60 px-3 py-2">
                  <button className="flex-1 text-left" onClick={() => open(p.id)}>
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-ink-500">{new Date(p.updatedAt).toLocaleString('es')}</div>
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Borrar ${p.name}`}
                    onClick={async () => {
                      if (!confirm(`¿Borrar «${p.name}» de este navegador? Los archivos importados se conservan.`)) return;
                      await deleteProject(p.id);
                      setProjects(await listProjects());
                    }}
                  >
                    Borrar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function BigAction({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-start gap-3 rounded-2xl border border-ink-700 bg-ink-900/70 p-5 text-left transition hover:-translate-y-0.5 hover:border-brand-500/60 hover:bg-ink-850"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/30 to-accent-500/30 text-white">{icon}</span>
      <span className="text-lg font-semibold">{title}</span>
      <span className="text-sm text-ink-400">{text}</span>
    </button>
  );
}
