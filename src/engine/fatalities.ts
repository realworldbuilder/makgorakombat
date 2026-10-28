import { classFor } from './abilities';
import { type Finder, type Move, moveFrom } from './anim';
import type { Wielding } from './moves';
import { TICK_MS } from './stage';

/*
 * The fatalities: one per class, done to the dazed loser under FINISH THE MAK'GORA! when the
 * winner enters the class's key sequence in time. Each is a short scripted scene in beats: for
 * the winner an animation from the model (the first of the candidates it has), fitted to the
 * beat's frames or looped through them, with a dash, a leap or a step behind the target; for
 * the loser a stun, a flinch, a knockdown or the death, timed to the blow; for the HUD an
 * effect in the class's colour (lightning, frost, shadow, fel, blood, moonlight, light, arrows,
 * fire), a flash and a camera shake; and the time scale the beat runs at. Everything is counted
 * in engine ticks, so the same sequence always plays the same scene.
 *
 * A beat's blow lands on a tick of the beat, and the winner's clip is played so that its own
 * blow (the moment the weapon is furthest out, measured on the player models and kept in CONTACT)
 * falls on that tick: the wind-up is timed to it, the follow-through fills what is left of the
 * beat, slowed where the beat is slow. The clip's own length never decides when the blow lands,
 * so an execute's blade comes down as the flash, the spark and the cry do, on any model.
 */

/** A key of the sequence: a direction relative to the way the winner faces, the attack key, or an ability key. */
export type SequenceToken = 'back' | 'forward' | 'attack' | 'ability1' | 'ability2' | 'ability3';

export type FatalityEffect = 'shockwave' | 'lightning' | 'frost' | 'shatter' | 'shadow' | 'fel' | 'blood' | 'moon' | 'light' | 'arrows' | 'fire';

/** How the winner moves during a beat: runs at the target, leaps onto them, hops away, steps behind them, or drags them in. */
export type Motion = 'dash' | 'leap' | 'retreat' | 'behind' | 'pull';

/** What the loser is doing: still dazed (or cowering, kneeling), flinching, knocked down, dead. */
export type VictimState = 'dazed' | 'hit' | 'knockdown' | 'death';

export interface Victim {
  anims: readonly string[];
  state: VictimState;
  /** The clip goes round (a cower, a stun); otherwise it holds its last frame. */
  loop?: boolean;
}

export interface Beat {
  /** Ticks the beat lasts. */
  frames: number;
  /** The winner's animation, the first of these the model has; idle when it has none. */
  winner: readonly string[];
  /** Wrap the winner's animation across the beat (a run, a channel) at its own pace; otherwise it is fitted to the beat. */
  loop?: boolean;
  /** A looping clip with repeated blows goes round once per `repeat` ticks, so each turn of a spin or each draw of a bow is a blow. */
  cycle?: boolean;
  /** Where the winner's own blow is in their clip, as a fraction of it, when CONTACT does not know the clip. */
  blowAt?: number;
  /** What the loser does: from the blow when the beat has one, else from the beat's start. */
  loser?: Victim;
  motion?: Motion;
  effect?: FatalityEffect;
  /** A screen flash at the blow (or the beat's start). */
  flash?: boolean;
  /** A blow lands on the loser: the spark's kind. */
  impact?: 'hit' | 'crit' | 'spell';
  /** When in the beat the blow lands, as a fraction of its frames; 0.3 by default. */
  impactAt?: number;
  /** Ticks between further blows after the first (a volley, a channel's ticks). */
  repeat?: number;
  /** Speed the loser is thrown away from the winner at the blow. */
  recoil?: number;
  /** Time scale during the beat; 1 by default. */
  slowmo?: number;
  /** Camera shake at the blow, in the page's pan units. */
  shake?: number;
}

export interface Fatality {
  /** The class key: 'warrior', 'mage'... */
  id: string;
  name: string;
  sequence: readonly SequenceToken[];
  /** 'r, g, b' for the HUD. */
  colour: string;
  beats: readonly Beat[];
  /** How far the camera pushes in on the pair: 1.3 is a third closer. */
  push: number;
}

export interface ResolvedFatality {
  spec: Fatality;
  /** The winner's move for each beat. */
  winner: Move[];
  /** Where the blow is in each beat's clip, as a fraction of it: the clip is played so this falls on the beat's impact tick. */
  blow: number[];
  /**
   * This model's part as the loser of every class's fatality, by fatality id: its move for each
   * beat, undefined where the beat leaves them as they are. The winner's class picks the fatality.
   */
  victim: Readonly<Record<string, (Move | undefined)[]>>;
}

/** Each key of the sequence must follow the one before within 1.5 s. */
export const STEP_FRAMES = 90;
/** A wrong key locks the sequence for half a second. */
export const PENALTY_FRAMES = 30;

const FLINCH: Victim = { anims: ['CombatCritical', 'CombatWound', 'StandWound'], state: 'hit' };
const WOUND: Victim = { anims: ['CombatWound', 'StandWound', 'CombatCritical'], state: 'hit' };
const DOWN: Victim = { anims: ['Knockdown', 'CombatCritical', 'CombatWound'], state: 'knockdown' };
const COWER: Victim = { anims: ['Cower', 'Stun', 'StandWound'], state: 'dazed', loop: true };
const STUNNED: Victim = { anims: ['Stun', 'StandWound'], state: 'dazed', loop: true };
const KNEEL: Victim = { anims: ['KneelStart', 'EmoteKneel', 'EmoteBeg', 'Cower', 'Stun'], state: 'dazed' };
const DIE: Victim = { anims: ['Death'], state: 'death' };

const RUN = ['CombatChargeLoop', 'Sprint', 'Run', 'Walk'];
const EXECUTE = ['CombatExecute', 'CombatFinishingMove', 'Special2H', 'Special1H', 'Attack2H', 'Attack1H'];
const CHANNEL = ['ChannelCastOmni', 'ChannelCastDirected', 'ReadySpellOmni', 'ReadySpellDirected'];
const SHOOT = ['AttackBow', 'AttackRifle', 'AttackCrossbow', 'AttackThrown', 'SpellCastDirected'];

/**
 * Where the blow is in the clips the winners strike with, as a fraction of the clip: the moment
 * the weapon (or the fist) is furthest out in front, measured on the player models with
 * game/strike.ts (the same on every race to a few percent; the kicks and the casts, which it
 * cannot measure, are judged by eye). A clip not here strikes at BLOW_AT.
 */
const CONTACT: Readonly<Record<string, number>> = {
  CombatExecute: 0.40, CombatFinishingMove: 0.31, CombatEviscerate: 0.15, CombatMutilate: 0.71, Mutilate: 0.55,
  CombatAbility1H01: 0.26, CombatAbility1H02: 0.42, CombatAbility2H01: 0.23, CombatAbility2HBig01: 0.47, CombatAbilityDualWield01: 0.67,
  CombatShieldBash: 0.29, ShieldBash: 0.45, Special1H: 0.48, Special2H: 0.50, Attack1H: 0.50, Attack2H: 0.48, AttackUnarmed: 0.45, SpecialUnarmed: 0.5,
  DeathStrike: 0.45, Stormstrike: 0.60, PalmStrike: 0.44, RoundHouseKick: 0.38, FlyingKickEnd: 0.25, SpinningKick: 0.5, Kick: 0.45,
  CombatBladeStorm: 0.5, CombatWhirlwind: 0.58, Whirlwind: 0.45, DHBladeDance1: 0.5,
  AttackBow: 0.6, AttackRifle: 0.8, AttackCrossbow: 0.8, AttackThrown: 0.4,
  SpellCastOmni: 0.5, SpellCastDirected: 0.5, PriSpellCastBothUp: 0.5, MagSpellCastBothFront: 0.5, MagSpellCastBothUp: 0.5,
  ShaSpellCastBothFront: 0.5, ShaSpellCastBothUp: 0.5, LocSpellCastBothUp: 0.5, LocSpellCastBothFront: 0.5, DruSpellCastBothFront: 0.5,
};
/** Where a blow is taken to be in a clip CONTACT does not know. */
const BLOW_AT = 0.45;

/** How a fitted clip's pace is held: the wind-up never slower than half its own (the clip starts late instead), the follow-through within these, the whole of a clip with no blow within these. */
const PACE = { windUp: 0.5, after: [0.3, 2] as const, whole: [0.4, 2.5] as const };

/** The fatality of each class by WoW class id. Sequences start with a direction, so a plain ability press in the finish still fires as before. */
const FATALITIES: Record<number, Fatality> = {
  // The frames and impact ticks below are set to the player models' clips (the execute's 866 ms
  // with its blade down at 40%, say) so the wind-ups run at about their own pace and the death
  // blows' follow-through at the beat's slow motion; another model's clip is fitted the same way.
  1: {
    id: 'warrior', name: 'Bladestorm', sequence: ['back', 'forward', 'back', 'ability2'], colour: '225, 35, 35', push: 1.3,
    beats: [
      { frames: 40, winner: RUN, loop: true, motion: 'dash' },
      { frames: 90, winner: ['CombatBladeStorm', 'CombatWhirlwind', 'Whirlwind', 'Special2H', 'Special1H'], loop: true, cycle: true, effect: 'blood', impact: 'crit', impactAt: 0.2, repeat: 30, loser: FLINCH, shake: 0.05, slowmo: 0.6 },
      { frames: 50, winner: ['BattleRoar', 'EmoteRoar', 'Stand'], loser: KNEEL },
      { frames: 100, winner: EXECUTE, impact: 'crit', impactAt: 0.21, flash: true, effect: 'blood', loser: DIE, slowmo: 0.4, shake: 0.08 },
    ],
  },
  2: {
    id: 'paladin', name: 'Hammer of Wrath', sequence: ['forward', 'forward', 'ability2', 'attack'], colour: '255, 215, 90', push: 1.3,
    beats: [
      { frames: 45, winner: ['PalSpellCast1HUp', 'SpellCastOmni', 'ReadySpellOmni'], effect: 'light', loser: COWER },
      { frames: 30, winner: RUN, loop: true, motion: 'dash' },
      { frames: 70, winner: ['CombatAbility2HBig01', 'Special2H', 'CombatShieldBash', 'ShieldBash', 'Special1H'], impact: 'crit', impactAt: 0.36, flash: true, effect: 'shockwave', loser: DOWN, shake: 0.07, slowmo: 0.5 },
      { frames: 100, winner: EXECUTE, impact: 'crit', impactAt: 0.21, flash: true, effect: 'light', loser: DIE, slowmo: 0.4, shake: 0.08 },
    ],
  },
  3: {
    id: 'hunter', name: 'Rapid Fire', sequence: ['back', 'back', 'ability1', 'attack'], colour: '255, 200, 120', push: 1.15,
    beats: [
      { frames: 36, winner: ['JumpStart', 'Jump', 'Dodge'], motion: 'retreat' },
      { frames: 80, winner: SHOOT, loop: true, cycle: true, effect: 'arrows', impact: 'hit', impactAt: 0.15, repeat: 16, loser: WOUND, shake: 0.03 },
      { frames: 40, winner: ['ReadyBow', 'ReadyRifle', 'ReadyCrossbow', 'ReadySpellDirected'], loser: KNEEL },
      { frames: 80, winner: SHOOT, impact: 'crit', impactAt: 0.3, flash: true, effect: 'arrows', loser: DIE, slowmo: 0.4, shake: 0.06 },
    ],
  },
  4: {
    id: 'rogue', name: 'Eviscerate', sequence: ['back', 'forward', 'ability1', 'ability1', 'attack'], colour: '200, 20, 45', push: 1.35,
    beats: [
      { frames: 24, winner: ['Roll', 'Dodge', 'StealthStand', 'Walkbackwards'], motion: 'behind', effect: 'shadow' },
      { frames: 50, winner: ['CombatMutilate', 'Mutilate', 'CombatAbilityDualWield01', 'CombatAbility1H01', 'Special1H', 'Attack1H'], impact: 'crit', impactAt: 0.56, effect: 'blood', loser: FLINCH, shake: 0.04, slowmo: 0.7 },
      { frames: 50, winner: ['CombatAbility1H02', 'CombatAbility1H01', 'Attack1H', 'Special1H'], impact: 'crit', impactAt: 0.4, effect: 'blood', loser: KNEEL, shake: 0.04, slowmo: 0.7 },
      { frames: 100, winner: ['CombatEviscerate', 'CombatFinishingMove', 'CombatExecute', 'Special1H', 'Attack1H'], impact: 'crit', impactAt: 0.1, flash: true, effect: 'blood', loser: DIE, slowmo: 0.4, shake: 0.08 },
    ],
  },
  5: {
    id: 'priest', name: 'Shadow Word: Death', sequence: ['back', 'back', 'ability2', 'ability1'], colour: '150, 60, 255', push: 1.2,
    beats: [
      { frames: 60, winner: ['PriSpellCastBothUp', 'SpellCastOmni', 'ReadySpellOmni'], effect: 'shadow', loser: COWER },
      { frames: 80, winner: CHANNEL, loop: true, effect: 'shadow', impact: 'spell', impactAt: 0.1, repeat: 24, loser: FLINCH, shake: 0.03, slowmo: 0.7 },
      { frames: 100, winner: ['SpellCastOmni', 'PriSpellCastBothUp', 'SpellCastDirected'], impact: 'crit', flash: true, effect: 'shadow', loser: DIE, slowmo: 0.4, shake: 0.06 },
    ],
  },
  6: {
    id: 'deathknight', name: 'Soul Reaper', sequence: ['forward', 'back', 'ability2', 'attack'], colour: '80, 220, 255', push: 1.3,
    beats: [
      { frames: 60, winner: ['SpellCastDirected', 'LocSummon', 'ReadySpellDirected'], motion: 'pull', effect: 'shadow', loser: WOUND },
      { frames: 80, winner: ['DeathStrike', 'CombatAbility2H01', 'Special2H', 'Special1H', 'Attack2H', 'Attack1H'], impact: 'crit', impactAt: 0.4, effect: 'frost', loser: KNEEL, shake: 0.05, slowmo: 0.6 },
      { frames: 100, winner: EXECUTE, impact: 'crit', impactAt: 0.21, flash: true, effect: 'shadow', loser: DIE, slowmo: 0.4, shake: 0.08 },
    ],
  },
  7: {
    id: 'shaman', name: 'Thunderstorm', sequence: ['back', 'forward', 'ability1', 'ability2'], colour: '120, 180, 255', push: 1.2,
    beats: [
      { frames: 50, winner: ['ShaSpellCastBothUp', 'ShaSpellCastBothFront', 'SpellCastOmni', 'ReadySpellOmni'], effect: 'lightning', impact: 'spell', impactAt: 0.4, loser: FLINCH, shake: 0.05 },
      { frames: 50, winner: ['ShaSpellCastBothUp', 'ShaSpellCastBothFront', 'SpellCastOmni'], effect: 'lightning', impact: 'spell', impactAt: 0.3, flash: true, loser: DOWN, shake: 0.06 },
      { frames: 30, winner: RUN, loop: true, motion: 'dash' },
      { frames: 100, winner: ['Stormstrike', 'CombatAbility1H01', 'Special1H', 'CombatExecute', 'Attack1H'], impact: 'crit', impactAt: 0.32, flash: true, effect: 'lightning', loser: DIE, slowmo: 0.4, shake: 0.08 },
    ],
  },
  8: {
    id: 'mage', name: 'Deep Freeze', sequence: ['back', 'back', 'forward', 'ability1'], colour: '150, 220, 255', push: 1.2,
    beats: [
      { frames: 50, winner: ['MagSpellCastBothFront', 'SpellCastDirected', 'ReadySpellDirected'], effect: 'frost', impact: 'spell', impactAt: 0.4, loser: STUNNED },
      { frames: 60, winner: ['ReadySpellOmni', 'ReadySpellDirected', 'Stand'], effect: 'frost', slowmo: 0.6 },
      { frames: 100, winner: ['SpellCastOmni', 'MagSpellCastBothUp', 'SpellCastDirected'], impact: 'crit', flash: true, effect: 'shatter', loser: DIE, slowmo: 0.4, shake: 0.08 },
    ],
  },
  9: {
    id: 'warlock', name: 'Drain Soul', sequence: ['forward', 'back', 'ability2', 'ability1'], colour: '190, 90, 255', push: 1.2,
    beats: [
      { frames: 40, winner: ['LocSpellCastBothFront', 'SpellCastDirected', 'ReadySpellDirected'], effect: 'shadow', loser: COWER },
      { frames: 100, winner: CHANNEL, loop: true, effect: 'shadow', impact: 'spell', impactAt: 0.1, repeat: 30, loser: COWER, slowmo: 0.7, shake: 0.02 },
      { frames: 90, winner: ['LocSpellCastBothUp', 'SpellCastOmni', 'SpellCastDirected'], impact: 'crit', impactAt: 0.33, flash: true, effect: 'shadow', loser: DIE, slowmo: 0.4, shake: 0.06 },
    ],
  },
  10: {
    id: 'monk', name: 'Touch of Death', sequence: ['forward', 'forward', 'attack', 'ability1'], colour: '120, 255, 200', push: 1.35,
    beats: [
      { frames: 36, winner: ['FlyingKickStart', 'FlyingKick', 'JumpStart', 'Run'], loop: true, motion: 'leap' },
      { frames: 60, winner: ['FlyingKickEnd', 'SpinningKick', 'RoundHouseKick', 'Kick', 'SpecialUnarmed'], impact: 'crit', impactAt: 0.23, effect: 'shockwave', loser: FLINCH, shake: 0.05, slowmo: 0.6 },
      { frames: 60, winner: ['RoundHouseKick', 'SpinningKick', 'Kick', 'SpecialUnarmed'], impact: 'crit', impactAt: 0.35, loser: KNEEL, shake: 0.04, slowmo: 0.6 },
      { frames: 120, winner: ['PalmStrike', 'CombatUnarmed01', 'SpellCastOmni', 'SpecialUnarmed', 'AttackUnarmed'], impact: 'crit', impactAt: 0.25, flash: true, effect: 'shockwave', loser: DIE, slowmo: 0.35, shake: 0.08 },
    ],
  },
  11: {
    id: 'druid', name: 'Starfall', sequence: ['back', 'forward', 'ability2', 'ability1'], colour: '190, 200, 255', push: 1.2,
    beats: [
      { frames: 60, winner: ['DruReadySpellCast', 'ReadySpellOmni', 'SpellCastOmni'], effect: 'moon', loser: COWER },
      { frames: 80, winner: ['SpellCastOmni', 'DruSpellCastBothFront', 'SpellCastDirected'], loop: true, effect: 'moon', impact: 'spell', impactAt: 0.15, repeat: 20, loser: DOWN, shake: 0.05, slowmo: 0.7 },
      { frames: 100, winner: ['SpellCastOmni', 'SpellCastDirected'], impact: 'crit', flash: true, effect: 'moon', loser: DIE, slowmo: 0.4, shake: 0.08 },
    ],
  },
  12: {
    id: 'demonhunter', name: 'Eye Beam', sequence: ['back', 'forward', 'forward', 'ability3'], colour: '100, 255, 80', push: 1.3,
    beats: [
      { frames: 30, winner: ['FelRushLoop', 'DHCombatSprint', 'Sprint', 'Run'], loop: true, motion: 'dash', effect: 'fel' },
      { frames: 50, winner: ['DHBladeDance1', 'CombatBladeStorm', 'CombatWhirlwind', 'Special1H', 'Attack1H'], impact: 'crit', impactAt: 0.4, effect: 'blood', loser: FLINCH, shake: 0.05, slowmo: 0.6 },
      { frames: 30, winner: ['DoubleJumpStart', 'JumpStart', 'Jump'], motion: 'retreat' },
      { frames: 80, winner: ['ChannelCastOmniUp', 'ChannelCastOmni', 'ChannelCastDirected', 'ReadySpellOmni'], loop: true, effect: 'fel', impact: 'spell', impactAt: 0.15, repeat: 20, flash: true, loser: COWER, slowmo: 0.7, shake: 0.03 },
      { frames: 60, winner: ['ChannelCastOmniUp', 'ChannelCastOmni', 'ReadySpellOmni'], loop: true, effect: 'fel', impact: 'crit', impactAt: 0.1, loser: DIE, slowmo: 0.4, shake: 0.06 },
    ],
  },
  13: {
    id: 'evoker', name: 'Deep Breath', sequence: ['back', 'back', 'ability2', 'attack'], colour: '255, 140, 40', push: 1.15,
    beats: [
      { frames: 40, winner: ['JumpStart', 'Jump', 'Hover', 'Dodge'], motion: 'retreat' },
      { frames: 40, winner: ['Hover', 'Jump', 'ReadySpellOmni', 'Stand'], loop: true, loser: COWER },
      { frames: 100, winner: ['BreathOfFire', 'ChannelCastDirected', 'ChannelCastOmni', 'SpellCastDirected'], loop: true, effect: 'fire', impact: 'spell', impactAt: 0.15, repeat: 20, flash: true, loser: FLINCH, shake: 0.04, slowmo: 0.7 },
      { frames: 60, winner: ['BreathOfFire', 'ChannelCastDirected', 'SpellCastDirected'], loop: true, effect: 'fire', impact: 'crit', impactAt: 0.1, loser: DIE, slowmo: 0.4, shake: 0.06 },
    ],
  },
};

/** The fatality a class plays; a legend without a class gets the warrior's, or the hunter's behind a bow. */
export function fatalityFor(classId: number | undefined, wielding: Wielding): Fatality {
  return FATALITIES[classFor(classId, wielding)]!;
}

/** Every fatality, for a guide: by class id. */
export const ALL_FATALITIES: ReadonlyMap<number, Fatality> = new Map(Object.entries(FATALITIES).map(([id, f]) => [Number(id), f]));

/** Every animation any fatality may ask for, for the worker to pre-read. */
export const FATALITY_ANIMATIONS: readonly string[] = [
  ...new Set(Object.values(FATALITIES).flatMap((f) => f.beats.flatMap((b) => [...b.winner, ...(b.loser?.anims ?? [])]))),
];

/** The fatality's beats resolved to the moves the model has; `idle` stands in for a missing one. */
export function resolveFatality(classId: number | undefined, wielding: Wielding, find: Finder, idle: Move): ResolvedFatality {
  const spec = fatalityFor(classId, wielding);
  const winner = spec.beats.map((b, k) => moveFrom(find, `fatality${k}`, b.winner, b.loop ?? false, idle));
  return {
    spec,
    winner,
    blow: spec.beats.map((b, k) => CONTACT[winner[k]!.animation] ?? b.blowAt ?? BLOW_AT),
    victim: Object.fromEntries(
      Object.values(FATALITIES).map((f) => [f.id, f.beats.map((b, k) => (b.loser ? moveFrom(find, `victim${k}`, b.loser.anims, b.loser.loop ?? false, idle) : undefined))]),
    ),
  };
}

/** The frame of a beat at which its blow lands. */
export function impactFrame(beat: Beat): number {
  return Math.floor(beat.frames * (beat.impactAt ?? 0.3));
}

/** `v` held between `lo` and `hi` of a tick's worth of clip. */
const paced = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi * TICK_MS, Math.max(lo * TICK_MS, v));

/**
 * The winner's clip time once tick `t` of a beat has run (1 to the beat's frames), for a clip
 * `duration` ms long whose own blow is `blow` of the way through it. A looping clip goes round
 * at its own pace slowed as the beat is, or once per `repeat` when the beat cycles. A clip with
 * a blow reaches it on the beat's impact tick: the wind-up is paced to land there (no slower
 * than half pace, starting late if it must), and the rest is paced to end with the beat, held
 * between PACE.after of its own. A clip with no blow is paced to fill the beat, held likewise.
 * Past its end a clip holds its last frame; the fit never asks for time the clip does not have.
 */
export function clipTime(beat: Beat, t: number, duration: number, blow: number, slowmo: number): number {
  if (duration <= 0) return 0;
  if (beat.loop) {
    const perTick = beat.cycle && beat.repeat ? duration / beat.repeat : TICK_MS * slowmo;
    return (t * perTick) % duration;
  }
  if (!beat.impact) return Math.min(duration, t * paced(duration / beat.frames, PACE.whole));
  const hit = impactFrame(beat);
  const at = blow * duration;
  if (t <= hit) {
    const pace = Math.max(PACE.windUp * TICK_MS, hit > 0 ? at / hit : 0);
    return Math.max(0, at - (hit - t) * pace);
  }
  const pace = paced((duration - at) / (beat.frames - hit), PACE.after);
  return Math.min(duration, at + (t - hit) * pace);
}

/** Whether a blow lands on tick `t` of the beat: at its impact frame, and every `repeat` after for a volley or a channel. */
export function isBlow(beat: Beat, t: number): boolean {
  if (!beat.impact) return false;
  const at = impactFrame(beat);
  return t === at || (beat.repeat !== undefined && t > at && (t - at) % beat.repeat === 0);
}

/** Ticks a whole fatality takes. */
export function fatalityFrames(f: Fatality): number {
  return f.beats.reduce((n, b) => n + b.frames, 0);
}

/** The left or right key a token means for a fighter facing `facing`; undefined for a key that is not a direction. */
export function directionOf(token: SequenceToken, facing: 1 | -1): 'left' | 'right' | undefined {
  if (token === 'back') return facing > 0 ? 'left' : 'right';
  if (token === 'forward') return facing > 0 ? 'right' : 'left';
  return undefined;
}
