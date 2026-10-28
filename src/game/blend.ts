import { attachmentMatrix, type PackedRig, wornBones } from '@mogshot/character/scene';
import { identity, invert, multiply, pivotTransform, scaling } from '@mogshot/math/mat4';
import type { PosedMesh } from '@mogshot/model/posable';
import type { FighterState } from '../engine/engine';

/*
 * Cross-fading between animations. A clip that changes snaps the model from one pose to the next
 * in a frame; a game that costs money eases it over a few. When a fighter's clip changes (or the
 * same one starts over), the pose last drawn is kept and the new clip is blended in from it over a
 * few frames. The blend is done bone by bone in each bone's own space, about its pivot, as the
 * animation's keys are: rotation along the shorter arc, translation and scale in a straight line,
 * so a limb swings round its joint rather than shrinking through the middle.
 */

/** How long a cross-fade lasts, in milliseconds: into a blow, a flinch or a dash quickly, so the game still answers the key at once; into anything else a little longer. */
export const FADE = { quick: 50, move: 110 } as const;

const QUICK: ReadonlySet<FighterState> = new Set(['attack', 'ability', 'hit', 'block', 'run', 'backdash', 'dodge', 'parry']);

/** The cross-fade into a fighter's pose in a state. */
export function fadeFor(state: FighterState): number {
  return QUICK.has(state) ? FADE.quick : FADE.move;
}

/** What blending needs of a skeleton: each bone's parent and the point it turns about. */
export interface Skeleton {
  bones: readonly { parent: number; pivot: readonly [number, number, number] }[];
}

/** A column of a matrix shorter than this is a bone scaled away to hide it: it has no rotation to blend. */
const FLAT = 1e-4;

type Quat = [number, number, number, number];

interface Parts {
  t: [number, number, number];
  q: Quat;
  s: [number, number, number];
}

/** The 3x3 part of a matrix has no length along some axis. */
function flat(m: Float32Array, at = 0): boolean {
  for (let c = 0; c < 3; c++) {
    if (Math.hypot(m[at + c * 4]!, m[at + c * 4 + 1]!, m[at + c * 4 + 2]!) < FLAT) return true;
  }
  return false;
}

/** A matrix without shear, taken apart: translation, rotation, scale (the inverse of pivotTransform with a zero pivot). */
function decompose(m: Float32Array): Parts {
  const s: [number, number, number] = [Math.hypot(m[0]!, m[1]!, m[2]!), Math.hypot(m[4]!, m[5]!, m[6]!), Math.hypot(m[8]!, m[9]!, m[10]!)];
  const det = m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) - m[4]! * (m[1]! * m[10]! - m[2]! * m[9]!) + m[8]! * (m[1]! * m[6]! - m[2]! * m[5]!);
  // A mirrored bone: one axis is turned inside out, not rotated.
  if (det < 0) s[0] = -s[0];
  const r00 = m[0]! / s[0], r10 = m[1]! / s[0], r20 = m[2]! / s[0];
  const r01 = m[4]! / s[1], r11 = m[5]! / s[1], r21 = m[6]! / s[1];
  const r02 = m[8]! / s[2], r12 = m[9]! / s[2], r22 = m[10]! / s[2];
  const trace = r00 + r11 + r22;
  let q: Quat;
  if (trace > 0) {
    const k = 0.5 / Math.sqrt(trace + 1);
    q = [(r21 - r12) * k, (r02 - r20) * k, (r10 - r01) * k, 0.25 / k];
  } else if (r00 > r11 && r00 > r22) {
    const k = 2 * Math.sqrt(Math.max(0, 1 + r00 - r11 - r22));
    q = [0.25 * k, (r01 + r10) / k, (r02 + r20) / k, (r21 - r12) / k];
  } else if (r11 > r22) {
    const k = 2 * Math.sqrt(Math.max(0, 1 + r11 - r00 - r22));
    q = [(r01 + r10) / k, 0.25 * k, (r12 + r21) / k, (r02 - r20) / k];
  } else {
    const k = 2 * Math.sqrt(Math.max(0, 1 + r22 - r00 - r11));
    q = [(r02 + r20) / k, (r12 + r21) / k, 0.25 * k, (r10 - r01) / k];
  }
  return { t: [m[12]!, m[13]!, m[14]!], q, s };
}

const lerp = (a: number, b: number, w: number) => a + (b - a) * w;

/** Two rotations part of the way from one to the other, along the shorter arc at an even pace. */
function slerp(a: Quat, b: Quat, w: number): Quat {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = cos < 0 ? -1 : 1;
  cos *= sign;
  let ka = 1 - w;
  let kb = w * sign;
  // Nearly the same rotation: a straight line between them is as good and does not divide by nothing.
  if (cos < 0.9995) {
    const angle = Math.acos(Math.min(1, cos));
    const sin = Math.sin(angle);
    ka = Math.sin((1 - w) * angle) / sin;
    kb = (Math.sin(w * angle) / sin) * sign;
  }
  const q: Quat = [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb, a[3] * ka + b[3] * kb];
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

/** A bone's own transform in a pose, about its pivot: the parent's matrix taken off, then the pivot. */
function local(out: Float32Array, bones: Float32Array, i: number, parent: number, pivot: readonly [number, number, number], scratch: Float32Array): Float32Array {
  const own = bones.subarray(i * 16, i * 16 + 16);
  if (parent >= 0) multiply(out, invert(scratch, bones.subarray(parent * 16, parent * 16 + 16)), own);
  else out.set(own);
  // translate(-pivot) * local * translate(pivot)
  const [px, py, pz] = pivot;
  out[12] = out[12]! + out[0]! * px + out[4]! * py + out[8]! * pz - px;
  out[13] = out[13]! + out[1]! * px + out[5]! * py + out[9]! * pz - py;
  out[14] = out[14]! + out[2]! * px + out[6]! * py + out[10]! * pz - pz;
  return out;
}

/**
 * Body bones (16 floats each, model space, as poseBones gives them) `weight` of the way from
 * one pose to another: 0 is `from`, 1 is `to`. A bone scaled away in either pose, or under
 * one that is, is blended as it stands, matrix by matrix.
 */
export function blendBones(skeleton: Skeleton, from: Float32Array, to: Float32Array, weight: number): Float32Array {
  if (weight <= 0) return from.slice();
  if (weight >= 1) return to.slice();
  const count = Math.min(skeleton.bones.length, from.length >> 4, to.length >> 4);
  const out = new Float32Array(to.length);
  out.set(to);
  const done = new Uint8Array(count);
  const a = new Float32Array(16);
  const b = new Float32Array(16);
  const scratch = new Float32Array(16);
  const blended = new Float32Array(16);

  const solve = (i: number): Float32Array => {
    const matrix = out.subarray(i * 16, i * 16 + 16);
    if (done[i]) return matrix;
    done[i] = 1;
    const { parent: p, pivot } = skeleton.bones[i]!;
    const parent = p >= 0 && p < count ? p : -1;
    if (flat(from, i * 16) || flat(to, i * 16) || (parent >= 0 && (flat(from, parent * 16) || flat(to, parent * 16)))) {
      for (let k = 0; k < 16; k++) matrix[k] = lerp(from[i * 16 + k]!, to[i * 16 + k]!, weight);
      return matrix;
    }
    const x = decompose(local(a, from, i, parent, pivot, scratch));
    const y = decompose(local(b, to, i, parent, pivot, scratch));
    pivotTransform(
      blended,
      pivot,
      [lerp(x.t[0], y.t[0], weight), lerp(x.t[1], y.t[1], weight), lerp(x.t[2], y.t[2], weight)],
      slerp(x.q, y.q, weight),
      [lerp(x.s[0], y.s[0], weight), lerp(x.s[1], y.s[1], weight), lerp(x.s[2], y.s[2], weight)],
    );
    if (parent >= 0) multiply(matrix, solve(parent), blended);
    else matrix.set(blended);
    return matrix;
  };
  for (let i = 0; i < count; i++) solve(i);
  return out;
}

/** Every mesh's bones and transform for body bones worked out here, as PosableRig.pose gives them for its own. */
export function posedFrom(packed: PackedRig, bones: Float32Array): PosedMesh[] {
  const { body, scale } = packed;
  const sized = scale !== 1 ? scaling(scale) : undefined;
  return packed.meshes.map((mesh) => {
    let meshBones: Float32Array;
    let transform = identity();
    if (mesh.follows === 'body') meshBones = bones;
    else if (mesh.follows === 'worn') meshBones = wornBones(mesh, body, bones);
    else {
      meshBones = mesh.own.slice();
      transform = attachmentMatrix(body, bones, mesh.attachment) ?? transform;
    }
    if (sized) transform = multiply(new Float32Array(16), sized, transform);
    return { bones: meshBones, transform };
  });
}

/**
 * One fighter's cross-fade. Given the clip and time to draw and the body bones posed for them,
 * it gives back the bones to draw: those, or, for a little while after the clip has changed or
 * started over, a blend into them from the pose drawn before. A fade that begins mid-fade begins
 * from where that one had got to.
 */
export class CrossFade {
  private last: { sequence: number; time: number; bones: Float32Array } | undefined;
  private from: Float32Array | undefined;
  private start = 0;
  private length = 0;

  /** Undefined when the bones posed are the ones to draw. */
  bones(skeleton: Skeleton, sequence: number, time: number, posed: Float32Array, now: number, fade: number): Float32Array | undefined {
    const last = this.last;
    if (last && fade > 0 && (sequence !== last.sequence || time < last.time)) {
      this.from = last.bones;
      this.start = now;
      this.length = fade;
    }
    let drawn: Float32Array | undefined;
    if (this.from) {
      const u = (now - this.start) / this.length;
      if (u >= 1) this.from = undefined;
      // Eased out: most of the way to the new clip early, so it reads as the key's answer at once.
      else drawn = blendBones(skeleton, this.from, posed, 1 - (1 - Math.max(0, u)) ** 2);
    }
    this.last = { sequence, time, bones: drawn ?? posed };
    return drawn;
  }
}
