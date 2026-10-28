import type { SceneMesh } from '@mogshot/character/scene';
import type { M2Bone } from '@mogshot/formats/m2';

/*
 * BOOBY BAY: a secret corner of the queue (typed 80085 while waiting for a fight, Online.tsx)
 * where the lobby pairs only those who found it. There the roster is a woman warrior of each race,
 * with no armour and no weapons (hand to hand) and with her chest and bottom made bigger; they fight on their own beach (stages.ts BAY_STAGE) under the
 * bay's own dress (BayDress.tsx).
 *
 * The models have no bone for the breasts, so the body's own vertices are moved, once, as the
 * fighter is built: everything after (the skinning, the poses, the renderer) uses them as stored.
 * The chest bone is the shoulders' parent. Of the vertices that bone and its own children carry
 * (not the arms, not the neck and head), the two that stand furthest forward, one each side, are
 * the breasts' points; each breast is then a ball behind its point, and everything inside a wider
 * ball about it is pushed out from its centre, most at the middle and nothing at the edge, so the
 * surface swells without a seam. Their normals turn the same way, so the light follows the shape.
 * The bottom the same way facing back: the hips are the bone both thighs hang from, and its cheeks
 * each side's rearmost vertex about the height of the thighs' tops.
 *
 * And they bounce. The models carry a bone for each breast, a child of the chest that the game
 * never moves on its own; the swollen vertices are handed to it, as far as they swelled. The bottom
 * has none, so the body is given two more bones at the end of its skeleton, one for each cheek,
 * which follow the hips (withAdded) and take the bottom's swollen vertices the same way. Each frame
 * a spring per breast and per cheek (Bounce) is pulled along by where the chest or the hips went,
 * walking, jumping, struck, and lags behind, overshoots and settles; the bone is moved by how far
 * the spring is from where it hangs. Only the drawing sees it: the fight itself, and the online lockstep, never do.
 */

/**
 * The races of the bay's champions, as many of them as the install has, the Alliance first:
 * human, night elf, dwarf, gnome, draenei, then orc, troll, undead, tauren, blood elf. The
 * warrior's class id; female.
 */
export const BAY_RACES = [1, 4, 3, 7, 11, 2, 8, 5, 6, 10] as const;
export const BAY_CLASS = 1;
export const BAY_SEX = 1;

/** How far the surface is pushed at the breast's point, as a share of the breast's radius; and the bottom's, of its own. */
export const BAY_SWELL = 2.1;
export const BAY_BUTT = 1.1;

const STRIDE = 48;
const SHOULDER_L = 2;
const SHOULDER_R = 3;
const HEAD = 6;
/** The breast's radius at most, as a share of the chest's height off the ground (human and night elf come to about 0.043); each cheek's, of the thighs' tops. */
const CHEST_MOST = 0.045;
const HIPS_SIZE = 0.068;
const THIGH_R = 55;
const THIGH_L = 56;

/** The model's axes: +x forward, +y the model's left, +z up. */
interface Found {
  /** The breast's centre on the model's left; the right one is its mirror across the chest's middle. */
  centre: Vec3;
  /** The chest's middle, side to side. */
  middle: number;
  radius: number;
}

/** The bones the chest carries the breasts on: the shoulders' parent and its children, less the arms and the head. */
function chestBones(bones: readonly M2Bone[]): Set<number> | undefined {
  const shoulder = bones.findIndex((bone) => bone.keyBoneId === SHOULDER_L);
  const chest = shoulder >= 0 ? bones[shoulder]!.parent : -1;
  if (chest < 0) return undefined;
  const cut = new Set<number>();
  for (const key of [SHOULDER_L, SHOULDER_R]) {
    const at = bones.findIndex((bone) => bone.keyBoneId === key);
    if (at >= 0) cut.add(at);
  }
  // The neck: the chest's child on the way up to the head.
  let up = bones.findIndex((bone) => bone.keyBoneId === HEAD);
  while (up >= 0 && bones[up]!.parent !== chest && bones[up]!.parent >= 0) up = bones[up]!.parent;
  if (up >= 0 && bones[up]!.parent === chest) cut.add(up);
  const set = new Set<number>([chest]);
  // Parents come before their children in an M2, so one pass in order finds every descendant.
  for (let i = 0; i < bones.length; i++) {
    const parent = bones[i]!.parent;
    if (!cut.has(i) && parent >= 0 && set.has(parent)) set.add(i);
  }
  return set;
}

/** How much of a vertex the bones of a set carry, 0 to 1. */
function weightIn(view: DataView, at: number, set: Set<number>): number {
  let sum = 0;
  for (let k = 0; k < 4; k++) {
    const w = view.getUint8(at + 12 + k);
    if (w > 0 && set.has(view.getUint8(at + 16 + k))) sum += w;
  }
  return sum / 255;
}

/** The vertices the scene draws: a model holds every geoset, most of them hidden. */
function drawn(mesh: SceneMesh): Set<number> {
  const seen = new Set<number>();
  for (const draw of mesh.draws) {
    for (let i = draw.indexStart; i < draw.indexStart + draw.indexCount; i++) seen.add(mesh.indices[i]!);
  }
  return seen;
}

/** Where the breasts are on a body mesh, or undefined when the model is not one this can read. */
export function findChest(mesh: SceneMesh, bones: readonly M2Bone[]): Found | undefined {
  const set = chestBones(bones);
  if (!set) return undefined;
  const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
  const chest = bones[bones.findIndex((bone) => bone.keyBoneId === SHOULDER_L)]!.parent;
  const middle = bones[chest]!.pivot[1];
  // Each side's most forward vertex of the chest.
  const best: [number, number, number][] = [];
  for (const side of [1, -1]) {
    let top: [number, number, number] | undefined;
    for (const i of drawn(mesh)) {
      const at = i * STRIDE;
      if (weightIn(view, at, set) < 0.5) continue;
      const x = view.getFloat32(at, true);
      const y = view.getFloat32(at + 4, true);
      const z = view.getFloat32(at + 8, true);
      if ((y - middle) * side < 0.02) continue;
      if (!top || x > top[0]) top = [x, y, z];
    }
    if (!top) return undefined;
    best.push(top);
  }
  const [left, right] = best as [[number, number, number], [number, number, number]];
  const apart = (Math.abs(left[1] - middle) + Math.abs(right[1] - middle)) / 2;
  const height = (left[2] + right[2]) / 2;
  // A wide chest on a short body (a dwarf's, a gnome's) would swell past all reason: no more than the tall races' share of the height.
  const radius = Math.min(apart * 0.95, height * CHEST_MOST);
  const front = (left[0] + right[0]) / 2;
  return { centre: [front - radius * 0.6, middle + apart, height], middle, radius };
}

/** A body mesh made bigger: its vertices, and what Bounce needs to move it, when the model has the bones for it. */
export interface Shaped {
  vertices: Uint8Array;
  bounce?: BounceRig;
}

/**
 * A pair that bounces: the bone they hang from and where it sits, their two bones (left, right),
 * how big they are, and how they swing. `added` when the two bones are the ones the body was given
 * for them (the cheeks of the bottom), which follow the anchor wherever it goes before they swing.
 */
export interface Jiggle {
  anchor: number;
  pivot: Vec3;
  bones: [number, number];
  radius: number;
  /** Swings a second, each side a little apart from the other. */
  hz: readonly [number, number];
  /** How far the swing shows, past how far the spring lags. */
  gain: number;
  added?: boolean;
}

/** What bounces on a body: the pairs, and the bones added to the end of its skeleton for them (copies of `from` until they swing). */
export interface BounceRig {
  parts: Jiggle[];
  added?: { from: number; count: number };
}

/** Each side's breast bone: a child of the chest in front of it, on that side, nearest the breast's centre. */
function breastBones(bones: readonly M2Bone[], chest: number, found: Found): [number, number] | undefined {
  const at = bones[chest]!.pivot;
  const picked: number[] = [];
  for (const side of [1, -1]) {
    let best = -1;
    let near = Infinity;
    bones.forEach((bone, i) => {
      if (bone.parent !== chest || bone.keyBoneId !== -1) return;
      const [x, y, z] = bone.pivot;
      if (x < at[0] + 0.02 || (y - found.middle) * side < 0.02) return;
      const far = Math.hypot(x - found.centre[0], y - (found.middle + (found.centre[1] - found.middle) * side), z - found.centre[2]);
      if (far < near && far < found.radius * 3) [best, near] = [i, far];
    });
    if (best < 0) return undefined;
    picked.push(best);
  }
  return [picked[0]!, picked[1]!];
}

/** Gives `share` of a vertex to `bone`, the rest of its weights scaled down to make room; four slots still, summing to 255. */
function handTo(view: DataView, at: number, bone: number, share: number): void {
  const slots = [0, 1, 2, 3];
  const weights = slots.map((k) => view.getUint8(at + 12 + k) * (1 - share));
  const owners = slots.map((k) => view.getUint8(at + 16 + k));
  let slot = slots.find((k) => owners[k] === bone && view.getUint8(at + 12 + k) > 0) ?? -1;
  if (slot < 0) {
    // The lightest slot makes room; what it held goes to the heaviest.
    slot = slots.reduce((a, b) => (weights[b]! < weights[a]! ? b : a));
    const heavy = slots.filter((k) => k !== slot).reduce((a, b) => (weights[b]! > weights[a]! ? b : a));
    weights[heavy]! += weights[slot]!;
    weights[slot] = 0;
    owners[slot] = bone;
  }
  weights[slot]! += 255 * share;
  const whole = weights.map(Math.round);
  const top = slots.reduce((a, b) => (whole[b]! > whole[a]! ? b : a));
  whole[top]! += 255 - whole.reduce((a, b) => a + b, 0);
  for (const k of slots) {
    view.setUint8(at + 12 + k, whole[k]!);
    view.setUint8(at + 16 + k, owners[k]!);
  }
}

/** One pair to swell: the left one's centre (the right is its mirror across the middle), its radius, and which way it faces (+1 forward, -1 back). */
interface Part {
  centre: Vec3;
  middle: number;
  radius: number;
  facing: 1 | -1;
  /** How much of the push above the centre is held back (a slope up into the body, not a shelf), and how much goes out to the side. */
  above?: number;
  side?: number;
}

/**
 * Pushes a pair out from their centres, in place: most at the middle and nothing at the edge of a
 * ball 1.7 radii about each, nothing behind the centre (the body wall) and only a little above it
 * (a slope, not a shelf), leaning the way the part faces and a little down under its own weight.
 * Only what the `hold` bones carry moves, as far as they carry it. `after` hears of each vertex
 * moved: which side, and how far into the swell it is.
 */
function swellPart(view: DataView, hold: Set<number>, part: Part, swell: number, after?: (at: number, side: 0 | 1, bend: number) => void): void {
  const { centre, middle, radius, facing, above: damp = 0.6, side: sideways = 1 } = part;
  const reach = radius * 1.7;
  const count = view.byteLength / STRIDE;
  for (let i = 0; i < count; i++) {
    const at = i * STRIDE;
    const held = weightIn(view, at, hold);
    if (held <= 0) continue;
    const p: Vec3 = [view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)];
    const move: Vec3 = [0, 0, 0];
    const out3: Vec3 = [0, 0, 0];
    let bend = 0;
    let which: 0 | 1 = 0;
    for (const [s, side] of [1, -1].entries()) {
      // In the part's own frame: +x the way it faces.
      const d: Vec3 = [(p[0] - centre[0]) * facing, p[1] - (middle + (centre[1] - middle) * side), p[2] - centre[2]];
      const far = Math.hypot(...d);
      if (far >= reach) continue;
      const behind = Math.min(1, Math.max(0, (d[0] + radius * 0.4) / (radius * 0.6)));
      const above = 1 - damp * Math.min(1, Math.max(0, d[2] / reach));
      const t = far / reach;
      const f = (1 - t * t) ** 2 * behind * above * held;
      if (f <= 0) continue;
      const dir = far > 1e-6 ? scale(d, 1 / far) : ([1, 0, 0] as Vec3);
      const lean = unit([dir[0] + 0.6, dir[1] * sideways, Math.min(dir[2], 0.2) - 0.2]);
      const push = swell * radius * f;
      for (const k of AXES) {
        move[k] += lean[k] * push;
        out3[k] += dir[k] * f;
      }
      if (f > bend) [bend, which] = [f, s as 0 | 1];
    }
    if (bend <= 0) continue;
    move[0] *= facing;
    out3[0] *= facing;
    for (const k of AXES) view.setFloat32(at + k * 4, p[k] + move[k], true);
    // The normal turns toward the ball's own, as far as the surface moved: the light follows the shape.
    if (Math.hypot(...out3) > 1e-6) {
      const normal: Vec3 = [view.getFloat32(at + 20, true), view.getFloat32(at + 24, true), view.getFloat32(at + 28, true)];
      const turn = Math.min(0.7, bend * swell * 0.6);
      const ball = unit(out3);
      const bent = unit([normal[0] * (1 - turn) + ball[0] * turn, normal[1] * (1 - turn) + ball[1] * turn, normal[2] * (1 - turn) + ball[2] * turn]);
      for (const k of AXES) view.setFloat32(at + 20 + k * 4, bent[k], true);
    }
    after?.(at, which, bend);
  }
}

/** The hips: the bone the two thighs hang from, it and its own children (not the legs below the thighs), and the bones above it. */
function hipBones(bones: readonly M2Bone[]): { pelvis: number; thighs: [number, number]; set: Set<number> } | undefined {
  const left = bones.findIndex((bone) => bone.keyBoneId === THIGH_L);
  const right = bones.findIndex((bone) => bone.keyBoneId === THIGH_R);
  if (left < 0 || right < 0) return undefined;
  const above = new Set<number>();
  for (let up = bones[left]!.parent; up >= 0; up = bones[up]!.parent) above.add(up);
  let pelvis = bones[right]!.parent;
  while (pelvis >= 0 && !above.has(pelvis)) pelvis = bones[pelvis]!.parent;
  if (pelvis < 0) return undefined;
  const set = new Set<number>([pelvis, left, right]);
  bones.forEach((bone, i) => {
    if (bone.parent === pelvis) set.add(i);
  });
  for (let up = bones[pelvis]!.parent; up >= 0; up = bones[up]!.parent) set.add(up);
  return { pelvis, thighs: [left, right], set };
}

/**
 * Where the cheeks of the bottom are. The rearmost vertex the pelvis and thighs themselves carry
 * (a tail has bones of its own), about the height of the thighs' tops, says how far back and how
 * high; each cheek sits out over its thigh, and is as big as the hips are high.
 */
export function findHips(mesh: SceneMesh, bones: readonly M2Bone[]): Part | undefined {
  const hips = hipBones(bones);
  if (!hips) return undefined;
  const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
  const at = bones[hips.pelvis]!.pivot;
  const [left, right] = hips.thighs.map((i) => bones[i]!.pivot) as [Vec3, Vec3];
  const middle = at[1];
  const out = (Math.abs(left[1] - middle) + Math.abs(right[1] - middle)) / 2;
  const tall = (left[2] + right[2]) / 2;
  const own = new Set<number>([hips.pelvis, ...hips.thighs]);
  let back: Vec3 | undefined;
  for (const i of drawn(mesh)) {
    const v = i * STRIDE;
    if (weightIn(view, v, own) < 0.5) continue;
    const p: Vec3 = [view.getFloat32(v, true), view.getFloat32(v + 4, true), view.getFloat32(v + 8, true)];
    if (p[2] < tall * 0.8 || p[2] > tall * 1.1 || p[0] > at[0] || Math.abs(p[1] - middle) > out * 1.4) continue;
    if (!back || p[0] < back[0]) back = p;
  }
  if (!back || out <= 0) return undefined;
  const radius = tall * HIPS_SIZE;
  // Rounder below the hip joint than above it, sloping up into the small of the back, and out behind more than to the sides.
  return { centre: [back[0] + radius * 0.6, middle + out * 0.75, Math.min(back[2], tall) - radius * 0.45], middle, radius, facing: -1, above: 0.92, side: 0.35 };
}

/**
 * The body mesh with its chest and bottom made bigger: a new vertex buffer, the old one left alone,
 * and the swollen breasts handed to their own bones to bounce. `swell` is how far the chest's
 * surface moves at the breast's point, in breast radii, `butt` the bottom's. A mesh this cannot
 * read comes back as it was; one whose hips it cannot find has its chest done alone.
 */
export function enlarge(mesh: SceneMesh, bones: readonly M2Bone[], swell = BAY_SWELL, butt = BAY_BUTT): Shaped {
  const found = findChest(mesh, bones);
  const set = chestBones(bones);
  if (!found || !set) return { vertices: mesh.vertices };
  // The spine below the chest carries the underside too; the head and arms never move.
  const torso = new Set(set);
  const chest = bones[bones.findIndex((bone) => bone.keyBoneId === SHOULDER_L)]!.parent;
  for (let up = bones[chest]!.parent; up >= 0; up = bones[up]!.parent) torso.add(up);
  const breasts = breastBones(bones, chest, found);
  // Found on the mesh as the game made it, before the chest moves anything.
  const bottom = butt > 0 ? findHips(mesh, bones) : undefined;
  const hips = hipBones(bones);
  const out = mesh.vertices.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  // The breast's own bone takes each vertex as far as it swelled: its middle wholly, its edge not at all.
  swellPart(view, torso, { ...found, facing: 1 }, swell, breasts && ((at, side, bend) => handTo(view, at, breasts[side], Math.min(1, bend * 1.3))));
  // The bottom has no bones of its own: the body is given two at the end of its skeleton, one a cheek,
  // and they take the swollen vertices as the breasts' bones do. A skeleton too long for one more pair
  // (a vertex names its bones in a byte) keeps its bottom still.
  const cheeks: [number, number] | undefined = bottom && bones.length + 2 <= 256 ? [bones.length, bones.length + 1] : undefined;
  if (bottom && hips) swellPart(view, hips.set, bottom, butt, cheeks && ((at, side, bend) => handTo(view, at, cheeks[side], Math.min(1, bend * 1.3))));
  const parts: Jiggle[] = [];
  if (breasts) parts.push({ anchor: chest, pivot: [...bones[chest]!.pivot], bones: breasts, radius: found.radius, hz: BREAST_HZ, gain: 1.8 });
  if (cheeks && hips) parts.push({ anchor: hips.pelvis, pivot: [...bones[hips.pelvis]!.pivot], bones: cheeks, radius: bottom!.radius, hz: CHEEK_HZ, gain: 1.5, added: true });
  if (parts.length === 0) return { vertices: out };
  return { vertices: out, bounce: { parts, added: cheeks && hips ? { from: hips.pelvis, count: 2 } : undefined } };
}

/**
 * A body pose's bones with the bones Booby Bay added at the end, each a copy of the bone they hang
 * from: the same pose, long enough for the vertices handed to them. Bounce swings them after.
 */
export function withAdded(bones: Float32Array, added: { from: number; count: number } | undefined): Float32Array {
  if (!added) return bones;
  const out = new Float32Array(bones.length + added.count * 16);
  out.set(bones);
  const from = bones.subarray(added.from * 16, added.from * 16 + 16);
  for (let k = 0; k < added.count; k++) out.set(from, bones.length + k * 16);
  return out;
}

/** Where a fighter stands in the ring, for the spring to feel the steps and jumps the poses do not have. */
export interface Standing {
  x: number;
  z: number;
  facing: 1 | -1;
}

/** How fast the breasts and the cheeks swing, in swings a second, each side a little apart; how quickly a swing dies away. */
const BREAST_HZ = [3.1, 3.4] as const;
const CHEEK_HZ = [2.6, 2.85] as const;
const BOUNCE_DAMPING = 0.11;
/** The furthest one lags its anchor, in its own radii; a jump further than this in one frame (a new round, a blink) starts the springs over. */
const BOUNCE_MOST = 0.9;
const BOUNCE_LEAP = 0.6;

/**
 * The springs of one fighter as drawn: one for each breast and each cheek, a weight on a spring from
 * the bone they hang from. Each place that draws a fighter keeps its own (both fighters of a mirror
 * match are one build).
 */
export class Bounce {
  private last = 0;
  private readonly parts: { part: Jiggle; anchorAt: Vec3 | undefined; springs: { at: Vec3; speed: Vec3 }[] }[];

  constructor(rig: BounceRig) {
    this.parts = rig.parts.map((part) => ({ part, anchorAt: undefined, springs: part.hz.map(() => ({ at: [0, 0, 0] as Vec3, speed: [0, 0, 0] as Vec3 })) }));
  }

  /**
   * Swings the breasts' and the cheeks' bones in a body pose (model space, 16 floats a bone, the
   * added bones included) by how far each spring lags its anchor; `now` in ms.
   */
  apply(bones: Float32Array, now: number, standing: Standing = { x: 0, z: 0, facing: 1 }): void {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    for (const held of this.parts) {
      const { part } = held;
      const m = part.anchor * 16;
      if (bones.length < Math.max(m, ...part.bones.map((b) => b * 16)) + 16) continue;
      // The added bones start where their anchor is this frame: a cross-fade may have left them elsewhere.
      if (part.added) for (const b of part.bones) bones.copyWithin(b * 16, m, m + 16);
      const { pivot } = part;
      // The anchor where the pose has it, then where that is in the ring.
      const local: Vec3 = [0, 1, 2].map((k) => bones[m + k]! * pivot[0] + bones[m + 4 + k]! * pivot[1] + bones[m + 8 + k]! * pivot[2] + bones[m + 12 + k]!) as Vec3;
      const anchorAt: Vec3 = [standing.x + standing.facing * local[0], standing.facing * local[1], standing.z + local[2]];
      const before = held.anchorAt;
      held.anchorAt = anchorAt;
      if (!before || Math.hypot(anchorAt[0] - before[0], anchorAt[1] - before[1], anchorAt[2] - before[2]) > BOUNCE_LEAP) {
        for (const spring of held.springs) [spring.at, spring.speed] = [[...anchorAt], [0, 0, 0]];
        continue;
      }
      const most = part.radius * BOUNCE_MOST;
      const steps = Math.max(1, Math.ceil(dt * 240));
      const h = dt / steps;
      const anchorSpeed = dt > 0 ? scale([anchorAt[0] - before[0], anchorAt[1] - before[1], anchorAt[2] - before[2]], 1 / dt) : ([0, 0, 0] as Vec3);
      held.springs.forEach((spring, s) => {
        const w = 2 * Math.PI * part.hz[s as 0 | 1];
        for (let step = 1; step <= steps; step++) {
          // The anchor moves evenly across the frame; the spring follows it a little at a time.
          const u = step / steps;
          for (const k of AXES) {
            const anchor = before[k] + (anchorAt[k] - before[k]) * u;
            spring.speed[k] += (-w * w * (spring.at[k] - anchor) - 2 * BOUNCE_DAMPING * w * (spring.speed[k] - anchorSpeed[k])) * h;
            spring.at[k] += spring.speed[k] * h;
          }
        }
        const lag: Vec3 = [spring.at[0] - anchorAt[0], spring.at[1] - anchorAt[1], spring.at[2] - anchorAt[2]];
        const far = Math.hypot(...lag);
        if (far > most) {
          for (const k of AXES) spring.at[k] = anchorAt[k] + (lag[k] * most) / far;
        }
        // Back into the model's own frame, and onto the bone: a move in model space adds to its translation.
        const shown = (Math.min(far, most) * part.gain) / (far || 1);
        const b = part.bones[s as 0 | 1] * 16;
        bones[b + 12] = bones[b + 12]! + standing.facing * lag[0] * shown;
        bones[b + 13] = bones[b + 13]! + standing.facing * lag[1] * shown;
        bones[b + 14] = bones[b + 14]! + lag[2] * shown;
      });
    }
  }
}

type Vec3 = [number, number, number];
const AXES = [0, 1, 2] as const;
const scale = (v: Vec3, by: number): Vec3 => [v[0] * by, v[1] * by, v[2] * by];
const unit = (v: Vec3): Vec3 => scale(v, 1 / (Math.hypot(...v) || 1));
