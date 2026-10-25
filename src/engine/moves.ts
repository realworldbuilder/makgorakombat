import type { WeaponKind } from '@mogshot/character/equipment';
import type { AnimationInfo } from '@mogshot/character/scene';
import { ABILITY_ANIMATIONS, type Kit, resolveKit, type SlotIndex } from './abilities';
import { finderOf, type HitWindow, type Move, moveFrom, type Variation } from './anim';
import { FATALITY_ANIMATIONS, resolveFatality, type ResolvedFatality } from './fatalities';
import { BODY } from './stage';

export type { Finder, HitWindow, Move, Variation } from './anim';

/*
 * What a fighter can play: the core moves every fighter has (stances, steps, the auto-attack
 * swing, dodges and parries, wounds, the death) and the class kit's abilities, each resolved
 * to the first animation the model has.
 */

export type MoveName =
  | 'idle'
  | 'walk'
  | 'back'
  | 'jumpStart'
  | 'jump'
  | 'jumpEnd'
  /** The auto-attack: Attack* with all its variations. */
  | 'swing'
  | 'dodge'
  | 'parry'
  /** Casting: held while the cast bar fills. */
  | 'cast'
  | 'hit'
  | 'crit'
  | 'knockdown'
  | 'dazed'
  | 'death'
  | 'finisher'
  | 'intro'
  | 'win';

/**
 * A move a fighter can be in: a core move, one of the kit's abilities (its own animation, or the one
 * held while casting or dashing), or a beat of the class fatality (the winner's `fatalityN`, the loser's `victimN`).
 */
export type MoveRef = MoveName | `ability${SlotIndex}` | `cast${SlotIndex}` | `fatality${number}` | `victim${number}`;

export type Wielding = WeaponKind | 'unarmed';

/** The weapon the fighter swings with: how often, how hard, and whether it shoots. */
export interface Weapon {
  wielding: Wielding;
  /** Frames between auto-attacks: 2.0 s one-hand and unarmed, 3.4 s two-hand, 3.0 s ranged. */
  speed: number;
  /** The average blow; each one rolls up to `spread` of it either side, as a weapon's damage range does. */
  damage: number;
  spread: number;
  /** Bows, guns, crossbows and thrown weapons: the auto-attack is a shot. */
  ranged: boolean;
  /** Reach of a swing, or of a shot. */
  range: number;
  /** An off-hand shield: blocks. */
  shield: boolean;
}

export interface MoveTable {
  moves: Record<MoveName, Move>;
  kit: Kit;
  weapon: Weapon;
  /** The class fatality's beats, resolved to the model's animations. */
  fatality: ResolvedFatality;
  /** False when the model has neither JumpStart nor Jump; the jump still happens, in the idle animation. */
  hasJump: boolean;
  /** The room the body takes in front of its feet, in yards (`bodyRadius`): how close it stands and how far its arms reach. */
  body: number;
}

const READY: Record<Wielding, string[]> = {
  unarmed: ['ReadyUnarmed'],
  oneHand: ['Ready1H'],
  twoHand: ['Ready2H'],
  long: ['Ready2HL', 'Ready2H'],
  bow: ['ReadyBow'],
  rifle: ['ReadyRifle'],
  crossbow: ['ReadyCrossbow', 'ReadyRifle'],
  thrown: ['ReadyThrown', 'Ready1H'],
};

const ATTACK: Record<Wielding, string[]> = {
  unarmed: ['AttackUnarmed'],
  oneHand: ['Attack1H'],
  twoHand: ['Attack2H'],
  long: ['Attack2HL', 'Attack2H'],
  bow: ['AttackBow'],
  rifle: ['AttackRifle'],
  crossbow: ['AttackCrossbow', 'AttackRifle'],
  thrown: ['AttackThrown', 'Attack1H'],
};

const PARRY: Record<Wielding, string[]> = {
  unarmed: ['ParryUnarmed'],
  oneHand: ['Parry1H'],
  twoHand: ['Parry2H'],
  long: ['Parry2HL', 'Parry2H'],
  bow: ['ParryUnarmed'],
  rifle: ['ParryUnarmed'],
  crossbow: ['ParryUnarmed'],
  thrown: ['Parry1H'],
};

/** Seconds between swings, by weapon: the game's 2.0 / 3.4 / 3.0, three quarters of them, so the ring keeps moving. */
const SPEED: Record<Wielding, number> = { unarmed: 1.5, oneHand: 1.5, twoHand: 2.4, long: 2.4, bow: 2.0, rifle: 2.0, crossbow: 2.0, thrown: 1.5 };
const DAMAGE: Record<Wielding, number> = { unarmed: 7, oneHand: 8, twoHand: 14, long: 14, bow: 9, rifle: 9, crossbow: 9, thrown: 7 };
/** How far a blow strays from the average, either way: a two-hander's range is the widest, a fist's the narrowest. */
const SPREAD: Record<Wielding, number> = { unarmed: 0.2, oneHand: 0.25, twoHand: 0.3, long: 0.3, bow: 0.2, rifle: 0.25, crossbow: 0.2, thrown: 0.2 };
const RANGED: ReadonlySet<Wielding> = new Set(['bow', 'rifle', 'crossbow', 'thrown']);

/** A swing reaches this far: two bodies and a little; fighters that look to be touching can hit. */
export const MELEE_RANGE = 2.6;
export const SHOT_RANGE = 8.0;

const ALL_READY = ['Ready1H', 'Ready2H', 'ReadyUnarmed', 'Ready2HL', 'ReadyBow', 'ReadyRifle', 'ReadyCrossbow', 'ReadyThrown'];
const ALL_ATTACK = ['Attack1H', 'Attack2H', 'Attack2HL', 'AttackUnarmed', 'AttackBow', 'AttackRifle', 'AttackCrossbow', 'AttackThrown'];
const ALL_PARRY = ['ShieldBlock', 'Parry1H', 'Parry2H', 'Parry2HL', 'ParryUnarmed', 'Dodge'];

export const SWING_HIT: HitWindow = { from: 0.2, to: 0.5, recover: 0.45 };

/** Candidates in order of preference, for a given weapon. `swing` collects all variations of the name it finds. */
function candidates(wielding: Wielding, shield: boolean): Record<MoveName, { names: string[]; loop: boolean; hit?: HitWindow }> {
  const uniq = (first: string[], rest: string[]) => [...new Set([...first, ...rest])];
  return {
    idle: { names: uniq(READY[wielding], ['Stand']), loop: true },
    // Fighters run at each other and backpedal away, as players do.
    walk: { names: ['Run', 'Walk'], loop: true },
    back: { names: ['Walkbackwards', 'RunBackwards', 'Walk'], loop: true },
    jumpStart: { names: ['JumpStart'], loop: false },
    jump: { names: ['Jump'], loop: true },
    jumpEnd: { names: ['JumpEnd', 'JumpLandRun'], loop: false },
    swing: { names: uniq(ATTACK[wielding], ['AttackUnarmed']), loop: false, hit: SWING_HIT },
    dodge: { names: ['Dodge', 'Walkbackwards'], loop: false },
    parry: { names: uniq(shield ? ['ShieldBlock'] : [], [...PARRY[wielding], 'Parry1H', 'Parry2H', 'ParryUnarmed', 'ShieldBlock', 'Dodge']), loop: false },
    cast: { names: ['ChannelCastDirected', 'ReadySpellDirected', 'ReadySpellOmni', 'SpellCastDirected'], loop: true },
    hit: { names: ['CombatWound', 'StandWound'], loop: false },
    crit: { names: ['CombatCritical', 'CombatWound'], loop: false },
    knockdown: { names: ['Knockdown', 'CombatCritical'], loop: false },
    dazed: { names: ['Stun', 'StandWound'], loop: true },
    death: { names: ['Death'], loop: false },
    finisher: { names: ['CombatExecute', 'CombatFinishingMove', 'Special2H', 'Special1H'], loop: false },
    intro: { names: ['BattleRoar', 'EmoteRoar', 'Stand'], loop: false },
    win: { names: ['EmoteCheer', 'EmoteRoar', 'BattleRoar'], loop: false },
  };
}

export const MOVE_NAMES: readonly MoveName[] = [
  'idle', 'walk', 'back', 'jumpStart', 'jump', 'jumpEnd', 'swing', 'dodge', 'parry', 'cast',
  'hit', 'crit', 'knockdown', 'dazed', 'death', 'finisher', 'intro', 'win',
];

/** Every model animation any move or ability may use, deduped: what select passes to `client.fighter()` so the worker pre-reads them. */
export const ALL_MOVE_NAMES: readonly string[] = [
  ...new Set([
    ...ALL_READY, 'Stand',
    'Walk', 'Run', 'Walkbackwards', 'RunBackwards',
    'JumpStart', 'Jump', 'JumpEnd', 'JumpLandRun',
    ...ALL_ATTACK,
    'SpellCastDirected', 'ReadySpellDirected', 'ChannelCastDirected', 'ReadySpellOmni',
    ...ALL_PARRY,
    'CombatWound', 'StandWound', 'CombatCritical', 'Knockdown', 'Stun', 'Death',
    'CombatExecute', 'CombatFinishingMove', 'Special2H', 'Special1H',
    'BattleRoar', 'EmoteRoar', 'EmoteCheer',
    ...ABILITY_ANIMATIONS,
    ...FATALITY_ANIMATIONS,
  ]),
];

/**
 * Picks a move table out of what a model animates: the first candidate the model has wins.
 * A move with no candidate borrows the idle animation (a jump still jumps, a dodge still dodges).
 * The kit and the fatality are the class's, or a warrior's (a hunter's behind a bow) when the class is unknown.
 * `body` is the room the body takes in front of its feet, a human's when not given.
 */
export function resolveMoves(animations: readonly AnimationInfo[], wielding: Wielding, classId?: number, shield = false, body = BODY / 2): MoveTable {
  const find = finderOf(animations);
  const spec = candidates(wielding, shield);
  const idleInfos = find(spec.idle.names) ?? (animations[0] ? [animations[0]] : undefined);
  const idleVariation: Variation = idleInfos?.[0]
    ? { sequence: idleInfos[0].sequence, duration: Math.max(1, idleInfos[0].duration) }
    : { sequence: 0, duration: 1000 };
  const idle: Move = { name: 'idle', animation: idleInfos?.[0]?.name ?? '', variations: [idleVariation], loop: true };

  const moves = {} as Record<MoveName, Move>;
  let hasJump = false;
  for (const name of MOVE_NAMES) {
    const c = spec[name];
    const move = name === 'idle' ? idle : moveFrom(find, name, c.names, c.loop, idle, name === 'swing');
    if (move.animation && (name === 'jumpStart' || name === 'jump')) hasJump = true;
    if (c.hit) move.hit = c.hit;
    moves[name] = move;
  }
  const ranged = RANGED.has(wielding);
  const kit = resolveKit(classId, wielding, find, idle);
  const weapon: Weapon = {
    wielding,
    speed: Math.round(SPEED[wielding] * 60),
    damage: DAMAGE[wielding] * kit.swing * kit.power,
    spread: SPREAD[wielding],
    ranged,
    range: ranged ? SHOT_RANGE : MELEE_RANGE,
    shield,
  };
  return { moves, kit, weapon, fatality: resolveFatality(classId, wielding, find, idle), hasJump, body };
}

/** The variation a fighter plays: `variation` cycles through the move's list. */
export function variationOf(move: Move, variation: number): Variation {
  const n = move.variations.length;
  return move.variations[((variation % n) + n) % n]!;
}
