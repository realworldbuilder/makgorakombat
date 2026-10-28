/*
 * A bench for the fatalities' particles without a WoW folder: the real engine is driven into
 * each class's fatality on fake move tables (test/engine/fake.ts), stand-in fighters are drawn
 * as plain figures on an arena-coloured floor, and the HUD painter (src/game/hud.ts) draws over
 * them as it does in the game. It plays the scene in a loop, scrubs to any tick, times the HUD,
 * and lays out a contact sheet of four moments of a fatality the way docs/fatality-*.png are.
 *
 *   pnpm dev --port 5188 --strictPort, then /makgorakombat/tools/fatality-fx/
 *   window.bench.sheet('mage') draws the sheet; window.bench.measure('mage') times a run.
 */

import { type Inputs, type Match, tick } from '../../src/engine/engine';
import { ALL_FATALITIES, directionOf, fatalityFrames, isBlow, type SequenceToken } from '../../src/engine/fatalities';
import { KO_SLOWMO } from '../../src/engine/stage';
import { ANCHOR, ANCHORS, FatalityFx } from '../../src/game/fatalityFx';
import { ATTACH, type Point } from '../../src/game/fx';
import { drawHud } from '../../src/game/hud';
import { drawParticles, type View } from '../../src/game/particles';
import { fakeMatch, inputs, NONE, place, rig, run, skipIntro, until, WARRIOR } from '../../test/engine/fake';

const W = 1280;
const H = 720;
const GROUND = 655;
const HEADS: [number, number] = [1.85, 2.15];

const bg = (document.getElementById('bg') as HTMLCanvasElement).getContext('2d')!;
const hud = document.getElementById('hud') as HTMLCanvasElement;
const hudCtx = hud.getContext('2d')!;
const sheet = document.getElementById('sheet') as HTMLCanvasElement;
const select = document.getElementById('cls') as HTMLSelectElement;
const scrub = document.getElementById('scrub') as HTMLInputElement;
const info = document.getElementById('info')!;
const playButton = document.getElementById('play')!;

const byName = new Map([...ALL_FATALITIES].map(([id, f]) => [f.id, id]));
for (const [, f] of ALL_FATALITIES) select.add(new Option(`${f.id}: ${f.name}`, f.id));

/** A match with `classId`'s fatality just begun on a dazed warrior. */
function begin(classId: number): Match {
  const match = fakeMatch(3, [classId, WARRIOR]);
  skipIntro(match);
  place(match, 2.0);
  match.fighters[1].hp = 7;
  rig(match, 'hit');
  tick(match, [inputs({ attack: true }), inputs()]);
  until(match, (m) => m.phase === 'finish', 60);
  run(match, 30);
  for (const token of match.tables[0].fatality.spec.sequence) press(match, token);
  return match;
}

function press(match: Match, token: SequenceToken): void {
  const key = directionOf(token, match.fighters[0].facing);
  const mine: Inputs = key ? inputs({ [key]: true }) : token === 'attack' ? inputs({ attack: true }) : inputs({ ability: Number(token.slice(7)) - 1 });
  tick(match, [mine, inputs()]);
  run(match, 4);
}

/** Ticks since the fatality began, as the HUD counts them. */
function sceneT(match: Match): number {
  const run = match.fatality!;
  return match.phase === 'fatality' ? run.total : run.total + match.phaseT - 1;
}

/** A match at scene tick T of `classId`'s fatality. */
function at(classId: number, T: number): Match {
  const match = begin(classId);
  while (sceneT(match) < T && (match.phase === 'fatality' || match.phase === 'ko')) tick(match, NONE);
  return match;
}

// --- The stand-ins and the camera ---------------------------------------------------------------

interface Camera {
  cx: number;
  yard: number;
}

function cameraOf(match: Match): Camera {
  const spec = match.tables[0].fatality.spec;
  const T = match.fatality ? sceneT(match) : 0;
  const push = 1 + (spec.push - 1) * Math.min(1, T / 30);
  return { cx: (match.fighters[0].x + match.fighters[1].x) / 2, yard: 165 * push };
}

const project = (cam: Camera) => (p: readonly [number, number, number]): [number, number] => [W / 2 + (p[0] - cam.cx) * cam.yard, GROUND - p[2] * cam.yard];

/** How far a fighter has gone over: 0 standing, 1 flat on the ground. */
function fallen(match: Match, i: 0 | 1): number {
  const f = match.fighters[i];
  if (f.state !== 'death' && f.state !== 'knockdown') return 0;
  return Math.min(1, f.t / 700);
}

/** Where the stand-in's parts are: the anchors the HUD asks for. */
function part(match: Match, i: 0 | 1, attachment: number): Point | undefined {
  const f = match.fighters[i];
  const s = HEADS[i] / 1.85;
  const lean = fallen(match, i) * (Math.PI / 2) * 0.95;
  // A point `up` yards up the body and `fwd` forward of it, tipped back by the fall.
  const body = (up: number, fwd: number): Point => {
    const back = -f.facing;
    return [f.x + back * Math.sin(lean) * up + f.facing * fwd * Math.cos(lean), 0, f.z + Math.cos(lean) * up + Math.sin(lean) * fwd];
  };
  if (attachment === ATTACH.chest) return body(1.3 * s, 0);
  if (attachment === ATTACH.helm || attachment === ATTACH.head) return body(1.72 * s, 0.05);
  if (attachment === ATTACH.rightHand) return body(1.15 * s, 0.5 * s);
  return undefined;
}

function figure(ctx: CanvasRenderingContext2D, match: Match, i: 0 | 1, cam: Camera): void {
  const p = project(cam);
  const f = match.fighters[i];
  const s = HEADS[i] / 1.85;
  const lean = fallen(match, i) * (Math.PI / 2) * 0.95;
  const pt = (up: number, fwd: number): [number, number] => {
    const back = -f.facing;
    return p([f.x + back * Math.sin(lean) * up + f.facing * fwd * Math.cos(lean), 0, f.z + Math.cos(lean) * up + Math.sin(lean) * fwd]);
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = i === 0 ? '#2d3442' : '#4a2f20';
  ctx.fillStyle = ctx.strokeStyle;
  const limb = (a: [number, number], b: [number, number], w: number) => {
    ctx.lineWidth = w * cam.yard;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  };
  const hip = pt(0.95 * s, 0);
  const neck = pt(1.5 * s, 0);
  limb(hip, pt(0, -0.18 * s), 0.16 * s);
  limb(hip, pt(0, 0.2 * s), 0.16 * s);
  limb(hip, neck, 0.34 * s);
  limb(neck, pt(1.15 * s, 0.5 * s), 0.12 * s);
  limb(neck, pt(1.05 * s, -0.25 * s), 0.12 * s);
  const head = pt(1.72 * s, 0.05);
  ctx.beginPath();
  ctx.arc(head[0], head[1], 0.13 * s * cam.yard, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function arena(ctx: CanvasRenderingContext2D, cam: Camera): void {
  // A stone wall and the sand floor of the game's arena, so light is judged on what it will be added to.
  const wall = ctx.createLinearGradient(0, 0, 0, 230);
  wall.addColorStop(0, '#4f3f2c');
  wall.addColorStop(1, '#6e5638');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, W, 230);
  const floor = ctx.createLinearGradient(0, 230, 0, H);
  floor.addColorStop(0, '#b8862f');
  floor.addColorStop(1, '#dcaa45');
  ctx.fillStyle = floor;
  ctx.fillRect(0, 230, W, H - 230);
  ctx.strokeStyle = 'rgba(90, 60, 30, 0.25)';
  ctx.lineWidth = 2;
  for (let x = -20; x <= 20; x += 2) {
    const [sx] = project(cam)([x, 0, 0]);
    ctx.beginPath();
    ctx.moveTo(sx, 230);
    ctx.lineTo(W / 2 + (sx - W / 2) * 1.6, H);
    ctx.stroke();
  }
}

/** Draw the scene; returns the HUD's time in milliseconds. */
function draw(match: Match): number {
  const cam = cameraOf(match);
  arena(bg, cam);
  figure(bg, match, 1, cam);
  figure(bg, match, 0, cam);
  const t0 = performance.now();
  drawHud(hudCtx, W, H, match, ['HUMAN', 'TAUREN'], project(cam), {
    anchor: (side, attachment) => part(match, side, attachment),
    heads: HEADS,
  });
  return performance.now() - t0;
}

// --- Playing, scrubbing, timing, the sheet -------------------------------------------------------

let classId = byName.get('warrior')!;
let live = begin(classId);
let playing = true;
const shadow = new FatalityFx();

function particles(match: Match): number {
  const spec = match.tables[0].fatality.spec;
  const T = sceneT(match);
  shadow.advance(spec, match.frame - T, { chest: 1.3 * (HEADS[1] / 1.85), top: HEADS[1] + 0.3 * (HEADS[1] / 1.85), winnerChest: 1.3 }, T);
  return shadow.pool.count;
}

function show(match: Match, ms?: number): void {
  const T = sceneT(match);
  const spec = match.tables[0].fatality.spec;
  scrub.max = String(fatalityFrames(spec) + KO_SLOWMO.frames);
  scrub.value = String(T);
  info.textContent = `T ${T} · ${match.phase} beat ${match.fatality!.beat} t ${match.fatality!.t} · particles ${particles(match)}${ms !== undefined ? ` · hud ${ms.toFixed(2)} ms` : ''}`;
}

function frame(): void {
  if (playing) {
    if (live.phase !== 'fatality' && live.phase !== 'ko') live = begin(classId);
    else tick(live, NONE);
    show(live, draw(live));
  }
  requestAnimationFrame(frame);
}

select.value = 'warrior';
select.onchange = () => {
  classId = byName.get(select.value)!;
  live = begin(classId);
};
playButton.onclick = () => {
  playing = !playing;
  playButton.textContent = playing ? 'pause' : 'play';
};
scrub.oninput = () => {
  playing = false;
  playButton.textContent = 'play';
  live = at(classId, Number(scrub.value));
  show(live, draw(live));
};

/** The moments a sheet shows: just after the first blow, the thick of it, the killing blow, and what it leaves. */
const MOMENTS: Record<string, number[]> = {
  paladin: [30, 100, 180, 199],
  deathknight: [28, 74, 150, 170],
  mage: [28, 80, 141, 160],
  evoker: [76, 120, 196, 214],
  rogue: [26, 92, 166, 186],
};

function moments(id: number): number[] {
  const spec = ALL_FATALITIES.get(id)!;
  if (MOMENTS[spec.id]) return MOMENTS[spec.id]!;
  const blows: number[] = [];
  let T0 = 0;
  for (const beat of spec.beats) {
    for (let t = 0; t < beat.frames; t++) if (isBlow(beat, t)) blows.push(T0 + t);
    T0 += beat.frames;
  }
  const last = blows.at(-1)!;
  const early = blows.filter((b) => b < last);
  return [early[0]! + 6, early[Math.floor(early.length / 2)]! + 8, last + 9, last + 28];
}

/** Mean, 95th percentile and worst of a list of milliseconds. */
function stat(xs: number[]): string {
  const s = [...xs].sort((a, b) => a - b);
  return `mean ${(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2)} p95 ${s[Math.floor(s.length * 0.95)]!.toFixed(2)} max ${s.at(-1)!.toFixed(2)}`;
}

const bench = {
  /** Draw a contact sheet of a class's fatality (by its key, 'mage'); `ticks` overrides the moments. */
  sheet(name: string, ticks?: number[]): number[] {
    const id = byName.get(name)!;
    const Ts = ticks ?? moments(id);
    const ctx = sheet.getContext('2d')!;
    sheet.hidden = false;
    playing = false;
    Ts.forEach((T, n) => {
      const m = at(id, T);
      draw(m);
      const x = (n % 2) * (W / 2);
      const y = Math.floor(n / 2) * (H / 2);
      ctx.drawImage(bg.canvas, x, y, W / 2, H / 2);
      ctx.drawImage(hud, x, y, W / 2, H / 2);
    });
    return Ts;
  },
  /** Send the sheet to the save server (tools/fatality-fx/save.mjs) as docs/`file`. */
  async save(file: string): Promise<string> {
    const blob = await new Promise<Blob>((done) => sheet.toBlob((b) => done(b!), 'image/png'));
    const r = await fetch(`http://127.0.0.1:5189/save?name=${encodeURIComponent(file)}`, { method: 'POST', body: blob });
    return r.text();
  },
  /** Time the HUD over a whole fatality and its knockout, `rounds` times over (what the game's F3 line calls hud); the most particles at once too. */
  measure(name: string, rounds = 3, flush = false): { hud: string; flushed: string; most: number; frames: number } {
    const id = byName.get(name)!;
    const hudMs: number[] = [];
    const flushMs: number[] = [];
    let most = 0;
    playing = false;
    // A first run to warm the code and the sprites, not counted.
    for (let r = 0; r <= rounds; r++) {
      const m = begin(id);
      while (m.phase === 'fatality' || m.phase === 'ko') {
        const ms = draw(m);
        // Reading a pixel makes the canvas finish what it was given, so the rasterising is counted too;
        // but it also moves the canvas off the GPU for good, so it is asked for, not done by default.
        const t1 = performance.now();
        if (flush) hudCtx.getImageData(0, 0, 1, 1);
        if (r > 0) {
          hudMs.push(ms);
          flushMs.push(ms + performance.now() - t1);
        }
        most = Math.max(most, particles(m));
        tick(m, NONE);
      }
    }
    return { hud: stat(hudMs), flushed: stat(flushMs), most, frames: hudMs.length };
  },
  /**
   * The particles alone, on a canvas of their own that is read back every frame (so Chrome keeps
   * it in software and every pixel is drawn on the CPU, the worst case): the pool's step and its
   * drawing, beside the same canvas with nothing on it.
   */
  particlesOnly(name: string): { step: string; draw: string; empty: string; most: number } {
    const id = byName.get(name)!;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const fx = new FatalityFx();
    const view: View = { spots: new Float64Array(ANCHORS * 2), dir: 1, yard: 200, tick: 0 };
    const stepMs: number[] = [];
    const drawMs: number[] = [];
    const emptyMs: number[] = [];
    let most = 0;
    const m = begin(id);
    const spec = m.tables[0].fatality.spec;
    const rig = { chest: 1.3 * (HEADS[1] / 1.85), top: HEADS[1] + 0.3 * (HEADS[1] / 1.85), winnerChest: 1.3 };
    while (m.phase === 'fatality' || m.phase === 'ko') {
      const T = sceneT(m);
      const cam = cameraOf(m);
      const p = project(cam);
      const spots = [part(m, 0, ATTACH.chest)!, part(m, 0, ATTACH.helm)!, part(m, 0, ATTACH.rightHand)!, [m.fighters[0].x, 0, 0], part(m, 1, ATTACH.chest)!, [m.fighters[1].x, 0, 0]] as [number, number, number][];
      while (spots.length < ANCHORS) spots.push([m.fatality!.fromX, 0, 0]);
      spots.forEach((q, i) => {
        const [x, y] = p(q);
        view.spots[i * 2] = x;
        view.spots[i * 2 + 1] = y;
      });
      view.yard = cam.yard;
      view.dir = view.spots[ANCHOR.feet * 2]! >= view.spots[ANCHOR.winnerFeet * 2]! ? 1 : -1;
      view.tick = T;
      let t0 = performance.now();
      fx.advance(spec, m.frame - T, rig, T);
      stepMs.push(performance.now() - t0);
      t0 = performance.now();
      ctx.clearRect(0, 0, W, H);
      ctx.getImageData(0, 0, 1, 1);
      emptyMs.push(performance.now() - t0);
      t0 = performance.now();
      ctx.clearRect(0, 0, W, H);
      drawParticles(ctx, fx.pool, view);
      ctx.getImageData(0, 0, 1, 1);
      drawMs.push(performance.now() - t0);
      most = Math.max(most, fx.pool.count);
      tick(m, NONE);
    }
    return { step: stat(stepMs), draw: stat(drawMs), empty: stat(emptyMs), most };
  },
  /** Jump the player to tick T of a class. */
  at(name: string, T: number): void {
    classId = byName.get(name)!;
    select.value = name;
    playing = false;
    live = at(classId, T);
    show(live, draw(live));
  },
  play(): void {
    playing = true;
  },
};
(window as unknown as { bench: typeof bench }).bench = bench;

requestAnimationFrame(frame);
