import type { AnimationInfo } from '@mogshot/character/scene';
import { PVP_DAMAGE, WEAPON_SKILL } from '../../src/engine/abilities';
import { type Inputs, type Match, newMatch, noInputs, tick } from '../../src/engine/engine';
import { type MoveTable, resolveMoves, type Wielding } from '../../src/engine/moves';
import type { RulesName } from '../../src/engine/rules';
import { INTRO_FRAMES } from '../../src/engine/stage';

/** A retail-like animation list, every sequence 1000 ms unless overridden by name. */
export const FULL_SET = [
  'Stand', 'Ready1H', 'Walk', 'Run', 'Walkbackwards', 'JumpStart', 'Jump', 'JumpEnd',
  'Attack1H', 'Attack1H', 'Attack1H', 'AttackUnarmed', 'Special1H', 'SpellCastDirected', 'ReadySpellDirected',
  'ShieldBlock', 'Parry1H', 'Dodge', 'CombatWound', 'CombatCritical', 'Knockdown', 'Stun', 'Death',
  'CombatExecute', 'CombatAbility1H01', 'CombatAbility2HBig01', 'CombatAbility2H02', 'CombatWhirlwind', 'CombatChargeLoop', 'CombatChargeEnd',
  'Kick', 'MagSpellCastBothFront', 'SpellCastOmni', 'BattleRoar', 'EmoteCheer',
];

export const WARRIOR = 1;
export const PALADIN = 2;
export const HUNTER = 3;
export const ROGUE = 4;
export const PRIEST = 5;
export const SHAMAN = 7;
export const MAGE = 8;
export const WARLOCK = 9;

export function fakeAnimations(names: readonly string[] = FULL_SET, durations: Record<string, number> = {}): AnimationInfo[] {
  const seen = new Map<string, number>();
  return names.map((name, i) => {
    const variation = seen.get(name) ?? 0;
    seen.set(name, variation + 1);
    return { sequence: i, id: 1000 + i, variation, name, duration: durations[name] ?? 1000 };
  });
}

/**
 * A table from a fake animation list. `exact` (the default) takes the class modifiers and the damage
 * ranges out, so every blow deals its listed number and a test can name it; the balance runs use the real ones.
 */
export function fakeTable(names: readonly string[] = FULL_SET, wielding: Wielding = 'oneHand', durations: Record<string, number> = {}, classId: number = WARRIOR, shield = false, exact = true, body?: number): MoveTable {
  if (!exact) return resolveMoves(fakeAnimations(names, durations), wielding, classId, shield, body);
  const tuned = { ...PVP_DAMAGE };
  const skill = { ...WEAPON_SKILL };
  for (const key of Object.keys(PVP_DAMAGE)) PVP_DAMAGE[key] = 1;
  for (const key of Object.keys(WEAPON_SKILL)) WEAPON_SKILL[key] = 1;
  try {
    const table = resolveMoves(fakeAnimations(names, durations), wielding, classId, shield, body);
    table.weapon.spread = 0;
    for (const a of table.kit.abilities) a.spread = 0;
    return table;
  } finally {
    Object.assign(PVP_DAMAGE, tuned);
    Object.assign(WEAPON_SKILL, skill);
  }
}

/** Two warriors with one-handers, unless other classes are asked for, under the Warcraft rules unless KOMBAT is. */
export function fakeMatch(seed = 1, classes: [number, number] = [WARRIOR, WARRIOR], shields: [boolean, boolean] = [false, false], rules: RulesName = 'warcraft'): Match {
  return newMatch([fakeTable(FULL_SET, 'oneHand', {}, classes[0], shields[0]), fakeTable(FULL_SET, 'oneHand', {}, classes[1], shields[1])], seed, ['P1', 'P2'], rules);
}

export function inputs(partial: Partial<Omit<Inputs, 'abilities'>> & { abilities?: [boolean, boolean, boolean]; ability?: number } = {}): Inputs {
  const out = { ...noInputs() };
  const { ability, abilities, ...rest } = partial;
  Object.assign(out, rest);
  if (abilities) out.abilities = [...abilities];
  if (ability !== undefined) out.abilities[ability] = true;
  return out;
}

export const NONE: [Inputs, Inputs] = [inputs(), inputs()];

/** Ticks `n` times with the same inputs. */
export function run(match: Match, n: number, both: [Inputs, Inputs] = NONE): void {
  for (let i = 0; i < n; i++) tick(match, both);
}

/** Through "ROUND 1" and "FIGHT!" to the first frame the fighters can act. */
export function skipIntro(match: Match): void {
  run(match, INTRO_FRAMES + 1);
}

/** Ticks until `done` or `limit` frames pass; returns how many ticks it took, or -1. */
export function until(match: Match, done: (m: Match) => boolean, limit: number, both: [Inputs, Inputs] = NONE): number {
  for (let i = 0; i < limit; i++) {
    if (done(match)) return i;
    tick(match, both);
  }
  return done(match) ? limit : -1;
}

/** Puts the fighters `gap` apart around the centre, facing each other, on the ground. */
export function place(match: Match, gap: number): void {
  match.fighters[0].x = -gap / 2;
  match.fighters[1].x = gap / 2;
  match.fighters[0].facing = 1;
  match.fighters[1].facing = -1;
}

/** Fixes the next roll on the hit table: the LCG state whose next draw lands in the wanted band. */
export function rig(match: Match, wanted: 'hit' | 'crit' | 'miss' | 'dodge' | 'parry' | 'block'): void {
  // Bands of the melee table: miss [0, .05), dodge [.05, .11), parry [.11, .17), block [.17, .27), crit [.27, .42), hit [.42, 1).
  const target = { miss: 0.02, dodge: 0.08, parry: 0.14, block: 0.2, crit: 0.3, hit: 0.7 }[wanted];
  // Search a seed whose next draw is close to the target.
  for (let seed = 1; seed < 1_000_000; seed++) {
    const next = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    if (Math.abs(next / 4294967296 - target) < 0.004) {
      match.rng = seed;
      return;
    }
  }
  throw new Error('no seed found');
}
