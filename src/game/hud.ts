import { BRAND } from '../engine/brand';
import type { FloatingText, Match } from '../engine/engine';
import { type Beat, directionOf, impactFrame, type SequenceToken, STEP_FRAMES } from '../engine/fatalities';
import { actionLabel, type InputSource } from '../engine/input';
import { FINISH_FRAMES, HP, HUMAN_HEAD, ROUND_FRAMES } from '../engine/stage';
import { ANCHOR, ANCHORS, BOLTS, boltAt, FatalityFx, jitter, type Rig, SKY } from './fatalityFx';
import { type AnchorAt, ATTACH } from './fx';
import { drawSpells, lightning } from './fx2d';
import { drawParticles, type View } from './particles';

/*
 * What is drawn over the ring and belongs to the world: the nameplates with their
 * slivers of health, cast bars and stun stars, the hit sparks, the spells in flight, the
 * numbers and words that float off a hit, and the words that slam in (ROUND 1, FIGHT!, K.O.);
 * during the finish the fatality's key sequence on the winner's side, and during the fatality
 * itself the class's effect over the pair (particles from fatalityFx.ts, with the few shapes that
 * still read best drawn whole), a flash at the blow, letterbox bars and a red vignette.
 * The unit frames, action bars and clock are the DOM layer's (ui/FightUi.tsx). Plain 2D canvas,
 * redrawn each frame.
 */

export type Project = (point: readonly [number, number, number]) => [number, number] | undefined;

const SERIF = "'Cinzel', 'Palatino', serif";
const HEAVY = "'Metal Mania', 'Impact', sans-serif";
const GOLD = '#ffd100';
const BONE = '#f4f1e6';
/** A nameplate sits this far above the head, for a human; more for a bigger body. */
const PLATE_ABOVE = 0.45;
/** The highest a nameplate goes, in HUD units: under the unit frames, as the game keeps a plate on screen when its head is not. */
const PLATE_TOP = 175;
/** Each of the fatality's letterbox bars, as a fraction of the screen's height. */
export const LETTERBOX = 0.085;

export interface HudOptions {
  /** Which fighters a person plays: a blow they take floats red, as the game shows damage taken. Both by default. */
  human?: [boolean, boolean];
  debug?: string;
  /** What each player plays with, for the sequence prompt's key labels; the keyboard by default. */
  sources?: [InputSource, InputSource];
  /** Whose keys each fighter's prompt shows: its own player's by default; online, both are this keyboard's player 1. */
  keys?: [0 | 1, 0 | 1];
  /** The fighters' attachment points this frame (hands, chest), for the spells to start and land on. */
  anchor?: AnchorAt;
  /** Each fighter's head, standing, in yards above the feet at its own size; a human's when not given. */
  heads?: [number, number];
}

/**
 * Where each fighter's body is, at its own size: a gnome's head is under a yard up, Cairne's near
 * three. Heights the engine gives for a human (a spark at the chest, a word over the head) are
 * stretched to the fighter they concern.
 */
interface Bodies {
  /** Standing head height above the feet. */
  head(i: 0 | 1): number;
  /** Height over a human's. */
  size(i: 0 | 1): number;
  /** Where the eyes are this frame: the posed helm point, following the head through a cast; the standing head without one. */
  eyes(i: 0 | 1): readonly [number, number, number];
  /** The chest this frame. */
  chest(i: 0 | 1): readonly [number, number, number];
  /** The nameplate's height above the feet. */
  plate(i: 0 | 1): number;
  /** The fighter nearest x: whose body a spark is on. */
  nearest(x: number): 0 | 1;
}

function bodiesOf(match: Match, heads: [number, number], anchor: AnchorAt): Bodies {
  const head = (i: 0 | 1) => heads[i];
  const size = (i: 0 | 1) => heads[i] / HUMAN_HEAD;
  return {
    head,
    size,
    eyes: (i) => {
      const f = match.fighters[i];
      return anchor(i, ATTACH.helm) ?? anchor(i, ATTACH.head) ?? [f.x, 0, f.z + head(i)];
    },
    chest: (i) => {
      const f = match.fighters[i];
      return anchor(i, ATTACH.chest) ?? [f.x, 0, f.z + 1.3 * size(i)];
    },
    plate: (i) => head(i) + PLATE_ABOVE * size(i),
    nearest: (x) => (Math.abs(match.fighters[0].x - x) <= Math.abs(match.fighters[1].x - x) ? 0 : 1),
  };
}

export function drawHud(ctx: CanvasRenderingContext2D, width: number, height: number, match: Match, names: [string, string], project: Project, options: HudOptions = {}): void {
  const { debug } = options;
  const human = options.human ?? [true, true];
  const sources = options.sources ?? ['keyboard', 'keyboard'];
  ctx.clearRect(0, 0, width, height);
  const unit = Math.min(width / 1280, height / 720);
  ctx.save();
  ctx.scale(unit, unit);
  const w = width / unit;
  const h = height / unit;
  /** A world point in HUD units. */
  const at = (point: readonly [number, number, number]): [number, number] | undefined => {
    const p = project(point);
    return p ? [p[0] / unit, p[1] / unit] : undefined;
  };

  const bodies = bodiesOf(match, options.heads ?? [HUMAN_HEAD, HUMAN_HEAD], options.anchor ?? (() => undefined));

  hurtFlash(ctx, w, h, match, human);
  nameplates(ctx, match, names, at, bodies);
  sparks(ctx, match, at, bodies);
  drawSpells(ctx, match, at, options.anchor ?? (() => undefined));
  fatalityEffects(ctx, match, at, bodies, options.anchor ?? (() => undefined));
  floatingTexts(ctx, match, at, human, bodies, w);
  sequencePrompt(ctx, w, h, match, sources, options.keys ?? [0, 1]);
  cinematic(ctx, w, h, match);
  banner(ctx, w, h, match);

  if (debug) {
    ctx.font = '12px monospace';
    ctx.fillStyle = '#7bd88f';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(debug, 12, h - 8);
  }
  ctx.restore();
}

/** A thin plate over each head: the name, a sliver of health, the cast bar while casting, stars while stunned. */
function nameplates(ctx: CanvasRenderingContext2D, match: Match, names: [string, string], at: (p: readonly [number, number, number]) => [number, number] | undefined, bodies: Bodies): void {
  // The scene plays without plates.
  if (match.fatality && (match.phase === 'fatality' || match.phase === 'ko')) return;
  match.fighters.forEach((fighter, i) => {
    if (fighter.state === 'death') return;
    // Over the standing head, as the game hangs a nameplate: it does not bob with the animation.
    const head = at([fighter.x, 0, bodies.plate(i as 0 | 1) + fighter.z]);
    if (!head) return;
    const hx = head[0];
    const hy = Math.max(PLATE_TOP, head[1]);
    const width = 96;
    ctx.font = `700 12px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(names[i]!, hx, hy - 10);
    ctx.fillStyle = i === 0 ? '#7bd88f' : '#ff7a6a';
    ctx.fillText(names[i]!, hx, hy - 10);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(hx - width / 2 - 1, hy - 8, width + 2, 7);
    const life = Math.max(0, Math.min(1, fighter.hp / HP));
    ctx.fillStyle = life > 0.3 ? '#c8121c' : '#ff5a2a';
    ctx.fillRect(hx - width / 2, hy - 7, width * life, 5);
    if (fighter.absorb > 0) {
      ctx.fillStyle = 'rgba(244, 241, 230, 0.8)';
      ctx.fillRect(hx - width / 2 + width * life, hy - 7, width * Math.min(1 - life, fighter.absorb / HP), 5);
    }
    // Damage over time: a purple square for each.
    fighter.dots.forEach((_, k) => {
      ctx.fillStyle = '#9b59ff';
      ctx.fillRect(hx + width / 2 + 4 + k * 8, hy - 7, 5, 5);
    });
    // The cast bar.
    if (fighter.cast && fighter.state === 'cast') {
      const ability = match.tables[i]!.kit.abilities[fighter.cast.ability]!;
      const share = Math.min(1, fighter.cast.t / fighter.cast.total);
      const cw = 120;
      const cy = hy + 4;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(hx - cw / 2 - 1, cy - 1, cw + 2, 12);
      ctx.fillStyle = GOLD;
      ctx.fillRect(hx - cw / 2, cy, cw * share, 10);
      ctx.strokeStyle = 'rgba(255, 209, 0, 0.8)';
      ctx.lineWidth = 1;
      ctx.strokeRect(hx - cw / 2, cy, cw, 10);
      ctx.font = `700 11px ${SERIF}`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = BONE;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(ability.name.toUpperCase(), hx, cy + 13);
      ctx.fillText(ability.name.toUpperCase(), hx, cy + 13);
    }
    // Stars circle a stunned head.
    if (fighter.state === 'stun' && fighter.stunT > 0) {
      ctx.font = `16px serif`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = GOLD;
      for (let s = 0; s < 3; s++) {
        const angle = match.frame * 0.12 + (s * Math.PI * 2) / 3;
        ctx.fillText('★', hx + Math.cos(angle) * 26, hy - 24 + Math.sin(angle) * 7);
      }
    }
  });
}

/** A red flash at the edges of the screen when a player's fighter takes a blow from the computer; deeper for a crit. */
function hurtFlash(ctx: CanvasRenderingContext2D, w: number, h: number, match: Match, human: [boolean, boolean]): void {
  let strength = 0;
  for (const text of match.texts) {
    if (text.t > 14 || !human[text.side] || human[text.from]) continue;
    if (text.kind !== 'damage' && text.kind !== 'crit') continue;
    strength = Math.max(strength, (text.kind === 'crit' ? 0.55 : 0.3) * (1 - text.t / 14));
  }
  if (strength <= 0) return;
  const glow = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.85);
  glow.addColorStop(0, 'rgba(200, 0, 0, 0)');
  glow.addColorStop(1, `rgba(200, 0, 0, ${strength})`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
}

/** Sparks where a blow landed: yellow hit, orange crit, blue-white block, silver parry, violet spell. */
function sparks(ctx: CanvasRenderingContext2D, match: Match, at: (p: readonly [number, number, number]) => [number, number] | undefined, bodies: Bodies): void {
  for (const spark of match.sparks) {
    // The engine puts a spark at a human's chest height; it lands on the body it struck, at that body's size.
    const on = bodies.nearest(spark.x);
    const feet = match.fighters[on].z;
    const p = at([spark.x, 0, feet + (spark.z - feet) * bodies.size(on)]);
    if (!p) continue;
    const [sx, sy] = p;
    const life = Math.max(0, 1 - spark.t / Math.max(1, spark.life));
    const colour = { hit: '255, 220, 90', crit: '255, 120, 40', block: '140, 200, 255', parry: '230, 230, 240', spell: '190, 120, 255', dot: '170, 90, 255' }[spark.kind];
    if (spark.kind === 'dot') {
      // A dot's tick: motes drifting up off the body.
      ctx.fillStyle = `rgba(${colour}, ${life})`;
      for (let m = 0; m < 5; m++) {
        const angle = m * 1.3 + spark.t * 0.05;
        ctx.beginPath();
        ctx.arc(sx + Math.cos(angle) * (10 + m * 4), sy - spark.t * 2.5 + Math.sin(angle) * 6, 3 * life + 1, 0, Math.PI * 2);
        ctx.fill();
      }
      continue;
    }
    ctx.strokeStyle = `rgba(${colour}, ${life})`;
    ctx.lineWidth = (spark.kind === 'crit' ? 5 : 3.5) * life + 1;
    const rays = spark.kind === 'block' || spark.kind === 'parry' ? 6 : spark.kind === 'crit' ? 14 : 10;
    const reach = (spark.kind === 'crit' ? 34 : 24) + spark.t * (spark.kind === 'crit' ? 6 : 4);
    // A flash at the point of impact on the first frames.
    if (spark.t < 4 && spark.kind !== 'block' && spark.kind !== 'parry') {
      const flash = ctx.createRadialGradient(sx, sy, 0, sx, sy, spark.kind === 'crit' ? 60 : 36);
      flash.addColorStop(0, `rgba(255, 250, 230, ${0.8 * (1 - spark.t / 4)})`);
      flash.addColorStop(1, `rgba(${colour}, 0)`);
      ctx.fillStyle = flash;
      ctx.beginPath();
      ctx.arc(sx, sy, spark.kind === 'crit' ? 60 : 36, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let r = 0; r < rays; r++) {
      const angle = (r / rays) * Math.PI * 2 + spark.t * 0.1;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(angle) * reach * 0.35, sy + Math.sin(angle) * reach * 0.35);
      ctx.lineTo(sx + Math.cos(angle) * reach, sy + Math.sin(angle) * reach);
      ctx.stroke();
    }
  }
}

/** The words of the hit table and the status effects, in white small caps; a crit in yellow. */
const WHITE = '#f4f1e6';
const RED = '#ff3b3b';
/** The face the game floats damage in (skurri.ttf), read from the install; the heavy face without it. */
const DAMAGE_FONT = `'WoW Skurri', ${HEAVY}`;

/** Spell damage in its school's colour, as the game's combat text colours it; a swing stays white. */
const SCHOOL_COLOURS = {
  holy: '#ffe680',
  fire: '#ff8a1e',
  nature: '#6dff5a',
  frost: '#86f0ff',
  shadow: '#a58cff',
  arcane: '#ff8cff',
} as const;
const SCHOOLS: Record<string, keyof typeof SCHOOL_COLOURS> = {
  crusaderStrike: 'holy', hammerOfJustice: 'holy', holyNova: 'holy',
  livingFlame: 'fire', fireBreath: 'fire',
  lightningBolt: 'nature', earthShock: 'nature', stormstrike: 'nature', wrath: 'nature',
  frostbolt: 'frost', frostNova: 'frost', icyTouch: 'frost',
  shadowBolt: 'shadow', corruption: 'shadow', howlOfTerror: 'shadow', mindBlast: 'shadow', deathCoil: 'shadow',
  moonfire: 'arcane',
};

interface TextStyle {
  size: number;
  colour: string;
  font: string;
  /** A word, drawn in the serif small caps; a number in the damage face. */
  word: boolean;
}

/**
 * How a floating text looks: numbers are white when dealt by a player's fighter (a spell's in its
 * school's colour), red when a player's fighter takes them from the computer, large for a crit and
 * a little larger the harder the blow; words are white.
 */
function styleOf(text: FloatingText, human: [boolean, boolean]): TextStyle {
  const incoming = human[text.side] && !human[text.from];
  const school = text.spell ? SCHOOLS[text.spell] : undefined;
  const dealt = school ? SCHOOL_COLOURS[school] : WHITE;
  // A 25-point blow stands a quarter taller than a 5-point one.
  const weight = 0.9 + 0.3 * Math.min(1, (Number(text.text) || 0) / 25);
  switch (text.kind) {
    case 'damage':
      return { size: 28 * weight, colour: incoming ? RED : dealt, font: DAMAGE_FONT, word: false };
    case 'crit':
      return { size: 42 * weight, colour: incoming ? RED : school ? dealt : GOLD, font: DAMAGE_FONT, word: false };
    case 'dot':
      return { size: 21, colour: incoming ? RED : dealt, font: DAMAGE_FONT, word: false };
    case 'heal':
      return { size: 28, colour: '#7bd88f', font: DAMAGE_FONT, word: false };
    case 'absorb':
    case 'block':
      return { size: 18, colour: WHITE, font: SERIF, word: true };
    case 'miss':
    case 'dodge':
    case 'parry':
    case 'immune':
      return { size: 19, colour: WHITE, font: SERIF, word: true };
    case 'status':
      return { size: 18, colour: '#ffb347', font: SERIF, word: true };
    case 'info':
      return { size: 13, colour: '#ff8a8a', font: SERIF, word: true };
    case 'combo':
      return { size: 24, colour: GOLD, font: SERIF, word: true };
  }
}

/** Each text's lane in its fighter's spray, kept from the frame it first shows so it never jumps. */
const lanes = new WeakMap<FloatingText, number>();
/** A lane is free again once the text in it has flown this many frames clear. */
const LANE_BUSY = 26;

function laneOf(match: Match, text: FloatingText): number {
  let lane = lanes.get(text);
  if (lane !== undefined) return lane;
  const taken = new Set<number>();
  for (const other of match.texts) {
    if (other === text || other.side !== text.side || other.t >= LANE_BUSY) continue;
    const l = lanes.get(other);
    if (l !== undefined) taken.add(l);
  }
  lane = 0;
  while (taken.has(lane)) lane++;
  lanes.set(text, lane);
  return lane;
}

/**
 * Numbers and words come off the fighter they concern the way the game's combat text does: they
 * appear in the air beside the head, on the far side from the other fighter so they never sit in
 * the tangle between the two, and arc up and outward as they fade. Blows that land together take
 * lanes down the body and fan wider, so a flurry reads as a spray of numbers rather than a pile.
 * A crit punches in large, holds a beat, then flies.
 */
function floatingTexts(ctx: CanvasRenderingContext2D, match: Match, at: (p: readonly [number, number, number]) => [number, number] | undefined, human: [boolean, boolean], bodies: Bodies, w: number): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const text of match.texts) {
    // The refusals (NOT ENOUGH RAGE, OUT OF RANGE) are the DOM layer's to show, from the view's `notice`.
    if (text.kind === 'info') continue;
    const side = text.side;
    const f = match.fighters[side];
    const o = match.fighters[side === 0 ? 1 : 0];
    const style = styleOf(text, human);
    const lane = laneOf(match, text);
    // Away from the other fighter; the engine's x is where the text was born, the fighter may have moved on.
    let out: 1 | -1 = f.x > o.x ? 1 : f.x < o.x ? -1 : f.facing === 1 ? -1 : 1;
    const size = bodies.size(side);
    const head = bodies.head(side);
    // Beside the head, a lane further down the body for each text already rising.
    const z = f.z + head * (0.92 - 0.13 * Math.min(lane, 3));
    let start = at([f.x + out * 0.6 * size, 0, z]);
    if (!start) continue;
    // Too near the edge to fly outward: fly inward over the head instead.
    if ((out > 0 && start[0] > w - 150) || (out < 0 && start[0] < 150)) {
      out = out > 0 ? -1 : 1;
      start = at([f.x + out * 0.2 * size, 0, z]) ?? start;
    }
    // A crit holds where it lands for 14 frames before it flies.
    const hold = text.kind === 'crit' ? 14 : 0;
    const u = Math.max(0, text.t - hold) / (text.life - hold);
    const eased = 1 - (1 - u) * (1 - u);
    const spread = 1 + 0.35 * (lane % 3);
    const x = start[0] + out * (14 + 58 * spread * eased);
    // Under the unit frames, as the game keeps a plate on screen when its head is not.
    const y = Math.max(PLATE_TOP + 20, start[1]) - 78 * eased + 12 * u * u;
    const fade = Math.min(1, (text.life - text.t) / 18, (text.t + 1) / 3);
    let scale = 1;
    if (text.kind === 'crit') {
      // Arrives at 1.8×, lands by frame 5, dips to 0.92× and settles by frame 10.
      scale = text.t < 5 ? 1.8 - 0.16 * text.t : text.t < 10 ? 1 - 0.08 * Math.sin(((text.t - 5) / 5) * Math.PI) : 1;
    } else if (!style.word) {
      scale = text.t < 4 ? 1.3 - 0.075 * text.t : 1;
    }
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.font = style.word ? `700 ${style.size}px ${style.font}` : `${Math.round(style.size)}px ${style.font}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = style.size > 34 ? 6 : 4;
    ctx.strokeStyle = 'rgba(10, 4, 4, 0.92)';
    ctx.strokeText(text.text, 0, 0);
    ctx.fillStyle = style.colour;
    ctx.fillText(text.text, 0, 0);
    ctx.restore();
  }
}

/** The words: ROUND 1, FIGHT!, FINISH THE MAK'GORA!, K.O., DISHONOR! */
function banner(ctx: CanvasRenderingContext2D, w: number, h: number, match: Match): void {
  if (!match.banner) return;
  const { text, sub, t, life } = match.banner;
  const grow = Math.min(1, t / 8);
  const scale = 1.6 - 0.6 * (1 - Math.pow(1 - grow, 3));
  const fade = life > 0 ? Math.min(1, Math.max(0, (life - t) / 12)) : 1;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(w / 2, h * 0.42);
  ctx.scale(scale, scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const colourOf = (line: string) => (line === BRAND.fatality ? '#ff2a2a' : line === BRAND.flawless ? '#7bd88f' : GOLD);
  const long = text.length > 12;
  ctx.font = `${long ? 64 : 96}px ${HEAVY}`;
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#2a0606';
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = colourOf(text);
  ctx.fillText(text, 0, 0);
  if (sub) {
    ctx.font = `36px ${HEAVY}`;
    ctx.lineWidth = 6;
    ctx.strokeText(sub, 0, long ? 52 : 72);
    ctx.fillStyle = colourOf(sub);
    ctx.fillText(sub, 0, long ? 52 : 72);
  }
  ctx.restore();
}

type At = (p: readonly [number, number, number]) => [number, number] | undefined;

/** The glyph for a key of the sequence: an arrow for a direction the way the winner faces, else the player's key. */
function glyphOf(token: SequenceToken, facing: 1 | -1, player: 0 | 1, source: InputSource): string {
  const direction = directionOf(token, facing);
  if (direction) return direction === 'left' ? '←' : '→';
  return actionLabel(player, source, token as Exclude<SequenceToken, 'back' | 'forward'>);
}

/**
 * The fatality's key sequence, on the winner's side of the screen during the finish: the
 * fatality's name, a slot per key lit as the keys land, a ring around the next slot counting
 * its 1.5 s down, every slot red while a wrong key's penalty runs, and a bar for the finish
 * window itself. The computer's sequence shows too, with player 2's keys.
 */
function sequencePrompt(ctx: CanvasRenderingContext2D, w: number, h: number, match: Match, sources: [InputSource, InputSource], keys: [0 | 1, 0 | 1]): void {
  const s = match.sequence;
  const winner = match.roundWinner;
  if (match.phase !== 'finish' || !s || winner === undefined) return;
  const fighter = match.fighters[winner];
  const spec = match.tables[winner].fatality.spec;
  const cx = winner === 0 ? w * 0.26 : w * 0.74;
  const cy = h * 0.6;
  const size = 56;
  const gap = 14;
  const n = spec.sequence.length;
  const total = n * size + (n - 1) * gap;
  const arrive = Math.min(1, match.phaseT / 10);
  const wrong = s.penaltyT > 0;
  ctx.save();
  ctx.globalAlpha = arrive;
  ctx.translate(0, (1 - arrive) * 24);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // The name.
  ctx.font = `34px ${HEAVY}`;
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(20, 5, 5, 0.9)';
  ctx.strokeText(spec.name.toUpperCase(), cx, cy - size / 2 - 32);
  ctx.fillStyle = `rgb(${spec.colour})`;
  ctx.fillText(spec.name.toUpperCase(), cx, cy - size / 2 - 32);
  const pulse = 0.5 + 0.5 * Math.sin(match.frame * 0.25);
  spec.sequence.forEach((token, k) => {
    const x = cx - total / 2 + k * (size + gap) + size / 2;
    const lit = k < s.progress;
    const current = k === s.progress && !wrong;
    // A key that just landed glows for a few frames.
    const fresh = lit && k === s.progress - 1 ? Math.max(0, (s.windowT - (STEP_FRAMES - 10)) / 10) : 0;
    if (fresh > 0) {
      const glow = ctx.createRadialGradient(x, cy, size * 0.3, x, cy, size * 1.1);
      glow.addColorStop(0, `rgba(255, 230, 120, ${0.7 * fresh})`);
      glow.addColorStop(1, 'rgba(255, 209, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - size * 1.2, cy - size * 1.2, size * 2.4, size * 2.4);
    }
    ctx.beginPath();
    ctx.roundRect(x - size / 2, cy - size / 2, size, size, 8);
    ctx.fillStyle = wrong ? 'rgba(140, 12, 12, 0.92)' : lit ? GOLD : 'rgba(10, 4, 4, 0.78)';
    ctx.fill();
    ctx.lineWidth = current ? 3 : 2;
    ctx.strokeStyle = wrong ? RED : lit ? '#fff1b0' : current ? `rgba(255, 209, 0, ${0.45 + 0.55 * pulse})` : 'rgba(244, 241, 230, 0.4)';
    ctx.stroke();
    const label = glyphOf(token, fighter.facing, keys[winner], sources[winner]);
    const arrow = label === '←' || label === '→';
    ctx.font = arrow ? 'bold 34px sans-serif' : `${label.length > 2 ? 16 : label.length > 1 ? 24 : 32}px ${HEAVY}`;
    ctx.fillStyle = lit ? '#2a0606' : wrong ? '#ffb0b0' : BONE;
    ctx.fillText(label, x, cy + (arrow ? 0 : 2));
    if (current && s.windowT > 0) {
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, cy, size / 2 + 8, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * s.windowT) / STEP_FRAMES);
      ctx.stroke();
    }
  });
  // The finish window.
  const left = Math.max(0, 1 - match.phaseT / FINISH_FRAMES);
  const by = cy + size / 2 + 18;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.fillRect(cx - total / 2 - 1, by - 1, total + 2, 7);
  ctx.fillStyle = left > 0.35 ? GOLD : RED;
  ctx.fillRect(cx - total / 2, by, total * left, 5);
  ctx.restore();
}

/** How far into the scene the letterbox and vignette are: in over its first frames, out with the round's end. */
function sceneInset(match: Match): number {
  const run = match.fatality;
  if (!run) return 0;
  switch (match.phase) {
    case 'fatality':
      return Math.min(1, run.total / 12);
    case 'ko':
      return 1;
    case 'roundEnd':
      return Math.max(0, 1 - match.phaseT / 15);
    default:
      return 0;
  }
}

/** Letterbox bars and a red vignette for the fatality, and the flash at its blows. */
function cinematic(ctx: CanvasRenderingContext2D, w: number, h: number, match: Match): void {
  const inset = sceneInset(match);
  const run = match.fatality;
  if (inset <= 0 || !run || match.roundWinner === undefined) return;
  if (match.phase === 'fatality') {
    const beat = match.tables[match.roundWinner].fatality.spec.beats[run.beat];
    if (beat?.flash) {
      const since = run.t - (beat.impact ? impactFrame(beat) : 0);
      if (since >= 0 && since < 8) {
        ctx.fillStyle = `rgba(255, 250, 240, ${0.75 * (1 - since / 8)})`;
        ctx.fillRect(0, 0, w, h);
      }
    }
  }
  const strength = (match.phase === 'fatality' ? 0.5 + 0.1 * Math.sin(match.frame * 0.15) : 0.4) * inset;
  const glow = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.9);
  glow.addColorStop(0, 'rgba(120, 0, 0, 0)');
  glow.addColorStop(1, `rgba(120, 0, 0, ${strength})`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  const bar = h * LETTERBOX * inset;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, bar);
  ctx.fillRect(0, h - bar, w, bar);
}

/** The fatality's particles: the HUD's one pool, kept in step with the scene, and where its anchors are this frame. */
const scene = new FatalityFx();
const view: View = { spots: new Float64Array(ANCHORS * 2), dir: 1, yard: 60, tick: 0 };

/** Ticks of the scene so far: from the fatality's first, on through the knockout's slow motion after it while what it threw settles. */
function sceneTick(match: Match): number | undefined {
  const run = match.fatality;
  if (!run) return undefined;
  if (match.phase === 'fatality') return run.total;
  if (match.phase === 'ko') return run.total + match.phaseT - 1;
  return undefined;
}

/**
 * The fatality over the pair, in the class's colours: what still reads best drawn whole (the
 * bolts, the beam, the ice, a pillar of light), and the particles the scene throws over it.
 */
function fatalityEffects(ctx: CanvasRenderingContext2D, match: Match, at: At, bodies: Bodies, anchor: AnchorAt): void {
  const run = match.fatality;
  const winner = match.roundWinner;
  const T = sceneTick(match);
  if (!run || winner === undefined || T === undefined) return;
  const loser = winner === 0 ? 1 : 0;
  const spec = match.tables[winner].fatality.spec;
  const wf = match.fighters[winner];
  const lf = match.fighters[loser];
  const rig: Rig = { chest: 1.3 * bodies.size(loser), top: bodies.head(loser) + 0.3 * bodies.size(loser), winnerChest: 1.3 * bodies.size(winner) };
  scene.advance(spec, match.frame - T, rig, T);
  if (match.phase === 'fatality') scene.note(run.beat, run.fromX);

  const feet = at([lf.x, 0, 0]);
  const up = at([lf.x, 0, 1]);
  const spots = [
    at(bodies.chest(winner)),
    at(bodies.eyes(winner)),
    at(anchor(winner, ATTACH.rightHand) ?? bodies.chest(winner)),
    at([wf.x, 0, 0]),
    at(bodies.chest(loser)),
    feet,
  ];
  for (let k = 0; k < ANCHORS - ANCHOR.from; k++) spots.push(at([scene.fromOf(k, run.fromX), 0, 0]));
  if (!feet || !up) return;
  for (let i = 0; i < spots.length; i++) {
    const p = spots[i];
    if (!p) return;
    view.spots[i * 2] = p[0];
    view.spots[i * 2 + 1] = p[1];
  }
  view.yard = Math.max(8, Math.abs(feet[1] - up[1]));
  view.dir = feet[0] >= view.spots[ANCHOR.winnerFeet * 2]! ? 1 : -1;
  view.tick = T;

  const beat = match.phase === 'fatality' ? spec.beats[run.beat] : undefined;
  if (beat?.effect) effect(ctx, spec.id, beat, run.t, match.frame, spec.colour, rig, view, run.beat);
  drawParticles(ctx, scene.pool, view);
}

/**
 * What is still drawn whole under the particles: Thunderstorm's bolts out of the sky onto the
 * loser's head, the fel beam from the demon hunter's eyes, the mage's ice growing out of the
 * loser until it shatters, and a faint column of light for the paladin's and the druid's
 * pillars. Everything else is particles now. `t` is the tick in the beat; all in HUD units.
 */
function effect(ctx: CanvasRenderingContext2D, id: string, beat: Beat, t: number, frame: number, colour: string, rig: Rig, v: View, k: number): void {
  const rgba = (a: number): string => `rgba(${colour}, ${a})`;
  const s = t / beat.frames;
  const yard = v.yard;
  // The shapes below were first drawn for the camera pushed in, at about 200 units a yard.
  const scale = yard / 200;
  const fx = v.spots[ANCHOR.feet * 2]!;
  const fy = v.spots[ANCHOR.feet * 2 + 1]!;
  const hit = impactFrame(beat);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  switch (beat.effect) {
    case 'lightning': {
      const top: [number, number] = [fx, fy - rig.top * yard];
      for (let b = 0; b < BOLTS; b++) {
        const bolt = boltAt(frame, b);
        const sky: [number, number] = [fx + v.dir * bolt.x * yard, fy - SKY * yard];
        lightning(ctx, sky, top, Math.floor(frame / 3) * 31 + b, colour, (bolt.on ? 1 : 0.25) * (b === 0 ? 1 : 0.6), 2.4 * scale, 3);
      }
      break;
    }
    case 'fel': {
      const ax = v.spots[ANCHOR.eyes * 2]!;
      const ay = v.spots[ANCHOR.eyes * 2 + 1]!;
      const bx = v.spots[ANCHOR.loser * 2]!;
      const by = v.spots[ANCHOR.loser * 2 + 1]!;
      // Only the beam itself; the rush has no beam.
      if (beat.motion) break;
      const pulse = 0.85 + 0.15 * Math.sin(frame * 0.6);
      for (const [width, a, white] of [[46, 0.22, false], [20, 0.5, false], [6, 0.95, true]] as const) {
        ctx.strokeStyle = white ? 'rgba(235, 255, 220, 0.95)' : rgba(a);
        ctx.lineWidth = width * pulse * scale;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      break;
    }
    case 'frost':
    case 'shatter': {
      // The mage's ice: grows over the first beat, holds, and is gone the moment it shatters into shards.
      if (id !== 'mage' || (beat.effect === 'shatter' && t >= hit)) break;
      const grow = k === 0 ? Math.min(1, s * 1.5) : 1;
      const cx = fx;
      const cy = fy - rig.chest * yard;
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + jitter(i) * 0.4;
        const len = (60 + 90 * jitter(i + 5)) * grow * scale;
        const base = (14 + 10 * jitter(i + 9)) * scale;
        const tx = cx + Math.cos(a) * len;
        const ty = cy + Math.sin(a) * len;
        const nx = (-Math.sin(a) * base) / 2;
        const ny = (Math.cos(a) * base) / 2;
        const ice = ctx.createLinearGradient(cx, cy, tx, ty);
        ice.addColorStop(0, 'rgba(200, 236, 255, 0.9)');
        ice.addColorStop(1, 'rgba(255, 255, 255, 0.55)');
        ctx.fillStyle = ice;
        ctx.strokeStyle = 'rgba(40, 110, 190, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(cx + nx, cy + ny);
        ctx.lineTo(cx - nx, cy - ny);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 'moon':
    case 'light': {
      // A faint column the motes and stars fall through, fading in at the beat's start and out after its blow.
      const fade = Math.min(1, s * 4) * (beat.impact && t > hit ? Math.max(0, 1 - (t - hit) / 20) : 1);
      if (fade <= 0) break;
      const half = (beat.effect === 'moon' ? 100 : 80) * scale;
      const column = ctx.createLinearGradient(fx - half, 0, fx + half, 0);
      column.addColorStop(0, rgba(0));
      column.addColorStop(0.5, rgba(0.2 * fade));
      column.addColorStop(1, rgba(0));
      ctx.fillStyle = column;
      ctx.fillRect(fx - half, 0, half * 2, fy);
      const core = ctx.createLinearGradient(fx - half / 4, 0, fx + half / 4, 0);
      core.addColorStop(0, rgba(0));
      core.addColorStop(0.5, `rgba(255, 255, 255, ${0.22 * fade})`);
      core.addColorStop(1, rgba(0));
      ctx.fillStyle = core;
      ctx.fillRect(fx - half / 4, 0, half / 2, fy);
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

export const roundSeconds = ROUND_FRAMES / 60;
