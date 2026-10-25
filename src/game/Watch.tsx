import { useEffect, useMemo, useState } from 'preact/hooks';
import type { LoadingScreen } from '@mogshot/worker/api';
import type { DataClient } from '@mogshot/worker/client';
import { Fight, type WatchFight } from './Fight';
import type { BuiltFighter, Fighters } from './fighters';
import { messageOf } from './folder';
import type { Tile } from './roster';
import { chosenRules } from './Settings';
import { facingRadians, type Ground, type Stage } from './stages';
import { championOf, type FighterSpec, type Hello, localize, plainSpec, type StageKey } from './net/handshake';
import type { LobbyFight } from './net/lobby';
import { VERSION } from './net/version';
import { Spectator, Watching } from './net/watch';
import type { UiAssets } from './ui/icons';
import { FightUi } from './ui/FightUi';
import { useModalKeys } from './ui/modal';

/*
 * WATCH: somebody else's fight on this screen, as a third seat in their room. The champions are
 * built from the host's hello with this install's own files, as the guest builds them, and the
 * ground found in this install's own list; the fight screen then draws the match the spectator
 * plays (net/watch.ts), with no keys of its own. Between fights, while the two pick their
 * champions, it says so and waits for the next hello. Escape goes back to the lobby whenever.
 */

interface WatchProps {
  fight: LobbyFight;
  client: DataClient;
  fighters: Fighters;
  legends: Tile[];
  stages: Stage[];
  screens: LoadingScreen[];
  assets: UiAssets;
  onBack: () => void;
}

/** The champions and the ground of a hello, built here. */
interface Ready {
  hello: Hello;
  fighters: [BuiltFighter, BuiltFighter];
  ground: Ground;
}

export function Watch({ fight, client, fighters, legends, stages, screens, assets, onBack }: WatchProps) {
  const spectator = useMemo(() => new Spectator({ rules: chosenRules }), [fight.code]);
  const [, redraw] = useState(0);
  const [arrived, setArrived] = useState(false);
  const [closed, setClosed] = useState(false);
  const [ready, setReady] = useState<Ready>();
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    const watching = new Watching(fight.code, spectator);
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
    void Promise.all([build(hello.fighters[0]), build(hello.fighters[1]), groundOf(hello.stage, client, stages, screens)]).then(
      ([a, b, ground]) => !stale && setReady({ hello, fighters: [a, b], ground }),
      (cause: unknown) => !stale && setProblem(`The players' champions could not be built here: ${messageOf(cause)}`),
    );
    return () => {
      stale = true;
    };
  }, [hello]);

  const watch = useMemo<WatchFight>(() => ({ spectator, players: fight.names }), [spectator, fight]);
  const { host, guest } = spectator.seats;
  const gone = closed || (arrived && !host && !guest);
  const fighting = ready !== undefined && ready.hello === hello && !problem;

  // The waiting screens' keys; the fight screen has its own Escape.
  useModalKeys(!fighting, (event) => {
    if (event.code === 'Escape' || (gone && (event.code === 'Enter' || event.code === 'NumpadEnter'))) onBack();
  });

  if (fighting) {
    return (
      <>
        <Fight fighters={ready.fighters} stage={ready.ground} p2="keyboard" onBack={onBack} watch={watch} />
        <FightUi fighters={ready.fighters} p2="keyboard" assets={assets} />
        {gone && <div class="lobby-toast">The players have left the room. Esc goes back to the lobby.</div>}
      </>
    );
  }

  const [a, b] = fight.names;
  const why = problem
    ? problem
    : gone
      ? 'The players have left the room; the fight is over.'
      : !arrived
        ? 'Coming into the room…'
        : hello
          ? 'Building their champions and raising the ground…'
          : host && guest
            ? 'They are picking their champions. The fight shows here when it starts.'
            : 'Waiting for both of them to be in the room.';
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
    </div>
  );
}

/** The ground a hello names, from this install's own stages and loading screens; none when it has not got it. */
async function groundOf(key: StageKey, client: DataClient, stages: Stage[], screens: LoadingScreen[]): Promise<Ground> {
  if (key.kind === 'stage') {
    const stage = stages.find((s) => s.slug === key.slug);
    if (!stage) return {};
    try {
      return { stage, place: await client.place(stage.map, stage.x, stage.y, facingRadians(stage), stage.reach, stage.z) };
    } catch (cause) {
      console.warn(`${stage.name} could not be raised:`, cause);
      return {};
    }
  }
  if (key.kind === 'screen') {
    const screen = screens.find((s) => s.id === key.id);
    if (!screen) return {};
    return { screen, image: await client.icon(screen.fileId).catch(() => undefined) };
  }
  return {};
}
