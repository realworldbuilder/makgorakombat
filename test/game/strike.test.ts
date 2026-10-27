import type { CharacterScene, PackedRig } from '@mogshot/character/scene';
import { identity, translation } from '@mogshot/math/mat4';
import type { PosableRig } from '@mogshot/model/posable';
import { describe, expect, it } from 'vitest';
import { BODY } from '../../src/engine/stage';
import { measureTable } from '../../src/game/strike';
import { fakeTable } from '../engine/fake';

/** A blade one yard long along x, held at the right hand: two vertices, its grip and its tip. */
function blade(): Uint8Array {
  const bytes = new Uint8Array(96);
  const view = new DataView(bytes.buffer);
  view.setFloat32(48, 1, true);
  return bytes;
}

/**
 * A rig whose blade swings out and back once per clip: its grip `out(t)` yards ahead at 1.2 high,
 * furthest at half way, plus a fixed lean of `lean` yards at the clip's ends.
 */
function rigOf(peak: number, at: number, lean = 0): PosableRig {
  const out = (fraction: number) => peak * Math.max(0, 1 - Math.abs(fraction - at) * 3) + (fraction < 0.05 || fraction > 0.95 ? lean : 0);
  return {
    meshCount: 2,
    duration: () => 1000,
    pose: (_sequence, timeMs) => [
      { bones: new Float32Array(16), transform: identity() },
      { bones: new Float32Array(16), transform: translation(out(timeMs / 1000), 0, 1.2) },
    ],
    attachment: () => undefined,
  };
}

const packed = { meshes: [{ follows: 'body' }, { follows: 'attachment', attachment: 1, own: new Float32Array(16) }] } as unknown as PackedRig;
const scene = { meshes: [{ vertices: new Uint8Array(0) }, { vertices: blade() }] } as unknown as CharacterScene;

describe('measured strikes', () => {
  it('finds the blow where the weapon is furthest out: when, how far and how high', () => {
    const table = measureTable(fakeTable(), rigOf(1.5, 0.5), packed, scene, 1.8);
    for (const v of table.moves.swing.variations) {
      expect(v.strike?.contact).toBeCloseTo(0.5, 5);
      // The grip 1.5 ahead and the blade a yard beyond it.
      expect(v.strike?.reach).toBeCloseTo(2.5, 5);
      expect(v.strike?.height).toBeCloseTo(1.2, 5);
    }
    expect(table.weapon.range).toBeCloseTo(2.5 + BODY / 2, 5);
    expect(table.stature).toBe(1.8);
    // The melee abilities are measured too; the rest of the moves are not.
    const mortal = table.kit.abilities.find((a) => a.id === 'mortalStrike')!;
    expect(mortal.move.variations[0]!.strike?.contact).toBeCloseTo(0.5, 5);
    expect(table.moves.idle.variations[0]!.strike).toBeUndefined();
  });

  it('looks past a stance that leans out at the clip ends', () => {
    const table = measureTable(fakeTable(), rigOf(1.2, 0.4, 5), packed, scene, 2);
    expect(table.moves.swing.variations[0]!.strike?.contact).toBeCloseTo(0.4, 1);
  });

  it('holds a reach to what can be fought at', () => {
    expect(measureTable(fakeTable(), rigOf(9, 0.5), packed, scene, 2).moves.swing.variations[0]!.strike?.reach).toBe(3.8);
    expect(measureTable(fakeTable(), rigOf(-0.5, 0.5), packed, scene, 2).moves.swing.variations[0]!.strike?.reach).toBe(1.0);
  });

  it('leaves a bow alone: its shot leaves when it leaves', () => {
    const table = measureTable(fakeTable(undefined, 'bow'), rigOf(1.5, 0.5), packed, scene, 2);
    expect(table.moves.swing.variations[0]!.strike).toBeUndefined();
    expect(table.weapon.range).toBe(fakeTable(undefined, 'bow').weapon.range);
  });
});
