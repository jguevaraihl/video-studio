import { createProject, addAsset, type Asset, type Project, secondsToTicks, newId } from '@vs/project';

export function fakeAsset(opts: Partial<Asset> & { seconds?: number } = {}): Asset {
  const seconds = opts.seconds ?? 10;
  return {
    id: newId('ast'),
    kind: 'video',
    name: 'clip.webm',
    mime: 'video/webm',
    size: 1000,
    storageKey: newId('blob'),
    proxyKey: null,
    duration: secondsToTicks(seconds),
    firstTimestamp: 0,
    width: 1280,
    height: 720,
    rotation: 0,
    fps: 30,
    variableFps: false,
    hasVideo: true,
    hasAudio: true,
    videoCodec: 'vp8',
    audioCodec: 'opus',
    sampleRate: 48000,
    channels: 2,
    origin: { type: 'import', generationId: null },
    createdAt: 0,
    ...opts,
  };
}

export function projectWith(...assets: Asset[]): Project {
  let p = createProject();
  for (const a of assets) p = addAsset(p, a);
  return p;
}

export const s = secondsToTicks;
