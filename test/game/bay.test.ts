import { describe, expect, it } from 'vitest';
import type { SceneMesh } from '@mogshot/character/scene';
import type { M2Bone } from '@mogshot/formats/m2';
import { Bounce, enlarge, findChest, findHips } from '../../src/game/bay';
import { BAY_CODE, typedToward } from '../../src/game/Online';

/** A bone with a role, a parent and a pivot; the tracks are not read. */
const bone = (keyBoneId: number, parent: number, pivot: [number, number, number]) => ({ keyBoneId, parent, pivot, flags: 0, nameHash: 0 }) as unknown as M2Bone;

// Root, spine, chest; the shoulders and the neck hang from the chest, the head from the neck. Human height, +x forward.
const BONES = [bone(-1, -1, [0, 0, 0]), bone(-1, 0, [0, 0, 1.1]), bone(-1, 1, [0, 0, 1.4]), bone(2, 2, [0, 0.17, 1.58]), bone(3, 2, [0, -0.17, 1.58]), bone(-1, 2, [0, 0, 1.6]), bone(6, 5, [0, 0, 1.7])];

/** A mesh of the given points, each carried wholly by one bone, all drawn. */
function meshOf(points: [number, number, number, number][]): SceneMesh {
  const vertices = new Uint8Array(points.length * 48);
  const view = new DataView(vertices.buffer);
  points.forEach(([x, y, z, by], i) => {
    const at = i * 48;
    view.setFloat32(at, x, true);
    view.setFloat32(at + 4, y, true);
    view.setFloat32(at + 8, z, true);
    view.setUint8(at + 12, 255);
    view.setUint8(at + 16, by);
    view.setFloat32(at + 20, 1, true);
  });
  const indices = new Uint16Array(points.map((_, i) => i));
  return { vertices, indices, bones: new Float32Array(), transform: new Float32Array(), billboards: [], draws: [{ indexStart: 0, indexCount: points.length } as SceneMesh['draws'][number]] };
}

const at = (vertices: Uint8Array, i: number) => {
  const view = new DataView(vertices.buffer, vertices.byteOffset);
  return [0, 4, 8].map((k) => view.getFloat32(i * 48 + k, true));
};

// The two points of the chest, its flat middle and back, the chin in front of it, a hand by the side.
const POINTS: [number, number, number, number][] = [
  [0.13, 0.08, 1.45, 2],
  [0.13, -0.08, 1.45, 2],
  [0.09, 0, 1.45, 2],
  [-0.12, 0.05, 1.45, 2],
  [0.14, 0, 1.62, 6],
  [0.05, 0.3, 1.2, 3],
  [0.1, 0.06, 1.38, 1],
];

describe('Booby Bay', () => {
  it('finds the chest by its most forward points, one each side', () => {
    const found = findChest(meshOf(POINTS), BONES)!;
    expect(found.middle).toBe(0);
    expect(found.centre[1]).toBeCloseTo(0.08, 5);
    expect(found.centre[2]).toBeCloseTo(1.45, 5);
    expect(found.centre[0]).toBeLessThan(0.13);
  });

  it('pushes the breasts forward and leaves the back, the head and the arms where they were', () => {
    const mesh = meshOf(POINTS);
    const out = enlarge(mesh, BONES).vertices;
    expect(out).not.toBe(mesh.vertices);
    for (const i of [0, 1]) expect(at(out, i)[0]! - at(mesh.vertices, i)[0]!).toBeGreaterThan(0.05);
    // The two sides alike.
    expect(at(out, 0)[0]).toBeCloseTo(at(out, 1)[0]!, 5);
    expect(at(out, 0)[1]).toBeCloseTo(-at(out, 1)[1]!, 5);
    for (const i of [3, 4, 5]) expect(at(out, i)).toEqual(at(mesh.vertices, i));
    // The spine under the chest follows a little: the underside.
    expect(at(out, 6)[0]).toBeGreaterThan(at(mesh.vertices, 6)[0]!);
    // The mesh it was given is left as it was.
    expect(at(mesh.vertices, 0)[0]).toBeCloseTo(0.13, 5);
  });

  it('hands the swollen vertices to the breasts\' bones, the weights still whole', () => {
    // Two breast bones off the chest, in front, one each side.
    const bones = [...BONES, bone(-1, 2, [0.09, 0.08, 1.45]), bone(-1, 2, [0.09, -0.08, 1.45])];
    const shaped = enlarge(meshOf(POINTS), bones);
    expect(shaped.bounce).toMatchObject({ chest: 2, breasts: [7, 8] });
    const view = new DataView(shaped.vertices.buffer);
    for (let i = 0; i < POINTS.length; i++) {
      const weights = [0, 1, 2, 3].map((k) => view.getUint8(i * 48 + 12 + k));
      expect(weights.reduce((a, b) => a + b, 0)).toBe(255);
    }
    const owner = (i: number) => [0, 1, 2, 3].filter((k) => view.getUint8(i * 48 + 12 + k) > 0).map((k) => view.getUint8(i * 48 + 16 + k));
    expect(owner(0)).toContain(7);
    expect(owner(1)).toContain(8);
    expect(owner(4)).toEqual([6]);
  });

  it('bounces: lags a chest that jumps, swings past, and settles', () => {
    const springs = new Bounce({ chest: 0, pivot: [0, 0, 1.4], breasts: [1, 2], radius: 0.1 });
    const pose = () => {
      const bones = new Float32Array(48);
      for (const b of [0, 1, 2]) for (const k of [0, 5, 10, 15]) bones[b * 16 + k] = 1;
      return bones;
    };
    springs.apply(pose(), 0);
    // Up a fifth of a yard in a frame: the breasts stay behind, below.
    let bones = pose();
    springs.apply(bones, 16, { x: 0, z: 0.2, facing: 1 });
    const lows: number[] = [bones[16 + 14]!];
    expect(bones[16 + 14]).toBeLessThan(-0.05);
    expect(bones[32 + 14]).toBeLessThan(-0.05);
    // Held there, they swing up past it and come to rest.
    let high = 0;
    for (let t = 32; t < 3000; t += 16) {
      bones = pose();
      springs.apply(bones, t, { x: 0, z: 0.2, facing: 1 });
      high = Math.max(high, bones[16 + 14]!);
      lows.push(bones[16 + 14]!);
    }
    expect(high).toBeGreaterThan(0.01);
    expect(Math.abs(lows.at(-1)!)).toBeLessThan(0.002);
    // A leap of yards in a frame (a new round) starts them over, not a fling.
    bones = pose();
    springs.apply(bones, 3016, { x: 5, z: 0, facing: 1 });
    expect(bones[16 + 12]).toBe(0);
  });

  it('makes the bottom bigger too, backward, over the thighs, and leaves the front of the hips alone', () => {
    // The pelvis off the root, the thighs hanging from it.
    const bones = [...BONES, bone(-1, 0, [0, 0, 1.0]), bone(55, 7, [0, -0.09, 0.95]), bone(56, 7, [0, 0.09, 0.95])];
    const points: [number, number, number, number][] = [...POINTS, [-0.13, 0.07, 0.9, 7], [-0.13, -0.07, 0.9, 7], [0.1, 0.05, 0.9, 7]];
    const hips = findHips(meshOf(points), bones)!;
    expect(hips.facing).toBe(-1);
    expect(hips.centre[1]).toBeGreaterThan(0.05);
    const mesh = meshOf(points);
    const out = enlarge(mesh, bones).vertices;
    for (const i of [7, 8]) expect(at(out, i)[0]!).toBeLessThan(at(mesh.vertices, i)[0]! - 0.03);
    expect(at(out, 9)).toEqual(at(mesh.vertices, 9));
    // Without a bottom to make bigger, it is left as it was.
    expect(at(enlarge(mesh, bones, undefined, 0).vertices, 7)).toEqual(at(mesh.vertices, 7));
  });

  it('leaves a model it cannot read alone', () => {
    const mesh = meshOf(POINTS);
    expect(enlarge(mesh, BONES.map((b) => ({ ...b, keyBoneId: -1 }))).vertices).toBe(mesh.vertices);
  });

  it('is found by typing its code while waiting, whatever was typed before', () => {
    let typed = '';
    for (const digit of `12${BAY_CODE.slice(0, 3)}9${BAY_CODE}`) typed = typedToward(typed, digit);
    expect(typed).toBe(BAY_CODE);
    expect(typedToward('800', '8')).toBe('8008');
    expect(typedToward('8008', '8')).toBe('8');
    expect(typedToward('80', '0')).toBe('800');
  });
});
