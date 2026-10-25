import { describe, expect, it } from 'vitest';
import type { FightSoundSet } from '@mogshot/worker/api';
import { decodedSet, KEEP_VOICES } from '../../src/game/sound';

/** A fighter's sounds: one kit of two clips. */
const soundSet = (): FightSoundSet =>
  ({
    kits: { 1: { kit: 1, pitchVariation: [1, 1], clips: [{ fileId: 10, bytes: new Uint8Array(8), volume: 1, weight: 1 }, { fileId: 11, bytes: new Uint8Array(8), volume: 1, weight: 1 }] } },
    sounds: {},
    problems: [],
  }) as unknown as FightSoundSet;

/** An audio context that counts what it decodes. */
function counting() {
  const ctx = { decoded: 0, decodeAudioData: async () => (ctx.decoded++, {} as AudioBuffer) };
  return ctx;
}

describe('the decoded sounds kept', () => {
  it('decodes a fighter once while it is kept, and shares it between the sides', async () => {
    const ctx = counting();
    const set = soundSet();
    const first = await decodedSet(ctx, set);
    expect(ctx.decoded).toBe(2);
    expect(first.get(1)?.clips).toHaveLength(2);
    // The same fighter in the next fight, and on both sides of a mirror match: the same buffers.
    expect(await decodedSet(ctx, set)).toBe(first);
    expect(await Promise.all([decodedSet(ctx, set), decodedSet(ctx, set)])).toEqual([first, first]);
    expect(ctx.decoded).toBe(2);
  });

  it('keeps the last few heard and decodes an older one again', async () => {
    const ctx = counting();
    const sets = Array.from({ length: KEEP_VOICES + 1 }, soundSet);
    for (const set of sets.slice(0, KEEP_VOICES)) await decodedSet(ctx, set);
    expect(ctx.decoded).toBe(2 * KEEP_VOICES);
    // The first is heard again, so the second is the oldest when one more comes.
    await decodedSet(ctx, sets[0]!);
    await decodedSet(ctx, sets[KEEP_VOICES]!);
    expect(ctx.decoded).toBe(2 * (KEEP_VOICES + 1));
    await decodedSet(ctx, sets[0]!);
    expect(ctx.decoded).toBe(2 * (KEEP_VOICES + 1));
    await decodedSet(ctx, sets[1]!);
    expect(ctx.decoded).toBe(2 * (KEEP_VOICES + 2));
  });

  it('leaves out a clip that does not decode and keeps the rest', async () => {
    let calls = 0;
    const ctx = { decodeAudioData: async () => (calls++ === 0 ? Promise.reject(new Error('bad')) : ({} as AudioBuffer)) };
    const warn = console.warn;
    console.warn = () => {};
    try {
      const decoded = await decodedSet(ctx, soundSet());
      expect(decoded.get(1)?.clips).toHaveLength(1);
    } finally {
      console.warn = warn;
    }
  });
});
