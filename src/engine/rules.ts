import { GCD_FRAMES } from './abilities';
import type { HitWindow } from './anim';
import { SWING_HIT } from './moves';
import { BACK, WALK } from './stage';

/*
 * The two ways a fight can be fought. WARCRAFT is the game's: the auto-attack on the weapon's
 * swing timer, every blow rolled on the hit table, abilities on a global cooldown. KOMBAT is a
 * fighting game's: a swing goes the moment the key is pressed, three presses in rhythm are a
 * string, a blow that lands holds the victim in hitstun so the next one combos, holding back
 * blocks, a double tap dashes, and nothing is left to the dice. Every number that differs
 * between the two lives here; the engine reads them through `match.rules`.
 */

export type RulesName = 'warcraft' | 'kombat';

export const RULES_NAMES: readonly RulesName[] = ['warcraft', 'kombat'];

/** Is this a rule set's name? For a word that came over the wire or out of storage. */
export const isRulesName = (value: unknown): value is RulesName => typeof value === 'string' && (RULES_NAMES as readonly string[]).includes(value);

/** The chances of each outcome on the hit table, taken in turn from one draw. */
export interface HitTable {
  miss: number;
  dodge: number;
  /** Dodge chance added while Evasion is up. */
  evasion: number;
  parry: number;
  block: number;
  crit: number;
  spellMiss: number;
}

export interface Rules {
  /** For the HUD: WARCRAFT, KOMBAT. */
  word: string;
  /** Ground speed per frame: forwards, and backing away. */
  walk: number;
  back: number;
  /** The auto-attack waits on the weapon's swing timer and only goes when the target is in reach; without it a press swings at once. */
  swingTimer: boolean;
  /** How much faster than the model's clip a swing plays, and an ability. */
  swingRate: number;
  abilityRate: number;
  /** When a swing connects and when the fighter may act again, as fractions of its clip. */
  swingHit: HitWindow;
  /** Frames both fighters freeze when a swing lands. */
  swingHitstop: number;
  /** The string: each blow's damage as a share of the weapon's. One entry is no string at all. */
  chain: readonly number[];
  /** Frames after a swing in which a press still continues the string. */
  chainGrace: number;
  /** The string's last blow: pushback times this, and a knockdown. */
  chainEnd: { pushback: number; knockdown: boolean };
  /** Frames a landed blow keeps the victim from acting: a plain one, and the string's last or an ability's. 0 is none. */
  hitstun: { light: number; heavy: number };
  /** Holding back blocks: the share of the damage that still comes through and the frames of block stun; undefined for no blocking. */
  block: { chip: number; stun: number } | undefined;
  /** A fighter who is down can be hit again. */
  hitsDown: boolean;
  hitTable: HitTable;
  /** What a crit multiplies. */
  crit: { melee: number; spell: number };
  gcd: number;
  /** Cast times as a share of the kit's. */
  cast: number;
  /** Mana regeneration as a multiple of the kit's. */
  manaRegen: number;
  /** An ability pressed once a swing is active cuts the swing short. */
  cancel: boolean;
  /**
   * The double tap: a tap released and pressed again within `window` frames (the first press held at
   * most `tap` frames). Forward runs at `speed` for `frames`, cancellable into a swing after `cancel`;
   * back hops away and cannot be hit by melee for `invulnerable` frames. Undefined for none.
   */
  dash: { window: number; tap: number; speed: number; frames: number; cancel: number; backSpeed: number; backFrames: number; invulnerable: number } | undefined;
  /** A press in the air swings from the apex down; landing out of it costs `recover` frames. Undefined: the air is for jumping. */
  airAttack: { recover: number } | undefined;
}

export const RULES: Record<RulesName, Rules> = {
  warcraft: {
    word: 'WARCRAFT',
    walk: WALK,
    back: BACK,
    swingTimer: true,
    swingRate: 1.35,
    abilityRate: 1.35,
    swingHit: SWING_HIT,
    swingHitstop: 8,
    chain: [1],
    chainGrace: 0,
    chainEnd: { pushback: 1, knockdown: false },
    hitstun: { light: 0, heavy: 0 },
    block: undefined,
    hitsDown: true,
    // Parry only from the front, block only with a shield, none of them against a helpless target.
    hitTable: { miss: 0.05, dodge: 0.06, evasion: 0.5, parry: 0.06, block: 0.1, crit: 0.15, spellMiss: 0.03 },
    // A melee crit doubles; a spell crit is half again, as in the game.
    crit: { melee: 2, spell: 1.5 },
    gcd: GCD_FRAMES,
    cast: 1,
    manaRegen: 1,
    cancel: false,
    dash: undefined,
    airAttack: undefined,
  },
  kombat: {
    word: 'KOMBAT',
    walk: 0.1,
    back: 0.07,
    swingTimer: false,
    swingRate: 1.6,
    abilityRate: 1.35,
    swingHit: { from: 0.15, to: 0.45, recover: 0.5 },
    swingHitstop: 4,
    // 8 / 8 / 12 with a one-hander, the others in proportion.
    chain: [1, 1, 1.5],
    chainGrace: 10,
    chainEnd: { pushback: 2, knockdown: true },
    hitstun: { light: 14, heavy: 24 },
    block: { chip: 0.2, stun: 8 },
    hitsDown: false,
    // Nothing to chance but a crit; blocking is the player's, and Evasion still dodges.
    hitTable: { miss: 0, dodge: 0, evasion: 0.5, parry: 0, block: 0, crit: 0.1, spellMiss: 0 },
    crit: { melee: 1.5, spell: 1.5 },
    gcd: 30,
    cast: 0.5,
    manaRegen: 2,
    cancel: true,
    dash: { window: 10, tap: 12, speed: 0.28, frames: 10, cancel: 4, backSpeed: 0.22, backFrames: 10, invulnerable: 6 },
    airAttack: { recover: 6 },
  },
};
