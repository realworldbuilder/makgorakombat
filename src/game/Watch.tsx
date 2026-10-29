import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Image } from '@mogshot/formats/blp';
import type { LoadingScreen } from '@mogshot/worker/api';
import type { DataClient } from '@mogshot/worker/client';
import { Fight, type WatchFight } from './Fight';
import type { BuiltFighter, Fighters } from './fighters';
import { messageOf } from './folder';
import type { Tile } from './roster';
import type { WatchRoster } from './Select';
import { chosenRules } from './Settings';
import { facingRadians, type Ground, type Stage, STAGES, thumbnailUrl } from './stages';
import { championOf, type FighterSpec, type Hello, localize, plainSpec, type StageKey } from './net/handshake';
import { type LobbyFight, savedName } from './net/lobby';
import { VERSION } from './net/version';
import { Spectator, Watching } from './net/watch';
import type { UiAssets } from './ui/icons';
import { FightUi } from './ui/FightUi';
import { WatchChat } from './WatchChat';

/*
 * WATCH: somebody else's fight on this screen, as a third seat in their room. The champions are
 * built from the host's hello with this install's own files, as the guest builds them, and the
 * ground found in this install's own list; the fight screen then draws the match the spectator
 * plays (net/watch.ts), with no keys of its own. Between fights the two players' pick is on
 * CHOOSE YOUR LEGEND as they see it, both cursors moving as they move theirs (Select's watch),
 * until the next hello's fight is ready. Escape goes back to the lobby whenever.
 *
 * A stage this install cannot raise (one its folder lacks, or one that would not rise) is never
 * black behind a watched fight: the stage's own picture stands in, and a note says why. The
 * watchers chat in the bottom corner (WatchChat), over their own sockets, never the players'.
 */

interface WatchProps {
  fight: LobbyFight;
  client: DataClient;
  fighters: Fighters;
  legends: Tile[];
  stages: Stage[];
  screens: LoadingScreen[];
  assets: UiAssets;
  /** CHOOSE YOUR LEGEND as the watcher sees the two pick, from the game's own (Game.tsx); `bay` when they pick in Booby Bay. */
  select: (roster: WatchRoster, bay: boolean) => ComponentChildren;
  onBack: () => void;
}

/** The champions and the ground of a hello, built here, and what this install draws otherwise than the players. */
interface Ready {
  hello: Hello;
  fighters: [BuiltFighter, BuiltFighter];
  ground: Ground;
  notes: string[];
}

export function Watch({ fight, client, fighters, legends, stages, screens, assets, select, onBack }: WatchProps) {
  const spectator = useMemo(() => new Spectator({ rules: chosenRules }), [fight.code]);
  const [, redraw] = useState(0);
  const [arrived, setArrived] = useState(false);
  const [closed, setClosed] = useState(false);
  const [ready, setReady] = useState<Ready>();
  const [problem, setProblem] = useState<string>();
  const [watching, setWatching] = useState<Watching>();
  const [chatting, setChatting] = useState(false);
  const chatField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const watching = new Watching(fight.code, spectator, undefined, savedName());
    setWatching(watching);
    const offChange = spectator.onChange(() => {
      setArrived(true);
      redraw((n) => n + 1);
    });
    const offClose = watching.onClose(() => setClosed(true));
    return () => {
      offChange();
      offClose();
      watching.close();
    };
  }, [spectator]);

  const hello = spectator.hello;
  useEffect(() => {
    setProblem(undefined);
    if (!hello) return setReady(undefined);
    if (hello.version !== VERSION) {
      setProblem(`The players' game is a different version (${hello.version}, this page is ${VERSION}). Reload this page; if it is still different, one of them has an older page open.`);
      return;
    }
    let stale = false;
    const displayOf = (slug: string) => {
      for (const tile of legends) if (tile.kind === 'legend' && tile.legend.slug === slug) return tile.displayId;
      return undefined;
    };
    // A legend this install cannot draw at all stands in as a plain member of its race.
    const build = (spec: FighterSpec) =>
      fighters.get(championOf(localize(spec, displayOf))).catch((cause: unknown) => {
        if (spec.npc === undefined) throw cause;
        return fighters.get(championOf(plainSpec(spec)));
      });
    // The champions first and then the ground, one after the other, as the players' own pages read them.
    void Promise.all([build(hello.fighters[0]), build(hello.fighters[1])]).then(
      async ([a, b]) => {
        const { ground, note } = await groundOf(hello.stage, client, stages, screens);
        if (!stale) setReady({ hello, fighters: [a, b], ground, notes: note ? [note] : [] });
      },
      (cause: unknown) => !stale && setProblem(`The players' champions could not be built here: ${messageOf(cause)}`),
    );
    return () => {
      stale = true;
    };
  }, [hello]);

  const notes = ready?.notes;
  const watch = useMemo<WatchFight>(() => ({ spectator, players: fight.names, notes }), [spectator, fight, notes]);
  const { host, guest } = spectator.seats;
  const gone = closed || (arrived && !host && !guest);
  const fighting = ready !== undefined && ready.hello === hello && !problem;

  // The waiting screens' keys, but for the chat's (whose own Enter opens it); the fight screen has its own Escape.
  // Nothing is under a watched fight to take keys first: the lobby's panel is shut and no other screen is up.
  useEffect(() => {
    if (fighting || chatting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.code === 'Escape' || (gone && (event.code === 'Enter' || event.code === 'NumpadEnter'))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onBack();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fighting, chatting, gone, onBack]);
  const chat = (onPick = false) => watching && <WatchChat watching={watching} open={chatting} onOpen={setChatting} field={chatField} onPick={onPick} />;

  if (fighting) {
    return (
      <>
        <Fight fighters={ready.fighters} stage={ready.ground} p2="keyboard" onBack={onBack} watch={watch} />
        <FightUi fighters={ready.fighters} p2="keyboard" assets={assets} />
        {chat()}
        {gone && <div class="lobby-toast">The players have left the room. Esc goes back to the lobby.</div>}
      </>
    );
  }

  const [a, b] = fight.names;
  const { picks } = spectator;
  const picked = picks[0]?.locked && picks[1]?.locked;
  const why = problem
    ? problem
    : gone
      ? 'The players have left the room; the fight is over.'
      : !arrived
        ? 'Coming into the room…'
        : hello
          ? 'Building their champions and raising the ground…'
          : host && guest
            ? picked
              ? 'Both have chosen; the stage is next, and the fight shows here when it starts.'
              : 'They are picking their champions. The fight shows here when it starts.'
            : 'Waiting for both of them to be in the room.';
  const roster: WatchRoster = { picks, names: fight.names, status: why };
  // The pick as they see it, while there is one to see; the card says the rest.
  if (!problem && !gone && (picks[0] || picks[1])) {
    return (
      <>
        {select(roster, picks.some((pick) => pick?.champion?.bay === true))}
        {chat(true)}
      </>
    );
  }
  return (
    <div class="screen watch-wait">
      <div class="guide-backdrop">
        <div class="guide online">
          <div class="body online-challenge">
            <p class="dim">WATCHING</p>
            <p class="big">
              {a} <span class="dim">vs</span> {b}
            </p>
            <p class={problem ? 'bad' : 'waiting'}>{why}</p>
            <button type="button" class="button" onClick={onBack}>BACK TO THE LOBBY · ESC</button>
          </div>
        </div>
      </div>
      {chat()}
    </div>
  );
}

/**
 * The ground a hello names, from this install's own stages and loading screens. A stage it cannot
 * raise, because its folder lacks the map or the place would not rise (asked twice), has the
 * stage's own picture behind the fight instead, with a note saying which and why.
 */
async function groundOf(key: StageKey, client: DataClient, stages: Stage[], screens: LoadingScreen[]): Promise<{ ground: Ground; note?: string }> {
  if (key.kind === 'stage') {
    const stage = stages.find((s) => s.slug === key.slug);
    const named = stage ?? STAGES.find((s) => s.slug === key.slug);
    let why = 'this folder does not have it';
    if (stage) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return { ground: { stage, place: await client.place(stage.map, stage.x, stage.y, facingRadians(stage), stage.reach, stage.z) } };
        } catch (cause) {
          console.warn(`${stage.name} could not be raised for watching:`, cause);
          why = `it would not rise here: ${messageOf(cause)}`;
        }
      }
    }
    if (!named) return { ground: {}, note: 'The players fight on a stage this page does not know; reload it for the latest.' };
    const picture = await pictureOf(thumbnailUrl(named));
    return { ground: { stage: named, picture }, note: `The players fight in ${named.name}; ${why}, so its picture stands behind them.` };
  }
  if (key.kind === 'screen') {
    const screen = screens.find((s) => s.id === key.id);
    if (!screen) return { ground: {}, note: 'The players fight before a loading screen this folder does not have.' };
    return { ground: { screen, image: await client.icon(screen.fileId).catch(() => undefined) } };
  }
  return { ground: {} };
}

/** A picture the site serves, as the backdrop takes one; undefined when it cannot be had. */
async function pictureOf(url: string): Promise<Image | undefined> {
  try {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, pixels: new Uint8Array(data.buffer) };
  } catch {
    return undefined;
  }
}
