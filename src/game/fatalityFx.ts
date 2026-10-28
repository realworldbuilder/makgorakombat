import { ALL_FATALITIES, type Beat, type Fatality, impactFrame, isBlow } from '../engine/fatalities';
import { KO_SLOWMO } from '../engine/stage';
import { kind, Pool } from './particles';

/*
 * The fatalities' particles: what each class's scene throws off, beat by beat and blow by blow,
 * into the HUD's pool. The script reads nothing but the fatality, the tick and a few body
 * heights, so the pool it fills is the same on both screens of an online match and the same
 * when rebuilt from the scene's first tick after a stall or a rematch: FatalityFx keeps the
 * one pool there is and steps it to the tick the match is on, from nothing when it has to.
 *
 * Every number here is in yards and engine ticks. A beat's particles move at its time scale
 * (0.4 in the slow-motion death), so a blow's blood hangs in the air with the fighters.
 */

/** The anchors the script hangs particles off; the HUD finds each on screen when it draws. */
export const ANCHOR = {
  /** The winner's chest, as posed. */
  winner: 0,
  /** The winner's eyes, as posed: Eye Beam, a dragon's breath. */
  eyes: 1,
  /** The winner's right hand, as posed; the chest when the model has none. */
  hand: 2,
  /** The ground under the winner. */
  winnerFeet: 3,
  /** The loser's chest, as posed: what is drawn into the body follows it down. */
  loser: 4,
  /** The ground under the loser: what flies off them has a floor to land on. */
  feet: 5,
  /** The ground where the winner stood when beat 0 began, then beat 1 and on: the start of a charge, the spot a rogue vanished from. */
  from: 6,
} as const;
const MOST_BEATS = Math.max(...[...ALL_FATALITIES.values()].map((f) => f.beats.length));
export const ANCHORS = ANCHOR.from + MOST_BEATS;

const { eyes: E, hand: H, winnerFeet: WG, loser: L, feet: LG } = ANCHOR;

/** The bodies' heights the script throws from, in yards: the same all fight. */
export interface Rig {
  /** The loser's chest, standing. */
  chest: number;
  /** The top of the loser's head, standing. */
  top: number;
  /** The winner's chest, standing. */
  winnerChest: number;
}

/** A repeatable jitter in [0, 1) from an integer. */
export function jitter(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** The Thunderstorm's bolts: how many strike at once, and how high their clouds are over the loser. */
export const BOLTS = 3;
export const SKY = 10;
/** Where bolt `b` comes down from on `frame`, yards to the side of the loser, and whether it is lit: the same for the HUD's bolt and the sparks it sheds. */
export function boltAt(frame: number, b: number): { x: number; on: boolean } {
  return { x: (jitter(Math.floor(frame / 3) + b * 17) - 0.5) * 3.6, on: frame % 14 < 8 };
}

// ---------------------------------------------------------------------------------------------
// What the scenes are made of.

const GRIT = kind({ shape: 'dot', colour: 'dirt', size: [0.025, 0.05], life: [18, 32], drag: 0.02, gravity: 0.008, floor: 'die' });
const DUST = kind({ shape: 'puff', colour: 'dust', size: [0.2, 0.38], life: [40, 70], drag: 0.06, grow: 0.012, gravity: -0.0006, alpha: 0.38, fadeIn: 0.12 });
const STEEL = kind({ shape: 'spark', colour: 'white', fade: 'hot', size: [0.014, 0.026], life: [10, 22], drag: 0.03, gravity: 0.006, len: 2.2, floor: 'bounce' });
const BLADE = kind({ shape: 'glow', colour: 'steel', size: [0.06, 0.09], life: [7, 11], alpha: 0.55 });
const BLOOD = kind({ shape: 'drop', colour: 'blood', fade: 'gore', size: [0.012, 0.034], life: [50, 90], drag: 0.03, gravity: 0.007, floor: 'settle' });
const SPATTER = kind({ shape: 'dot', colour: 'blood', size: [0.008, 0.016], life: [30, 50], drag: 0.05, gravity: 0.006, floor: 'die' });
const MIST = kind({ shape: 'puff', colour: 'mist', size: [0.18, 0.34], life: [24, 40], drag: 0.08, grow: 0.01, alpha: 0.42 });
const CRIT = kind({ shape: 'glow', colour: 'red', size: [0.3, 0.45], life: [9, 14], alpha: 0.65, grow: 0.015 });
const SLASH = kind({ shape: 'spark', colour: 'white', fade: 'crimson', size: [0.022, 0.04], life: [6, 11], drag: 0.12, len: 3 });

const MOTE = kind({ shape: 'glow', colour: 'gold', size: [0.04, 0.08], life: [40, 70], drag: 0.01, alpha: 0.9 });
const FALLING_MOTE = kind({ shape: 'glow', colour: 'holy', fade: 'gold', size: [0.05, 0.09], life: [30, 50], alpha: 0.9, floor: 'die', trail: { kind: kind({ shape: 'dot', light: true, colour: 'gold', size: [0.02, 0.035], life: [6, 12] }), rate: 0.6 } });
const HOLY = kind({ shape: 'spark', colour: 'white', fade: 'gold', size: [0.016, 0.028], life: [14, 28], drag: 0.03, gravity: 0.004, len: 2.6, floor: 'bounce' });
const HALO = kind({ shape: 'glow', colour: 'gold', size: [0.08, 0.14], life: [18, 28], drag: 0.05, alpha: 0.85 });
const BLAZE = kind({ shape: 'glow', colour: 'holy', size: [0.5, 0.7], life: [12, 18], alpha: 0.55, grow: 0.03 });

const GLINT = kind({ shape: 'dot', light: true, colour: 'hot', size: [0.012, 0.022], life: [6, 12], drag: 0.05 });
const ARROW_HIT = kind({ shape: 'spark', colour: 'white', fade: 'hot', size: [0.013, 0.022], life: [6, 12], drag: 0.06, len: 2 });
const ARROW = kind({ shape: 'spark', colour: 'white', fade: 'hot', size: [0.035, 0.04], life: [8, 8], len: 3, trail: { kind: GLINT, rate: 2, speed: 0.008 }, burst: { kind: ARROW_HIT, n: 6, speed: [0.03, 0.08] } });
const ARROW_HEAD = kind({ shape: 'glow', colour: 'hot', size: [0.09, 0.1], life: [8, 8], alpha: 0.9 });
const SHOT_GLOW = kind({ shape: 'glow', colour: 'hot', size: [0.22, 0.26], life: [8, 8], alpha: 0.8 });
const FEATHER = kind({ shape: 'shard', colour: 'feather', fade: 'dirt', size: [0.06, 0.1], life: [30, 55], drag: 0.07, gravity: 0.0018, spin: 0.25, floor: 'die' });
const FLARE = kind({ shape: 'glow', colour: 'hot', size: [0.25, 0.38], life: [8, 12], alpha: 0.7 });

const SHADOW = kind({ shape: 'puff', colour: 'void', size: [0.28, 0.5], life: [30, 50], drag: 0.06, grow: 0.012, gravity: -0.001, alpha: 0.55, fadeIn: 0.1 });
const SHADOW_GLINT = kind({ shape: 'dot', light: true, colour: 'purple', size: [0.016, 0.03], life: [12, 24], drag: 0.05, gravity: -0.002 });
const WISP_TAIL = kind({ shape: 'glow', colour: 'violet', size: [0.05, 0.09], life: [10, 18], alpha: 0.5 });
const WISP = kind({ shape: 'glow', colour: 'purple', size: [0.08, 0.13], life: [30, 30], alpha: 0.8, trail: { kind: WISP_TAIL, rate: 1 } });
const SHADOW_SPARK = kind({ shape: 'spark', colour: 'lilac', fade: 'purple', size: [0.015, 0.028], life: [12, 22], drag: 0.04, len: 2.4 });
const DARK_GLOW = kind({ shape: 'glow', colour: 'violet', size: [0.35, 0.55], life: [12, 20], alpha: 0.6, grow: 0.02 });

const ASH = kind({ shape: 'dot', colour: 'ash', size: [0.014, 0.028], life: [20, 40], drag: 0.03, gravity: -0.0008 });
const GRIP = kind({ shape: 'dot', colour: 'void', size: [0.02, 0.035], life: [10, 18], drag: 0.05 });
const ASH_PUFF = kind({ shape: 'puff', colour: 'ash', size: [0.18, 0.36], life: [30, 50], drag: 0.05, grow: 0.01, gravity: -0.001, alpha: 0.45, fadeIn: 0.1 });
const FROST_GLINT = kind({ shape: 'dot', light: true, colour: 'ice', fade: 'frost', size: [0.014, 0.024], life: [8, 16], drag: 0.05 });
const SHARD = kind({ shape: 'shard', colour: 'ice', fade: 'iceEdge', size: [0.05, 0.12], life: [35, 60], drag: 0.02, gravity: 0.006, spin: 0.3, floor: 'bounce' });
const FROST_SPARK = kind({ shape: 'spark', colour: 'white', fade: 'frost', size: [0.015, 0.026], life: [10, 20], drag: 0.04, gravity: 0.002, len: 2.2 });
const CHILL = kind({ shape: 'puff', colour: 'chill', size: [0.3, 0.5], life: [40, 60], drag: 0.04, grow: 0.01, alpha: 0.3, fadeIn: 0.15 });
const FROST_MOTE = kind({ shape: 'glow', colour: 'frost', size: [0.05, 0.09], life: [14, 14], alpha: 0.85, trail: { kind: FROST_GLINT, rate: 0.8 } });
const FROST_GLOW = kind({ shape: 'glow', colour: 'frost', size: [0.4, 0.6], life: [12, 18], alpha: 0.55, grow: 0.02 });
const SOUL = kind({ shape: 'glow', colour: 'frost', fade: 'ice', size: [0.06, 0.1], life: [40, 40], alpha: 0.85, trail: { kind: FROST_GLINT, rate: 0.6 } });

const STORM = kind({ shape: 'spark', colour: 'white', fade: 'storm', size: [0.013, 0.024], life: [12, 26], drag: 0.02, gravity: 0.011, len: 1.6, floor: 'bounce' });
const CRACKLE = kind({ shape: 'spark', colour: 'white', fade: 'blue', size: [0.012, 0.02], life: [4, 8], drag: 0.1, len: 1.5 });
const STORM_GLOW = kind({ shape: 'glow', colour: 'storm', size: [0.08, 0.14], life: [14, 22], drag: 0.05, alpha: 0.8 });
const STRIKE = kind({ shape: 'glow', colour: 'storm', size: [0.45, 0.6], life: [8, 12], alpha: 0.7 });

const LILAC_TAIL = kind({ shape: 'dot', light: true, colour: 'lilac', size: [0.012, 0.02], life: [8, 14] });
const SOUL_MOTE = kind({ shape: 'glow', colour: 'lilac', fade: 'purple', size: [0.06, 0.1], life: [40, 40], alpha: 0.8, trail: { kind: LILAC_TAIL, rate: 0.5 } });

const PULSE = kind({ shape: 'glow', colour: 'red', fade: 'crimson', size: [0.08, 0.12], life: [16, 24], drag: 0.04, alpha: 0.85 });
const CHI = kind({ shape: 'spark', colour: 'white', fade: 'jade', size: [0.013, 0.022], life: [10, 18], drag: 0.05, len: 2 });
const LIFE = kind({ shape: 'glow', colour: 'red', fade: 'crimson', size: [0.04, 0.07], life: [30, 50], drag: 0.02, gravity: -0.002, alpha: 0.8 });

const STARDUST = kind({ shape: 'dot', light: true, colour: 'white', fade: 'moon', size: [0.012, 0.024], life: [12, 24], drag: 0.05, gravity: 0.0008 });
const STAR_SPARK = kind({ shape: 'spark', colour: 'white', fade: 'moon', size: [0.014, 0.024], life: [10, 20], drag: 0.05, gravity: 0.002, len: 2 });
const STAR = kind({ shape: 'glow', colour: 'moon', size: [0.14, 0.2], life: [1, 1], trail: { kind: STARDUST, rate: 2.2, speed: 0.006 }, burst: { kind: STAR_SPARK, n: 14, speed: [0.03, 0.09] } });
const BIG_STAR = kind({ shape: 'glow', colour: 'moon', size: [0.42, 0.5], life: [1, 1], trail: { kind: STARDUST, rate: 6, speed: 0.012 }, burst: { kind: STAR_SPARK, n: 50, speed: [0.04, 0.14] } });
const MOONMOTE = kind({ shape: 'dot', light: true, colour: 'moon', size: [0.012, 0.02], life: [50, 80] });
const MOON_RING = kind({ shape: 'glow', colour: 'moon', size: [0.08, 0.14], life: [16, 26], drag: 0.05, alpha: 0.85 });
const MOON_GLOW = kind({ shape: 'glow', colour: 'moon', size: [0.4, 0.6], life: [12, 18], alpha: 0.6, grow: 0.02 });

const FEL_EMBER = kind({ shape: 'ember', colour: 'felPale', fade: 'fel', size: [0.05, 0.1], life: [14, 26], drag: 0.04, gravity: -0.0012 });
const FEL_SMOKE = kind({ shape: 'puff', colour: 'felSmoke', size: [0.2, 0.36], life: [30, 45], drag: 0.05, grow: 0.01, gravity: -0.0008, alpha: 0.32, fadeIn: 0.15 });
const FEL_SPARK = kind({ shape: 'spark', colour: 'felPale', fade: 'fel', size: [0.015, 0.026], life: [10, 20], drag: 0.04, gravity: 0.004, len: 2.2, floor: 'bounce' });
const FEL_BLADE = kind({ shape: 'glow', colour: 'fel', size: [0.07, 0.11], life: [7, 11], alpha: 0.6 });
const FEL_GLOW = kind({ shape: 'glow', colour: 'fel', size: [0.35, 0.5], life: [5, 8], alpha: 0.6 });

const FIRE = kind({ shape: 'ember', colour: 'flame', fade: 'ember', size: [0.08, 0.16], life: [20, 32], drag: 0.01, gravity: -0.002, grow: 0.005, alpha: 0.85 });
const FIRE_GLOW = kind({ shape: 'glow', colour: 'ember', fade: 'cinder', size: [0.2, 0.34], life: [14, 24], alpha: 0.35, grow: 0.012 });
const BLACK_SMOKE = kind({ shape: 'puff', colour: 'smoke', size: [0.26, 0.44], life: [40, 60], drag: 0.02, grow: 0.014, gravity: -0.002, alpha: 0.42, fadeIn: 0.2 });
const CINDER = kind({ shape: 'dot', light: true, colour: 'flame', fade: 'cinder', size: [0.014, 0.026], life: [30, 50], drag: 0.02, gravity: -0.003 });

// ---------------------------------------------------------------------------------------------
// The script.

/** One tick of a beat, as the script sees it. */
interface Moment {
  pool: Pool;
  rig: Rig;
  /** Which beat, and the tick in it. */
  k: number;
  beat: Beat;
  t: number;
  /** The beat's time scale. */
  dt: number;
  /** The match's frame once this tick has run: what the HUD's bolts are drawn from. */
  frame: number;
  /** A blow lands this tick. */
  blow: boolean;
  /** The tick of the beat's first blow. */
  hit: number;
}

/** Where the winner stood when this beat began. */
const from = (m: Moment) => ANCHOR.from + m.k;

/** A whole number for this tick of `rate` a tick, at the beat's time scale. */
const per = (m: Moment, rate: number) => m.pool.howMany(rate * m.dt);

/** Dust and grit kicked up where a fighter pushes off or comes down. */
function dust(m: Moment, at: number, n: number, radius = 0.5): void {
  m.pool.smoke(DUST, n, at, 0, 0.15, radius, 0.006);
  m.pool.burst(GRIT, n * 2, at, 0, 0.05, [0.03, 0.08], Math.PI / 2, 2.4);
}

/** A ring of dust rolling out along the ground. */
function dustRing(m: Moment, at: number, n: number, speed: number): void {
  m.pool.ring(DUST, n, at, 0, 0.1, 0.35, [speed * 0.7, speed], 0.3);
  m.pool.burst(GRIT, n, at, 0, 0.05, [0.04, 0.1], Math.PI / 2, 2.6);
}

/** Blood thrown off the loser's chest, `angle` and `spread` the way it goes. */
function bleed(m: Moment, n: number, angle = 0.6, spread = 1.8, speed: [number, number] = [0.04, 0.12]): void {
  m.pool.burst(BLOOD, n, LG, 0, m.rig.chest, speed, angle, spread);
  m.pool.burst(SPATTER, n, LG, 0, m.rig.chest, [speed[0] * 1.2, speed[1] * 1.4], angle, spread * 0.8);
  m.pool.smoke(MIST, Math.ceil(n / 10), LG, 0.1, m.rig.chest, 0.25, 0.004);
}

/** A blade's sweep round the winner, as a fading ring where it has been and sparks flung off it. */
function spin(m: Moment, blade: typeof BLADE, spark: typeof STEEL, period: number): void {
  const ang = (m.t / period) * Math.PI * 2;
  for (let j = 0; j < 2; j++) {
    const a = ang + j * 0.15;
    const i = m.pool.spawn(blade, WG, WG, 0, 0, m.rig.winnerChest * 0.75, 0, 0);
    m.pool.orbit(i, 1.1, 0, a, 0);
  }
  for (let j = per(m, 1.6); j > 0; j--) {
    const i = m.pool.spawn(spark, WG, WG, 0, 0, m.rig.winnerChest * 0.75, -Math.sin(ang) * 0.14, Math.cos(ang) * 0.08 + 0.03);
    m.pool.orbit(i, 1.1, 0, ang, 0);
  }
}

/** Bladestorm: dust off the charge, a ring of steel and dust every turn of the spin, blood each time it bites, and the execute's spray. */
function warrior(m: Moment): void {
  const { pool, rig } = m;
  if (m.k === 0) {
    if (m.t === 0) dust(m, from(m), 8);
    pool.stream(DUST, per(m, 1.2), from(m), WG, [0.2, 1], [0, 0], 0.3, [0, 0], 0.006);
  } else if (m.k === 1) {
    // One turn of the blade per blow, as the spin is played.
    spin(m, BLADE, STEEL, m.beat.repeat ?? 20);
    if (m.blow) {
      pool.ring(STEEL, 36, WG, 0, rig.winnerChest * 0.7, 1.0, [0.12, 0.22], 0.4);
      dustRing(m, WG, 14, 0.06);
      bleed(m, 26, 0.5, 1.6);
      pool.burst(CRIT, 1, L, 0, 0, [0, 0]);
    }
  } else if (m.k === 2) {
    if (m.t === 0) dustRing(m, WG, 16, 0.07);
  } else if (m.k === 3) {
    if (m.blow) {
      bleed(m, 90, 0.7, 2.2, [0.05, 0.2]);
      pool.burst(STEEL, 40, LG, 0, rig.chest, [0.08, 0.2], 0.4, 2.4);
      pool.burst(CRIT, 2, L, 0, 0, [0, 0]);
    }
    // The wound gushes on after the blow.
    if (m.t > m.hit && m.t < m.hit + 36) pool.fountain(BLOOD, 3, m.dt, LG, 0.05, rig.chest, [0.08, 0.16], 1.0, 0.7);
    if (m.t === m.hit + 34) dust(m, LG, 10, 0.9);
  }
}

/** Hammer of Wrath: a pillar of gold motes over the loser that comes down into a ring of light on the blow, and again for the kill. */
function paladin(m: Moment): void {
  const { pool, rig } = m;
  const pillar = (rate: number) => {
    for (let j = per(m, rate); j > 0; j--) {
      const i = pool.column(MOTE, 1, LG, 0, 0.2, 0, 5, [0.015, 0.045]);
      pool.orbit(i, 0.25 + 0.4 * pool.random(), 0, pool.random() * Math.PI * 2, 0.07);
    }
  };
  const collapse = (rate: number) => pool.column(FALLING_MOTE, per(m, rate), LG, 0, 1.4, 3.5, 6, [-0.2, -0.12]);
  const impact = (n: number) => {
    pool.ring(HALO, n, LG, 0, 0.05, 0.3, [0.1, 0.17], 0.3);
    dustRing(m, LG, Math.round(n / 3), 0.07);
    pool.burst(HOLY, n, LG, 0, rig.chest * 0.6, [0.06, 0.18], Math.PI / 2, 2.8);
    pool.burst(BLAZE, 1, L, 0, 0, [0, 0]);
  };
  if (m.k === 0) pillar(4);
  else if (m.k === 1) collapse(3);
  else if (m.k === 2) {
    if (m.t < m.hit) collapse(4);
    if (m.blow) impact(48);
  } else if (m.k === 3) {
    if (m.t < m.hit) {
      pillar(6);
      collapse(2);
    }
    if (m.blow) {
      impact(70);
      pool.burst(MOTE, 40, LG, 0, rig.chest, [0.04, 0.1]);
    }
  }
}

/** Rapid Fire: a stream of arrows that land on the loser, each blow in feathers and sparks, and one last glowing shot. */
function hunter(m: Moment): void {
  const { pool, rig } = m;
  /** An arrow loosed now that lands `ticks` later. */
  const loose = (ticks: number, big: boolean) => {
    const flight = ticks * m.dt;
    pool.lasting(pool.spawn(ARROW, H, L, 0, 0, 0, 0, 0, 1 / flight), flight - 1e-6);
    pool.lasting(pool.spawn(big ? SHOT_GLOW : ARROW_HEAD, H, L, 0, 0, 0, 0, 0, 1 / flight), flight - 1e-6);
  };
  const struck = (n: number) => {
    pool.burst(FEATHER, n, LG, 0, rig.chest, [0.03, 0.08], Math.PI * 0.75, 1.6);
    pool.burst(ARROW_HIT, n * 2, L, 0, 0, [0.05, 0.14], Math.PI, 1.8);
    pool.burst(FLARE, 1, L, 0, 0, [0, 0]);
    bleed(m, n, 0.3, 1.4);
  };
  if (m.k === 0) {
    if (m.t === 0) dust(m, from(m), 8);
    if (m.t === m.beat.frames - 1) dust(m, WG, 6);
  } else if (m.k === 1) {
    // One every four ticks, timed to land on the blows.
    if ((m.t + 8) % 4 === 0 && m.t + 8 < m.beat.frames) loose(8, false);
    if (m.blow) struck(8);
  } else if (m.k === 3) {
    const flight = 20;
    if (m.t === m.hit - flight) loose(flight, true);
    if (m.blow) {
      struck(24);
      pool.ring(FLARE, 10, L, 0, 0, 0.2, [0.04, 0.06], 1);
      pool.burst(ARROW_HIT, 50, L, 0, 0, [0.06, 0.2]);
    }
  }
}

/** Eviscerate: a puff of shadow where the rogue was and where they step out, then each strike an arc of blood along the blade. */
function rogue(m: Moment): void {
  const { pool, rig } = m;
  const slash = (from: number, to: number, n: number) => {
    pool.arc(BLOOD, n, LG, 0, rig.chest, 0.45, from, to, [0.06, 0.15], 0.35);
    pool.arc(SPATTER, n, LG, 0, rig.chest, 0.45, from, to, [0.08, 0.18], 0.25);
    pool.arc(SLASH, Math.round(n * 0.6), LG, 0, rig.chest, 0.5, from, to, [0.08, 0.14], 0.1);
    pool.smoke(MIST, 3, LG, 0.1, rig.chest, 0.3, 0.004);
  };
  if (m.k === 0 && m.t === 0) {
    pool.smoke(SHADOW, 14, from(m), 0, 0.9, 0.6, 0.008);
    pool.burst(SHADOW_GLINT, 20, from(m), 0, 0.9, [0.02, 0.06]);
    pool.smoke(SHADOW, 10, WG, 0, 0.9, 0.5, 0.008);
    pool.burst(SHADOW_GLINT, 14, WG, 0, 0.9, [0.02, 0.05]);
  } else if (m.k === 1 && m.blow) slash(2.3, -0.7, 40);
  else if (m.k === 2 && m.blow) slash(-2.2, 0.8, 40);
  else if (m.k === 3) {
    if (m.blow) {
      slash(2.4, -0.8, 70);
      slash(-2.4, 0.8, 70);
      pool.burst(CRIT, 2, L, 0, 0, [0, 0]);
    }
    if (m.t > m.hit && m.t < m.hit + 30) pool.fountain(BLOOD, 2.5, m.dt, LG, 0.05, rig.chest, [0.07, 0.14], 0.9, 0.8);
  }
}

/** Shadow Word: Death: shadow gathered in the hands, wisps winding into the loser on each tick of the channel, and the darkness bursting out of them. */
function priest(m: Moment): void {
  const { pool, rig } = m;
  if (m.k === 0) {
    pool.implode(WISP_TAIL, per(m, 1.5), H, 0, 0, [0.8, 1.4], 25, 0.15);
    pool.smoke(SHADOW, per(m, 0.4), LG, 0, 0.2, 0.6, 0.01);
  } else if (m.k === 1) {
    pool.spiral(WISP, per(m, 1.2), H, L, [1 / 35, 1 / 25], [0.3, 0.6], 0.25);
    if (m.blow) {
      pool.burst(SHADOW_SPARK, 24, L, 0, 0, [0.04, 0.12]);
      pool.smoke(SHADOW, 4, LG, 0, rig.chest, 0.3, 0.008);
      pool.burst(DARK_GLOW, 1, L, 0, 0, [0, 0]);
    }
  } else if (m.k === 2) {
    if (m.t < m.hit) {
      pool.implode(WISP, per(m, 3), L, 0, 0, [1.5, 2.5], 24, 0.12);
      pool.spiral(WISP, per(m, 1), H, L, [1 / 30, 1 / 20], [0.3, 0.6], 0.25);
    }
    if (m.blow) {
      pool.burst(SHADOW_SPARK, 60, L, 0, 0, [0.05, 0.18]);
      pool.smoke(SHADOW, 16, LG, 0, rig.chest, 0.5, 0.01);
      pool.burst(SHADOW_GLINT, 40, LG, 0, rig.chest, [0.02, 0.07], Math.PI / 2, 2);
      pool.burst(DARK_GLOW, 2, L, 0, 0, [0, 0]);
    }
  }
}

/** Soul Reaper: a grip of ash dragging the loser in, frost shards off the strike, and the reap's shards, ash and the soul drawn to the blade. */
function deathknight(m: Moment): void {
  const { pool, rig } = m;
  const shatter = (n: number) => {
    pool.burst(SHARD, n, LG, 0, rig.chest, [0.08, 0.18], 0.6, 2.6);
    pool.burst(FROST_SPARK, Math.round(n * 0.7), L, 0, 0, [0.06, 0.16]);
    pool.smoke(CHILL, Math.round(n / 5), LG, 0, 0.3, 0.8, 0.004);
    pool.burst(FROST_GLOW, 1, L, 0, 0, [0, 0]);
  };
  if (m.k === 0) {
    if (m.t === 0) pool.burst(ASH, 30, L, 0, 0, [0.02, 0.07]);
    // The grip: ash pouring from the loser back into the hand, and the chill that comes with it.
    pool.stream(GRIP, per(m, 10), H, L, [0.05, 1], [-1 / 24, -1 / 36], 0.12);
    pool.stream(ASH, per(m, 4), H, L, [0.1, 1], [-1 / 30, -1 / 45], 0.35);
    pool.stream(ASH_PUFF, per(m, 0.5), H, L, [0.2, 1], [-1 / 50, -1 / 70], 0.3);
    pool.stream(FROST_GLINT, per(m, 2), H, L, [0.1, 1], [-1 / 25, -1 / 35], 0.2);
  } else if (m.k === 1) {
    if (m.t < m.hit) pool.implode(FROST_GLINT, per(m, 2), H, 0, 0, [0.6, 1.0], 14, 0.2);
    if (m.blow) shatter(40);
  } else if (m.k === 2) {
    if (m.t < m.hit) pool.implode(ASH, per(m, 3), L, 0, 0, [1.0, 1.8], 26, 0.1);
    if (m.blow) {
      shatter(70);
      pool.smoke(ASH_PUFF, 14, LG, 0, rig.chest * 0.8, 0.6, 0.008);
      pool.burst(ASH, 50, LG, 0, rig.chest, [0.03, 0.1]);
    }
    if (m.t > m.hit && m.t < m.hit + 36) pool.stream(SOUL, per(m, 1.5), L, H, [0, 0.1], [1 / 40, 1 / 30], 0.5);
  }
}

/** Thunderstorm: the bolts shed sparks as they strike, rings of blue light on the ground, and the hands crackle throughout. */
function shaman(m: Moment): void {
  const { pool, rig } = m;
  pool.burst(CRACKLE, per(m, 1.2), H, 0, 0, [0.04, 0.1]);
  const striking = m.beat.effect === 'lightning';
  if (striking) {
    for (let b = 0; b < BOLTS; b++) {
      const bolt = boltAt(m.frame, b);
      if (!bolt.on) continue;
      // Sparks off the lower part of the bolt, falling.
      for (let j = per(m, b === 0 ? 2.5 : 1.2); j > 0; j--) {
        const f = 0.55 + 0.45 * pool.random();
        const x = bolt.x * (1 - f);
        const y = SKY + (rig.top - SKY) * f;
        pool.spawn(STORM, LG, LG, 0, x, y, (pool.random() - 0.5) * 0.12, (pool.random() - 0.3) * 0.08);
      }
      if (m.frame % 3 === 0) pool.burst(STORM, 4, LG, 0, rig.top, [0.04, 0.12], Math.PI / 2, 3);
    }
  }
  if (m.blow) {
    const n = m.k === 3 ? 70 : 36;
    pool.burst(STORM, n, LG, 0, rig.top, [0.06, 0.2], Math.PI / 2, 3.4);
    pool.ring(STORM_GLOW, Math.round(n * 0.7), LG, 0, 0.05, 0.3, [0.08, 0.15], 0.3);
    pool.burst(STRIKE, 1, LG, 0, rig.top, [0, 0]);
    dustRing(m, LG, Math.round(n / 4), 0.06);
  }
}

/** Deep Freeze: frost drawn from the hand into the loser, a chill on the ground while the ice grows, and the shatter. */
function mage(m: Moment): void {
  const { pool, rig } = m;
  if (m.k === 0) {
    if (m.t < m.hit) pool.stream(FROST_MOTE, per(m, 2), H, L, [0, 0.05], [1 / 14, 1 / 14], 0.2);
    if (m.blow) {
      pool.burst(FROST_SPARK, 30, L, 0, 0, [0.04, 0.12]);
      pool.smoke(CHILL, 6, LG, 0, 0.2, 0.9, 0.003);
      pool.burst(FROST_GLOW, 1, L, 0, 0, [0, 0]);
    }
  } else if (m.k === 1) {
    pool.smoke(CHILL, per(m, 0.5), LG, 0, 0.1, 1.0, 0.002);
    pool.smoke(FROST_GLINT, per(m, 1.5), LG, 0, rig.chest, 0.8, 0);
  } else if (m.k === 2) {
    if (m.t < m.hit) pool.smoke(FROST_GLINT, per(m, 2), LG, 0, rig.chest, 0.8, 0);
    if (m.blow) {
      pool.burst(SHARD, 160, LG, 0, rig.chest, [0.06, 0.22], Math.PI / 2, Math.PI * 2);
      pool.burst(FROST_SPARK, 50, L, 0, 0, [0.06, 0.18]);
      pool.smoke(CHILL, 14, LG, 0, 0.4, 1.0, 0.004);
      pool.burst(FROST_GLOW, 2, L, 0, 0, [0, 0]);
    }
  }
}

/** Drain Soul: wisps winding into the loser, their soul streaming back along them, and torn out whole at the end. */
function warlock(m: Moment): void {
  const { pool, rig } = m;
  if (m.k === 0) {
    pool.implode(WISP_TAIL, per(m, 1), H, 0, 0, [0.8, 1.3], 25, 0.15);
    pool.smoke(SHADOW, per(m, 0.3), H, 0, 0, 0.2, 0.008);
  } else if (m.k === 1) {
    pool.spiral(WISP, per(m, 1), H, L, [1 / 35, 1 / 25], [0.3, 0.55], 0.25);
    pool.stream(SOUL_MOTE, per(m, 1.5), L, H, [0, 0.05], [1 / 40, 1 / 28], 0.5);
    if (m.blow) {
      pool.burst(SHADOW_SPARK, 20, L, 0, 0, [0.04, 0.1]);
      pool.smoke(SHADOW, 3, LG, 0, rig.chest, 0.3, 0.008);
    }
  } else if (m.k === 2) {
    if (m.t < m.hit) pool.spiral(WISP, per(m, 2), H, L, [1 / 30, 1 / 20], [0.3, 0.6], 0.25);
    if (m.blow) {
      pool.stream(SOUL_MOTE, 60, L, H, [0, 0.15], [1 / 40, 1 / 22], 0.8);
      pool.burst(SHADOW_SPARK, 50, L, 0, 0, [0.05, 0.16]);
      pool.smoke(SHADOW, 14, LG, 0, rig.chest, 0.5, 0.01);
      pool.burst(DARK_GLOW, 2, L, 0, 0, [0, 0]);
    }
  }
}

/** Touch of Death: dust off the leap, a red pulse out of the loser and a ring of dust at each kick, and their life rising off them at the end. */
function monk(m: Moment): void {
  const { pool } = m;
  const kick = (n: number) => {
    pool.ring(PULSE, n, L, 0, 0, 0.2, [0.06, 0.09], 1);
    dustRing(m, LG, Math.round(n * 0.6), 0.07);
    pool.ring(PULSE, Math.round(n * 0.6), LG, 0, 0.05, 0.3, [0.07, 0.11], 0.3);
    pool.burst(CHI, Math.round(n / 2), L, 0, 0, [0.05, 0.14]);
  };
  if (m.k === 0 && m.t === 0) dust(m, from(m), 8);
  else if ((m.k === 1 || m.k === 2) && m.blow) kick(m.k === 1 ? 40 : 30);
  else if (m.k === 3) {
    if (m.blow) {
      kick(56);
      pool.burst(CRIT, 2, L, 0, 0, [0, 0]);
    }
    if (m.t === m.hit + 8) pool.ring(PULSE, 40, L, 0, 0, 0.3, [0.07, 0.1], 1);
    if (m.t > m.hit && m.t < m.hit + 50) pool.smoke(LIFE, per(m, 1.2), L, 0, 0, 0.4, 0.01);
  }
}

/** Starfall: silver motes drifting down, then stars falling out of the sky with dust behind them, bursting on the loser and around them. */
function druid(m: Moment): void {
  const { pool, rig } = m;
  /** A star that lands `ticks` from now at `x, y` (yards from the loser's feet), from high over them. */
  const fall = (k: typeof STAR, ticks: number, x: number, y: number) => {
    const flight = ticks * m.dt;
    const x0 = x - 1.2 - pool.random() * 1.2;
    const y0 = 7.5 + pool.random();
    const i = pool.spawn(k, LG, LG, 0, x0, y0, (x - x0) / flight, (y - y0) / flight);
    pool.lasting(i, flight - 1e-6);
  };
  if (m.k === 0) pool.rain(MOONMOTE, per(m, 1), LG, 0, 2.6, 4.5, [0.01, 0.025]);
  else if (m.k === 1) {
    const flight = 22;
    // The stars that land on the blows (loosed later for the first, which comes early), and one every four ticks round about.
    for (let blow = m.hit; blow < m.beat.frames; blow += m.beat.repeat ?? m.beat.frames) {
      if (blow - m.t === Math.min(flight, blow)) fall(STAR, blow - m.t, 0, rig.chest * 0.9);
    }
    if (m.t % 4 === 0 && m.t + flight < m.beat.frames + 20) {
      const side = pool.random() < 0.5 ? -1 : 1;
      fall(STAR, flight, side * (0.6 + pool.random() * 1.6), 0);
    }
    pool.rain(MOONMOTE, per(m, 0.6), LG, 0, 2.6, 4.5, [0.01, 0.025]);
    if (m.blow) {
      pool.ring(MOON_RING, 24, LG, 0, rig.chest * 0.9, 0.2, [0.05, 0.09], 1);
      pool.burst(MOON_GLOW, 1, L, 0, 0, [0, 0]);
    }
  } else if (m.k === 2) {
    if (m.t === 0) fall(BIG_STAR, m.hit, 0, rig.chest * 0.9);
    if (m.t % 3 === 0 && m.t < m.hit) fall(STAR, 16, (pool.random() - 0.5) * 4, 0);
    if (m.blow) {
      pool.ring(MOON_RING, 50, LG, 0, 0.05, 0.3, [0.1, 0.16], 0.3);
      pool.ring(MOON_RING, 30, LG, 0, rig.chest * 0.9, 0.25, [0.06, 0.1], 1);
      pool.burst(STAR_SPARK, 60, LG, 0, rig.chest * 0.9, [0.05, 0.16]);
      pool.burst(MOON_GLOW, 2, L, 0, 0, [0, 0]);
    }
  }
}

/** Eye Beam: fel fire behind the rush, a fel ring round the blade dance, and the beam shedding embers and smoke as it burns into the loser. */
function demonhunter(m: Moment): void {
  const { pool, rig } = m;
  const beam = (rate: number) => {
    pool.stream(FEL_EMBER, per(m, rate), E, L, [0, 1], [0.002, 0.008], 0.2, [0.002, 0.008], 0.002);
    pool.stream(FEL_SMOKE, per(m, rate * 0.1), E, L, [0.3, 1], [0, 0.003], 0.3, [0, 0.003], 0.003);
    pool.fountain(FEL_EMBER, rate * 0.8, m.dt, LG, 0, rig.chest, [0.03, 0.09], 0.5, 1.6);
    pool.burst(FEL_GLOW, per(m, 0.6), L, 0, 0, [0, 0]);
    pool.burst(FEL_GLOW, per(m, 0.4), E, 0, 0, [0, 0]);
  };
  if (m.k === 0) {
    if (m.t === 0) pool.burst(FEL_EMBER, 24, from(m), 0, 0.6, [0.02, 0.06]);
    pool.stream(FEL_EMBER, per(m, 2.5), from(m), WG, [0.3, 1], [0, 0], 0.6, [0, 0.01], 0.01);
    pool.stream(FEL_SMOKE, per(m, 0.5), from(m), WG, [0.2, 1], [0, 0], 0.4, [0, 0], 0.006);
  } else if (m.k === 1) {
    spin(m, FEL_BLADE, FEL_SPARK, 16);
    if (m.blow) {
      bleed(m, 30, 0.5, 1.8);
      pool.ring(FEL_SPARK, 30, WG, 0, rig.winnerChest * 0.7, 1.0, [0.1, 0.2], 0.4);
    }
  } else if (m.k === 2) {
    if (m.t === 0) dust(m, from(m), 6);
    if (m.t === m.beat.frames - 1) dust(m, WG, 6);
  } else {
    beam(m.k === 4 ? 4 : 3);
    if (m.blow) {
      pool.burst(FEL_SPARK, m.k === 4 ? 60 : 30, L, 0, 0, [0.05, 0.16]);
      if (m.k === 4) pool.smoke(FEL_SMOKE, 12, LG, 0, rig.chest * 0.7, 0.6, 0.01);
    }
  }
}

/** Deep Breath: dust off the leap, embers drawn into the mouth, then a cone of fire and black smoke over the loser, who burns on after it stops. */
function evoker(m: Moment): void {
  const { pool, rig } = m;
  const breath = (rate: number) => {
    // The cone: each ember flies out along the line and away from it, so the farther it gets the wider it spreads.
    pool.stream(FIRE, per(m, rate), E, L, [0, 0.1], [1 / 22, 1 / 16], 0.1, [0.01, 0.034]);
    pool.stream(FIRE_GLOW, per(m, rate * 0.35), E, L, [0, 0.15], [1 / 22, 1 / 16], 0.15, [0.006, 0.024]);
    pool.stream(BLACK_SMOKE, per(m, rate * 0.12), E, L, [0.6, 1.1], [0, 0.004], 0.6, [0, 0.004], 0.008);
    pool.fountain(CINDER, rate * 0.3, m.dt, LG, 0, rig.chest, [0.02, 0.05], 1.2, 1.6);
  };
  if (m.k === 0) {
    if (m.t === 0) dust(m, from(m), 8);
    if (m.t === m.beat.frames - 1) dust(m, WG, 6);
  } else if (m.k === 1) {
    if (m.t >= 20) pool.implode(FIRE, per(m, 1.5), E, 0, 0, [0.8, 1.4], 18, 0.1);
  } else if (m.k === 2) {
    breath(8);
    if (m.blow) {
      pool.burst(FIRE, 20, L, 0, 0, [0.04, 0.12]);
      pool.smoke(BLACK_SMOKE, 3, LG, 0, rig.chest, 0.4, 0.01);
    }
  } else if (m.k === 3) {
    if (m.t < 30) breath(8);
    if (m.blow) {
      pool.burst(FIRE, 50, L, 0, 0, [0.05, 0.16]);
      pool.burst(FIRE_GLOW, 6, L, 0, 0, [0.01, 0.04]);
    }
    if (m.t > m.hit) {
      pool.smoke(BLACK_SMOKE, per(m, 1.2), LG, 0, rig.chest * 0.6, 0.5, 0.012);
      pool.smoke(CINDER, per(m, 1.5), LG, 0, rig.chest * 0.6, 0.5, 0.01);
    }
  }
}

const SCRIPTS: Record<string, (m: Moment) => void> = { warrior, paladin, hunter, rogue, priest, deathknight, shaman, mage, warlock, monk, druid, demonhunter, evoker };

// ---------------------------------------------------------------------------------------------
// Running it.

/** The beat and tick of the scene's tick `T` (counted from the fatality's first), or undefined past its end. */
export function beatAt(spec: Fatality, T: number): { k: number; t: number } | undefined {
  let t = T;
  for (let k = 0; k < spec.beats.length; k++) {
    const frames = spec.beats[k]!.frames;
    if (t < frames) return { k, t };
    t -= frames;
  }
  return undefined;
}

/** The seed of a beat's particles: the match's frame the fatality began on and the beat, so each fatality throws its own and both screens the same. */
export function beatSeed(start: number, k: number): number {
  return (start * 16 + k) | 0;
}

/**
 * The scene's particles, kept in step with the match. `advance` brings the pool to the tick the
 * scene is on: forward one tick at a time, or, when the match is not the one it was following
 * (a new fatality, a rematch, different bodies) or has gone back, from nothing at the scene's
 * first tick. Either way the pool ends up the same.
 */
export class FatalityFx {
  readonly pool = new Pool();
  private key = '';
  /** Ticks the pool has been stepped through. */
  tick = 0;
  /**
   * Where the winner stood as each beat began, as the HUD saw it during the beat: the engine keeps
   * only the current beat's, and dust kicked up at the start of a leap should stay there after.
   * Not part of the pool; a beat the HUD never drew during falls back to the current one.
   */
  private froms: number[] = [];

  /** The winner stood at `x` when beat `k` began. */
  note(k: number, x: number): void {
    this.froms[k] = x;
  }

  /** Where the winner stood when beat `k` began, or `x` when the HUD never saw it. */
  fromOf(k: number, x: number): number {
    return this.froms[k] ?? x;
  }

  advance(spec: Fatality, start: number, rig: Rig, target: number): void {
    const key = `${spec.id} ${start} ${rig.chest.toFixed(3)} ${rig.top.toFixed(3)} ${rig.winnerChest.toFixed(3)}`;
    if (key !== this.key || target < this.tick) {
      if (key !== this.key) this.froms = [];
      this.key = key;
      this.tick = 0;
      this.pool.reset(0);
    }
    while (this.tick < target) {
      stepScene(this.pool, spec, start, rig, this.tick);
      this.tick++;
    }
  }
}

/** One tick of the scene: the beat's script, then the pool moves on at the beat's time scale. After the last beat (the knockout's slow motion) nothing new is made and what is there settles. */
export function stepScene(pool: Pool, spec: Fatality, start: number, rig: Rig, T: number): void {
  const at = beatAt(spec, T);
  if (!at) {
    pool.step(KO_SLOWMO.rate);
    return;
  }
  const beat = spec.beats[at.k]!;
  if (at.t === 0) pool.seed(beatSeed(start, at.k));
  const dt = beat.slowmo ?? 1;
  SCRIPTS[spec.id]?.({ pool, rig, k: at.k, beat, t: at.t, dt, frame: start + T + 1, blow: isBlow(beat, at.t), hit: impactFrame(beat) });
  pool.step(dt);
}
