import { useStore, type LeftTab } from '../../state/store.ts';
import { Library } from './Library.tsx';
import { TextPanel } from './TextPanel.tsx';
import { SubtitlesPanel } from '../subtitles/SubtitlesPanel.tsx';
import { GeneratePanel } from '../generate/GeneratePanel.tsx';
import { AssistantPanel } from '../assistant/AssistantPanel.tsx';
import { ICaption, IChat, IFilm, ISpark, IText } from '../../ui/icons.tsx';

const TABS: { id: LeftTab; label: string; icon: React.ReactNode }[] = [
  { id: 'media', label: 'Medios', icon: <IFilm /> },
  { id: 'generate', label: 'Generar', icon: <ISpark /> },
  { id: 'text', label: 'Texto', icon: <IText /> },
  { id: 'subtitles', label: 'Subtítulos', icon: <ICaption /> },
  { id: 'assistant', label: 'Asistente', icon: <IChat /> },
];

export function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const set = useStore((s) => s.setLeftTab);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Paneles" className="flex shrink-0 border-b border-ink-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => set(t.id)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${tab === t.id ? 'border-b-2 border-brand-400 text-white' : 'text-ink-400 hover:text-ink-200'}`}
            data-testid={`tab-${t.id}`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'media' && <Library />}
        {tab === 'generate' && <GeneratePanel />}
        {tab === 'text' && <TextPanel />}
        {tab === 'subtitles' && <SubtitlesPanel />}
        {tab === 'assistant' && <AssistantPanel />}
      </div>
    </div>
  );
}
