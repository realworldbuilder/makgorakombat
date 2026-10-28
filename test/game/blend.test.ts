import { multiply, pivotTransform, transformPoint } from '@mogshot/math/mat4';
import { describe, expect, it } from 'vitest';
import { blendBones, CrossFade, FADE, fadeFor, type Skeleton } from '../../src/game/blend';

type Vec = [number, number, number];

/** A turn of `degrees` about z, as a quaternion. */
const turn = (degrees: number): [number, number, number, number] => {
  const half = (degrees * Math.PI) / 360;
  return [0, 0, Math.sin(half), Math.cos(half)];
};

/** An arm: a shoulder at the origin and an elbow a yard out along x, under it. */
const arm: Skeleton = {
  bones: [
    { parent: -1, pivot: [0, 0, 0] },
    { parent: 0, pivot: [1, 0, 0] },
  ],
};

/** The arm's bones in model space for a turn of the shoulder and of the elbow, and the elbow's stretch. */
function pose(shoulder: number, elbow: number, stretch: Vec = [1, 1, 1], move: Vec = [0, 0, 0]): Float32Array {
  const bones = new Float32Array(32);
  const root = pivotTransform(new Float32Array(16), [0, 0, 0], move, turn(shoulder), [1, 1, 1]);
  bones.set(root, 0);
  bones.set(multiply(new Float32Array(16), root, pivotTransform(new Float32Array(16), [1, 0, 0], [0, 0, 0], turn(elbow), stretch)), 16);
  return bones;
}

/** Where a point is carried by one bone of a pose. */
const at = (bones: Float32Array, bone: number, point: Vec) => transformPoint(bones, point, bone * 16);

function close(actual: Float32Array, expected: Float32Array) {
  expect(actual.length).toBe(expected.length);
  actual.forEach((v, k) => expect(v).toBeCloseTo(expected[k]!, 5));
}

describe('blending two poses', () => {
  it('is the first pose at 0 and the second at 1', () => {
    const from = pose(0, 0);
    const to = pose(30, 90);
    close(blendBones(arm, from, to, 0), from);
    close(blendBones(arm, from, to, 1), to);
  });

  it('turns a limb about its joint along the arc, keeping its length', () => {
    const blended = blendBones(arm, pose(0, 0), pose(0, 90), 0.5);
    close(blendBones(arm, pose(0, 0), pose(0, 90), 0.5), pose(0, 45));
    // The hand a yard beyond the elbow stays a yard from it; blending the matrices straight would pull it to 0.71.
    const [x, y] = at(blended, 1, [2, 0, 0]);
    expect(Math.hypot(x - 1, y)).toBeCloseTo(1, 5);
  });

  it('carries a child with its parent and blends both', () => {
    close(blendBones(arm, pose(0, 0), pose(60, 40), 0.5), pose(30, 20));
    close(blendBones(arm, pose(-20, 10), pose(40, -50), 0.25), pose(-5, -5));
  });

  it('takes the shorter way round', () => {
    close(blendBones(arm, pose(170, 0), pose(-170, 0), 0.5), pose(180, 0));
  });

  it('moves and stretches in a straight line', () => {
    close(blendBones(arm, pose(0, 0, [1, 1, 1], [0, 0, 0]), pose(0, 0, [2, 1, 1], [0, 0, 1]), 0.5), pose(0, 0, [1.5, 1, 1], [0, 0, 0.5]));
  });

  it('blends a bone scaled away as it stands, without breaking', () => {
    const from = pose(0, 0, [0, 0, 0]);
    const to = pose(0, 0);
    const blended = blendBones(arm, from, to, 0.5);
    for (let k = 16; k < 32; k++) expect(blended[k]).toBeCloseTo((from[k]! + to[k]!) / 2, 5);
    expect(blended.every(Number.isFinite)).toBe(true);
  });
});

describe('the cross-fade', () => {
  it('draws the posed bones until the clip changes, then fades in from the pose last drawn', () => {
    const fade = new CrossFade();
    expect(fade.bones(arm, 1, 0, pose(0, 0), 0, 100)).toBeUndefined();
    expect(fade.bones(arm, 1, 16, pose(0, 0), 16, 100)).toBeUndefined();
    // A new clip: at its first frame it is still the old pose.
    close(fade.bones(arm, 2, 0, pose(0, 90), 32, 100)!, pose(0, 0));
    // Half way through the fade is three quarters of the way there (eased out).
    close(fade.bones(arm, 2, 50, pose(0, 90), 82, 100)!, pose(0, 67.5));
    expect(fade.bones(arm, 2, 100, pose(0, 90), 132, 100)).toBeUndefined();
  });

  it('fades when the same clip starts over, and not when it plays on', () => {
    const fade = new CrossFade();
    fade.bones(arm, 1, 400, pose(0, 60), 0, 100);
    expect(fade.bones(arm, 1, 416, pose(0, 60), 16, 100)).toBeUndefined();
    expect(fade.bones(arm, 1, 0, pose(0, 0), 32, 100)).toBeDefined();
  });

  it('begins a fade that interrupts another from where that one had got to', () => {
    const fade = new CrossFade();
    fade.bones(arm, 1, 0, pose(0, 0), 0, 100);
    const halfway = fade.bones(arm, 2, 0, pose(0, 90), 50, 100);
    const mid = fade.bones(arm, 2, 50, pose(0, 90), 100, 100)!;
    expect(halfway).toBeDefined();
    close(fade.bones(arm, 3, 0, pose(0, -90), 100, 100)!, mid);
  });

  it('snaps when the fade is 0', () => {
    const fade = new CrossFade();
    fade.bones(arm, 1, 0, pose(0, 0), 0, 0);
    expect(fade.bones(arm, 2, 0, pose(0, 90), 16, 0)).toBeUndefined();
  });

  it('fades into blows and flinches quickly and into the rest more slowly', () => {
    expect(fadeFor('attack')).toBe(FADE.quick);
    expect(fadeFor('hit')).toBe(FADE.quick);
    expect(fadeFor('block')).toBe(FADE.quick);
    expect(fadeFor('walk')).toBe(FADE.move);
    expect(fadeFor('knockdown')).toBe(FADE.move);
    expect(FADE.quick).toBeLessThan(FADE.move);
  });
});
