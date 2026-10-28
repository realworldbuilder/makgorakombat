import { describe, expect, it } from 'vitest';
import type { Placement } from '../../src/game/arena';
import { between, easeFor, SNAP } from '../../src/game/smooth';

const at = (x: number, time: number, sequence = 1, z = 0): Placement => ({ sequence, time, x, z, facing: 1, fade: 50 });

describe('drawing between steps', () => {
  it('is the step before at 0, the last step at 1, and in between part of the way', () => {
    expect(between(at(0, 100), at(0.1, 116), 0)).toMatchObject({ x: 0, time: 100 });
    expect(between(at(0, 100), at(0.1, 116), 1)).toMatchObject({ x: 0.1, time: 116 });
    const half = between(at(0, 100, 1, 0.2), at(0.1, 116, 1, 0.4), 0.5);
    expect(half.x).toBeCloseTo(0.05);
    expect(half.z).toBeCloseTo(0.3);
    expect(half.time).toBeCloseTo(108);
  });

  it('keeps everything else from the last step: the clip, the facing, the fade', () => {
    const drawn = between(at(0, 100), { ...at(0.1, 116), facing: -1, fade: 110 }, 0.5);
    expect(drawn).toMatchObject({ sequence: 1, facing: -1, fade: 110 });
  });

  it('draws a new clip, or one gone back to its start, at the last step’s time', () => {
    expect(between(at(0, 900, 1), at(0, 16, 2), 0.5).time).toBe(16);
    // A loop that came round: not the middle of it.
    expect(between(at(0, 990, 1), at(0, 6, 1), 0.5).time).toBe(6);
  });

  it('does not slide a fighter across a jump: a blink, a new round', () => {
    expect(between(at(-3, 0), at(-3 + SNAP * 2, 0), 0.5).x).toBe(-3 + SNAP * 2);
    expect(between(at(0, 0, 1, 0), at(0, 0, 1, SNAP * 2), 0.5).z).toBe(SNAP * 2);
    // A dash, fast as it is, is not one.
    expect(between(at(0, 0), at(0.28, 16), 0.5).x).toBeCloseTo(0.14);
  });

  it('holds the fraction to the steps it lies between', () => {
    expect(between(at(0, 0), at(1, 16), 2).x).toBe(1);
    expect(between(at(0, 0), at(1, 16), -1).x).toBe(0);
  });
});

describe('easing by the clock', () => {
  it('eases as far in one step’s time as it is written to, whatever the screen’s rate', () => {
    expect(easeFor(0.12, 1000 / 60, 1000 / 60)).toBeCloseTo(0.12);
    // Two frames at 120 Hz come to one at 60.
    const half = easeFor(0.12, 1000 / 120, 1000 / 60);
    expect(1 - (1 - half) ** 2).toBeCloseTo(0.12);
    expect(easeFor(0.12, 0, 1000 / 60)).toBe(0);
    expect(easeFor(1, 1000 / 144, 1000 / 60)).toBe(1);
  });
});
