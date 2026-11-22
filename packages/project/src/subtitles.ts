/** Importación y exportación de subtítulos SRT y WebVTT. */
import { secondsToTicks, ticksToSeconds, type Ticks } from './time.ts';

export interface PlainCue {
  start: Ticks;
  end: Ticks;
  text: string;
}

function parseTimestamp(raw: string): number {
  const m = raw.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) throw new Error(`Marca de tiempo no válida: «${raw}»`);
  const h = Number(m[1] ?? 0);
  const min = Number(m[2]);
  const s = Number(m[3]);
  const ms = Number(m[4]!.padEnd(3, '0'));
  return h * 3600 + min * 60 + s + ms / 1000;
}

function formatTimestamp(ticks: Ticks, sep: ',' | '.'): string {
  const totalMs = Math.round(ticksToSeconds(ticks) * 1000);
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms).padStart(3, '0')}`;
}

function parseBlocks(text: string, isVtt: boolean): PlainCue[] {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  const cues: PlainCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.length > 0);
    if (!lines.length) continue;
    if (isVtt && /^(WEBVTT|NOTE|STYLE|REGION)/.test(lines[0]!)) continue;
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx === -1) continue;
    const [a, b] = lines[timingIdx]!.split('-->');
    const endRaw = (b ?? '').trim().split(/\s+/)[0] ?? '';
    const start = parseTimestamp(a ?? '');
    const end = parseTimestamp(endRaw);
    const body = lines.slice(timingIdx + 1).join('\n').replace(/<[^>]+>/g, '');
    if (end > start) cues.push({ start: secondsToTicks(start), end: secondsToTicks(end), text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

export function parseSrt(text: string): PlainCue[] {
  return parseBlocks(text, false);
}

export function parseVtt(text: string): PlainCue[] {
  if (!/^﻿?WEBVTT/.test(text)) throw new Error('El archivo no empieza con «WEBVTT».');
  return parseBlocks(text, true);
}

export function parseSubtitles(name: string, text: string): PlainCue[] {
  return /\.vtt$/i.test(name) || /^﻿?WEBVTT/.test(text) ? parseVtt(text) : parseSrt(text);
}

export function toSrt(cues: PlainCue[]): string {
  return (
    cues
      .map((c, i) => `${i + 1}\n${formatTimestamp(c.start, ',')} --> ${formatTimestamp(c.end, ',')}\n${c.text}`)
      .join('\n\n') + '\n'
  );
}

export function toVtt(cues: PlainCue[]): string {
  return (
    'WEBVTT\n\n' +
    cues.map((c) => `${formatTimestamp(c.start, '.')} --> ${formatTimestamp(c.end, '.')}\n${c.text}`).join('\n\n') +
    '\n'
  );
}
