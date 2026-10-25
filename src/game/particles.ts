/*
 * Particles for the HUD canvas: a pool of a few thousand points of light and matter (sparks,
 * embers, glows, blood drops, ice shards, smoke) stepped once per engine tick from a seeded
 * generator, so two players watching the same fight see the same sparks fly.
 *
 * A particle does not live in screen space. It hangs off one of the scene's anchors (the
 * winner's hand, the loser's chest, the ground under either), or somewhere on the line between
 * two of them, and its position and speed are yards from there. The pool never sees where the
 * anchors are: they are looked up when it is drawn. So the pool's state is a function of the
 * seed and the ticks alone, and a pool rebuilt from nothing and stepped to tick N is the same,
 * float for float, as one that was there all along; the camera pushing in or a fighter being
 * pulled across the ring only moves the anchors under it.
 *
 * Yards are world-up: +y is up, and +x is away from the winner, through the loser, mirrored
 * when the loser stands on the winner's left. Anchors on the ground give the particles a floor
 * at y = 0 that a drop can splash on and a spark bounce off.
 *
 * Drawing is one pass over the pool: the particles are sorted by what they look like (shape,
 * colour, alpha in twelve steps) and each group is one path filled once, or one sprite stamped
 * at each, matter painted first and light added over it. No shadows, no save/restore per
 * particle. Everything random comes from the pool's generator, a mulberry32 that runs on
 * integers; only the emitters' sines and cosines are left to the browser's floats.
 */

export const PALETTE = {
  white: '255, 255, 245',
  steel: '215, 222, 235',
  hot: '255, 205, 130',
  blood: '150, 6, 14',
  gore: '95, 0, 8',
  mist: '120, 10, 18',
  dust: '150, 125, 95',
  dirt: '95, 78, 60',
  gold: '255, 205, 90',
  holy: '255, 240, 175',
  storm: '150, 200, 255',
  blue: '100, 150, 255',
  frost: '150, 220, 255',
  ice: '205, 238, 255',
  iceEdge: '45, 120, 200',
  chill: '170, 215, 240',
  purple: '170, 80, 255',
  violet: '120, 40, 210',
  lilac: '225, 190, 255',
  void: '40, 10, 65',
  ash: '62, 62, 68',
  bone: '190, 200, 205',
  fel: '90, 255, 40',
  felPale: '210, 255, 160',
  felSmoke: '18, 42, 12',
  flame: '255, 215, 110',
  ember: '255, 120, 30',
  cinder: '200, 40, 10',
  smoke: '16, 12, 10',
  red: '255, 40, 30',
  crimson: '200, 10, 30',
  moon: '195, 210, 255',
  feather: '235, 222, 200',
  jade: '120, 255, 200',
} as const;

export type Colour = keyof typeof PALETTE;
const COLOURS = Object.keys(PALETTE) as Colour[];
const COLOUR_INDEX = new Map(COLOURS.map((c, i) => [c, i]));

export type Shape = 'dot' | 'spark' | 'glow' | 'shard' | 'ember' | 'drop' | 'puff';
/** What a particle on a ground anchor does at y = 0: nothing, vanish, bounce off, or come to rest there (a splash of blood). */
export type Floor = 'none' | 'die' | 'bounce' | 'settle';

export type Range = readonly [number, number];

/** What a particle is: how it looks, how long it lasts, how it moves, and what it leaves behind. */
export interface KindSpec {
  shape: Shape;
  /** A dot drawn as light (added) instead of matter (painted over); glows, embers and sparks always are light, drops, shards and puffs never. */
  light?: boolean;
  colour: Colour;
  /** The colour it turns in the second half of its life; for a shard, its edge. */
  fade?: Colour;
  /** Radius in yards (a spark's width, a shard's length). */
  size: Range;
  /** Ticks. */
  life: Range;
  /** Fraction of its speed lost per tick. */
  drag?: number;
  /** Yards per tick per tick, downward; negative rises (smoke). */
  gravity?: number;
  /** Yards its radius grows per tick (smoke spreading). */
  grow?: number;
  /** Opacity at its brightest. */
  alpha?: number;
  /** Fastest it tumbles, radians per tick (shards). */
  spin?: number;
  /** A spark's streak is this many ticks of its motion long. */
  len?: number;
  floor?: Floor;
  /** Fades in over this fraction of its life (smoke) rather than starting at full. */
  fadeIn?: number;
  /** Leaves a trail: this kind, this many per tick on average. */
  trail?: { kind: Kind; rate: number; speed?: number };
  /** Breaks into this when its life runs out: a star bursting, an arrow's feathers. */
  burst?: { kind: Kind; n: number; speed: Range };
}

export interface Kind extends KindSpec {
  readonly id: number;
}

const KINDS: Kind[] = [];

/** A kind of particle, made once at load: the pool keeps only its number. */
export function kind(spec: KindSpec): Kind {
  const k = { ...spec, id: KINDS.length };
  KINDS.push(k);
  return k;
}

// The fields of a particle, laid out in one Float64Array so a dead one is replaced by the last in one copy.
const X = 0, Y = 1, VX = 2, VY = 3, U = 4, DU = 5, R = 6, DR = 7, ANG = 8, SPIN = 9, ROT = 10, VROT = 11;
const LIFE = 12, MAX = 13, SIZE = 14, GROW = 15, DRAG = 16, GRAV = 17, ALPHA = 18, SEED = 19, KIND = 20, A = 21, B = 22, FLAGS = 23;
const STRIDE = 24;
const SETTLED = 1;

/** Room for this many at once; past it, new ones are not made (the same ones on every machine). */
export const POOL_SIZE = 4096;

/** A point a particle hangs off: an index into the anchors the scene supplies when it draws. */
export type Anchor = number;

export class Pool {
  readonly data = new Float64Array(POOL_SIZE * STRIDE);
  count = 0;
  /** The generator's state. */
  state = 1;

  constructor(seed = 1) {
    this.reset(seed);
  }

  reset(seed: number): void {
    this.count = 0;
    this.seed(seed);
  }

  /** Start the generator over from a seed; the pool's particles stay. */
  seed(seed: number): void {
    this.state = hash(seed) || 1;
  }

  /** The next number in [0, 1). */
  random(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A number in the range. */
  between(range: Range): number {
    return range[0] + (range[1] - range[0]) * this.random();
  }

  /** A whole number of particles for an average of `rate`: its whole part, and one more as often as the fraction says. */
  howMany(rate: number): number {
    const whole = Math.floor(rate);
    return whole + (this.random() < rate - whole ? 1 : 0);
  }

  /** One particle of `k`, `x, y` yards from `u` of the way from anchor `a` to `b`, moving `vx, vy` yards a tick. -1 when the pool is full. */
  spawn(k: Kind, a: Anchor, b: Anchor, u: number, x: number, y: number, vx: number, vy: number, du = 0): number {
    if (this.count >= POOL_SIZE) return -1;
    const i = this.count++;
    const d = this.data;
    const o = i * STRIDE;
    const life = this.between(k.life);
    d[o + X] = x;
    d[o + Y] = y;
    d[o + VX] = vx;
    d[o + VY] = vy;
    d[o + U] = u;
    d[o + DU] = du;
    d[o + R] = 0;
    d[o + DR] = 0;
    d[o + ANG] = 0;
    d[o + SPIN] = 0;
    d[o + ROT] = this.random() * Math.PI * 2;
    d[o + VROT] = k.spin ? (this.random() * 2 - 1) * k.spin : 0;
    d[o + LIFE] = life;
    d[o + MAX] = life;
    d[o + SIZE] = this.between(k.size);
    d[o + GROW] = k.grow ?? 0;
    d[o + DRAG] = k.drag ?? 0;
    d[o + GRAV] = k.gravity ?? 0;
    d[o + ALPHA] = k.alpha ?? 1;
    d[o + SEED] = this.random();
    d[o + KIND] = k.id;
    d[o + A] = a;
    d[o + B] = b;
    d[o + FLAGS] = 0;
    return i;
  }

  /** Set a particle circling its spot: `r` yards out (squashed to an ellipse when drawn), shrinking by `dr` a tick, at angle `ang`, turning `spin` a tick. */
  orbit(i: number, r: number, dr: number, ang: number, spin: number): void {
    if (i < 0) return;
    const o = i * STRIDE;
    this.data[o + R] = r;
    this.data[o + DR] = dr;
    this.data[o + ANG] = ang;
    this.data[o + SPIN] = spin;
  }

  /** Make a particle's life exactly `ticks`, so it ends where it was meant to: an arrow on the target, a star on the ground. */
  lasting(i: number, ticks: number): void {
    if (i < 0) return;
    this.data[i * STRIDE + LIFE] = ticks;
    this.data[i * STRIDE + MAX] = ticks;
  }

  // ---------------------------------------------------------------------------------------
  // Emitters. Angles are world-up radians: 0 away from the winner, PI/2 straight up.

  /** `n` at once from a point, `speed` yards a tick, spread over `spread` radians about `angle`. */
  burst(k: Kind, n: number, at: Anchor, x: number, y: number, speed: Range, angle = Math.PI / 2, spread = Math.PI * 2): void {
    for (let j = 0; j < n; j++) {
      const a = angle + (this.random() - 0.5) * spread;
      const v = this.between(speed);
      this.spawn(k, at, at, 0, x, y, Math.cos(a) * v, Math.sin(a) * v);
    }
  }

  /** A steady jet: `rate` a tick on average (scaled by the tick's `dt`), the same spread as a burst. */
  fountain(k: Kind, rate: number, dt: number, at: Anchor, x: number, y: number, speed: Range, angle = Math.PI / 2, spread = 0.6): void {
    this.burst(k, this.howMany(rate * dt), at, x, y, speed, angle, spread);
  }

  /** `n` round a ring of `radius` yards about a point, flying outward; `squash` flattens it onto the ground (0.3) or keeps it round (1). */
  ring(k: Kind, n: number, at: Anchor, x: number, y: number, radius: number, speed: Range, squash = 0.3): void {
    for (let j = 0; j < n; j++) {
      const a = ((j + this.random() * 0.6) / n) * Math.PI * 2;
      const v = this.between(speed);
      const c = Math.cos(a);
      const s = Math.sin(a) * squash;
      this.spawn(k, at, at, 0, x + c * radius, y + s * radius, c * v, s * v);
    }
  }

  /** `n` falling from `height` yards over a band `width` wide centred `x` from the anchor; `slant` leans them. */
  rain(k: Kind, n: number, at: Anchor, x: number, width: number, height: number, speed: Range, slant = 0): void {
    for (let j = 0; j < n; j++) {
      const v = this.between(speed);
      this.spawn(k, at, at, 0, x + (this.random() - 0.5) * width, height + this.random() * 0.6, slant * v, -v);
    }
  }

  /** `n` left where something passes, `u` of the way from `a` to `b`, scattered `spread` yards and drifting at up to `speed`. */
  trail(k: Kind, n: number, a: Anchor, b: Anchor, u: number, x: number, y: number, spread: number, speed: number): void {
    for (let j = 0; j < n; j++) {
      const ang = this.random() * Math.PI * 2;
      const d = Math.sqrt(this.random()) * spread;
      const v = this.random() * speed;
      const dir = this.random() * Math.PI * 2;
      this.spawn(k, a, b, u, x + Math.cos(ang) * d, y + Math.sin(ang) * d, Math.cos(dir) * v, Math.sin(dir) * v);
    }
  }

  /**
   * `n` flowing along the line from `a` to `b`: placed at `u` of the way, moving `du` of it a tick,
   * scattered `spread` yards off the line and drifting `drift` a tick (a cone when it points outward).
   */
  stream(k: Kind, n: number, a: Anchor, b: Anchor, u: Range, du: Range, spread: number, drift: Range = [0, 0], up = 0): void {
    for (let j = 0; j < n; j++) {
      const side = this.random() - 0.5;
      const v = this.between(drift);
      this.spawn(k, a, b, this.between(u), side * spread * 0.5, (this.random() - 0.5) * spread, (this.random() - 0.5) * v * 0.5, side * 2 * v + up, this.between(du));
    }
  }

  /** `n` wisps winding from `a` into `b`: each circles the line `radius` yards out, tightening to nothing as it arrives `1 / du` ticks later. */
  spiral(k: Kind, n: number, a: Anchor, b: Anchor, du: Range, radius: Range, spin: number): void {
    for (let j = 0; j < n; j++) {
      const rate = this.between(du);
      const r = this.between(radius);
      const i = this.spawn(k, a, b, 0, 0, 0, 0, 0, rate);
      this.lasting(i, 1 / rate);
      this.orbit(i, r, -r * rate, this.random() * Math.PI * 2, spin * (this.random() < 0.5 ? -1 : 1));
    }
  }

  /** `n` wisps closing in on a point from `radius` yards round it, arriving after `ticks`. */
  implode(k: Kind, n: number, at: Anchor, x: number, y: number, radius: Range, ticks: number, spin: number): void {
    for (let j = 0; j < n; j++) {
      const r = this.between(radius);
      const i = this.spawn(k, at, at, 0, x, y, 0, 0);
      this.lasting(i, ticks * (0.8 + 0.2 * this.random()));
      this.orbit(i, r, -r / ticks, this.random() * Math.PI * 2, spin);
    }
  }

  /** `n` through a box `width` across from height `y0` to `y1` over the anchor, drifting up (or down, negative) at `rise`: a pillar of motes. */
  column(k: Kind, n: number, at: Anchor, x: number, width: number, y0: number, y1: number, rise: Range): number {
    let last = -1;
    for (let j = 0; j < n; j++) {
      last = this.spawn(k, at, at, 0, x + (this.random() - 0.5) * width, y0 + (y1 - y0) * this.random(), (this.random() - 0.5) * 0.01, this.between(rise));
    }
    return last;
  }

  /**
   * `n` thrown off a blade's sweep: placed along the arc of `radius` about a point from angle `from`
   * to `to`, each flying along the sweep at `speed` and a little outward, as blood leaves a slash.
   */
  arc(k: Kind, n: number, at: Anchor, x: number, y: number, radius: number, from: number, to: number, speed: Range, out = 0.3): void {
    const turn = to > from ? 1 : -1;
    for (let j = 0; j < n; j++) {
      const a = from + (to - from) * this.random();
      const c = Math.cos(a);
      const s = Math.sin(a);
      const v = this.between(speed);
      // Along the sweep (its tangent the way the blade turns), and out from the centre.
      this.spawn(k, at, at, 0, x + c * radius, y + s * radius, (-s * turn + c * out) * v, (c * turn + s * out) * v);
    }
  }

  /** `n` puffs of smoke or dust about a point, `radius` yards across, rising `rise` a tick. */
  smoke(k: Kind, n: number, at: Anchor, x: number, y: number, radius: number, rise: number): void {
    for (let j = 0; j < n; j++) {
      const ang = this.random() * Math.PI * 2;
      const d = Math.sqrt(this.random()) * radius;
      this.spawn(k, at, at, 0, x + Math.cos(ang) * d, y + Math.sin(ang) * d * 0.6, (this.random() - 0.5) * 0.02, rise * (0.5 + 0.5 * this.random()));
    }
  }

  // ---------------------------------------------------------------------------------------

  /** One tick, `dt` long (the scene's time scale: 0.4 in a slow-motion beat). */
  step(dt: number): void {
    const d = this.data;
    // Backwards, so the last one swapped into a dead one's place has been stepped already, and what is born this tick waits for the next.
    for (let i = this.count - 1; i >= 0; i--) {
      const o = i * STRIDE;
      const k = KINDS[d[o + KIND]!]!;
      const life = d[o + LIFE]! - dt;
      if (life <= 0) {
        if (k.burst) this.burstFrom(o, k.burst.kind, k.burst.n, k.burst.speed);
        this.kill(i);
        continue;
      }
      d[o + LIFE] = life;
      const keep = 1 - d[o + DRAG]! * dt;
      let vx = d[o + VX]! * keep;
      let vy = d[o + VY]! * keep - d[o + GRAV]! * dt;
      let x = d[o + X]! + vx * dt;
      let y = d[o + Y]! + vy * dt;
      if (y < 0 && k.floor && k.floor !== 'none' && !(d[o + FLAGS]! & SETTLED)) {
        if (k.floor === 'die') {
          this.kill(i);
          continue;
        }
        if (k.floor === 'bounce') {
          y = -y * 0.3;
          vy = -vy * 0.3;
          vx *= 0.6;
        } else {
          y = 0;
          vx = 0;
          vy = 0;
          d[o + GRAV] = 0;
          d[o + FLAGS] = d[o + FLAGS]! | SETTLED;
        }
      }
      d[o + VX] = vx;
      d[o + VY] = vy;
      d[o + X] = x;
      d[o + Y] = y;
      d[o + U] = d[o + U]! + d[o + DU]! * dt;
      const r = d[o + R]!;
      if (r > 0) {
        d[o + R] = Math.max(0, r + d[o + DR]! * dt);
        d[o + ANG] = d[o + ANG]! + d[o + SPIN]! * dt;
      }
      d[o + ROT] = d[o + ROT]! + d[o + VROT]! * dt;
      d[o + SIZE] = d[o + SIZE]! + d[o + GROW]! * dt;
      if (k.trail) {
        const n = this.howMany(k.trail.rate * dt);
        if (n > 0) this.burstFrom(o, k.trail.kind, n, [0, k.trail.speed ?? 0.01]);
      }
    }
  }

  /** `n` of `k` from where the particle at offset `o` is now. */
  private burstFrom(o: number, k: Kind, n: number, speed: Range): void {
    const d = this.data;
    const r = d[o + R]!;
    const ang = d[o + ANG]!;
    const x = d[o + X]! + r * Math.cos(ang);
    const y = d[o + Y]! + r * Math.sin(ang) * ORBIT_SQUASH;
    const a = d[o + A]!;
    const b = d[o + B]!;
    const u = d[o + U]!;
    for (let j = 0; j < n; j++) {
      const dir = this.random() * Math.PI * 2;
      const v = this.between(speed);
      this.spawn(k, a, b, u, x, y, Math.cos(dir) * v, Math.sin(dir) * v);
    }
  }

  private kill(i: number): void {
    const last = --this.count;
    if (i !== last) this.data.copyWithin(i * STRIDE, last * STRIDE, last * STRIDE + STRIDE);
  }

  /** The live particles and the generator, for a test to compare. */
  snapshot(): number[] {
    return [this.state, this.count, ...this.data.subarray(0, this.count * STRIDE)];
  }
}

/** An orbit is drawn as an ellipse this much flatter than it is wide, as a ring seen from a little above. */
const ORBIT_SQUASH = 0.55;

/** A well-mixed 32-bit number from any number (the frame, the beat): the generator's seed. */
export function hash(n: number): number {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// ---------------------------------------------------------------------------------------------
// Drawing.

/** Where the anchors are this frame, in canvas units, and how the pool's yards map onto them. */
export interface View {
  /** x, y of each anchor in turn. */
  spots: Float64Array;
  /** 1 when the loser stands to the winner's right on screen, -1 to the left. */
  dir: number;
  /** Canvas units per yard. */
  yard: number;
  /** The scene's tick, for the embers' flicker. */
  tick: number;
}

const LEVELS = 12;
/** The draw groups, in order: matter first, painted over the scene, then light added on top. */
const SLOT = { puff: 0, drop: 1, shard: 2, dotMatter: 3, glow: 4, ember: 5, dotLight: 6, spark: 7 } as const;
const SLOTS = 8;
const FIRST_LIGHT = SLOT.glow;
const KEYS = SLOTS * COLOURS.length * (LEVELS + 1);

const RGBA: string[][] = COLOURS.map((c) => Array.from({ length: LEVELS + 1 }, (_, l) => `rgba(${PALETTE[c]}, ${(l / LEVELS).toFixed(3)})`));

let scratch: { sx: Float32Array; sy: Float32Array; vx: Float32Array; vy: Float32Array; px: Float32Array; key: Int32Array; order: Int32Array; counts: Int32Array } | undefined;

function slotOf(shape: Shape, light: boolean | undefined): number {
  switch (shape) {
    case 'puff':
      return SLOT.puff;
    case 'drop':
      return SLOT.drop;
    case 'shard':
      return SLOT.shard;
    case 'dot':
      return light ? SLOT.dotLight : SLOT.dotMatter;
    case 'glow':
      return SLOT.glow;
    case 'ember':
      return SLOT.ember;
    case 'spark':
      return SLOT.spark;
  }
}

type Sprite = HTMLCanvasElement | OffscreenCanvas;
const SPRITE = 64;
const glows: (Sprite | undefined)[] = [];
const puffs: (Sprite | undefined)[] = [];

function canvas(): Sprite | undefined {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = SPRITE;
    c.height = SPRITE;
    return c;
  }
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(SPRITE, SPRITE) : undefined;
}

/** A soft round sprite in one colour: for light a white-hot core fading out through the colour, for matter the colour fading to nothing. */
function sprite(colour: number, light: boolean): Sprite | undefined {
  const cache = light ? glows : puffs;
  const have = cache[colour];
  if (have) return have;
  const c = canvas();
  const g = c?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
  if (!c || !g) return undefined;
  const rgb = PALETTE[COLOURS[colour]!];
  const half = SPRITE / 2;
  const grad = g.createRadialGradient(half, half, 0, half, half, half);
  if (light) {
    grad.addColorStop(0, 'rgba(255, 255, 250, 1)');
    grad.addColorStop(0.18, `rgba(${rgb}, 0.95)`);
    grad.addColorStop(0.45, `rgba(${rgb}, 0.35)`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
  } else {
    grad.addColorStop(0, `rgba(${rgb}, 1)`);
    grad.addColorStop(0.5, `rgba(${rgb}, 0.6)`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, SPRITE, SPRITE);
  cache[colour] = c;
  return c;
}

/** Draw every live particle of the pool where its anchors are this frame. */
export function drawParticles(ctx: CanvasRenderingContext2D, pool: Pool, view: View): void {
  const n = pool.count;
  if (n === 0) return;
  if (!scratch || scratch.sx.length < POOL_SIZE) {
    scratch = {
      sx: new Float32Array(POOL_SIZE),
      sy: new Float32Array(POOL_SIZE),
      vx: new Float32Array(POOL_SIZE),
      vy: new Float32Array(POOL_SIZE),
      px: new Float32Array(POOL_SIZE),
      key: new Int32Array(POOL_SIZE),
      order: new Int32Array(POOL_SIZE),
      counts: new Int32Array(KEYS + 1),
    };
  }
  const { sx, sy, vx, vy, px, key, order, counts } = scratch;
  const d = pool.data;
  const { spots, dir, yard } = view;
  counts.fill(0);
  let drawn = 0;

  // Where each one is on screen, how fast it goes there, and which group it is drawn in.
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE;
    const k = KINDS[d[o + KIND]!]!;
    const life = d[o + LIFE]!;
    const max = d[o + MAX]!;
    const age = 1 - life / max;
    let alpha = d[o + ALPHA]! * Math.min(1, life / (max * 0.35));
    if (k.fadeIn) alpha *= Math.min(1, age / k.fadeIn);
    const level = Math.min(LEVELS, Math.round(alpha * LEVELS));
    if (level <= 0) {
      key[i] = -1;
      continue;
    }
    const a = d[o + A]! * 2;
    const b = d[o + B]! * 2;
    const ax = spots[a]!;
    const ay = spots[a + 1]!;
    const lx = spots[b]! - ax;
    const ly = spots[b + 1]! - ay;
    const u = d[o + U]!;
    const du = d[o + DU]!;
    let ox = d[o + X]!;
    let oy = d[o + Y]!;
    let ovx = d[o + VX]!;
    let ovy = d[o + VY]!;
    const r = d[o + R]!;
    if (r > 0) {
      const ang = d[o + ANG]!;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const spin = d[o + SPIN]! * r;
      ox += r * c;
      oy += r * s * ORBIT_SQUASH;
      ovx -= spin * s;
      ovy += spin * c * ORBIT_SQUASH;
    }
    sx[i] = ax + lx * u + dir * ox * yard;
    sy[i] = ay + ly * u - oy * yard;
    vx[i] = lx * du + dir * ovx * yard;
    vy[i] = ly * du - ovy * yard;
    px[i] = d[o + SIZE]! * yard;
    const colour = COLOUR_INDEX.get(k.shape !== 'shard' && k.fade && age > 0.5 ? k.fade : k.colour)!;
    const kk = (slotOf(k.shape, k.light) * COLOURS.length + colour) * (LEVELS + 1) + level;
    key[i] = kk;
    counts[kk + 1]!++;
    drawn++;
  }
  // Counting sort by group.
  for (let g = 1; g <= KEYS; g++) counts[g]! += counts[g - 1]!;
  for (let i = 0; i < n; i++) {
    const kk = key[i]!;
    if (kk >= 0) order[counts[kk]!++] = i;
  }

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  let lit = false;
  let j = 0;
  while (j < drawn) {
    const first = order[j]!;
    const kk = key[first]!;
    const level = kk % (LEVELS + 1);
    const colour = Math.floor(kk / (LEVELS + 1)) % COLOURS.length;
    const slot = Math.floor(kk / ((LEVELS + 1) * COLOURS.length));
    let end = j;
    while (end < drawn && key[order[end]!] === kk) end++;
    if (slot >= FIRST_LIGHT && !lit) {
      ctx.globalCompositeOperation = 'lighter';
      lit = true;
    }
    if (slot === SLOT.puff || slot === SLOT.glow || slot === SLOT.ember) {
      const image = sprite(colour, slot !== SLOT.puff);
      if (image) {
        ctx.globalAlpha = level / LEVELS;
        for (let q = j; q < end; q++) {
          const i = order[q]!;
          let s = px[i]!;
          if (slot === SLOT.ember) s *= 0.65 + 0.35 * flicker(d[i * STRIDE + SEED]!, view.tick);
          ctx.drawImage(image, sx[i]! - s, sy[i]! - s, s * 2, s * 2);
        }
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.beginPath();
      for (let q = j; q < end; q++) {
        const i = order[q]!;
        shapeOf(ctx, slot, sx[i]!, sy[i]!, vx[i]!, vy[i]!, px[i]!, d, i * STRIDE);
      }
      ctx.fillStyle = RGBA[colour]![level]!;
      ctx.fill();
      if (slot === SLOT.shard) {
        // A shard's edge, in its second colour.
        const k = KINDS[d[first * STRIDE + KIND]!]!;
        if (k.fade) {
          ctx.strokeStyle = RGBA[COLOUR_INDEX.get(k.fade)!]![level]!;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
    }
    j = end;
  }
  ctx.restore();
}

/** An ember's brightness this tick, in [0, 1]: a cheap hash of its seed and the tick, so it flickers the same everywhere. */
function flicker(seed: number, tick: number): number {
  const x = Math.sin(seed * 6151.3 + tick * 0.9) * 43758.5453;
  return x - Math.floor(x);
}

/** Add one particle's outline to the current path. */
function shapeOf(ctx: CanvasRenderingContext2D, slot: number, x: number, y: number, vx: number, vy: number, size: number, d: Float64Array, o: number): void {
  switch (slot) {
    case SLOT.spark: {
      // A taper from where it was `len` ticks ago to where it is, `size` across at the head.
      const k = KINDS[d[o + KIND]!]!;
      const len = k.len ?? 2;
      const tx = vx * len;
      const ty = vy * len;
      const length = Math.hypot(tx, ty);
      if (length < size * 2) {
        // Too slow to streak: a small diamond.
        const s = size * 1.2;
        ctx.moveTo(x - s, y);
        ctx.lineTo(x, y - s);
        ctx.lineTo(x + s, y);
        ctx.lineTo(x, y + s);
        ctx.closePath();
        return;
      }
      const half = size / 2;
      const nx = (-ty / length) * half;
      const ny = (tx / length) * half;
      // The head rounds off a little past the point.
      const fx = (tx / length) * half;
      const fy = (ty / length) * half;
      ctx.moveTo(x - tx, y - ty);
      ctx.lineTo(x + nx, y + ny);
      ctx.lineTo(x + fx, y + fy);
      ctx.lineTo(x - nx, y - ny);
      ctx.closePath();
      return;
    }
    case SLOT.drop: {
      if (d[o + FLAGS]! & SETTLED) {
        // A splash on the floor.
        ctx.moveTo(x + size * 1.7, y);
        ctx.ellipse(x, y, size * 1.7, size * 0.45, 0, 0, Math.PI * 2);
        return;
      }
      const speed = Math.hypot(vx, vy);
      const stretch = 1 + Math.min(2.2, speed / Math.max(1, size) * 0.35);
      const ang = speed > 0.01 ? Math.atan2(vy, vx) : Math.PI / 2;
      ctx.moveTo(x + Math.cos(ang) * size * stretch, y + Math.sin(ang) * size * stretch);
      ctx.ellipse(x, y, size * stretch, size, ang, 0, Math.PI * 2);
      return;
    }
    case SLOT.shard: {
      // A thin kite, turning as it flies.
      const rot = d[o + ROT]!;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const w = size * 0.32;
      ctx.moveTo(x + c * size, y + s * size);
      ctx.lineTo(x - s * w, y + c * w);
      ctx.lineTo(x - c * size * 0.45, y - s * size * 0.45);
      ctx.lineTo(x + s * w, y - c * w);
      ctx.closePath();
      return;
    }
    default: {
      // A dot: a square is cheaper than a circle and no different at this size.
      const s = Math.max(1, size);
      ctx.rect(x - s / 2, y - s / 2, s, s);
    }
  }
}
