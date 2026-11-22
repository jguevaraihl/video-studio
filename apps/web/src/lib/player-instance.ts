/** Instancia única del reproductor del visor. */
import { Player } from '../engine/player.ts';
import { useStore, getProject } from '../state/store.ts';

let player: Player | null = null;

export function getPlayer(): Player {
  player ??= new Player({
    getProject,
    onTime: (t) => useStore.getState().setPlayhead(t),
    onEnded: () => useStore.getState().setPlaying(false),
    getRange: () => {
      const { inOut, loop } = useStore.getState();
      return { from: inOut.in ?? 0, to: inOut.out, loop };
    },
  });
  return player;
}

export function togglePlay(): void {
  const st = useStore.getState();
  const p = getPlayer();
  if (p.isPlaying) {
    st.setPlayhead(p.pause());
    st.setPlaying(false);
  } else {
    st.setPlaying(true);
    void p.play(st.playhead).catch((e) => {
      st.setPlaying(false);
      st.toast(`No se pudo reproducir: ${e instanceof Error ? e.message : String(e)}`, 'error');
    });
  }
}

export function seek(t: number): void {
  const st = useStore.getState();
  const p = getPlayer();
  st.setPlayhead(t);
  if (p.isPlaying) void p.play(Math.max(0, t));
  else void p.paint(Math.max(0, t), true);
}
