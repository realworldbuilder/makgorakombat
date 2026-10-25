import { type Finder, type Move, moveFrom } from './anim';
import type { Wielding } from './moves';

/*
 * The class kits: three abilities per class, each with a cost in the class's resource, a cooldown,
 * a cast time, a reach and what it does, resolved to the model's own animations. Frames are at
 * 60 Hz; a cooldown of 90 is 1.5 s. Everything a class can do in the ring is in this file.
 */

export type ResourceKind = 'rage' | 'energy' | 'mana' | 'focus' | 'runic' | 'fury';

/** How an ability reaches its target. */
export type AbilityKind =
  /** Swings at the target in front, within `range`. */
  | 'melee'
  /** Hits the target anywhere within `range` the moment it fires; a bolt of light, a thrown hammer. */
  | 'spell'
  /** Fires a projectile at the target; dodged by jumping. */
  | 'bolt'
  /** Affects the caster only. */
  | 'self'
  /** Dashes at the target and lands on arrival. */
  | 'charge'
  /** Dashes a fixed distance forward, hitting whoever is there at the end. */
  | 'rush'
  /** Teleports away from the target. */
  | 'blink'
  /** Leaps backwards. */
  | 'leap';

export interface Dot {
  damage: number;
  ticks: number;
}

export interface Ability {
  id: string;
  name: string;
  /** For the action bar's slot; up to about ten letters. */
  short: string;
  kind: AbilityKind;
  cost: number;
  /** Frames before it can be used again; 0 is only the global cooldown. */
  cooldown: number;
  /** Starts the 1.5 s global cooldown. */
  gcd: boolean;
  /** Frames the cast bar fills before it fires; 0 is instant. */
  cast: number;
  range: number;
  minRange: number;
  /** The average blow; each one rolls up to `spread` of it either side. A damage-over-time tick does not stray. */
  damage: number;
  spread: number;
  /** Hits on both sides of the fighter, not only ahead. */
  both: boolean;
  /** Frames the target is stunned. */
  stun: number;
  /** Frames the target walks at half speed. */
  slow: number;
  /** Frames the target flees. */
  fear: number;
  dot: Dot | undefined;
  /** Healing on the caster. */
  heal: number;
  /** Damage the caster absorbs before taking any. */
  absorb: number;
  /** Frames the caster's dodge chance is raised. */
  evasion: number;
  /** Cancels the target's cast and locks their casting for a while. */
  interrupt: boolean;
  /** Only usable while the target is under 20 % health. */
  execute: boolean;
  /** Resource gained when it lands (rage from Charge, runic power from a rune strike). */
  gain: number;
  /** Candidate animations for the ability itself (the swing, the release of a cast, the dash). */
  anims: readonly string[];
  /** For a cast or a charge: the animation held while the bar fills or the dash runs. */
  holdAnims: readonly string[] | undefined;
}

export interface ResolvedAbility extends Ability {
  move: Move;
  /** Looping move held during a cast or a dash. */
  hold: Move;
}

export interface Kit {
  /** 'warrior', 'mage' ... as the game's interface atlas names them; 'champion' for a legend without a class. */
  classKey: string;
  className: string;
  resource: ResourceKind;
  /** Rage, fury and runic power start empty and build in combat; the rest start full and regenerate. */
  starts: number;
  /** Per frame. */
  regen: number;
  /** The class's PvP damage modifier, already in the abilities' numbers; the weapon's swing takes it too. */
  power: number;
  /** How much of its weapon's damage the class's swing lands (`WEAPON_SKILL`). */
  swing: number;
  abilities: [ResolvedAbility, ResolvedAbility, ResolvedAbility];
}

/** Abilities on the bar: the auto-attack and three abilities keep a class simple to play. */
export const ABILITY_SLOTS = 3;
export type SlotIndex = 0 | 1 | 2;

export const MAX_RESOURCE = 100;
/** The global cooldown: 1.0 s, a beat quicker than the game's 1.5 so a fight reads as a fight. */
export const GCD_FRAMES = 60;
/** A damage-over-time effect ticks every 3 s. */
export const DOT_TICK_FRAMES = 180;
/** Below this share of health Execute and Kill Shot work. */
export const EXECUTE_BELOW = 0.2;
/** A target in melee reach for an ability. */
export const ABILITY_MELEE_RANGE = 2.3;

const S = 60;

const DEFAULTS: Omit<Ability, 'id' | 'name' | 'short' | 'kind' | 'anims'> = {
  cost: 0, cooldown: 0, gcd: true, cast: 0, range: ABILITY_MELEE_RANGE, minRange: 0, damage: 0, spread: 0.15, both: false,
  stun: 0, slow: 0, fear: 0, dot: undefined, heal: 0, absorb: 0, evasion: 0, interrupt: false, execute: false, gain: 0, holdAnims: undefined,
};

type Spec = Pick<Ability, 'id' | 'name' | 'short' | 'kind' | 'anims'> & Partial<Ability>;

function ability(spec: Spec): Ability {
  const out: Ability = { ...DEFAULTS, ...spec };
  if (spec.range === undefined) {
    if (spec.kind === 'bolt' || spec.kind === 'spell') out.range = 8;
    if (spec.kind === 'charge') out.range = 9;
  }
  // A spell's damage range is narrower than a weapon's: Frostbolt is 515 to 555, a sword 70 to 131.
  if (spec.spread === undefined && (spec.kind === 'bolt' || spec.kind === 'spell')) out.spread = 0.08;
  if (spec.kind === 'charge' && spec.minRange === undefined) out.minRange = 2.5;
  return out;
}

/** Held while the cast bar fills: the channel pose moves the arms, so a caster is seen to be casting. */
const CAST_HOLD = ['ChannelCastDirected', 'ReadySpellDirected', 'ReadySpellOmni', 'SpellCastDirected'];
const SPELL = ['SpellCastDirected', 'ReadySpellDirected'];
const OMNI = ['SpellCastOmni', 'SpellCastDirected'];
const STRIKE_1H = ['CombatAbility1H01', 'CombatAbility1H02', 'Special1H', 'Attack1H', 'AttackUnarmed'];
const STRIKE_2H = ['CombatAbility2H01', 'CombatAbility2H02', 'CombatAbility2H03', 'Special2H', 'Attack2H', 'CombatAbility1H01'];
const BIG_2H = ['CombatAbility2HBig01', 'CombatAbility2HBig02', 'CombatAbility2H01', 'Special2H', 'CombatAbility1H01', 'Special1H'];
const SPIN = ['CombatWhirlwind', 'Whirlwind', 'CombatBladeStorm', 'SpinningKick', 'SpecialUnarmed', 'Special1H'];
const KICK = ['Kick', 'RoundHouseKick', 'CombatAbility1H02', 'SpecialUnarmed'];
const EXECUTE = ['CombatExecute', 'CombatFinishingMove', 'Special2H', 'Special1H'];

/** The kit of each class by WoW class id, with a weapon-appropriate strike where the class wields either. */
function classKits(twoHand: boolean): Record<number, { key: string; name: string; resource: ResourceKind; abilities: Ability[] }> {
  const strike = twoHand ? STRIKE_2H : STRIKE_1H;
  return {
    1: {
      key: 'warrior', name: 'WARRIOR', resource: 'rage',
      abilities: [
        ability({ id: 'charge', name: 'Charge', short: 'CHARGE', kind: 'charge', cooldown: 15 * S, damage: 5, stun: 60, gain: 20, anims: ['CombatChargeEnd', ...strike], holdAnims: ['CombatChargeLoop', 'Sprint', 'Run', 'Walk'] }),
        ability({ id: 'mortalStrike', name: 'Mortal Strike', short: 'MORTAL', kind: 'melee', cost: 30, cooldown: 6 * S, damage: 18, anims: BIG_2H }),
        ability({ id: 'execute', name: 'Execute', short: 'EXECUTE', kind: 'melee', cost: 15, damage: 30, execute: true, anims: EXECUTE }),
      ],
    },
    2: {
      key: 'paladin', name: 'PALADIN', resource: 'mana',
      abilities: [
        ability({ id: 'crusaderStrike', name: 'Crusader Strike', short: 'CRUSADER', kind: 'melee', cost: 15, cooldown: 4.5 * S, damage: 14, anims: strike }),
        ability({ id: 'hammerOfJustice', name: 'Hammer of Justice', short: 'HAMMER', kind: 'spell', cost: 15, cooldown: 20 * S, range: 3.5, damage: 4, stun: 120, anims: ['PalSpellCast1HUp', ...SPELL] }),
        ability({ id: 'holyLight', name: 'Holy Light', short: 'HOLY LIGHT', kind: 'self', cost: 30, cast: 2 * S, heal: 35, anims: OMNI, holdAnims: ['PalSpellCast1HUp', ...CAST_HOLD] }),
      ],
    },
    3: {
      key: 'hunter', name: 'HUNTER', resource: 'focus',
      abilities: [
        ability({ id: 'aimedShot', name: 'Aimed Shot', short: 'AIMED', kind: 'bolt', cost: 35, cast: 1.5 * S, damage: 24, anims: ['AttackBow', 'AttackRifle', 'AttackCrossbow', 'AttackThrown', ...SPELL], holdAnims: ['ReadyBow', 'ReadyRifle', 'ReadyCrossbow', ...CAST_HOLD] }),
        ability({ id: 'disengage', name: 'Disengage', short: 'DISENGAGE', kind: 'leap', cooldown: 15 * S, gcd: false, anims: ['JumpStart', 'Jump', 'Dodge'] }),
        ability({ id: 'killShot', name: 'Kill Shot', short: 'KILL SHOT', kind: 'bolt', cost: 10, damage: 30, execute: true, anims: ['AttackBow', 'AttackRifle', 'AttackCrossbow', 'AttackThrown', ...SPELL] }),
      ],
    },
    4: {
      key: 'rogue', name: 'ROGUE', resource: 'energy',
      abilities: [
        ability({ id: 'sinisterStrike', name: 'Sinister Strike', short: 'SINISTER', kind: 'melee', cost: 40, damage: 12, anims: STRIKE_1H }),
        ability({ id: 'kidneyShot', name: 'Kidney Shot', short: 'KIDNEY', kind: 'melee', cost: 25, cooldown: 20 * S, damage: 6, stun: 120, anims: KICK }),
        ability({ id: 'evasion', name: 'Evasion', short: 'EVASION', kind: 'self', cooldown: 30 * S, gcd: false, evasion: 8 * S, anims: ['Dodge', 'Roll', 'ParryUnarmed'] }),
      ],
    },
    5: {
      key: 'priest', name: 'PRIEST', resource: 'mana',
      abilities: [
        ability({ id: 'mindBlast', name: 'Mind Blast', short: 'MIND BLAST', kind: 'spell', cost: 25, cooldown: 4 * S, cast: 1 * S, damage: 22, anims: ['PriSpellCastBothUp', ...SPELL], holdAnims: CAST_HOLD }),
        ability({ id: 'shadowWordPain', name: 'Shadow Word: Pain', short: 'SW: PAIN', kind: 'spell', cost: 20, dot: { damage: 7, ticks: 5 }, anims: SPELL }),
        ability({ id: 'powerWordShield', name: 'Power Word: Shield', short: 'PW: SHIELD', kind: 'self', cost: 25, cooldown: 10 * S, absorb: 25, anims: ['PriSpellCastBothUp', ...OMNI] }),
      ],
    },
    6: {
      key: 'deathknight', name: 'DEATH KNIGHT', resource: 'runic',
      abilities: [
        ability({ id: 'icyTouch', name: 'Icy Touch', short: 'ICY TOUCH', kind: 'spell', cooldown: 6 * S, range: 4, damage: 10, slow: 3 * S, gain: 15, anims: SPELL }),
        ability({ id: 'deathStrike', name: 'Death Strike', short: 'DEATH STR', kind: 'melee', cooldown: 6 * S, damage: 16, heal: 10, gain: 15, anims: ['DeathStrike', ...STRIKE_2H] }),
        ability({ id: 'deathCoil', name: 'Death Coil', short: 'DEATH COIL', kind: 'bolt', cost: 40, range: 6, damage: 16, anims: ['LocSpellCastBothFront', ...SPELL] }),
      ],
    },
    7: {
      key: 'shaman', name: 'SHAMAN', resource: 'mana',
      abilities: [
        ability({ id: 'lightningBolt', name: 'Lightning Bolt', short: 'LIGHTNING', kind: 'bolt', cost: 15, cast: 1.5 * S, damage: 19, anims: ['ShaSpellCastBothFront', ...SPELL], holdAnims: CAST_HOLD }),
        ability({ id: 'earthShock', name: 'Earth Shock', short: 'EARTH SHK', kind: 'spell', cost: 20, cooldown: 6 * S, range: 5, damage: 10, interrupt: true, anims: ['ShaSpellCastBothFront', ...SPELL] }),
        ability({ id: 'stormstrike', name: 'Stormstrike', short: 'STORMSTR', kind: 'melee', cost: 20, cooldown: 8 * S, damage: 16, anims: ['Stormstrike', ...strike] }),
      ],
    },
    8: {
      key: 'mage', name: 'MAGE', resource: 'mana',
      abilities: [
        ability({ id: 'frostbolt', name: 'Frostbolt', short: 'FROSTBOLT', kind: 'bolt', cost: 20, cast: 1.5 * S, damage: 22, slow: 4 * S, anims: ['MagSpellCastBothFront', ...SPELL], holdAnims: CAST_HOLD }),
        ability({ id: 'fireBlast', name: 'Fire Blast', short: 'FIRE BLAST', kind: 'spell', cost: 25, cooldown: 8 * S, range: 6, damage: 15, anims: ['MagSpellCastBothFront', ...SPELL] }),
        ability({ id: 'blink', name: 'Blink', short: 'BLINK', kind: 'blink', cost: 15, cooldown: 15 * S, anims: OMNI }),
      ],
    },
    9: {
      key: 'warlock', name: 'WARLOCK', resource: 'mana',
      abilities: [
        ability({ id: 'shadowBolt', name: 'Shadow Bolt', short: 'SHADOW BLT', kind: 'bolt', cost: 20, cast: 1.5 * S, damage: 27, anims: ['LocSpellCastBothFront', ...SPELL], holdAnims: CAST_HOLD }),
        ability({ id: 'corruption', name: 'Corruption', short: 'CORRUPTION', kind: 'spell', cost: 20, dot: { damage: 8, ticks: 5 }, anims: SPELL }),
        ability({ id: 'fear', name: 'Fear', short: 'FEAR', kind: 'spell', cost: 20, cooldown: 20 * S, cast: 1 * S, range: 6, fear: 150, anims: ['LocSpellCastBothFront', ...OMNI], holdAnims: CAST_HOLD }),
      ],
    },
    10: {
      key: 'monk', name: 'MONK', resource: 'energy',
      abilities: [
        ability({ id: 'tigerPalm', name: 'Tiger Palm', short: 'TIGER PALM', kind: 'melee', cost: 35, damage: 10, anims: ['CombatUnarmed01', 'AttackUnarmed', 'SpecialUnarmed', ...STRIKE_1H] }),
        ability({ id: 'risingSunKick', name: 'Rising Sun Kick', short: 'RISING SUN', kind: 'melee', cost: 30, cooldown: 8 * S, damage: 18, anims: ['RisingSunKick', 'FlyingKick', 'RoundHouseKick', 'Kick', ...STRIKE_1H] }),
        ability({ id: 'legSweep', name: 'Leg Sweep', short: 'LEG SWEEP', kind: 'melee', cost: 25, cooldown: 20 * S, damage: 6, stun: 120, anims: KICK }),
      ],
    },
    11: {
      key: 'druid', name: 'DRUID', resource: 'mana',
      abilities: [
        ability({ id: 'wrath', name: 'Wrath', short: 'WRATH', kind: 'bolt', cost: 15, cast: 1.5 * S, damage: 17, anims: SPELL, holdAnims: ['DruReadySpellCast', ...CAST_HOLD] }),
        ability({ id: 'moonfire', name: 'Moonfire', short: 'MOONFIRE', kind: 'spell', cost: 20, damage: 8, dot: { damage: 4, ticks: 4 }, anims: OMNI }),
        ability({ id: 'rake', name: 'Rake', short: 'RAKE', kind: 'melee', cost: 25, damage: 8, dot: { damage: 4, ticks: 3 }, anims: ['SpecialUnarmed', 'AttackUnarmed', ...STRIKE_1H] }),
      ],
    },
    12: {
      key: 'demonhunter', name: 'DEMON HUNTER', resource: 'fury',
      abilities: [
        ability({ id: 'chaosStrike', name: 'Chaos Strike', short: 'CHAOS STR', kind: 'melee', cost: 30, damage: 20, anims: ['CombatAbilityGlv01', 'CombatAbilityDualWield01', ...STRIKE_1H] }),
        ability({ id: 'felRush', name: 'Fel Rush', short: 'FEL RUSH', kind: 'rush', cooldown: 10 * S, range: 4, damage: 10, gain: 20, anims: ['FelRushEnd', ...STRIKE_1H], holdAnims: ['FelRushLoop', 'DHCombatSprint', 'Sprint', 'Run', 'Walk'] }),
        ability({ id: 'bladeDance', name: 'Blade Dance', short: 'BLADE DNC', kind: 'melee', cost: 30, cooldown: 9 * S, damage: 16, both: true, anims: ['DHBladeDance1', ...SPIN] }),
      ],
    },
    13: {
      key: 'evoker', name: 'EVOKER', resource: 'mana',
      abilities: [
        ability({ id: 'livingFlame', name: 'Living Flame', short: 'LIVING FLM', kind: 'bolt', cost: 15, cast: 1.5 * S, damage: 19, anims: SPELL, holdAnims: CAST_HOLD }),
        ability({ id: 'fireBreath', name: 'Fire Breath', short: 'FIRE BRTH', kind: 'spell', cost: 25, cooldown: 12 * S, range: 3.5, damage: 16, dot: { damage: 3, ticks: 3 }, anims: ['ChannelCastDirected', ...SPELL] }),
        ability({ id: 'hover', name: 'Hover', short: 'HOVER', kind: 'leap', cooldown: 15 * S, gcd: false, anims: ['JumpStart', 'Jump', 'Dodge'] }),
      ],
    },
  };
}

/**
 * Each class's PvP damage modifier: everything it deals, swings and spells alike, is scaled by it,
 * the way the game tunes specs against each other in PvP without changing what their spells do.
 * The kits keep their character (a mage's slow big bolts, a rogue's quick light strikes, a priest's
 * damage over time); these even out how hard each hits overall. They come from playing every class
 * against every other, the computer on both sides: BALANCE=1 pnpm test prints the table.
 */
export const PVP_DAMAGE: Record<string, number> = {
  warrior: 0.9, paladin: 0.85, hunter: 0.85, rogue: 0.8, priest: 1.4, deathknight: 0.85, shaman: 1.1,
  mage: 1.1, warlock: 1.15, monk: 0.8, druid: 1.15, demonhunter: 1.05, evoker: 1.2,
};

/**
 * How much of a weapon's damage a class's swing lands: all of it for the fighters, a little over half
 * for a mage or a priest, whose strength is in their spells, as a caster's white hits are in the game.
 */
export const WEAPON_SKILL: Record<string, number> = {
  warrior: 1, paladin: 1, hunter: 1, rogue: 1, priest: 0.8, deathknight: 1, shaman: 0.85,
  mage: 0.6, warlock: 0.6, monk: 1, druid: 0.75, demonhunter: 1, evoker: 0.7,
};

/** An ability with the class's modifier in its damage; a tick of damage over time stays a whole number. */
function tuned(a: Ability, power: number): Ability {
  if (power === 1) return a;
  return { ...a, damage: a.damage * power, dot: a.dot ? { ...a.dot, damage: Math.max(1, Math.round(a.dot.damage * power)) } : undefined };
}

/** Rage, fury and runic power start at nothing; the rest start full. Regeneration per frame. */
const RESOURCES: Record<ResourceKind, { starts: number; regen: number }> = {
  rage: { starts: 0, regen: 0 },
  fury: { starts: 0, regen: 0 },
  runic: { starts: 0, regen: 0 },
  energy: { starts: MAX_RESOURCE, regen: 10 / 60 },
  focus: { starts: MAX_RESOURCE, regen: 5 / 60 },
  mana: { starts: MAX_RESOURCE, regen: 4 / 60 },
};

export const RESOURCE_COLOURS: Record<ResourceKind, string> = {
  rage: '#c41f3b',
  energy: '#fff569',
  mana: '#2f7df6',
  focus: '#ff8040',
  runic: '#00d1ff',
  fury: '#c84bf0',
};

export const RESOURCE_NAMES: Record<ResourceKind, string> = {
  rage: 'RAGE', energy: 'ENERGY', mana: 'MANA', focus: 'FOCUS', runic: 'RUNIC POWER', fury: 'FURY',
};

/** Every animation any ability may ask for. */
export const ABILITY_ANIMATIONS: readonly string[] = [
  ...new Set([...Object.values(classKits(false)), ...Object.values(classKits(true))].flatMap((kit) => kit.abilities.flatMap((a) => [...a.anims, ...(a.holdAnims ?? [])]))),
];

/** The class a fighter without one plays as: a hunter behind a bow, a gun or a crossbow, else a warrior. */
export function classFor(classId: number | undefined, wielding: Wielding): number {
  if (classId !== undefined && classKits(false)[classId]) return classId;
  return wielding === 'bow' || wielding === 'rifle' || wielding === 'crossbow' ? 3 : 1;
}

/** The abilities and resource a class plays with, before any model is involved: for a guide or a roster screen. */
export function kitSpec(classId: number | undefined, wielding: Wielding = 'oneHand'): { classKey: string; className: string; resource: ResourceKind; abilities: readonly Ability[] } {
  const twoHand = wielding === 'twoHand' || wielding === 'long';
  const spec = classKits(twoHand)[classFor(classId, wielding)]!;
  const legend = classId === undefined || !classKits(false)[classId];
  const power = PVP_DAMAGE[spec.key] ?? 1;
  return { classKey: legend ? 'champion' : spec.key, className: legend ? 'CHAMPION' : spec.name, resource: spec.resource, abilities: spec.abilities.map((a) => tuned(a, power)) };
}

/** The kit a class plays with, resolved to the animations the model has; `idle` fills in for a missing one. */
export function resolveKit(classId: number | undefined, wielding: Wielding, find: Finder, idle: Move): Kit {
  const twoHand = wielding === 'twoHand' || wielding === 'long';
  const id = classFor(classId, wielding);
  const spec = classKits(twoHand)[id]!;
  const legend = classId === undefined || !classKits(false)[classId];
  const resource = RESOURCES[spec.resource];
  const power = PVP_DAMAGE[spec.key] ?? 1;
  const abilities = spec.abilities.map((spec) => {
    const a = tuned(spec, power);
    const move = moveFrom(find, a.id, a.anims, false, idle);
    const hold = a.holdAnims ? moveFrom(find, `${a.id}Hold`, a.holdAnims, true, idle) : { ...move, name: `${a.id}Hold`, loop: true };
    return { ...a, move, hold };
  }) as Kit['abilities'];
  return {
    classKey: legend ? 'champion' : spec.key,
    className: legend ? 'CHAMPION' : spec.name,
    resource: spec.resource,
    starts: resource.starts,
    regen: resource.regen,
    power,
    swing: WEAPON_SKILL[spec.key] ?? 1,
    abilities,
  };
}

/** The least and most a blow of average `damage` can roll, before a crit or a block. */
export function damageRange(damage: number, spread: number): [number, number] {
  return [Math.max(1, Math.round(damage * (1 - spread))), Math.max(1, Math.round(damage * (1 + spread)))];
}

/** The name the HUD shows for a kit's resource. */
export function resourceLabel(kit: Kit): string {
  return RESOURCE_NAMES[kit.resource];
}
