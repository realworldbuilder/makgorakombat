import { BRAND } from '../engine/brand';
import type { FloatingText, Match } from '../engine/engine';
import { directionOf, type FatalityEffect, impactFrame, type SequenceToken, STEP_FRAMES } from '../engine/fatalities';
import { actionLabel, type InputSource } from '../engine/input';
import { FINISH_FRAMES, HALF, HP, ROUND_FRAMES } from '../engine/stage';
import { type AnchorAt, ATTACH } from './fx';
import { drawSpells } from './fx2d';

/*
 * What is drawn over the ring and belongs to the world: the ground line, the nameplates with
 * their slivers of health, cast bars and stun stars, the hit sparks, the spells in flight, the
 * numbers and words that float off a hit, and the words that slam in (ROUND 1, FIGHT!, K.O.);
 * during the finish the fatality's key sequence on the winner's side, and during the fatality
 * itself the class's effect over the pair, a flash at the blow, letterbox bars and a red vignette.
 * The unit frames, action bars and clock are the DOM layer's (ui/FightUi.tsx). Plain 2D canvas,
 * redrawn each frame.
 */

export type Project = (point: readonly [number, number, number]) => [number, number] | undefined;

const SERIF = "'Cinzel', 'Palatino', serif";
const HEAVY = "'Metal Mania', 'Impact', sans-serif";
const GOLD = '#ffd100';
const BONE = '#f4f1e6';
/** Where the engine floats words over a fighter: this far above the feet, as for a human. */
const TEXT_Z = 2.3;
/** A human male's head, standing: the heights the engine uses (a spark at the chest, a word over the head) are his. */
export const HUMAN_HEAD = 1.85;
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

  groundLine(ctx, at);
  hurtFlash(ctx, w, h, match, human);
  nameplates(ctx, match, names, at, bodies);
  sparks(ctx, match, at, bodies);
  drawSpells(ctx, match, at, options.anchor ?? (() => undefined));
  fatalityEffects(ctx, w, h, match, at, bodies);
  floatingTexts(ctx, match, at, human, bodies);
  sequencePrompt(ctx, w, h, match, sources);
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

/** The ground line, where the fighters' feet are. */
function groundLine(ctx: CanvasRenderingContext2D, at: (p: readonly [number, number, number]) => [number, number] | undefined): void {
  const left = at([-HALF - 0.5, 0, 0]);
  const right = at([HALF + 0.5, 0, 0]);
  if (!left || !right) return;
  const gradient = ctx.createLinearGradient(left[0], 0, right[0], 0);
  gradient.addColorStop(0, 'rgba(255, 209, 0, 0)');
  gradient.addColorStop(0.5, 'rgba(255, 209, 0, 0.55)');
  gradient.addColorStop(1, 'rgba(255, 209, 0, 0)');
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left[0], left[1] + 2);
  ctx.lineTo(right[0], right[1] + 2);
  ctx.stroke();
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

/** Spells in flight glow; arrows and shots streak. */
/** The words of the hit table and the status effects, in white small caps; a crit in yellow. */
const WHITE = '#f4f1e6';
const RED = '#ff3b3b';

interface TextStyle {
  size: number;
  colour: string;
  font: string;
  /** A word, drawn in the serif small caps; a number in the heavy face. */
  word: boolean;
}

/**
 * How a floating text looks: numbers are white when dealt by a player's fighter, red when a
 * player's fighter takes them from the computer, yellow and large for a crit; words are white.
 */
function styleOf(text: FloatingText, human: [boolean, boolean]): TextStyle {
  const incoming = human[text.side] && !human[text.from];
  switch (text.kind) {
    case 'damage':
      return { size: 26, colour: incoming ? RED : WHITE, font: HEAVY, word: false };
    case 'crit':
      return { size: 40, colour: incoming ? RED : GOLD, font: HEAVY, word: false };
    case 'dot':
      return { size: 18, colour: incoming ? RED : WHITE, font: HEAVY, word: false };
    case 'heal':
      return { size: 26, colour: '#7bd88f', font: HEAVY, word: false };
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
  }
}

/**
 * Numbers and words rise off the head of the fighter they concern, above the nameplate, fanning a
 * little left and right so hits that land together do not overlap, and fade over 1.2 s. A crit
 * arrives large and bounces into place.
 */
function floatingTexts(ctx: CanvasRenderingContext2D, match: Match, at: (p: readonly [number, number, number]) => [number, number] | undefined, human: [boolean, boolean], bodies: Bodies): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Texts born on the same frame over the same fighter stack up instead of overlapping.
  const stack: Record<string, number> = {};
  for (const text of match.texts) {
    // The refusals (NOT ENOUGH RAGE, OUT OF RANGE) are the DOM layer's to show, from the view's `notice`.
    if (text.kind === 'info') continue;
    const style = styleOf(text, human);
    const key = `${text.side}:${text.t}`;
    const slot = stack[key] ?? 0;
    stack[key] = slot + 1;
    // The engine floats a word at a human's head; it rises off this fighter's nameplate instead.
    const raw = at([text.x, 0, text.z - TEXT_Z + bodies.plate(text.side)]);
    if (!raw) continue;
    // Off a nameplate kept on screen, the words start from where the plate is drawn.
    const p: [number, number] = [raw[0], Math.max(PLATE_TOP, raw[1])];
    const born = match.frame - text.t;
    // The fan: each text takes a lane from -2 to 2 by its birth frame, so a stream of hits spreads out.
    const lane = ((born * 7 + slot * 3) % 5) - 2;
    const rise = text.t * 0.85;
    const x = p[0] + lane * 16;
    const y = p[1] - 30 - rise - slot * 22;
    const fade = Math.min(1, (text.life - text.t) / 18);
    let scale = 1;
    if (text.kind === 'crit') {
      // Arrives at 1.7×, lands by frame 5, dips to 0.9× and settles by frame 10.
      scale = text.t < 5 ? 1.7 - 0.14 * text.t : text.t < 10 ? 1 - 0.1 * Math.sin(((text.t - 5) / 5) * Math.PI) : 1;
    } else if (text.kind === 'damage' || text.kind === 'heal') {
      scale = text.t < 4 ? 1.25 - 0.0625 * text.t : 1;
    }
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.font = style.word ? `700 ${style.size}px ${style.font}` : `${style.size}px ${style.font}`;
    ctx.lineWidth = style.size > 30 ? 6 : 4;
    ctx.strokeStyle = 'rgba(20, 5, 5, 0.9)';
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

/** A repeatable jitter in [0, 1) from an integer, so effects flicker the same way on every frame count. */
function jitter(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

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
function sequencePrompt(ctx: CanvasRenderingContext2D, w: number, h: number, match: Match, sources: [InputSource, InputSource]): void {
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
    const label = glyphOf(token, fighter.facing, winner, sources[winner]);
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

/** The beat's effect, over the pair, in the class's colour. */
function fatalityEffects(ctx: CanvasRenderingContext2D, w: number, h: number, match: Match, at: At, bodies: Bodies): void {
  const run = match.fatality;
  const winner = match.roundWinner;
  if (!run || winner === undefined || match.phase !== 'fatality') return;
  const spec = match.tables[winner].fatality.spec;
  const beat = spec.beats[run.beat];
  if (!beat?.effect) return;
  const lf = match.fighters[winner === 0 ? 1 : 0];
  const loser = winner === 0 ? 1 : 0;
  // Each spot on the body itself: the eyes where the posed head is (Eye Beam, fire from the mouth), the chests, the top of the loser's head.
  const spots = {
    winner: at(bodies.chest(winner)),
    head: at(bodies.eyes(winner)),
    loser: at(bodies.chest(loser)),
    feet: at([lf.x, 0, 0]),
    top: at([lf.x, 0, lf.z + bodies.head(loser) + 0.3 * bodies.size(loser)]),
  };
  if (!spots.winner || !spots.head || !spots.loser || !spots.feet || !spots.top) return;
  effect(ctx, w, h, beat.effect, spec.colour, run.t / beat.frames, match.frame, spots as Record<keyof typeof spots, [number, number]>);
}

interface Spots {
  winner: [number, number];
  head: [number, number];
  loser: [number, number];
  feet: [number, number];
  top: [number, number];
}

/**
 * The effects: a shockwave from the loser's feet, lightning from the sky, frost shards that grow
 * and then shatter, shadow tendrils and smoke, a fel beam from the winner's eyes, blood off the
 * loser, moonlight and falling stars, a pillar of light, a volley of arrows, a cone of fire.
 * `s` is how far through the beat; `frame` drives the flicker. All in HUD units.
 */
function effect(ctx: CanvasRenderingContext2D, w: number, h: number, kind: FatalityEffect, colour: string, s: number, frame: number, p: Spots): void {
  const rgba = (a: number): string => `rgba(${colour}, ${a})`;
  const disc = (x: number, y: number, r: number, inner: string, outer: string): void => {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, inner);
    glow.addColorStop(1, outer);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const line = (ax: number, ay: number, bx: number, by: number): void => {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  };
  ctx.save();
  // Light adds up; blood and ice are things, drawn over the scene.
  ctx.globalCompositeOperation = kind === 'blood' || kind === 'frost' || kind === 'shatter' ? 'source-over' : 'lighter';
  ctx.lineCap = 'round';
  switch (kind) {
    case 'shockwave': {
      for (let i = 0; i < 3; i++) {
        const ss = Math.min(1, s * 1.4 - i * 0.15);
        if (ss <= 0) continue;
        const rx = 30 + 320 * ss;
        ctx.strokeStyle = rgba(0.9 * (1 - ss));
        ctx.lineWidth = 8 * (1 - ss) + 1;
        ctx.beginPath();
        ctx.ellipse(p.feet[0], p.feet[1], rx, rx * 0.28, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      disc(p.loser[0], p.loser[1], 90, rgba(0.5 * (1 - s)), rgba(0));
      break;
    }
    case 'lightning': {
      const seed = Math.floor(frame / 3);
      const on = frame % 14 < 8;
      for (let b = 0; b < 3; b++) {
        const alpha = (on ? 1 : 0.25) * (b === 0 ? 1 : 0.6);
        const x0 = p.top[0] + (jitter(seed + b * 17) - 0.5) * 260;
        const steps = 9;
        const path: [number, number][] = [];
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const wobble = k === 0 || k === steps ? 0 : (jitter(seed * 7 + b * 31 + k) - 0.5) * 70;
          path.push([x0 + (p.top[0] - x0) * t + wobble, -10 + (p.top[1] + 10) * t]);
        }
        for (const [width, a] of [[9, 0.35 * alpha], [3.5, 0.8 * alpha], [1.5, alpha]] as const) {
          ctx.strokeStyle = width > 2 ? rgba(a) : `rgba(255, 255, 255, ${a})`;
          ctx.lineWidth = width;
          ctx.beginPath();
          path.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
          ctx.stroke();
        }
      }
      disc(p.top[0], p.top[1], 90, rgba(on ? 0.7 : 0.2), rgba(0));
      break;
    }
    case 'frost':
    case 'shatter': {
      const grow = kind === 'frost' ? Math.min(1, s * 1.5) : 1;
      const fly = kind === 'shatter' ? s : 0;
      const [cx, cy] = p.loser;
      ctx.globalCompositeOperation = 'lighter';
      disc(cx, cy, 120 * grow, rgba(0.45 * (1 - fly)), rgba(0));
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + jitter(i) * 0.4;
        const len = (60 + 90 * jitter(i + 5)) * grow;
        const base = 14 + 10 * jitter(i + 9);
        const off = fly * 260 * (0.6 + jitter(i + 3));
        const ox = cx + Math.cos(a) * off;
        const oy = cy + Math.sin(a) * off + fly * fly * 300;
        const tx = ox + Math.cos(a) * len;
        const ty = oy + Math.sin(a) * len;
        const nx = -Math.sin(a) * base / 2;
        const ny = Math.cos(a) * base / 2;
        const ice = ctx.createLinearGradient(ox, oy, tx, ty);
        ice.addColorStop(0, `rgba(200, 236, 255, ${0.95 * (1 - fly)})`);
        ice.addColorStop(1, `rgba(255, 255, 255, ${0.6 * (1 - fly)})`);
        ctx.fillStyle = ice;
        ctx.strokeStyle = `rgba(40, 110, 190, ${0.9 * (1 - fly)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(ox + nx, oy + ny);
        ctx.lineTo(ox - nx, oy - ny);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 'shadow': {
      const [ax, ay] = p.winner;
      const [bx, by] = p.loser;
      for (let i = 0; i < 6; i++) {
        const wobble = Math.sin(frame * 0.18 + i * 1.7) * (40 + i * 10);
        const mx = (ax + bx) / 2 + wobble * 0.3;
        const my = (ay + by) / 2 + wobble - 30;
        ctx.strokeStyle = i % 2 ? rgba(0.75) : 'rgba(40, 0, 60, 0.85)';
        ctx.lineWidth = 2 + (i % 3) * 1.5;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo(mx, my, bx + Math.sin(frame * 0.3 + i) * 12, by + Math.cos(frame * 0.27 + i) * 18);
        ctx.stroke();
      }
      for (let i = 0; i < 5; i++) {
        const t = (frame * 0.02 + i / 5) % 1;
        disc(bx + Math.sin(i * 2.1 + frame * 0.05) * 30, by - 60 * t, 20 + 40 * t, rgba(0.35 * (1 - t)), rgba(0));
      }
      break;
    }
    case 'fel': {
      const [ax, ay] = p.head;
      const [bx, by] = p.loser;
      const pulse = 0.85 + 0.15 * Math.sin(frame * 0.6);
      for (const [width, a, white] of [[34, 0.22, false], [16, 0.55, false], [5, 0.95, true]] as const) {
        ctx.strokeStyle = white ? 'rgba(235, 255, 220, 0.95)' : rgba(a);
        ctx.lineWidth = width * pulse;
        line(ax, ay, bx, by);
      }
      disc(bx, by, 80, rgba(0.6), rgba(0));
      disc(ax, ay, 30, rgba(0.8), rgba(0));
      break;
    }
    case 'blood': {
      const [cx, cy] = p.loser;
      for (let i = 0; i < 24; i++) {
        const t = s - jitter(i + 1) * 0.5;
        if (t < 0) continue;
        const a = -Math.PI / 2 + (jitter(i + 7) - 0.5) * 2.4;
        const v = 160 + 260 * jitter(i + 13);
        const x = cx + Math.cos(a) * v * t;
        const y = cy + Math.sin(a) * v * t + 900 * t * t;
        const r = 4 + 6 * jitter(i + 2);
        ctx.fillStyle = `rgba(170, 8, 18, ${Math.max(0, 1 - t * 1.5)})`;
        ctx.beginPath();
        // A drop: round, drawn out along its flight.
        ctx.ellipse(x, y, r, r * 1.6, a + Math.PI / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'moon':
    case 'light': {
      const [fx, fy] = p.feet;
      const half = kind === 'moon' ? 110 : 90;
      const column = ctx.createLinearGradient(fx - half, 0, fx + half, 0);
      column.addColorStop(0, rgba(0));
      column.addColorStop(0.5, rgba(0.35));
      column.addColorStop(1, rgba(0));
      ctx.fillStyle = column;
      ctx.fillRect(fx - half, 0, half * 2, fy);
      const core = ctx.createLinearGradient(fx - 25, 0, fx + 25, 0);
      core.addColorStop(0, rgba(0));
      core.addColorStop(0.5, 'rgba(255, 255, 255, 0.45)');
      core.addColorStop(1, rgba(0));
      ctx.fillStyle = core;
      ctx.fillRect(fx - 25, 0, 50, fy);
      ctx.fillStyle = rgba(0.4);
      ctx.beginPath();
      ctx.ellipse(fx, fy, 95, 24, 0, 0, Math.PI * 2);
      ctx.fill();
      if (kind === 'moon') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 10; i++) {
          const y = ((frame * 11 + i * 97) % (fy + 80)) - 40;
          const x = fx + (jitter(i) - 0.5) * 260;
          line(x, y - 36, x, y);
        }
      } else {
        ctx.fillStyle = rgba(0.16);
        for (let r = 0; r < 14; r++) {
          const a = (r / 14) * Math.PI * 2 + frame * 0.01;
          ctx.beginPath();
          ctx.moveTo(fx, fy);
          ctx.lineTo(fx + Math.cos(a) * 460, fy + Math.sin(a) * 460);
          ctx.lineTo(fx + Math.cos(a + 0.06) * 460, fy + Math.sin(a + 0.06) * 460);
          ctx.closePath();
          ctx.fill();
        }
      }
      break;
    }
    case 'arrows': {
      const [ax, ay] = p.winner;
      const [bx, by] = p.loser;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      for (let i = 0; i < 6; i++) {
        const t = (s * 4 + i / 6) % 1;
        const x = ax + dx * t;
        const y = ay + dy * t - Math.sin(t * Math.PI) * 30 * (jitter(i) - 0.5);
        ctx.strokeStyle = 'rgba(255, 240, 210, 0.95)';
        ctx.lineWidth = 2.5;
        line(x - (dx / len) * 44, y - (dy / len) * 44, x, y);
        ctx.fillStyle = rgba(1);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'fire': {
      const [ax, ay] = p.head;
      const [bx, by] = p.loser;
      const flicker = 0.9 + 0.2 * Math.sin(frame * 0.7) + 0.1 * Math.sin(frame * 1.9);
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const reach = 1.25;
      for (const [spread, a, col] of [[95, 0.35, '200, 30, 10'], [60, 0.5, colour], [28, 0.65, '255, 240, 150']] as const) {
        const sp = spread * flicker;
        const ex = ax + dx * reach;
        const ey = ay + dy * reach;
        ctx.fillStyle = `rgba(${col}, ${a})`;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ex + nx * sp, ey + ny * sp);
        ctx.lineTo(ex - nx * sp, ey - ny * sp);
        ctx.closePath();
        ctx.fill();
      }
      for (let i = 0; i < 14; i++) {
        const t = (frame * 0.03 + jitter(i)) % 1;
        const x = ax + dx * t * reach + nx * (jitter(i + 3) - 0.5) * 120 * t;
        const y = ay + dy * t * reach + ny * (jitter(i + 5) - 0.5) * 120 * t - 40 * t;
        ctx.fillStyle = rgba(1 - t);
        ctx.beginPath();
        ctx.arc(x, y, 2 + 3 * (1 - t), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
  void w;
  void h;
  ctx.restore();
}

export const roundSeconds = ROUND_FRAMES / 60;
