import { useEffect, useRef, useState } from 'preact/hooks';
import type { Image } from '@mogshot/formats/blp';
import { CLASSIC_SCREEN_ASPECT, composeBackdrop } from '@mogshot/render/backdrop';
import type { LoadingScreen } from '@mogshot/worker/api';
import type { DataClient } from '@mogshot/worker/client';
import type { PlaceScene } from '@mogshot/world/place';
import { CAMERA, START_X } from '../engine/stage';
import { Arena } from './arena';
import { BATTLEGROUND, LEVEL, music, stageCue } from './music';
import type { BuiltFighter } from './fighters';
import { facingRadians, type Ground, type Stage, thumbnailUrl } from './stages';
import { type Line, WowTooltip } from './ui/WowTooltip';

/*
 * The two champions face each other across the ring while the ground is picked: a stage in the
 * game world, read from the open folder's map files and raised around them while they wait, or,
 * further along the strip, one of the game's loading screens. Enter fights; Escape goes back.
 */

interface VersusProps {
  client: DataClient;
  fighters: [BuiltFighter, BuiltFighter];
  /** The stages this install can draw. */
  stages: Stage[];
  screens: LoadingScreen[];
  onFight: (ground: Ground) => void;
  onBack: () => void;
}

type Entry = { kind: 'stage'; stage: Stage } | { kind: 'screen'; screen: LoadingScreen };

/** The stage under the cursor as the game would list it: a place in the world reads epic, a loading screen common. */
function stageLines(entry: Entry, status: string | undefined): Line[] {
  if (entry.kind === 'screen') {
    return [
      { left: entry.screen.name, kind: 'name', hue: 'common' },
      { left: 'Loading Screen', right: entry.screen.wide ? 'Widescreen' : 'Classic' },
      { left: 'Use: Fight before the picture.', hue: 'green' },
    ];
  }
  const { stage } = entry;
  const lines: Line[] = [
    { left: stage.name, kind: 'name', hue: 'epic' },
    { left: 'Arena', right: stage.where },
    { left: `Use: Fight in the world itself, ${stage.reach} yards of it drawn round the ring.`, hue: 'green' },
    { left: `"${stage.why}"`, hue: 'gold' },
  ];
  if (status) lines.push({ left: status, hue: 'grey', kind: 'small' });
  return lines;
}

const STAGE_LIKE = /arena|gurubashi|nagrand|coliseum|colosseum|durotar|orgrimmar|stranglethorn|barrens|valley of trials|ring/i;
/** How many raised places are kept while the strip is browsed; a place is a few hundred megabytes of world. */
const KEEP_PLACES = 3;

/** How long the cursor rests on a stage before its music comes in, so a quick pass along the strip does not read every zone's. */
const MUSIC_REST = 450;

const keyOf = (entry: Entry) => (entry.kind === 'stage' ? `stage:${entry.stage.slug}` : `screen:${entry.screen.id}`);

export function Versus({ client, fighters, stages, screens, onFight, onBack }: VersusProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const arena = useRef<Arena>(null);
  // The real places only; the loading screens are there for an install that has none of them.
  const entries: Entry[] = stages.length > 0 ? stages.map((stage): Entry => ({ kind: 'stage', stage })) : screens.map((screen): Entry => ({ kind: 'screen', screen }));
  const [cursor, setCursor] = useState(() => (stages.length > 0 ? 0 : Math.max(0, screens.findIndex((screen) => STAGE_LIKE.test(screen.name)))));
  const [thumbs, setThumbs] = useState<Map<number, string>>(new Map());
  const [status, setStatus] = useState<string>();
  const images = useRef(new Map<number, Promise<Image | undefined>>());
  const places = useRef(new Map<string, Promise<PlaceScene>>());
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const started = useRef(performance.now());

  const imageOf = (screen: LoadingScreen) => {
    let image = images.current.get(screen.fileId);
    if (!image) images.current.set(screen.fileId, (image = client.icon(screen.fileId).catch(() => undefined)));
    return image;
  };

  /** The world around a stage's spot, read once and kept while it is near the cursor. */
  const placeOf = (stage: Stage) => {
    const kept = places.current;
    let place = kept.get(stage.slug);
    if (place) {
      // Most recently wanted last.
      kept.delete(stage.slug);
      kept.set(stage.slug, place);
      return place;
    }
    place = client.place(stage.map, stage.x, stage.y, facingRadians(stage), stage.reach, stage.z);
    place.catch(() => kept.delete(stage.slug));
    kept.set(stage.slug, place);
    while (kept.size > KEEP_PLACES) kept.delete(kept.keys().next().value!);
    return place;
  };

  // Thumbnails of the loading screens around the cursor, drawn as the game shows them. Stages ship theirs.
  useEffect(() => {
    let stale = false;
    const around = entries.slice(Math.max(0, cursor - 8), cursor + 9);
    for (const entry of around) {
      if (entry.kind !== 'screen') continue;
      const { screen } = entry;
      if (thumbs.has(screen.fileId)) continue;
      void imageOf(screen).then((image) => {
        if (stale || !image) return;
        const drawn = composeBackdrop({ kind: 'screen', fileId: screen.fileId, blur: 0, vignette: 0 }, 192, 108, image, screen.wide ? undefined : CLASSIC_SCREEN_ASPECT);
        if (!drawn) return;
        const url = drawn instanceof HTMLCanvasElement ? drawn.toDataURL() : undefined;
        if (!url) return;
        setThumbs((current) => new Map(current).set(screen.fileId, url));
      });
    }
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, stages, screens]);

  useEffect(() => {
    const ring = (arena.current ??= new Arena(canvas.current!));
    ring.setFighters(fighters);
    // The spells' models are read while the players choose the ground, ready for the fight.
    for (const fighter of fighters) void fighter.fx();
    started.current = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const since = now - started.current;
      ring.frame([-START_X, START_X], 1);
      ring.draw(
        fighters.map((fighter, i) => {
          const intro = fighter.moves.moves.intro.variations[0]!;
          const idle = fighter.moves.moves.idle.variations[0]!;
          const roaring = since < intro.duration;
          const time = roaring ? since : idle.duration > 0 ? since % idle.duration : 0;
          return { sequence: roaring ? intro.sequence : idle.sequence, time, x: i === 0 ? -START_X : START_X, z: 0, facing: i === 0 ? 1 : -1 };
        }),
        CAMERA,
      );
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [fighters]);

  // The ground under the ring follows the cursor: a stage is raised around the fighters, a screen goes up behind them.
  useEffect(() => {
    const entry = entries[cursor];
    if (!entry) return;
    let stale = false;
    if (entry.kind === 'stage') {
      const { stage } = entry;
      setStatus('RAISING THE GROUND…');
      placeOf(stage)
        .then((place) => {
          if (stale) return;
          arena.current?.setGround({ stage, place });
          setStatus(undefined);
        })
        .catch((cause: unknown) => {
          if (stale) return;
          console.warn(`${stage.name} could not be raised:`, cause);
          arena.current?.setGround({});
          setStatus(`THE GROUND WOULD NOT RISE · ${cause instanceof Error ? cause.message : String(cause)}`);
        });
    } else {
      const { screen } = entry;
      setStatus(undefined);
      void imageOf(screen).then((image) => !stale && arena.current?.setGround({ screen, image }));
    }
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, stages, screens]);

  // The music of the stage under the cursor, once the cursor rests a moment; a loading screen has the battlegrounds'.
  useEffect(() => {
    const entry = entries[cursor];
    const wait = setTimeout(() => music.play(entry?.kind === 'stage' ? stageCue(entry.stage) : BATTLEGROUND, LEVEL.versus), MUSIC_REST);
    return () => clearTimeout(wait);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, stages, screens]);

  useEffect(() => {
    const count = entries.length;
    const onKey = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'ArrowLeft': case 'KeyA': setCursor((c) => (c - 1 + count) % count); break;
        case 'ArrowRight': case 'KeyD': setCursor((c) => (c + 1) % count); break;
        case 'ArrowUp': case 'KeyW': setCursor((c) => (c - 8 + count * 8) % count); break;
        case 'ArrowDown': case 'KeyS': setCursor((c) => (c + 8) % count); break;
        case 'Enter': case 'KeyJ': case 'Numpad1': case 'Comma': case 'Space': case 'Digit1': {
          event.preventDefault();
          const entry = entries[cursorRef.current];
          if (!entry) onFight({});
          else if (entry.kind === 'stage') {
            // Enter while the ground is still rising waits for it, then fights on it.
            void placeOf(entry.stage).then((place) => onFight({ stage: entry.stage, place })).catch(() => onFight({}));
          } else void imageOf(entry.screen).then((image) => onFight({ screen: entry.screen, image }));
          break;
        }
        case 'Escape': onBack(); break;
        default: return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stages, screens, onFight, onBack]);

  const [a, b] = fighters;
  const here = entries[cursor];
  const shown = entries.slice(Math.max(0, cursor - 5), cursor + 6);
  const title = here?.kind === 'stage' ? `${here.stage.name} · ${here.stage.where}` : here?.kind === 'screen' ? here.screen.name : 'NO STAGE';
  return (
    <div class="screen versus">
      <canvas class="ring" ref={canvas} />
      <div class="plates">
        <div class="plate p1">
          <div class="name">{a.champion.name}</div>
          <div class="title">{a.champion.title}</div>
        </div>
        <div class="vs">VS</div>
        <div class="plate p2">
          <div class="name">{b.champion.name}</div>
          <div class="title">{b.champion.title}</div>
        </div>
      </div>
      <div class="stages">
        <div class="label">CHOOSE THE GROUND · {title}</div>
        <div class="strip">
          {shown.map((entry) => (
            <div key={keyOf(entry)} class={`stage ${entry.kind === 'stage' ? 'world' : ''} ${entry === here ? 'here' : ''}`}>
              {entry === here && <WowTooltip lines={stageLines(entry, status)} />}
              {entry.kind === 'stage' ? (
                <img src={thumbnailUrl(entry.stage)} alt={entry.stage.name} />
              ) : thumbs.get(entry.screen.fileId) ? (
                <img src={thumbs.get(entry.screen.fileId)} alt={entry.screen.name} />
              ) : (
                <span class="dim small">{entry.screen.name}</span>
              )}
            </div>
          ))}
        </div>
        <div class="controls">
          {status ? <span class="status">{status}</span> : <span>← → pick a stage · ↑ ↓ jump eight · <b>Enter</b> fight · <b>Esc</b> back</span>}
        </div>
      </div>
    </div>
  );
}
