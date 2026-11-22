import { describe, expect, it } from 'vitest';
import {
  TICKS_PER_SECOND,
  frameToTicks,
  ticksToFrame,
  ticksToSample,
  sampleToTicks,
  frameCount,
  secondsToTicks,
  microsToTicks,
  rationalFromFps,
  formatTimecode,
} from '@vs/project';

describe('base de tiempo', () => {
  it('divide exactamente fps y frecuencias comunes', () => {
    for (const fps of [24, 25, 30, 48, 50, 60, 120]) expect(TICKS_PER_SECOND % fps).toBe(0);
    for (const sr of [8000, 16000, 22050, 44100, 48000]) expect(TICKS_PER_SECOND % sr).toBe(0);
    expect((TICKS_PER_SECOND * 1001) % 30000).toBe(0);
  });

  it('convierte fotograma <-> ticks sin deriva en una hora a 29.97', () => {
    const fps = { num: 30000, den: 1001 };
    const n = 107_892; // ~1 h
    expect(ticksToFrame(frameToTicks(n, fps), fps)).toBe(n);
    expect(ticksToFrame(frameToTicks(n, fps) - 1, fps)).toBe(n - 1);
  });

  it('convierte muestra <-> ticks', () => {
    expect(ticksToSample(secondsToTicks(1), 48000)).toBe(48000);
    expect(sampleToTicks(48000, 48000)).toBe(TICKS_PER_SECOND);
    expect(ticksToSample(sampleToTicks(12345, 44100), 44100)).toBe(12345);
  });

  it('cuenta fotogramas de una duración', () => {
    expect(frameCount(secondsToTicks(2), { num: 30, den: 1 })).toBe(60);
    expect(frameCount(secondsToTicks(2) + 1, { num: 30, den: 1 })).toBe(61);
  });

  it('convierte microsegundos de WebCodecs', () => {
    expect(microsToTicks(33_333)).toBe(Math.round(33_333 * 705.6));
  });

  it('reconoce fps NTSC y formatea código de tiempo', () => {
    expect(rationalFromFps(29.97)).toEqual({ num: 30000, den: 1001 });
    expect(formatTimecode(secondsToTicks(61.5), { num: 30, den: 1 })).toBe('01:01.15');
  });
});
