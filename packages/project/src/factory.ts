import {
  SCHEMA_VERSION,
  defaultAudio,
  defaultColor,
  defaultTextStyle,
  defaultTransform,
  type Asset,
  type ImageClip,
  type MediaClip,
  type Project,
  type TextClip,
  type Track,
  type TrackKind,
} from './schema.ts';
import { secondsToTicks, type Rational, type Ticks } from './time.ts';

let counter = 0;
export function newId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

export const ASPECT_PRESETS = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 1080, height: 1080 },
} as const;
export type AspectPreset = keyof typeof ASPECT_PRESETS;

export function createTrack(kind: TrackKind, name: string): Track {
  return { id: newId('trk'), kind, name, muted: false, solo: false, locked: false, hidden: false, gainDb: 0 };
}

export function createProject(opts: {
  name?: string;
  width?: number;
  height?: number;
  fps?: Rational;
} = {}): Project {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('prj'),
    name: opts.name ?? 'Proyecto sin título',
    createdAt: now,
    updatedAt: now,
    settings: {
      width: opts.width ?? 1280,
      height: opts.height ?? 720,
      fps: opts.fps ?? { num: 30, den: 1 },
      sampleRate: 48000,
      background: '#000000',
    },
    assets: {},
    tracks: [
      createTrack('video', 'Video 1'),
      createTrack('video', 'Video 2'),
      createTrack('text', 'Texto 1'),
      createTrack('audio', 'Audio 1'),
      createTrack('audio', 'Audio 2'),
    ],
    clips: {},
    transitions: {},
    subtitles: {
      cues: [],
      style: { fontFamily: 'Inter', fontSize: 0.05, color: '#ffffff', background: 'rgba(0,0,0,0.55)', bottom: 0.08 },
      burnIn: false,
      visibleInViewer: true,
    },
    generations: {},
    masterGainDb: 0,
  };
}

export function createMediaClip(asset: Asset, trackId: string, start: Ticks, opts: Partial<MediaClip> = {}): MediaClip {
  return {
    id: newId('clp'),
    trackId,
    start,
    name: asset.name,
    linkGroupId: null,
    kind: 'media',
    assetId: asset.id,
    sourceIn: 0,
    sourceOut: asset.duration,
    speed: { mode: 'constant', rate: 1, preservePitch: true },
    frameBlend: false,
    transform: defaultTransform(),
    keyframes: {},
    color: defaultColor(),
    fadeIn: 0,
    fadeOut: 0,
    audio: defaultAudio(),
    ...opts,
  };
}

export function createImageClip(asset: Asset, trackId: string, start: Ticks, duration = secondsToTicks(4)): ImageClip {
  return {
    id: newId('clp'),
    trackId,
    start,
    name: asset.name,
    linkGroupId: null,
    kind: 'image',
    assetId: asset.id,
    duration,
    transform: defaultTransform(),
    keyframes: {},
    color: defaultColor(),
    fadeIn: 0,
    fadeOut: 0,
  };
}

export function createTextClip(text: string, trackId: string, start: Ticks, duration = secondsToTicks(3)): TextClip {
  return {
    id: newId('clp'),
    trackId,
    start,
    name: text.slice(0, 24),
    linkGroupId: null,
    kind: 'text',
    text,
    duration,
    style: defaultTextStyle(),
    transform: { ...defaultTransform(), y: 0 },
    keyframes: {},
    color: defaultColor(),
    fadeIn: 0,
    fadeOut: 0,
  };
}
