import type { CharacterScene } from '@mogshot/character/scene';
import { multiply, rotation, scaling, translation } from '@mogshot/math/mat4';
import { posableRig, type PosableRig } from '@mogshot/model/posable';
import type { SpellModel, SpellVisual } from '@mogshot/worker/api';
import type { DataClient } from '@mogshot/worker/client';
import { type Ability, kitSpec } from '../engine/abilities';
import { type Match, PROJECTILE_HIT, type Projectile } from '../engine/engine';
import type { Wielding } from '../engine/moves';
import { TICK_MS } from '../engine/stage';

/*
 * The game's own spell models in the ring: for each ability of a fighter's kit, the models its
 * spell visual names (the missile that flies, what glows in the hands while the bar fills, what
 * flashes at the release, what strikes the target, the aura that stays), built by the worker as
 * small scenes and merged into the ring beside the fighters. Each frame every model is either
 * posed where the fight says (at a projectile, a hand, the target's chest or feet) or folded
 * away to nothing. Particles and ribbons are not drawn by the renderer, so a spell whose look is
 * all particles has no model here; fx2d.ts draws every spell over the top either way.
 */

export type Point = [number, number, number];

/** Where a fighter's attachment point is in the world this frame, or undefined. */
export type AnchorAt = (side: 0 | 1, attachment: number) => Point | undefined;

/** Attachment points the effects ask for (the model's numbering). */
export const ATTACH = { rightHand: 1, leftHand: 2, helm: 11, base: 19, head: 20, spellLeft: 21, spellRight: 22, chest: 34 } as const;

export type Moment = 'missile' | 'precast' | 'cast' | 'impact' | 'aura';

/** One model of one spell at one moment, with a place of its own in the ring. */
export interface FxSlot {
  /** The ability's id ('lightningBolt'), or 'shot' for a ranged auto-attack. */
  spell: string;
  moment: Moment;
  /** Attachment point it is put on; -1 where the game places it by other means. */
  attachment: number;
  scale: number;
  scene: CharacterScene;
  rig: PosableRig;
  sequence: number;
  /** Length of the sequence in ms. */
  duration: number;
}

export interface FighterFx {
  slots: FxSlot[];
  /** Spells by ability id and what the files had for each, for the console. */
  spells: { spell: string; name: string; spellId: number; models: string[] }[];
}

/** Spell ids to try before the ability's name: the player's own spell where an NPC copy of the name would come first. */
const SPELL_IDS: Record<string, number[]> = {
  lightningBolt: [403, 188196],
  earthShock: [8042],
  stormstrike: [17364],
  mindBlast: [8092],
  holyNova: [15237, 132157],
  powerWordShield: [17],
  wrath: [5176, 190984],
  moonfire: [8921],
  rake: [1822],
  aimedShot: [19434],
  raptorStrike: [186270, 2973],
  disengage: [781],
  chaosStrike: [162794],
  felRush: [195072],
  bladeDance: [188499],
  charge: [100],
  mortalStrike: [12294],
  execute: [5308],
  frostbolt: [116],
  frostNova: [122],
  howlOfTerror: [5484],
  shadowBolt: [686],
};

/** Missiles are drawn half again their size: at a fighting game's distance the game's own read as specks. */
const MISSILE_SCALE = 1.5;
/** How long a release or an impact model shows, at most, in ms. */
const CAST_MS = 450;
const IMPACT_MS = 900;
/** An aura that is not a shield shows this long after the spell lands. */
const AURA_MS = 1400;
/** The few last ms of a model's showing in which it shrinks away, so it does not blink out. */
const SHRINK_MS = 150;

const RANGED: ReadonlySet<Wielding> = new Set(['bow', 'rifle', 'crossbow', 'thrown']);

/**
 * The spell models of a fighter's kit, as this folder has them. Never fails: a fighter whose
 * spells have no model, or whose models cannot be read, has none.
 */
export async function loadFighterFx(client: DataClient, classId: number | undefined, wielding: Wielding): Promise<FighterFx> {
  const abilities: readonly Pick<Ability, 'id' | 'name'>[] = kitSpec(classId, wielding).abilities;
  const wanted = abilities.map((a) => ({ spell: a.id, name: a.name, ids: SPELL_IDS[a.id] ?? [] }));
  // A shot flies as the game's arrow: Auto Shot's missile, else Aimed Shot's.
  if (RANGED.has(wielding)) wanted.push({ spell: 'shot', name: 'Auto Shot', ids: [75] }, { spell: 'shot', name: 'Aimed Shot', ids: [19434] });
  let visuals: SpellVisual[];
  try {
    visuals = await client.spellVisuals(wanted.map(({ name, ids }) => ({ name, ids })));
  } catch (error) {
    console.warn('No spell models:', error);
    return { slots: [], spells: [] };
  }
  const fileIds = [...new Set(visuals.flatMap((v) => [...v.missiles.map((m) => m.fileId), ...v.models.map((m) => m.fileId)]))];
  let built: SpellModel[] = [];
  try {
    built = fileIds.length > 0 ? await client.spellModels(fileIds) : [];
  } catch (error) {
    console.warn('No spell models:', error);
  }
  const byFile = new Map(built.map((model) => [model.fileId, { model, rig: posableRig(model.rig) }]));
  const slots: FxSlot[] = [];
  const spells: FighterFx['spells'] = [];
  const add = (spell: string, moment: Moment, fileId: number, attachment: number, scale: number) => {
    const found = byFile.get(fileId);
    if (!found) return false;
    const { model, rig } = found;
    slots.push({ spell, moment, attachment, scale, scene: model.scene, rig, sequence: model.sequence, duration: model.duration });
    return true;
  };
  visuals.forEach((visual, i) => {
    const { spell } = wanted[i]!;
    // The second ask for a shot only counts when the first had no missile.
    if (spell === 'shot' && slots.some((slot) => slot.spell === 'shot')) return;
    const models: string[] = [];
    for (const missile of visual.missiles) if (add(spell, 'missile', missile.fileId, -1, missile.scale)) models.push(`missile ${missile.fileId}`);
    if (spell !== 'shot') {
      for (const ref of visual.models) {
        // A model the game places by a positioner (no attachment point) is not read here: drawn
        // where this guesses, retail's Fel Rush floods the ring. The light of fx2d.ts stands in.
        if (ref.attachment < 0) continue;
        if (add(spell, ref.moment, ref.fileId, ref.attachment, ref.scale)) models.push(`${ref.moment} ${ref.fileId}@${ref.attachment}`);
      }
    }
    spells.push({ spell, name: visual.name, spellId: visual.spellId, models });
  });
  return { slots, spells };
}

/** A posed effect: the world matrix to draw its model with and where in its sequence it is. */
export interface FxPose {
  world: Float32Array;
  time: number;
}

/** A matrix that folds a model to a point: drawn as nothing. */
export const HIDDEN = (() => {
  const m = new Float32Array(16);
  m[15] = 1;
  return m;
})();

/** Translation × the half turn for one facing -X × a uniform scale. */
function place(point: Point, facing: number, scale: number): Float32Array {
  let m = translation(point[0], point[1], point[2]);
  if (facing < 0) m = multiply(new Float32Array(16), m, rotation('z', Math.PI));
  if (scale !== 1) m = multiply(new Float32Array(16), m, scaling(scale));
  return m;
}

/** The scale of a model with `left` ms of its showing to go: full, then shrinking to nothing at the end. */
const fade = (left: number) => Math.max(0, Math.min(1, left / SHRINK_MS));

/**
 * Where a fighter's attachment point is, with stand-ins for points a model lacks: the hands for
 * the spell hands, the helm for the head, the middle of the body for the chest, the feet on the
 * floor for the base and for a model the game places by other means.
 */
export function anchorOf(at: AnchorAt, match: Match, side: 0 | 1, attachment: number, moment: Moment): Point {
  const f = match.fighters[side];
  const feet: Point = [f.x, 0, f.z];
  const chest: Point = [f.x, 0, f.z + 1.3];
  const fallback: Record<number, number[]> = {
    [ATTACH.spellLeft]: [ATTACH.spellLeft, ATTACH.leftHand],
    [ATTACH.spellRight]: [ATTACH.spellRight, ATTACH.rightHand],
    [ATTACH.head]: [ATTACH.head, ATTACH.helm],
    [ATTACH.chest]: [ATTACH.chest],
  };
  if (attachment === ATTACH.base) return feet;
  if (attachment < 0) return moment === 'impact' ? (at(side, ATTACH.chest) ?? chest) : feet;
  for (const id of fallback[attachment] ?? [attachment]) {
    const point = at(side, id);
    if (point) return point;
  }
  return attachment === ATTACH.chest ? chest : feet;
}

/** Where each projectile left its shooter's hand, and where the engine launched it, taken the first time it is drawn. */
const launches = new WeakMap<Projectile, { hand: Point; x: number }>();

/**
 * Where a projectile is drawn, `back` frames of its flight behind where it is now. The engine flies
 * every bolt and arrow at one height from a step ahead of the body: a human's waist, the hip of a
 * taller legend, and behind the hands of a caster who lunges. The drawing instead leaves from the
 * hand held toward the target (the bow hand, the casting hand) and runs straight to the target's
 * chest as it stands on the floor, so a jump still clears it, arriving on the frame the engine's
 * shot lands (it strikes PROJECTILE_HIT short of the body).
 */
export function flightAt(match: Match, shot: Projectile, at: AnchorAt, back = 0): Point {
  let launch = launches.get(shot);
  if (!launch) {
    const f = match.fighters[shot.owner];
    const forward = (p: Point | undefined) => (p ? p[0] * f.facing : -Infinity);
    const right = at(shot.owner, ATTACH.rightHand);
    const left = at(shot.owner, ATTACH.leftHand);
    launch = { hand: (forward(left) > forward(right) ? left : right) ?? [shot.x, 0, shot.z], x: shot.x - shot.vx * shot.t };
    launches.set(shot, launch);
  }
  const { hand } = launch;
  const target = match.fighters[(1 - shot.owner) as 0 | 1];
  const chest = at((1 - shot.owner) as 0 | 1, ATTACH.chest);
  const to: Point = chest ? [chest[0], chest[1], chest[2] - target.z] : [target.x, 0, 1.3];
  const dir = Math.sign(shot.vx) || 1;
  const lands = target.x - dir * PROJECTILE_HIT;
  const span = lands - launch.x;
  const u = Math.abs(span) < 0.1 ? 1 : Math.max(0, Math.min(1, (shot.x - shot.vx * back - launch.x) / span));
  return [hand[0] + (to[0] - hand[0]) * u, hand[1] + (to[1] - hand[1]) * u, hand[2] + (to[2] - hand[2]) * u];
}

/**
 * Pose every effect slot of both fighters for this frame: a missile on its projectile, the hands'
 * models while the cast bar fills, a release where the caster stands, an impact on the target, a
 * shield's aura for as long as it holds. A slot not in use is HIDDEN. Each slot shows one
 * instance at a time: a second projectile of the same spell in flight flies without a model,
 * and the newest release or impact is the one shown. `back` is how far behind the engine's last
 * step the frame is drawn, in steps (smooth.ts), so a shot flies with the fighters.
 */
export function poseFx(match: Match, fxs: readonly (FighterFx | undefined)[], at: AnchorAt, back = 0): FxPose[][] {
  return fxs.map((fx, s) => {
    const side = s as 0 | 1;
    const f = match.fighters[side];
    const target = (1 - side) as 0 | 1;
    const kit = match.tables[side].kit;
    const idOf = (n: number) => kit.abilities[n]?.id;
    const castingId = f.cast ? idOf(f.cast.ability) : undefined;
    const shots = match.projectiles.filter((p) => p.owner === side);
    const events = match.spellEvents.filter((e) => e.owner === side);
    return (fx?.slots ?? []).map((slot) => {
      const loop = (ms: number) => (slot.duration > 0 ? ms % slot.duration : 0);
      switch (slot.moment) {
        case 'missile': {
          // Every missile model of the spell (an arrow and its glow) rides the first of its projectiles.
          const shot = shots.find((p) => (p.ability < 0 ? 'shot' : idOf(p.ability)) === slot.spell);
          if (!shot) return { world: HIDDEN, time: 0 };
          return { world: place(flightAt(match, shot, at, back), Math.sign(shot.vx) || 1, slot.scale * MISSILE_SCALE), time: loop(Math.max(0, shot.t - back) * TICK_MS) };
        }
        case 'precast': {
          if (castingId !== slot.spell || !f.cast) return { world: HIDDEN, time: 0 };
          return { world: place(anchorOf(at, match, side, slot.attachment, slot.moment), f.facing, slot.scale), time: loop(f.cast.t * TICK_MS) };
        }
        case 'cast': {
          const e = events.find((ev) => ev.kind === 'release' && ev.spell === slot.spell && ev.t * TICK_MS < CAST_MS);
          if (!e) return { world: HIDDEN, time: 0 };
          const ms = e.t * TICK_MS;
          return { world: place(anchorOf(at, match, side, slot.attachment, slot.moment), f.facing, slot.scale * fade(CAST_MS - ms)), time: Math.min(ms, slot.duration) };
        }
        case 'impact': {
          const e = events.find((ev) => ev.kind === 'impact' && ev.spell === slot.spell && ev.t * TICK_MS < Math.min(IMPACT_MS, slot.duration || IMPACT_MS));
          if (!e) return { world: HIDDEN, time: 0 };
          const ms = e.t * TICK_MS;
          const left = Math.min(IMPACT_MS, slot.duration || IMPACT_MS) - ms;
          return { world: place(anchorOf(at, match, target, slot.attachment, slot.moment), -f.facing, slot.scale * fade(left)), time: Math.min(ms, slot.duration) };
        }
        case 'aura': {
          const ability = kit.abilities.find((a) => a.id === slot.spell);
          if (ability && ability.absorb > 0) {
            // A shield: for as long as it holds.
            if (f.absorb <= 0) return { world: HIDDEN, time: 0 };
            const since = events.find((ev) => ev.spell === slot.spell && ev.kind === 'release');
            const ms = since ? since.t * TICK_MS : slot.duration;
            return { world: place(anchorOf(at, match, side, slot.attachment, slot.moment), f.facing, slot.scale), time: loop(ms) };
          }
          // Otherwise a while after the release, on the caster of a buff, on the target of anything else.
          const self = ability && (ability.kind === 'self' || ability.kind === 'melee' || ability.kind === 'rush' || ability.kind === 'charge' || ability.kind === 'leap');
          const e = events.find((ev) => ev.spell === slot.spell && ev.kind === (self ? 'release' : 'impact') && ev.t * TICK_MS < AURA_MS);
          if (!e) return { world: HIDDEN, time: 0 };
          const ms = e.t * TICK_MS;
          const who = self ? side : target;
          return { world: place(anchorOf(at, match, who, slot.attachment, slot.moment), match.fighters[who].facing, slot.scale * fade(AURA_MS - ms)), time: loop(ms) };
        }
      }
    });
  });
}
