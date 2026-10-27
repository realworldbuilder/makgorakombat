import { useEffect, useRef, useState } from 'preact/hooks';
import { type Inputs, type Match, newMatch, poseOf, type Spark, tick } from '../engine/engine';
import { InputReader } from '../engine/input';
import { type MoveTable, resolveMoves } from '../engine/moves';
import { type FighterView, fighterView } from '../engine/view';
import { CAMERA, TICK_MS } from '../engine/stage';
import { Arena } from './arena';
import type { BuiltFighter } from './fighters';
import { type FighterFx, poseFx } from './fx';
import { drawHud } from './hud';
import { seedOf } from './pixels';
import { LEVEL, music, stageCue } from './music';
import { isMuted, Mixer, toggleMute } from './sound';
import type { Source } from './Select';
import { chosenRules } from './Settings';
import { measureTable } from './strike';
import type { Ground } from './stages';

/*
 * The fight. The engine steps sixty times a second whatever the screen does; each frame the
 * fighters are posed from the engine's state and the HUD is drawn over them.
 */

interface FightProps {
  fighters: [BuiltFighter, BuiltFighter];
  stage: Ground;
  p2: Source;
  onBack: () => void;
}

const MAX_STEPS = 4;

/** How hard the camera shakes for each kind of landed blow, in pan units (a fraction of half the view's height). */
const SHAKE: Record<Spark['kind'], number> = { hit: 0.025, crit: 0.06, spell: 0.03, block: 0.012, parry: 0.015, dot: 0 };
const SHAKE_DECAY = 0.82;
/** How fast the camera pushes in on a fatality and comes back, per frame. */
const PUSH_EASE = 0.07;
/** The view sinks a little as it pushes in, so the feet stay in frame; in pan units per unit of push. */
const PUSH_SINK = 0.16;

/** The camera's shake: kicked by each new spark, dying away over a few frames, deterministic in the frame count. */
class Shaker {
  private readonly seen = new WeakSet<Spark>();
  private amount = 0;

  /** Note this frame's new sparks and step the shake. */
  observe(match: Match): void {
    for (const spark of match.sparks) {
      if (this.seen.has(spark)) continue;
      this.seen.add(spark);
      this.amount = Math.max(this.amount, SHAKE[spark.kind]);
    }
    this.amount *= SHAKE_DECAY;
    if (this.amount < 0.0005) this.amount = 0;
  }

  /** A kick from outside the sparks: a fatality's blow. */
  kick(amount: number): void {
    this.amount = Math.max(this.amount, amount);
  }

  /** The camera offset this frame. */
  offset(frame: number): { x: number; y: number } {
    if (this.amount === 0) return { x: 0, y: 0 };
    return { x: Math.sin(frame * 2.9) * this.amount, y: Math.cos(frame * 4.1) * this.amount * 0.7 };
  }
}

/** Classes whose off-hand, beside a one-hander, is a shield: warrior, paladin, shaman. */
const SHIELD_CLASSES = new Set([1, 2, 7]);

/**
 * The fighter's moves and class kit, from its animations, its weapon and its class, with its
 * blows measured off its own model so they land when and where the weapon does. A legend
 * without a class gets a warrior's kit, or a hunter's behind a bow.
 */
function tableOf(fighter: BuiltFighter): MoveTable {
  const { champion, result } = fighter;
  const shield = result.wielding === 'oneHand' && champion.classId !== undefined && SHIELD_CLASSES.has(champion.classId) && champion.gear.some(([slot]) => slot === 'offHand');
  const table = resolveMoves(result.scene.animations, result.wielding, champion.classId, shield);
  return measureTable(table, fighter.rig, result.rig, result.scene, headHeight(fighter));
}

/** How high a fighter's head is, standing: the model's helm point, at its own size; a little under the top of its box without one. */
function headHeight(fighter: BuiltFighter): number {
  const { head, bounds } = fighter.result.scene;
  return head ? head[2] : (bounds.max[2] - bounds.min[2]) * 0.88;
}

export function Fight({ fighters, stage, p2, onBack }: FightProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const stageElement = useRef<HTMLDivElement>(null);
  const [debug, setDebug] = useState(false);
  const debugRef = useRef(debug);
  debugRef.current = debug;
  const match = useRef<Match>(null);
  const rematch = useRef(0);
  const [muted, setMuted] = useState(isMuted());
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    const ring = new Arena(canvas.current!);
    ring.setFighters(fighters);
    // The spells' models join the ring once both fighters' are read: one more upload, at the start.
    let fxs: (FighterFx | undefined)[] = [undefined, undefined];
    let live = true;
    void Promise.all(fighters.map((fighter) => fighter.fx())).then((loaded) => {
      if (!live) return;
      fxs = loaded;
      ring.setFighters(fighters, loaded.flatMap((fx) => fx.slots));
    });
    ring.setGround(stage);
    const names: [string, string] = [fighters[0].champion.name, fighters[1].champion.name];
    const seed = seedOf(fighters[0].champion.key + fighters[1].champion.key) + rematch.current;
    const tables: [MoveTable, MoveTable] = [tableOf(fighters[0]), tableOf(fighters[1])];
    const rules = chosenRules();
    match.current = newMatch(tables, seed, names, rules);
    const mixer = new Mixer();
    void mixer.load(0, fighters[0].sounds);
    void mixer.load(1, fighters[1].sounds);
    // The stage's music carries on from the VS screen, under the fight, and drops under a fatality.
    music.play(stageCue(stage.stage), LEVEL.fight);
    let musicLevel: number = LEVEL.fight;
    // For scripts and the console: the live match and what the fight sounds like.
    (window as unknown as { mk?: { match: () => Match; view: (i: 0 | 1) => FighterView; fighters: () => [BuiltFighter, BuiltFighter]; sounds: () => unknown; spells: () => unknown; hold: (on: boolean) => void; anchor: (side: 0 | 1, id: number) => unknown; times: () => unknown } }).mk = {
      match: () => match.current!,
      view: (i) => fighterView(match.current!, i),
      fighters: () => fighters,
      sounds: () => ({ played: mixer.played, sides: mixer.summary(), music: music.now() }),
      spells: () => fxs.map((fx) => fx?.spells),
      anchor: (side, id) => ring.anchor(side, id),
      // What F3 shows: ms a frame in the engine, posing and drawing the ring, and the HUD.
      times: () => ({ ...times }),
      // Freeze the fight on a frame, still drawn: for scripts that photograph a moment.
      hold: (on) => {
        held = on;
      },
    };
    // Each fighter's head, standing, at its own size: where its nameplate hangs and its words rise.
    const heads: [number, number] = [headHeight(fighters[0]), headHeight(fighters[1])];
    const input = new InputReader();
    // The keys are read from the window, not the stage element: a click on the DOM frames or anywhere
    // else must not leave the keyboard dead. The stage still takes focus so the arrows do not scroll.
    input.attach(window);
    input.setSource(1, p2);
    stageElement.current!.focus();

    let frame = 0;
    let held = false;
    let last = performance.now();
    let owed = 0;
    const times = { engine: 0, pose: 0, draw: 0 };
    const shaker = new Shaker();
    let push = 1;
    let hitsSeen = 0;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      const current = match.current!;
      owed = held ? 0 : owed + Math.min(now - last, 250);
      last = now;
      let steps = 0;
      const t0 = performance.now();
      while (owed >= TICK_MS && steps < MAX_STEPS) {
        // The reader asks the CPU itself when player 2 is the computer; asking twice would lose its presses.
        const inputs: [Inputs, Inputs] = input.read(current);
        tick(current, inputs);
        owed -= TICK_MS;
        steps++;
      }
      if (steps === MAX_STEPS) owed = 0;
      if (steps > 0) {
        mixer.observe(current);
        shaker.observe(current);
        // A fatality's blow shakes as its beat says.
        const run = current.fatality;
        if (run && current.phase === 'fatality' && run.hits !== hitsSeen) {
          shaker.kick(current.tables[current.roundWinner ?? 0].fatality.spec.beats[run.beat]?.shake ?? 0);
        }
        hitsSeen = run?.hits ?? 0;
        const wantMusic = current.phase === 'fatality' ? LEVEL.fatality : LEVEL.fight;
        if (wantMusic !== musicLevel) music.level((musicLevel = wantMusic));
      }
      const t1 = performance.now();
      const shake = shaker.offset(current.frame);
      // The camera pushes in on the pair for the fatality and eases back out with the round's end.
      const cinematic = current.fatality !== undefined && (current.phase === 'fatality' || current.phase === 'ko');
      const wantPush = cinematic ? current.tables[current.roundWinner ?? 0].fatality.spec.push : 1;
      push += (wantPush - push) * PUSH_EASE;
      const camera = { ...CAMERA, zoom: CAMERA.zoom / push, panX: CAMERA.panX + shake.x, panY: CAMERA.panY + shake.y - (push - 1) * PUSH_SINK };
      ring.frame(current.fighters.map((fighter) => fighter.x));
      ring.draw(
        current.fighters.map((fighter, i) => ({ ...poseOf(current, i as 0 | 1), x: fighter.x, z: fighter.z, facing: fighter.facing })),
        camera,
        (at) => poseFx(current, fxs, at).flat(),
      );
      const t2 = performance.now();
      const hud = overlay.current!;
      if (hud.width !== canvas.current!.width || hud.height !== canvas.current!.height) {
        hud.width = canvas.current!.width;
        hud.height = canvas.current!.height;
      }
      const ctx = hud.getContext('2d')!;
      times.engine = times.engine * 0.9 + (t1 - t0) * 0.1;
      times.pose = times.pose * 0.9 + (t2 - t1) * 0.1;
      const note = debugRef.current
        ? `engine ${times.engine.toFixed(2)} ms · pose+draw ${times.pose.toFixed(2)} ms · hud ${times.draw.toFixed(2)} ms · sounds ${mixer.played}`
        : mutedRef.current ? 'MUTED · M' : undefined;
      drawHud(ctx, hud.width, hud.height, current, names, (point) => ring.project(camera, point), { human: [true, p2 !== 'cpu'], debug: note, sources: [input.source(0), input.source(1)], anchor: ring.anchor, heads });
      // The HUD's own time, shown the next frame.
      times.draw = times.draw * 0.9 + (performance.now() - t2) * 0.1;
    };
    frame = requestAnimationFrame(loop);

    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'F3') {
        event.preventDefault();
        setDebug((d) => !d);
      } else if (event.code === 'KeyM') {
        setMuted(toggleMute());
      } else if (event.code === 'Escape') {
        onBack();
      } else if (event.code === 'Enter' && match.current?.phase === 'matchEnd') {
        rematch.current++;
        match.current = newMatch(tables, seed + rematch.current, names, rules);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      mixer.dispose();
      input.detach();
      window.removeEventListener('keydown', onKey);
    };
  }, [fighters, stage, p2, onBack]);

  return (
    <div class="screen fight" ref={stageElement} tabIndex={0}>
      <canvas class="ring" ref={canvas} />
      <canvas class="hud" ref={overlay} />
    </div>
  );
}
