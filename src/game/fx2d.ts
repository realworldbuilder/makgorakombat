import type { Fighter, Match, Projectile, SpellEvent } from '../engine/engine';
import { ATTACH, type AnchorAt, type Point, flightAt } from './fx';

/*
 * The spells as light over the ring, on the HUD's canvas: each ability of the kits drawn as what
 * it is (a forked bolt for Lightning Bolt, a column from the sky for Moonfire, a gold bubble for
 * Power Word: Shield, a red crescent for Mortal Strike ...), timed off the engine's spell events
 * and its projectiles, anchored to the caster's hands and the target's chest. The game's own
 * models (fx.ts) are drawn in the ring beneath where the files have them; this layer adds the
 * light the renderer cannot (particles, glows, trails) and stands alone where there is no model.
 *
 * Sizes are in yards, turned to pixels through the camera, so a spell keeps its size as the
 * view pushes in and out. Everything random is seeded from the frame, so a replay draws the same.
 */

type Screen = [number, number];
type At = (point: readonly [number, number, number]) => Screen | undefined;

interface Scene {
  ctx: CanvasRenderingContext2D;
  match: Match;
  at: At;
  anchor: AnchorAt;
  /** Pixels per yard about the middle of the ring. */
  yard: number;
}

/** What a spell's drawing gets: the caster, the target, and this spell's events and projectiles. */
interface Cast {
  s: Scene;
  side: 0 | 1;
  caster: Fighter;
  target: Fighter;
  targetSide: 0 | 1;
  events: SpellEvent[];
  shots: Projectile[];
  /** The ability's index in the kit, or -1 for the auto-shot. */
  index: number;
}

type Style = (cast: Cast) => void;

// ---------------------------------------------------------------------------------------------
// Drawing helpers.

/** A small seeded generator: the same seed gives the same sequence. */
function rng(seed: number): () => number {
  let x = (seed * 2654435761) >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

const rgba = (rgb: string, a: number) => `rgba(${rgb}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** A soft round glow: a white-hot core fading through `rgb` to nothing. */
function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, rgb: string, alpha: number, core = 0.35): void {
  if (radius <= 0 || alpha <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, rgba('255, 255, 245', alpha));
  g.addColorStop(core, rgba(rgb, alpha * 0.8));
  g.addColorStop(1, rgba(rgb, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** A soft cloud of matter (dust, smoke, shadow), painted over what is there rather than added as light. */
function puff(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, rgb: string, alpha: number): void {
  if (radius <= 0 || alpha <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, rgba(rgb, alpha));
  g.addColorStop(0.6, rgba(rgb, alpha * 0.5));
  g.addColorStop(1, rgba(rgb, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A ring, optionally squashed into an ellipse lying on the floor. */
function ring(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rgb: string, alpha: number, width: number): void {
  if (alpha <= 0 || rx <= 0) return;
  ctx.strokeStyle = rgba(rgb, alpha);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, Math.max(0.5, ry), 0, 0, Math.PI * 2);
  ctx.stroke();
}

/** Points of a jagged line from a to b: midpoint displacement, `depth` halvings, each pushed sideways by `rough` of its length. */
function jagged(a: Screen, b: Screen, depth: number, rough: number, random: () => number): Screen[] {
  let points: Screen[] = [a, b];
  for (let level = 0; level < depth; level++) {
    const next: Screen[] = [points[0]!];
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1]!;
      const q = points[i]!;
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const length = Math.hypot(dx, dy) || 1;
      const push = (random() - 0.5) * length * rough;
      next.push([(p[0] + q[0]) / 2 - (dy / length) * push, (p[1] + q[1]) / 2 + (dx / length) * push], q);
    }
    points = next;
  }
  return points;
}

function strokePath(ctx: CanvasRenderingContext2D, points: readonly Screen[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0]![0], points[0]![1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]![0], points[i]![1]);
  ctx.stroke();
}

/**
 * A bolt of lightning from a to b with forks: a wide faint halo, a coloured body and a white core,
 * drawn additively; forks leave the trunk at random points and wander off. `width` is the core's.
 */
export function lightning(ctx: CanvasRenderingContext2D, a: Screen, b: Screen, seed: number, rgb: string, alpha: number, width: number, forks = 3): void {
  if (alpha <= 0) return;
  const random = rng(seed);
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const depth = Math.max(2, Math.min(6, Math.round(Math.log2(Math.max(4, length / 6)))));
  const trunk = jagged(a, b, depth, 0.32, random);
  const branches: Screen[][] = [];
  for (let k = 0; k < forks; k++) {
    const from = trunk[Math.floor(trunk.length * (0.2 + random() * 0.6))]!;
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]) + (random() - 0.5) * 1.8;
    const reach = length * (0.15 + random() * 0.25);
    branches.push(jagged(from, [from[0] + Math.cos(angle) * reach, from[1] + Math.sin(angle) * reach], Math.max(2, depth - 2), 0.45, random));
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [w, colour, a2] of [
    [width * 6, rgb, 0.18],
    [width * 2.4, rgb, 0.6],
    [width, '255, 255, 255', 0.95],
  ] as const) {
    ctx.strokeStyle = rgba(colour, alpha * a2);
    ctx.lineWidth = w;
    strokePath(ctx, trunk);
    ctx.lineWidth = w * 0.55;
    for (const branch of branches) strokePath(ctx, branch);
  }
}

/**
 * A tapered streak from `tail` (a point, faded) to `head` (`width` across, bright), soft-edged:
 * three tapers laid over one another, wide and faint to narrow and hot, the head rounded off.
 */
function streak(ctx: CanvasRenderingContext2D, tail: Screen, head: Screen, width: number, rgb: string, alpha: number): void {
  const dx = head[0] - tail[0];
  const dy = head[1] - tail[1];
  const length = Math.hypot(dx, dy);
  if (length < 1 || alpha <= 0) return;
  for (const [w, a, hot] of [[1, 0.3, false], [0.55, 0.5, false], [0.2, 0.9, true]] as const) {
    const half = (width * w) / 2;
    const nx = (-dy / length) * half;
    const ny = (dx / length) * half;
    const g = ctx.createLinearGradient(tail[0], tail[1], head[0], head[1]);
    g.addColorStop(0, rgba(rgb, 0));
    g.addColorStop(0.6, rgba(rgb, alpha * a * 0.6));
    g.addColorStop(1, rgba(hot ? '255, 255, 240' : rgb, alpha * a));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(tail[0], tail[1]);
    ctx.lineTo(head[0] + nx, head[1] + ny);
    ctx.arc(head[0], head[1], half, Math.atan2(ny, nx), Math.atan2(ny, nx) + Math.PI, true);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * A crescent slash about a centre: the arc from `from` to `to` (radians, screen space), thickest
 * in the middle, swept up to `progress` of the way, in `rgb` with a white edge.
 */
function crescent(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, from: number, to: number, progress: number, thickness: number, rgb: string, alpha: number, squash = 1): void {
  if (alpha <= 0 || progress <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  const end = from + (to - from) * Math.min(1, progress);
  const steps = 24;
  const outer: Screen[] = [];
  const inner: Screen[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const angle = from + (end - from) * t;
    const thick = thickness * Math.sin(Math.PI * t) * (0.4 + 0.6 * t);
    outer.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * squash]);
    inner.push([cx + Math.cos(angle) * (radius - thick), cy + Math.sin(angle) * (radius - thick) * squash]);
  }
  ctx.fillStyle = rgba(rgb, alpha * 0.8);
  ctx.beginPath();
  ctx.moveTo(outer[0]![0], outer[0]![1]);
  for (const p of outer) ctx.lineTo(p[0], p[1]);
  for (let k = inner.length - 1; k >= 0; k--) ctx.lineTo(inner[k]![0], inner[k]![1]);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba('255, 255, 250', alpha);
  ctx.lineWidth = Math.max(1, thickness * 0.15);
  strokePath(ctx, outer);
  ctx.restore();
}

/** Bits flung from a point, falling under gravity: rocks, sparks, drops. `t` is in frames. */
function burst(x: number, y: number, t: number, count: number, speed: number, seed: number, draw: (x: number, y: number, size: number, life: number, k: number) => void, up = 1, gravity = 0.35): void {
  const random = rng(seed);
  for (let k = 0; k < count; k++) {
    const angle = -Math.PI / 2 + (random() - 0.5) * Math.PI * (up < 1 ? 2 : 1.2);
    const v = speed * (0.5 + random() * 0.8);
    const px = x + Math.cos(angle) * v * t;
    const py = y + Math.sin(angle) * v * t * up + gravity * t * t * 0.5;
    draw(px, py, 0.6 + random() * 0.8, t, k);
  }
}

// ---------------------------------------------------------------------------------------------
// Where things are, in pixels.

const handOf = (c: Cast, side: 0 | 1, which: 'right' | 'left'): Screen | undefined => {
  const id = which === 'right' ? ATTACH.rightHand : ATTACH.leftHand;
  const f = c.s.match.fighters[side];
  const point = c.s.anchor(side, id) ?? ([f.x + f.facing * 0.4, 0, f.z + 1.3] as Point);
  return c.s.at(point);
};
const chestOf = (c: Cast, side: 0 | 1): Screen | undefined => {
  const f = c.s.match.fighters[side];
  return c.s.at(c.s.anchor(side, ATTACH.chest) ?? [f.x, 0, f.z + 1.3]);
};
const headOf = (c: Cast, side: 0 | 1): Screen | undefined => {
  const f = c.s.match.fighters[side];
  return c.s.at(c.s.anchor(side, ATTACH.helm) ?? [f.x, 0, f.z + 1.9]);
};
const feetOf = (c: Cast, side: 0 | 1): Screen | undefined => {
  const f = c.s.match.fighters[side];
  return c.s.at([f.x, 0, f.z]);
};
const release = (c: Cast, within: number) => c.events.find((e) => e.kind === 'release' && e.t <= within);
const impact = (c: Cast, within: number) => c.events.find((e) => e.kind === 'impact' && e.t <= within);
/** Fraction of the cast bar filled, when this spell is being cast. */
const casting = (c: Cast): number | undefined => (c.caster.cast && c.caster.cast.ability === c.index ? c.caster.cast.t / Math.max(1, c.caster.cast.total) : undefined);
const shotAt = (c: Cast, shot: Projectile, back = 0): Screen | undefined => c.s.at(flightAt(c.s.match, shot, c.s.anchor, back));

// ---------------------------------------------------------------------------------------------
// The spells.

const BLUE = '120, 170, 255';
const STORM = '150, 200, 255';
const PURPLE = '170, 80, 255';
const GOLD = '255, 205, 90';
const HOLY = '255, 235, 160';
const NATURE = '120, 255, 80';
const MOON = '190, 210, 255';
const FEL = '80, 255, 40';
const BLOOD = '220, 30, 30';
const EMBER = '255, 120, 40';
const DUST = '150, 125, 95';
/** Shadow as matter: a dark violet smoke, painted over. */
const SMOKE = '45, 12, 70';

/** Crackles between the hands while a lightning spell is cast. */
function handCrackle(c: Cast, rgb: string, strength: number): void {
  const { ctx, match, yard } = c.s;
  const right = handOf(c, c.side, 'right');
  const left = handOf(c, c.side, 'left');
  if (!right || !left) return;
  const seed = Math.floor(match.frame / 2) * 31 + c.side;
  glow(ctx, right[0], right[1], yard * 0.35 * strength, rgb, 0.7 * strength);
  glow(ctx, left[0], left[1], yard * 0.35 * strength, rgb, 0.7 * strength);
  lightning(ctx, left, right, seed, rgb, 0.8 * strength, Math.max(1, yard * 0.025), 1);
}

const lightningBolt: Style = (c) => {
  const { ctx, match, yard } = c.s;
  const filled = casting(c);
  if (filled !== undefined) handCrackle(c, BLUE, 0.4 + filled * 0.6);
  for (const shot of c.shots) {
    const hand = handOf(c, c.side, 'right');
    const head = shotAt(c, shot);
    if (!hand || !head) continue;
    // The bolt is a stroke of lightning from the hand to its head, flickering every other frame.
    const fadeIn = Math.max(0.35, 1 - shot.t / 30);
    lightning(ctx, hand, head, Math.floor(match.frame / 2) * 97 + shot.t, BLUE, fadeIn, Math.max(1.2, yard * 0.035), 3);
    glow(ctx, head[0], head[1], yard * 0.55, BLUE, 1);
    if (shot.t < 6) glow(ctx, hand[0], hand[1], yard * (0.9 - shot.t * 0.1), BLUE, 1 - shot.t / 6);
  }
  const hit = impact(c, 14);
  const chest = hit && chestOf(c, c.targetSide);
  if (hit && chest) {
    const life = 1 - hit.t / 14;
    if (hit.t < 4) glow(ctx, chest[0], chest[1], yard * 1.6, BLUE, 1 - hit.t / 4, 0.25);
    glow(ctx, chest[0], chest[1], yard * (0.6 + hit.t * 0.05), BLUE, life);
    ring(ctx, chest[0], chest[1], yard * (0.3 + hit.t * 0.1), yard * (0.3 + hit.t * 0.1), BLUE, life * 0.8, Math.max(1, yard * 0.04));
    const random = rng(hit.t * 13 + 7);
    for (let k = 0; k < 4; k++) {
      const angle = random() * Math.PI * 2;
      const reach = yard * (0.4 + random() * 0.5);
      lightning(ctx, chest, [chest[0] + Math.cos(angle) * reach, chest[1] + Math.sin(angle) * reach], Math.floor(match.frame / 2) * 7 + k, BLUE, life, Math.max(1, yard * 0.02), 1);
    }
  }
};

const earthShock: Style = (c) => {
  const { ctx, match, yard } = c.s;
  const hit = impact(c, 36);
  if (!hit) return;
  const feet = feetOf(c, c.targetSide);
  const chest = chestOf(c, c.targetSide);
  const hand = handOf(c, c.side, 'right');
  if (!feet || !chest) return;
  const t = hit.t;
  // The shock: a short golden bolt from the hand, then the ground breaking under the target.
  if (hand && t < 8) lightning(ctx, hand, chest, Math.floor(match.frame / 2) * 17, GOLD, 1 - t / 8, Math.max(1.2, yard * 0.03), 2);
  const life = 1 - t / 36;
  ring(ctx, feet[0], feet[1], yard * (0.3 + t * 0.08), yard * (0.08 + t * 0.02), GOLD, life * 0.9, Math.max(1, yard * 0.06 * life));
  for (let k = 0; k < 7; k++) {
    const angle = (k / 7) * Math.PI * 2;
    const r = yard * (0.25 + t * 0.05);
    puff(ctx, feet[0] + Math.cos(angle) * r, feet[1] + Math.sin(angle) * r * 0.3, yard * (0.25 + t * 0.012), DUST, life * 0.5);
  }
  glow(ctx, feet[0], feet[1] - yard * 0.1, yard * (0.8 + t * 0.02), GOLD, life * 0.6);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  burst(feet[0], feet[1], t, 12, yard * 0.09, 4242 + hit.x * 10, (x, y, size, _life, k) => {
    ctx.fillStyle = k % 3 === 0 ? rgba('255, 220, 140', life) : rgba('110, 80, 50', life);
    ctx.fillRect(x - size * yard * 0.04, y - size * yard * 0.04, size * yard * 0.08, size * yard * 0.08);
  }, 1, yard * 0.012);
  ctx.restore();
};

const stormstrike: Style = (c) => {
  const { ctx, match, yard } = c.s;
  const swing = release(c, 24);
  if (swing && swing.t < 24) {
    const hand = handOf(c, c.side, 'right');
    if (hand) {
      const random = rng(Math.floor(match.frame / 2) * 5 + c.side);
      for (let k = 0; k < 3; k++) {
        const angle = random() * Math.PI * 2;
        lightning(ctx, hand, [hand[0] + Math.cos(angle) * yard * 0.5, hand[1] + Math.sin(angle) * yard * 0.5], k + match.frame, STORM, 1 - swing.t / 24, Math.max(1, yard * 0.02), 0);
      }
      glow(ctx, hand[0], hand[1], yard * 0.4, STORM, 0.7 * (1 - swing.t / 24));
    }
  }
  const hit = impact(c, 16);
  const chest = hit && chestOf(c, c.targetSide);
  if (hit && chest) {
    const life = 1 - hit.t / 16;
    glow(ctx, chest[0], chest[1], yard * (0.7 + hit.t * 0.06), STORM, life);
    ring(ctx, chest[0], chest[1], yard * (0.3 + hit.t * 0.09), yard * (0.3 + hit.t * 0.09), STORM, life, Math.max(1, yard * 0.04));
    for (let k = 0; k < 5; k++) {
      const angle = (k / 5) * Math.PI * 2 + hit.t * 0.2;
      lightning(ctx, chest, [chest[0] + Math.cos(angle) * yard * 0.8, chest[1] + Math.sin(angle) * yard * 0.8], Math.floor(match.frame / 2) * 11 + k, STORM, life, Math.max(1, yard * 0.018), 0);
    }
  }
};

const mindBlast: Style = (c) => {
  const { ctx, match, yard } = c.s;
  const filled = casting(c);
  if (filled !== undefined) {
    // Shadow gathering between the hands.
    const right = handOf(c, c.side, 'right');
    const left = handOf(c, c.side, 'left');
    if (right && left) {
      const mx = (right[0] + left[0]) / 2;
      const my = (right[1] + left[1]) / 2;
      glow(ctx, mx, my, yard * (0.25 + filled * 0.35), PURPLE, 0.5 + filled * 0.5, 0.15);
      for (let k = 0; k < 8; k++) {
        const angle = (k / 8) * Math.PI * 2 + match.frame * 0.15;
        const r = yard * (0.7 - filled * 0.5) * (1 + (k % 2) * 0.3);
        glow(ctx, mx + Math.cos(angle) * r, my + Math.sin(angle) * r, yard * 0.08, PURPLE, 0.8);
      }
    }
  }
  const hit = impact(c, 26);
  const head = hit && headOf(c, c.targetSide);
  if (hit && head) {
    const t = hit.t;
    const life = 1 - t / 26;
    const source = headOf(c, c.side);
    if (source && t < 6) streak(ctx, source, head, yard * 0.25 * (1 - t / 6), PURPLE, 1 - t / 6);
    puff(ctx, head[0], head[1], yard * (0.55 + t * 0.03), SMOKE, life * 0.75);
    glow(ctx, head[0], head[1], yard * 0.3, PURPLE, life * 0.7, 0.2);
    for (let k = 0; k < 3; k++) {
      const r = yard * (0.2 + (t + k * 5) * 0.06);
      ring(ctx, head[0], head[1], r, r, PURPLE, life * (1 - k * 0.25), Math.max(1, yard * 0.06 * life));
    }
  }
};

const shadowWordPain: Style = (c) => {
  const { ctx, match, yard } = c.s;
  const hit = impact(c, 30);
  const chest = chestOf(c, c.targetSide);
  if (!chest) return;
  if (hit) {
    const t = hit.t;
    const life = 1 - t / 30;
    // Smoke closing on the target in a spiral, a violet flare where it takes hold.
    for (let k = 0; k < 8; k++) {
      const angle = (k / 8) * Math.PI * 2 + t * 0.15;
      const r = yard * Math.max(0.1, 1.2 - t * 0.05);
      puff(ctx, chest[0] + Math.cos(angle) * r, chest[1] + Math.sin(angle) * r * 0.7, yard * 0.32, SMOKE, life * 0.7);
    }
    puff(ctx, chest[0], chest[1], yard * 0.6, SMOKE, life * 0.6);
    glow(ctx, chest[0], chest[1], yard * (0.35 + t * 0.02), PURPLE, life, 0.15);
  }
  // While it eats at them: wisps of smoke curling about the chest, a violet glint in each.
  if (c.target.dots.some((d) => d.name === 'shadowWordPain' && d.source === c.side)) {
    for (let k = 0; k < 4; k++) {
      const angle = match.frame * 0.06 + (k / 4) * Math.PI * 2;
      const x = chest[0] + Math.cos(angle) * yard * 0.45;
      const y = chest[1] + Math.sin(angle) * yard * 0.25 - yard * 0.15 * Math.sin(match.frame * 0.1 + k);
      puff(ctx, x, y, yard * 0.22, SMOKE, 0.45);
      glow(ctx, x, y, yard * 0.08, PURPLE, 0.6);
    }
  }
};

const powerWordShield: Style = (c) => {
  const { ctx, match, yard } = c.s;
  const cast = release(c, 12);
  const chest = chestOf(c, c.side);
  if (!chest) return;
  if (cast) glow(ctx, chest[0], chest[1], yard * (0.6 + cast.t * 0.1), HOLY, 1 - cast.t / 12);
  if (c.caster.absorb <= 0) return;
  // The bubble: a gold-rimmed sphere about the body, swelling in, shimmering while it holds.
  const grow = Math.min(1, ((cast?.t ?? 12) + 2) / 8);
  const rx = yard * 0.95 * grow;
  const ry = yard * 1.35 * grow;
  const cy = chest[1] - yard * 0.05;
  const strength = 0.55 + 0.45 * Math.min(1, c.caster.absorb / 25);
  const fill = ctx.createRadialGradient(chest[0], cy, rx * 0.2, chest[0], cy, ry);
  fill.addColorStop(0, rgba(HOLY, 0.0));
  fill.addColorStop(0.75, rgba(GOLD, 0.12 * strength));
  fill.addColorStop(1, rgba(GOLD, 0.45 * strength));
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(chest[0], cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ring(ctx, chest[0], cy, rx, ry, GOLD, 0.75 * strength, Math.max(1.5, yard * 0.04));
  // A highlight running round the rim.
  const a0 = match.frame * 0.05;
  ctx.strokeStyle = rgba('255, 255, 230', 0.9 * strength);
  ctx.lineWidth = Math.max(1.5, yard * 0.05);
  ctx.beginPath();
  ctx.ellipse(chest[0], cy, rx * 0.97, ry * 0.97, 0, a0, a0 + 0.9);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(chest[0], cy, rx * 0.97, ry * 0.97, 0, a0 + Math.PI, a0 + Math.PI + 0.5);
  ctx.stroke();
};

/** A ball of light with a trail of fading copies behind it. */
function orb(c: Cast, shot: Projectile, rgb: string, size: number): void {
  const { ctx, yard } = c.s;
  for (let k = 6; k >= 1; k--) {
    const p = shotAt(c, shot, k * 1.6);
    if (p) glow(ctx, p[0], p[1], yard * size * (1 - k * 0.11), rgb, 0.35 * (1 - k / 7));
  }
  const head = shotAt(c, shot);
  const tail = shotAt(c, shot, 9);
  if (head && tail) streak(ctx, tail, head, yard * size * 0.9, rgb, 0.8);
  if (head) glow(ctx, head[0], head[1], yard * size, rgb, 1, 0.3);
}

const wrath: Style = (c) => {
  const { ctx, match, yard } = c.s;
  const filled = casting(c);
  if (filled !== undefined) {
    const hand = handOf(c, c.side, 'right');
    if (hand) {
      glow(ctx, hand[0], hand[1], yard * (0.2 + filled * 0.3), NATURE, 0.6 + filled * 0.4);
      for (let k = 0; k < 6; k++) {
        const angle = (k / 6) * Math.PI * 2 - match.frame * 0.12;
        const r = yard * 0.7 * (1 - ((match.frame * 0.04 + k / 6) % 1));
        glow(ctx, hand[0] + Math.cos(angle) * r, hand[1] + Math.sin(angle) * r, yard * 0.07, NATURE, 0.9);
      }
    }
  }
  for (const shot of c.shots) orb(c, shot, NATURE, 0.42);
  const hit = impact(c, 16);
  const chest = hit && chestOf(c, c.targetSide);
  if (hit && chest) {
    const life = 1 - hit.t / 16;
    glow(ctx, chest[0], chest[1], yard * (0.5 + hit.t * 0.06), NATURE, life);
    burst(chest[0], chest[1], hit.t, 10, yard * 0.08, 77, (x, y, size) => glow(ctx, x, y, yard * 0.08 * size, NATURE, life), 0.6, 0);
  }
};

const moonfire: Style = (c) => {
  const { ctx, yard } = c.s;
  const hit = impact(c, 34);
  if (!hit) return;
  const feet = feetOf(c, c.targetSide);
  if (!feet) return;
  const t = hit.t;
  const life = t < 4 ? t / 4 : 1 - (t - 4) / 30;
  // A column of moonlight from the top of the view down onto the target.
  const width = yard * 0.75 * (t < 4 ? 0.6 + t * 0.1 : 1 - (t - 4) / 60);
  const top = -20;
  const beam = ctx.createLinearGradient(feet[0] - width, 0, feet[0] + width, 0);
  beam.addColorStop(0, rgba(MOON, 0));
  beam.addColorStop(0.35, rgba(MOON, 0.35 * life));
  beam.addColorStop(0.5, rgba('255, 255, 255', 0.9 * life));
  beam.addColorStop(0.65, rgba(MOON, 0.35 * life));
  beam.addColorStop(1, rgba(MOON, 0));
  ctx.fillStyle = beam;
  ctx.fillRect(feet[0] - width, top, width * 2, feet[1] - top);
  ring(ctx, feet[0], feet[1], yard * (0.5 + t * 0.03), yard * (0.14 + t * 0.008), MOON, life, Math.max(1, yard * 0.05));
  glow(ctx, feet[0], feet[1], yard * 0.9, MOON, life * 0.8, 0.2);
  const random = rng(31 + Math.floor(hit.x * 7));
  for (let k = 0; k < 10; k++) {
    const y = feet[1] - ((random() * yard * 4 + t * yard * 0.08) % (yard * 4));
    glow(ctx, feet[0] + (random() - 0.5) * width * 1.4, y, yard * 0.05, MOON, life);
  }
};

const rake: Style = (c) => {
  const { ctx, yard } = c.s;
  const hit = impact(c, 22);
  const chest = hit && chestOf(c, c.targetSide);
  if (!hit || !chest) return;
  const t = hit.t;
  const life = 1 - t / 22;
  // Three claws raked down across the chest, then a spatter.
  const facing = c.caster.facing;
  for (let k = -1; k <= 1; k++) {
    const cx = chest[0] - facing * yard * 0.5 + k * yard * 0.2;
    const cy = chest[1] + k * yard * 0.05;
    crescent(ctx, cx, cy, yard * 0.65, facing > 0 ? -1.0 : Math.PI + 1.0, facing > 0 ? 0.7 : Math.PI - 0.7, (t + 1) / 5, yard * 0.12, BLOOD, life);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  burst(chest[0], chest[1], t, 8, yard * 0.06, 91, (x, y, size) => {
    ctx.fillStyle = rgba(BLOOD, life);
    ctx.beginPath();
    ctx.arc(x, y, yard * 0.03 * size, 0, Math.PI * 2);
    ctx.fill();
  }, 0.5, yard * 0.01);
  ctx.restore();
};

/** An arrow in flight: a glowing shaft with a head and fletching, and a streak behind it. */
function arrow(c: Cast, shot: Projectile, rgb: string, streakLength: number, glowSize: number): void {
  const { ctx, yard } = c.s;
  const head = shotAt(c, shot);
  const nock = shotAt(c, shot, 0.9 / Math.max(0.01, Math.abs(shot.vx)) * 0.5);
  const tail = shotAt(c, shot, streakLength);
  if (!head || !nock || !tail) return;
  streak(ctx, tail, head, yard * glowSize * 0.45, rgb, 0.85);
  glow(ctx, head[0], head[1], yard * glowSize, rgb, 0.9, 0.25);
  const dx = head[0] - nock[0];
  const dy = head[1] - nock[1];
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  ctx.strokeStyle = 'rgba(255, 250, 235, 0.95)';
  ctx.lineWidth = Math.max(1, yard * 0.025);
  ctx.beginPath();
  ctx.moveTo(nock[0], nock[1]);
  ctx.lineTo(head[0], head[1]);
  ctx.stroke();
  const h = yard * 0.09;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.beginPath();
  ctx.moveTo(head[0] + ux * h, head[1] + uy * h);
  ctx.lineTo(head[0] - uy * h * 0.5, head[1] + ux * h * 0.5);
  ctx.lineTo(head[0] + uy * h * 0.5, head[1] - ux * h * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba(rgb, 0.9);
  for (const side of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(nock[0] + ux * h, nock[1] + uy * h);
    ctx.lineTo(nock[0] - ux * h * 0.3 + side * uy * h * 0.6, nock[1] - uy * h * 0.3 - side * ux * h * 0.6);
    ctx.stroke();
  }
}

function shotImpact(c: Cast, rgb: string, frames: number, size: number): void {
  const { ctx, yard } = c.s;
  const hit = impact(c, frames);
  const chest = hit && chestOf(c, c.targetSide);
  if (!hit || !chest) return;
  const life = 1 - hit.t / frames;
  glow(ctx, chest[0], chest[1], yard * size * (0.6 + hit.t * 0.05), rgb, life);
  ring(ctx, chest[0], chest[1], yard * size * (0.2 + hit.t * 0.08), yard * size * (0.2 + hit.t * 0.08), rgb, life, Math.max(1, yard * 0.04));
}

const aimedShot: Style = (c) => {
  const { ctx, yard } = c.s;
  const filled = casting(c);
  const bow = handOf(c, c.side, 'left');
  if (filled !== undefined && bow) {
    glow(ctx, bow[0], bow[1], yard * (0.2 + filled * 0.45), GOLD, 0.4 + filled * 0.6);
    ring(ctx, bow[0], bow[1], yard * (0.7 - filled * 0.5), yard * (0.7 - filled * 0.5), GOLD, filled, Math.max(1, yard * 0.03));
  }
  for (const shot of c.shots) arrow(c, shot, GOLD, 12, 0.42);
  shotImpact(c, GOLD, 16, 1);
};

const killShot: Style = (c) => {
  for (const shot of c.shots) arrow(c, shot, BLOOD, 14, 0.5);
  shotImpact(c, BLOOD, 20, 1.3);
};

const shot: Style = (c) => {
  for (const s of c.shots) arrow(c, s, '255, 245, 220', 6, 0.18);
};

const disengage: Style = (c) => {
  const { ctx, yard } = c.s;
  const leap = release(c, 24);
  if (!leap) return;
  const ground = c.s.at([leap.x, 0, 0]);
  if (!ground) return;
  const life = 1 - leap.t / 24;
  burst(ground[0], ground[1], leap.t, 9, yard * 0.05, 13, (x, y, size) => puff(ctx, x, y, yard * 0.35 * size * (0.6 + leap.t / 24), DUST, life * 0.55), 0.35, 0);
  const body = chestOf(c, c.side);
  if (body) {
    for (let k = 0; k < 3; k++) {
      const y = body[1] - yard * 0.4 + k * yard * 0.4;
      streak(ctx, [body[0] + c.caster.facing * yard * 1.6, y], [body[0] + c.caster.facing * yard * 0.3, y], yard * 0.05, '255, 255, 255', life * 0.6);
    }
  }
};

/**
 * A slash crescent where the blade cuts: across the target's chest, the arc's centre a little
 * back toward the attacker, swept through the blow's window (`frames`: starts, is whole, gone,
 * in frames after the release). Angles are on screen, 0 to the right, mirrored for an attacker facing left.
 */
function slash(c: Cast, rgb: string, from: number, to: number, size: number, frames: [number, number, number]): void {
  const { ctx, yard } = c.s;
  const swing = release(c, frames[2]);
  const chest = swing && chestOf(c, c.targetSide);
  if (!swing || !chest) return;
  const [start, full, end] = frames;
  if (swing.t < start) return;
  const progress = (swing.t - start) / Math.max(1, full - start);
  const life = swing.t <= full ? 1 : 1 - (swing.t - full) / (end - full);
  const facing = c.caster.facing;
  const a0 = facing > 0 ? from : Math.PI - from;
  const a1 = facing > 0 ? to : Math.PI - to;
  const radius = yard * size * 0.8;
  crescent(ctx, chest[0] - facing * radius * 0.55, chest[1], radius, a0, a1, progress, yard * 0.26 * size, rgb, life);
}

const mortalStrike: Style = (c) => {
  const { ctx, yard } = c.s;
  slash(c, BLOOD, -1.4, 1.2, 1.15, [5, 14, 26]);
  const hit = impact(c, 16);
  const chest = hit && chestOf(c, c.targetSide);
  if (hit && chest) {
    const life = 1 - hit.t / 16;
    puff(ctx, chest[0], chest[1], yard * (0.4 + hit.t * 0.04), BLOOD, life * 0.6);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    burst(chest[0], chest[1], hit.t, 10, yard * 0.07, 3, (x, y, size) => {
      ctx.fillStyle = rgba(BLOOD, life);
      ctx.beginPath();
      ctx.arc(x, y, yard * 0.035 * size, 0, Math.PI * 2);
      ctx.fill();
    }, 0.6, yard * 0.012);
    ctx.restore();
  }
};

const execute: Style = (c) => {
  const { ctx, yard } = c.s;
  slash(c, EMBER, -1.6, 0.9, 1.3, [6, 14, 24]);
  const hit = impact(c, 32);
  const chest = hit && chestOf(c, c.targetSide);
  const feet = hit && feetOf(c, c.targetSide);
  if (!hit || !chest || !feet) return;
  const t = hit.t;
  const life = 1 - t / 32;
  // A big one: a white-hot flash, a shockwave through the air and across the floor, sparks.
  glow(ctx, chest[0], chest[1], yard * (1.4 - t * 0.02), '255, 200, 120', Math.min(1, life * 1.4), 0.4);
  ring(ctx, chest[0], chest[1], yard * (0.4 + t * 0.14), yard * (0.4 + t * 0.14), EMBER, life, Math.max(1.5, yard * 0.12 * life));
  ring(ctx, feet[0], feet[1], yard * (0.5 + t * 0.12), yard * (0.12 + t * 0.03), EMBER, life * 0.8, Math.max(1, yard * 0.07 * life));
  ctx.lineCap = 'round';
  for (let k = 0; k < 12; k++) {
    const angle = (k / 12) * Math.PI * 2;
    const r0 = yard * (0.5 + t * 0.12);
    const r1 = r0 + yard * 0.5 * life;
    ctx.strokeStyle = rgba('255, 230, 180', life);
    ctx.lineWidth = Math.max(1, yard * 0.04);
    ctx.beginPath();
    ctx.moveTo(chest[0] + Math.cos(angle) * r0, chest[1] + Math.sin(angle) * r0);
    ctx.lineTo(chest[0] + Math.cos(angle) * r1, chest[1] + Math.sin(angle) * r1);
    ctx.stroke();
  }
};

/** Dust (or fire, `light`) kicked up along a run, from where it began to where the runner is. */
function trail(c: Cast, rgb: string, from: number, alpha: number, puffs: number, height: number, size: number, light = false): void {
  const { ctx, yard } = c.s;
  const to = c.caster.x;
  for (let k = 0; k < puffs; k++) {
    const x = from + ((to - from) * k) / Math.max(1, puffs - 1);
    const p = c.s.at([x, 0, c.caster.z + height]);
    if (!p) continue;
    const radius = yard * size * (0.5 + (k / puffs) * 0.5);
    const a = alpha * (0.3 + 0.7 * (k / puffs));
    if (light) glow(ctx, p[0], p[1], radius, rgb, a, 0.05);
    else puff(ctx, p[0], p[1], radius, rgb, a * 0.7);
  }
}

const charge: Style = (c) => {
  const { ctx, yard } = c.s;
  const run = release(c, 70);
  if (run) {
    const dashing = c.caster.state === 'dash';
    const after = c.events.find((e) => e.kind === 'impact');
    const life = dashing ? 1 : after ? 1 - after.t / 24 : Math.max(0, 1 - run.t / 50);
    if (life > 0) {
      trail(c, DUST, run.x, life, 12, 0.2, 0.6);
      const chest = chestOf(c, c.side);
      if (chest && dashing) {
        for (let k = -1; k <= 1; k++) {
          const y = chest[1] + k * yard * 0.35;
          streak(ctx, [chest[0] - c.caster.facing * yard * 1.5, y], [chest[0] - c.caster.facing * yard * 0.2, y], yard * 0.06, '255, 240, 220', 0.6);
        }
      }
    }
  }
  const hit = impact(c, 22);
  const feet = hit && feetOf(c, c.targetSide);
  if (hit && feet) {
    const life = 1 - hit.t / 22;
    burst(feet[0], feet[1], hit.t, 10, yard * 0.06, 59, (x, y, size) => puff(ctx, x, y, yard * 0.38 * size, DUST, life * 0.6), 0.4, 0);
    ring(ctx, feet[0], feet[1], yard * (0.3 + hit.t * 0.07), yard * (0.08 + hit.t * 0.018), DUST, life, Math.max(1, yard * 0.05));
  }
};

const felRush: Style = (c) => {
  const { ctx, match, yard } = c.s;
  const run = release(c, 50);
  if (!run) return;
  const life = c.caster.state === 'dash' ? 1 : Math.max(0, 1 - run.t / 40);
  if (life <= 0) return;
  const from = c.s.at([run.x, 0, c.caster.z + 0.9]);
  const to = c.s.at([c.caster.x, 0, c.caster.z + 0.9]);
  if (!from || !to) return;
  // Fel fire where the demon hunter passed: a band of green flame along the path, tongues
  // licking up out of it, a hot thread through the middle, and a burst where the rush ends.
  const steps = Math.max(4, Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / (yard * 0.25)));
  const random = rng(Math.floor(match.frame / 2) * 13 + c.side);
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const x = from[0] + (to[0] - from[0]) * t;
    const y = from[1] + (to[1] - from[1]) * t;
    const heat = life * (0.35 + 0.65 * t);
    glow(ctx, x, y, yard * (0.35 + random() * 0.15), FEL, heat * 0.55, 0.1);
    const lick = yard * (0.3 + random() * 0.7) * (0.4 + 0.6 * t);
    streak(ctx, [x + (random() - 0.5) * yard * 0.2, y - lick], [x, y], yard * 0.22, FEL, heat * 0.8);
  }
  ctx.strokeStyle = rgba('230, 255, 200', life * 0.9);
  ctx.lineWidth = Math.max(1, yard * 0.04);
  strokePath(ctx, jagged(from, to, 3, 0.08, random));
  glow(ctx, to[0], to[1], yard * 0.7, FEL, life * 0.8, 0.25);
};

const chaosStrike: Style = (c) => {
  const { ctx, yard } = c.s;
  slash(c, FEL, -1.2, 1.0, 1.05, [4, 11, 22]);
  slash(c, PURPLE, 1.0, -1.1, 0.9, [9, 16, 26]);
  const hit = impact(c, 16);
  const chest = hit && chestOf(c, c.targetSide);
  if (hit && chest) {
    const life = 1 - hit.t / 16;
    glow(ctx, chest[0], chest[1], yard * (0.5 + hit.t * 0.05), FEL, life);
    burst(chest[0], chest[1], hit.t, 12, yard * 0.09, 17, (x, y, size, _l, k) => glow(ctx, x, y, yard * 0.07 * size, k % 2 ? FEL : PURPLE, life), 0.6, 0);
  }
};

const bladeDance: Style = (c) => {
  const { ctx, yard } = c.s;
  const dance = release(c, 36);
  const chest = dance && chestOf(c, c.side);
  if (!dance || !chest) return;
  const t = dance.t;
  const life = t < 26 ? 1 : 1 - (t - 26) / 10;
  // Blades whirling round the dancer on both sides: crescents on an ellipse, turning.
  for (let k = 0; k < 4; k++) {
    const base = t * 0.38 + (k / 4) * Math.PI * 2;
    crescent(ctx, chest[0], chest[1], yard * 1.2, base, base + 1.3, 1, yard * 0.28, k % 2 ? FEL : '230, 255, 220', life * 0.9, 0.42);
  }
  ring(ctx, chest[0], chest[1] + yard * 0.3, yard * 1.25, yard * 0.5, FEL, life * 0.35, Math.max(1, yard * 0.05));
};

/** The old glow for a bolt of a spell with no style of its own. */
const plainBolt: Style = (c) => {
  for (const shot of c.shots) orb(c, shot, '140, 210, 255', 0.45);
};

const STYLES: Record<string, Style> = {
  lightningBolt, earthShock, stormstrike,
  mindBlast, shadowWordPain, powerWordShield,
  wrath, moonfire, rake,
  aimedShot, killShot, disengage, shot,
  chaosStrike, felRush, bladeDance,
  charge, mortalStrike, execute,
};

/** Whether the spell drawing knows an ability by its own look. */
export const hasSpellStyle = (id: string): boolean => id in STYLES;

/**
 * Draw both fighters' spells over the ring. `at` turns a world point into HUD units, `anchor`
 * gives a fighter's attachment points (from the arena; points it lacks fall back to the body).
 */
export function drawSpells(ctx: CanvasRenderingContext2D, match: Match, at: At, anchor: AnchorAt): void {
  const mid = at([0, 0, 1]);
  const up = at([0, 0, 2]);
  const yard = mid && up ? Math.max(8, Math.abs(mid[1] - up[1])) : 60;
  const s: Scene = { ctx, match, at, anchor, yard };
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const side of [0, 1] as const) {
    const caster = match.fighters[side];
    const targetSide = (1 - side) as 0 | 1;
    const kit = match.tables[side].kit;
    const ids = [...kit.abilities.map((a) => a.id), 'shot'];
    ids.forEach((id, index) => {
      const shots = match.projectiles.filter((p) => p.owner === side && (p.ability < 0 ? 'shot' : kit.abilities[p.ability]?.id) === id);
      const events = match.spellEvents.filter((e) => e.owner === side && e.spell === id);
      const isCasting = caster.cast?.ability === index;
      const shield = id === 'powerWordShield' && caster.absorb > 0;
      const wounding = match.fighters[targetSide].dots.some((d) => d.name === id && d.source === side);
      if (shots.length === 0 && events.length === 0 && !isCasting && !shield && !wounding) return;
      const style = STYLES[id] ?? plainBolt;
      style({ s, side, caster, target: match.fighters[targetSide], targetSide, events, shots, index: id === 'shot' ? -1 : index });
    });
  }
  ctx.restore();
}
