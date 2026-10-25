import { useEffect, useRef, useState } from 'preact/hooks';
import { type Inputs, type Match, moveOf, newMatch, poseOf, type Spark, tick } from '../engine/engine';
import { InputReader } from '../engine/input';
import { type MoveTable, resolveMoves, variationOf } from '../engine/moves';
import { type FighterView, fighterView } from '../engine/view';
import { bodyRadius, CAMERA, HUMAN_HEAD, TICK_MS } from '../engine/stage';
import { Arena } from './arena';
import type { BuiltFighter } from './fighters';
import { ATTACH, type FighterFx, poseFx } from './fx';
import { drawHud, LETTERBOX } from './hud';
import { seedOf } from './pixels';
import { isReporting } from './report';
import { LEVEL, music, stageCue } from './music';
import { isMuted, Mixer, toggleMute } from './sound';
import type { Source } from './Select';
import { chosenRules } from './Settings';
import { isRulesName, type RulesName } from '../engine/rules';
import type { Ground } from './stages';
import type { Hello } from './net/handshake';
import { Lockstep, WAIT_SHOWN_MS } from './net/lockstep';
import type { Link } from './net/relay';
import type { Spectator } from './net/watch';

/*
 * The fight. The engine steps sixty times a second whatever the screen does; each frame the
 * fighters are posed from the engine's state and the HUD is drawn over them.
 */

interface FightProps {
  fighters: [BuiltFighter, BuiltFighter];
  stage: Ground;
  p2: Source;
  onBack: () => void;
  /** Online: the fight runs in lockstep with the other machine. */
  net?: NetFight;
  /** Watching somebody else's fight: no keys, no lockstep, the match played from what the room relays. */
  watch?: WatchFight;
}

/** A fight being watched: the match the spectator plays, and the two players' names for the banner. */
export interface WatchFight {
  spectator: Spectator;
  players: [string, string];
}

/** An online fight: the wire, which fighter this machine plays, and what the host's hello fixed. */
export interface NetFight {
  link: Link;
  me: 0 | 1;
  host: boolean;
  /** The seed, the match number and the host's tables, which both engines run on. */
  hello: Hello;
  /** Said once at the start: a legend, an item or the ground this install draws otherwise than the other. */
  notes: string[];
}

/** How the fight stands on the wire, for the banner over it. */
type NetState = 'waiting' | 'desync' | undefined;
/** The notes at the start stay up this long. */
const NOTES_MS = 7000;

const MAX_STEPS = 4;

/** How hard the camera shakes for each kind of landed blow, in pan units (a fraction of half the view's height). */
const SHAKE: Record<Spark['kind'], number> = { hit: 0.025, crit: 0.06, spell: 0.03, block: 0.012, parry: 0.015, dot: 0 };
const SHAKE_DECAY = 0.82;
/** How fast the camera pushes in on a fatality and comes back, per frame. */
const PUSH_EASE = 0.07;
/** The view sinks a little as it pushes in, so the feet stay in frame; in pan units per unit of push. */
const PUSH_SINK = 0.16;
/** In a fatality the camera keeps this much air between a head or a foot and its letterbox bar, as a fraction of the height. */
const FIT_AIR = 0.02;
/** How fast it lets the push off or slides the view to do that, per frame: quickly to make room before a head is cut, slowly back once there is room. */
const FIT_EASE = { out: 0.45, back: 0.1 };
/** The top of the head above the helm point, for a human. */
const CROWN = 0.25;

/**
 * Keeps both bodies between a fatality's letterbox bars: a leap or a hop can lift a head out of a
 * frame pushed in for the close-up. Measured on each frame's picture, it lets the push off
 * (`give`, a factor on the zoom) while the pair is taller than the room between the bars, and
 * slides the view (`lift`, in pan units) while they fit but sit under a bar; both ease back to
 * nothing once there is room.
 */
class Fitter {
  give = 1;
  lift = 0;

  /** Step toward the framing that puts `span` (the pair's top and bottom in canvas pixels, as this frame drew them) between the bars; undefined steps back to none. */
  observe(span: readonly [number, number] | undefined, height: number): void {
    let give = 1;
    let lift = 0;
    if (span) {
      const [top, bottom] = span;
      const lo = height * (LETTERBOX + FIT_AIR);
      const hi = height * (1 - LETTERBOX - FIT_AIR);
      give = Math.max(1, (this.give * (bottom - top)) / (hi - lo));
      // Slide the picture down by `by` pixels (up when negative): as little as fits, and toward no slide at all.
      const now = this.lift * (height / 2);
      const least = lo - top;
      const most = hi - bottom;
      const by = least > most ? (least + most) / 2 : Math.min(most, Math.max(least, -now));
      lift = (now + by) / (height / 2);
    }
    this.give += (give - this.give) * (give > this.give ? FIT_EASE.out : FIT_EASE.back);
    this.lift += (lift - this.lift) * (Math.abs(lift) > Math.abs(this.lift) ? FIT_EASE.out : FIT_EASE.back);
  }
}

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
 * The fighter's moves and class kit, from its animations, its weapon and its class. A legend
 * without a class gets a warrior's kit, or a hunter's behind a bow.
 */
export function tableOf(fighter: BuiltFighter): MoveTable {
  const { champion, result } = fighter;
  const shield = result.wielding === 'oneHand' && champion.classId !== undefined && SHIELD_CLASSES.has(champion.classId) && champion.gear.some(([slot]) => slot === 'offHand');
  // The body's size and lean set how close it stands and how far it reaches: Cairne stands off further than a gnome.
  const body = bodyRadius(headHeight(fighter) / HUMAN_HEAD, result.scene.head?.[0] ?? 0);
  return resolveMoves(result.scene.animations, result.wielding, champion.classId, shield, body);
}

/**
 * The pose of fighter `i` in this install's own animations. Online the engine times every move
 * by the host's tables; when this model's clip for the move is longer or shorter than the
 * host's, it is stretched to the host's timing, so the blow lands where the engine says.
 */
function poseIn(match: Match, i: 0 | 1, table: MoveTable): { sequence: number; time: number } {
  if (table === match.tables[i]) return poseOf(match, i);
  const f = match.fighters[i];
  const played = variationOf(moveOf(match, i, f.move), f.variation);
  // moveOf reads only the side's table: this install's, in place of the host's.
  const own = variationOf(moveOf({ tables: [table, table] } as unknown as Match, i, f.move), f.variation);
  return { sequence: own.sequence, time: (Math.min(f.t, played.duration) * own.duration) / played.duration };
}

/** How high a fighter's head is, standing: the model's helm point, at its own size; a little under the top of its box without one. */
function headHeight(fighter: BuiltFighter): number {
  const { head, bounds } = fighter.result.scene;
  return head ? head[2] : (bounds.max[2] - bounds.min[2]) * 0.88;
}

export function Fight({ fighters, stage, p2, onBack, net, watch }: FightProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const arena = useRef<Arena>(null);
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
  const [netState, setNetState] = useState<NetState>();
  const [notes, setNotes] = useState<string[]>(net?.notes ?? []);

  useEffect(() => {
    // One ring for the screen, kept if the fight starts over on it: its canvas has one context to give.
    const ring = (arena.current ??= new Arena(canvas.current!));
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
    // Online the names, the seed, the tables and the rules are the host's, the same on both machines; the poses are this install's.
    // Watching, they are the host's too, from the hello the room kept.
    const hello = net?.hello ?? watch?.spectator.hello;
    const names: [string, string] = hello ? [hello.fighters[0].name, hello.fighters[1].name] : [fighters[0].champion.name, fighters[1].champion.name];
    let seed = hello ? hello.seed : seedOf(fighters[0].champion.key + fighters[1].champion.key) + rematch.current;
    const own: [MoveTable, MoveTable] = [tableOf(fighters[0]), tableOf(fighters[1])];
    const tables: [MoveTable, MoveTable] = hello ? hello.tables : own;
    const drawn: [MoveTable, MoveTable] = net?.host ? tables : own;
    const rules: RulesName = hello && isRulesName(hello.rules) ? hello.rules : chosenRules();
    match.current = watch?.spectator.match ?? newMatch(tables, seed, names, rules);
    let game = net?.hello.game ?? 0;
    let lockstep = net ? new Lockstep(net.link.channel(), net.me, { game }) : undefined;
    let shown: NetState;
    const mixer = new Mixer();
    void mixer.load(0, fighters[0].sounds);
    void mixer.load(1, fighters[1].sounds);
    // The stage's music carries on from the VS screen, under the fight, and drops under a fatality.
    music.play(stageCue(stage.stage), LEVEL.fight);
    let musicLevel: number = LEVEL.fight;
    // For scripts and the console: the live match and what the fight sounds like.
    (window as unknown as { mk?: { match: () => Match; view: (i: 0 | 1) => FighterView; fighters: () => [BuiltFighter, BuiltFighter]; sounds: () => unknown; spells: () => unknown; hold: (on: boolean) => void; anchor: (side: 0 | 1, id: number) => unknown; times: () => unknown; net: () => Lockstep | undefined } }).mk = {
      net: () => lockstep,
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
    const handle = (window as unknown as { mk?: unknown }).mk;
    // Each fighter's head, standing, at its own size: where its nameplate hangs and its words rise.
    const heads: [number, number] = [headHeight(fighters[0]), headHeight(fighters[1])];
    const input = new InputReader();
    // The keys are read from the window, not the stage element: a click on the DOM frames or anywhere
    // else must not leave the keyboard dead. The stage still takes focus so the arrows do not scroll.
    input.attach(window);
    // Online this keyboard plays as player 1 whichever side it is, and the other side comes over the wire.
    input.setSource(1, net || watch ? 'remote' : p2);
    stageElement.current!.focus();

    let frame = 0;
    let held = false;
    let last = performance.now();
    let owed = 0;
    const times = { engine: 0, pose: 0, draw: 0 };
    const shaker = new Shaker();
    const fitter = new Fitter();
    let push = 1;
    let hitsSeen = 0;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      // Watching, a rematch is a new match the spectator made.
      if (watch?.spectator.match) match.current = watch.spectator.match;
      const current = match.current!;
      // Held by a script, or standing still while a report is written; never online, where holding here would stall the other player.
      owed = (held || isReporting()) && !net ? 0 : owed + Math.min(now - last, 250);
      last = now;
      let steps = 0;
      const t0 = performance.now();
      if (watch) {
        // The ticks the clock owes, or more to catch up; a fight held for the players' inputs runs up no debt.
        const due = Math.floor(owed / TICK_MS);
        steps = watch.spectator.play(due);
        owed = steps < due ? Math.min(owed, TICK_MS) : owed - due * TICK_MS;
      }
      while (!watch && owed >= TICK_MS && steps < MAX_STEPS) {
        if (lockstep) {
          // A tick runs once both players' inputs for it are here; until then the fight holds, with no debt run up.
          if (!lockstep.step(current, () => input.read(current)[0])) {
            owed = Math.min(owed, TICK_MS);
            break;
          }
        } else {
          // The reader asks the CPU itself when player 2 is the computer; asking twice would lose its presses.
          const inputs: [Inputs, Inputs] = input.read(current);
          tick(current, inputs);
        }
        owed -= TICK_MS;
        steps++;
      }
      if (steps === MAX_STEPS && !watch) owed = 0;
      if (lockstep) {
        const status = lockstep.status();
        const state: NetState = status.desync ? 'desync' : status.waiting > WAIT_SHOWN_MS ? 'waiting' : undefined;
        if (state !== shown) setNetState((shown = state));
      } else if (watch) {
        const status = watch.spectator.status();
        const state: NetState = status === 'desync' ? 'desync' : status === 'buffering' ? 'waiting' : undefined;
        if (state !== shown) setNetState((shown = state));
      }
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
      const camera = { ...CAMERA, zoom: (CAMERA.zoom / push) * fitter.give, panX: CAMERA.panX + shake.x, panY: CAMERA.panY + shake.y - (push - 1) * PUSH_SINK - fitter.lift };
      ring.frame(current.fighters.map((fighter) => fighter.x));
      ring.draw(
        current.fighters.map((fighter, i) => ({ ...poseIn(current, i as 0 | 1, drawn[i]!), x: fighter.x, z: fighter.z, facing: fighter.facing })),
        camera,
        (at) => poseFx(current, fxs, at).flat(),
      );
      // Where the pair reaches in that picture, the top of the higher head and the lower feet, for the next frame's fit.
      let span: [number, number] | undefined;
      if (cinematic) {
        let top = Infinity;
        let bottom = -Infinity;
        for (const i of [0, 1] as const) {
          const f = current.fighters[i];
          const ground = f.z + ring.floorAt(f.x);
          const eyes = ring.anchor(i, ATTACH.helm) ?? ring.anchor(i, ATTACH.head) ?? [f.x, 0, ground + heads[i]];
          const crown = ring.project(camera, [eyes[0], eyes[1], eyes[2] + (CROWN * heads[i]) / HUMAN_HEAD]);
          const feet = ring.project(camera, [f.x, 0, ground]);
          if (crown) top = Math.min(top, crown[1]);
          if (feet) bottom = Math.max(bottom, feet[1]);
        }
        if (top < bottom) span = [top, bottom];
      }
      fitter.observe(span, canvas.current!.height);
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
      drawHud(ctx, hud.width, hud.height, current, names, (point) => ring.project(camera, point), {
        human: [true, net !== undefined || watch !== undefined || p2 !== 'cpu'],
        debug: note,
        sources: [input.source(0), input.source(1)],
        keys: net || watch ? [0, 0] : undefined,
        anchor: ring.anchor,
        heads,
      });
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
        // Online both go back to the roster together; a watcher just stops watching.
        net?.link.send({ t: 'back' });
        onBack();
      } else if (event.code === 'Enter' && match.current?.phase === 'matchEnd' && !watch) {
        if (!net) {
          rematch.current++;
          match.current = newMatch(tables, seed + rematch.current, names, rules);
        } else if (net.host) {
          // The host calls the rematch; the guest starts it when told.
          game++;
          const next = (seed + game) >>> 0;
          net.link.send({ t: 'rematch', game, seed: next });
          restart(game, next);
        }
      }
    };
    /** A new match on the same tables, and a new lockstep for it: the last match's frames still on the wire are of another game. */
    const restart = (number: number, next: number) => {
      lockstep?.dispose();
      game = number;
      seed = next;
      lockstep = new Lockstep(net!.link.channel(), net!.me, { game });
      match.current = newMatch(tables, seed, names, rules);
      shown = undefined;
      setNetState(undefined);
    };
    const offLink = net?.link.listen((message) => {
      if (message.t === 'rematch' && !net.host && message.game !== game) restart(message.game, message.seed);
    });
    window.addEventListener('keydown', onKey);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      mixer.dispose();
      input.detach();
      lockstep?.dispose();
      offLink?.();
      window.removeEventListener('keydown', onKey);
      // The console's handle goes with the fight: it reaches the fighters, the ring and the mixer, and would keep them after.
      const page = window as unknown as { mk?: unknown };
      if (page.mk === handle) delete page.mk;
    };
  }, [fighters, stage, p2, onBack, net, watch]);

  // The ring's context goes with the screen, so the next fight's does not push the browser past its few.
  useEffect(
    () => () => {
      arena.current?.dispose();
      arena.current = null;
    },
    [],
  );

  // The notes on how this install draws the fight go after a while.
  useEffect(() => {
    if (notes.length === 0) return;
    const timer = setTimeout(() => setNotes([]), NOTES_MS);
    return () => clearTimeout(timer);
  }, [notes]);

  return (
    <div class="screen fight" ref={stageElement} tabIndex={0}>
      <canvas class="ring" ref={canvas} />
      <canvas class="hud" ref={overlay} />
      {watch && (
        <div class="watch-banner">
          WATCHING <b>{watch.players[0]}</b> vs <b>{watch.players[1]}</b>
          <span>Esc back to the lobby</span>
        </div>
      )}
      {netState === 'waiting' && <div class="net-banner">{watch ? 'WAITING FOR THE PLAYERS' : 'WAITING FOR OPPONENT'}</div>}
      {netState === 'desync' && (
        <div class="net-banner bad">
          DESYNC
          <span>
            {watch
              ? "This page's game no longer agrees with the players', so watching is stopped. Esc goes back to the lobby."
              : 'The two games no longer agree, so the match is stopped. Esc goes back to the roster.'}
          </span>
        </div>
      )}
      {notes.length > 0 && (
        <div class="net-notes">
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      )}
    </div>
  );
}
