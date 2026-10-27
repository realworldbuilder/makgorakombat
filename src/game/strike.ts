import type { CharacterScene, PackedRig } from '@mogshot/character/scene';
import type { PosableRig } from '@mogshot/model/posable';
import type { Move, MoveTable, Strike } from '../engine/moves';
import { BODY } from '../engine/stage';

/*
 * Where a fighter's blows really are. Each attack clip is played through on the fighter's own rig,
 * and at every step the point furthest out in front is found: the tip of whatever is held in the
 * hands (every vertex of the weapon, as posed), or the fists when nothing is. The step where that
 * point is furthest out is the blow: when it lands, how far it reaches and how high. The engine
 * takes these as plain numbers (anim.ts Strike), so a swing connects when the blade arrives, at the
 * distance it can be seen to reach, and its spark shows where it came in.
 */

/** Steps through a clip. At 60 Hz a 1 s swing played 1.6 times faster is 37 frames, so this is finer than the fight sees. */
const SAMPLES = 48;
/** The blow is looked for away from the clip's ends, where an attack rests in its stance with the arms wherever they are. */
const SEARCH = { from: 0.12, to: 0.88 } as const;
/** Attachment points: the hands, where weapons are held. */
const HANDS = [1, 2] as const;
/** A fist's knuckles beyond the hand's attachment point. */
const FIST = 0.12;
/** What a measured reach is held to, in yards ahead of the fighter's feet: a strike measured shorter is the model's rest pose leaning, and longer would hit from across the ring. */
const REACH = { min: 1.0, max: 3.8 } as const;
/** Vertices of a 48-byte record: the position is its first three floats. */
const STRIDE = 48;

interface Held {
  /** The mesh's index in the scene and the rig's pose. */
  index: number;
  /** Its vertex positions, x y z in turn, in its own space. */
  points: Float32Array;
}

/** The meshes held in the hands: the weapons, a shield, an off-hand. */
function heldMeshes(packed: PackedRig, scene: CharacterScene): Held[] {
  const held: Held[] = [];
  packed.meshes.forEach((follows, index) => {
    if (follows.follows !== 'attachment' || !(HANDS as readonly number[]).includes(follows.attachment)) return;
    const vertices = scene.meshes[index]?.vertices;
    if (!vertices || vertices.byteLength < STRIDE) return;
    const view = new DataView(vertices.buffer, vertices.byteOffset, vertices.byteLength);
    const count = Math.floor(vertices.byteLength / STRIDE);
    const points = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) {
      for (let k = 0; k < 3; k++) points[v * 3 + k] = view.getFloat32(v * STRIDE + k * 4, true);
    }
    held.push({ index, points });
  });
  return held;
}

/** The point furthest ahead (+X, the way models face) at one moment of a clip: [ahead, height]. */
function furthest(rig: PosableRig, held: readonly Held[], sequence: number, timeMs: number): [number, number] {
  const pose = rig.pose(sequence, timeMs);
  let ahead = -Infinity;
  let height = 0;
  for (const { index, points } of held) {
    const m = pose[index]?.transform;
    if (!m) continue;
    for (let v = 0; v < points.length; v += 3) {
      const x = points[v]!;
      const y = points[v + 1]!;
      const z = points[v + 2]!;
      const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
      if (wx > ahead) {
        ahead = wx;
        height = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
      }
    }
  }
  const body = pose[0]?.bones;
  if (body) {
    for (const hand of HANDS) {
      const p = rig.attachment(body, hand);
      if (p && p[0] + FIST > ahead) {
        ahead = p[0] + FIST;
        height = p[2];
      }
    }
  }
  return [ahead, height];
}

/** The blow of one clip, or undefined when nothing in it comes forward of the fighter. */
export function measureStrike(rig: PosableRig, held: readonly Held[], sequence: number, duration: number): Strike | undefined {
  let best: Strike | undefined;
  for (let k = 0; k <= SAMPLES; k++) {
    const contact = k / SAMPLES;
    if (contact < SEARCH.from || contact > SEARCH.to) continue;
    const [ahead, height] = furthest(rig, held, sequence, contact * duration);
    if (Number.isFinite(ahead) && (!best || ahead > best.reach)) best = { contact, reach: ahead, height };
  }
  if (!best || best.reach <= 0) return undefined;
  best.reach = Math.min(REACH.max, Math.max(REACH.min, best.reach));
  return best;
}

/** A move whose every variation carries its measured blow; one whose animation the model lacks is left as it is. */
function measured(move: Move, rig: PosableRig, held: readonly Held[]): Move {
  if (!move.animation) return move;
  return { ...move, variations: move.variations.map((v) => ({ ...v, strike: measureStrike(rig, held, v.sequence, v.duration) })) };
}

/**
 * Measures a fighter's blows into its move table: each variation of the swing (not for a bow or a
 * gun, whose shot leaves when it leaves) and each melee ability. The weapon's range becomes the
 * shortest swing's reach to the front of a body, so the CPU walks close enough for any of them;
 * the fighter's height is `stature`.
 */
export function measureTable(table: MoveTable, rig: PosableRig, packed: PackedRig, scene: CharacterScene, stature: number): MoveTable {
  const held = heldMeshes(packed, scene);
  table.stature = stature;
  if (!table.weapon.ranged) {
    const swing = measured(table.moves.swing, rig, held);
    table.moves = { ...table.moves, swing };
    const reaches = swing.variations.flatMap((v) => (v.strike ? [v.strike.reach] : []));
    if (reaches.length > 0) table.weapon = { ...table.weapon, range: Math.min(...reaches) + BODY / 2 };
  }
  const abilities = table.kit.abilities.map((a) => (a.kind === 'melee' ? { ...a, move: measured(a.move, rig, held) } : a)) as MoveTable['kit']['abilities'];
  table.kit = { ...table.kit, abilities };
  return table;
}
