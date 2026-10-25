import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ClassEntry, Race } from '@mogshot/character/appearance';
import type { Image } from '@mogshot/formats/blp';
import type { LoadingScreen } from '@mogshot/worker/api';
import { DataClient } from '@mogshot/worker/client';
import { type Edition, editionOf, playableProducts } from './edition';
import { type EditionArt, loadEditionArt } from './editionArt';
import { Fight, type NetFight, tableOf } from './Fight';
import { chosenRules } from './Settings';
import { type BuiltFighter, Fighters } from './fighters';
import { messageOf, useFolder } from './folder';
import { LEVEL, music } from './music';
import { pictureUrl } from './pixels';
import { setWhere } from './report';
import { LEGENDS, legendTiles, type Tile } from './roster';
import { loadSaved, type SavedChampion, storeSaved } from './saved';
import { type OnlinePick, Select, type Source } from './Select';
import { championOf, decode, encode, type Hello, localize, mismatch, sameStage, stageKeyOf } from './net/handshake';
import { Lobby, saveName, savedName } from './net/lobby';
import type { Link } from './net/relay';
import { VERSION } from './net/version';
import { Challenge, enterRoom, Matching, Online, type Session, useLobby } from './Online';
import { Title } from './Title';
import { loadGameFonts } from './ui/fonts';
import { FightUi } from './ui/FightUi';
import { type Stage, stagesFor, type Ground } from './stages';
import { Versus } from './Versus';

/*
 * The screens: the title with the folder drop, CHOOSE YOUR CHAMPION, the VS screen with the
 * stage pick, and the fight. Everything the game knows about the open folder is loaded once
 * here and handed down, with the edition (edition.ts): which of the folder's games is open.
 */

/** How long a match from the queue shows FOUND and the opponent's name before the roster. */
const FOUND_MS = 2000;

/** The fight on screen has ended its match, as the fight screen shows it through window.mk. */
function matchOver(): boolean {
  const mk = (window as unknown as { mk?: { match?: () => { phase: string } | undefined } }).mk;
  return mk?.match?.()?.phase === 'matchEnd';
}

type Screen =
  | { kind: 'select' }
  | { kind: 'versus'; fighters: [BuiltFighter, BuiltFighter]; pick?: OnlinePick }
  | { kind: 'fight'; fighters: [BuiltFighter, BuiltFighter]; stage: Ground; net?: NetFight };

interface Loaded {
  edition: Edition;
  art: EditionArt;
  races: Race[];
  classes: ClassEntry[];
  portraits: { races: Map<string, string>; classes: Map<string, string> };
  screens: LoadingScreen[];
  /** The stages in the world this install can draw. */
  stages: Stage[];
  legends: Tile[];
  fighters: Fighters;
}

export function Game() {
  const client = useRef<DataClient>(null);
  client.current ??= new DataClient();
  const { phase, dragging, openFolder, onPick } = useFolder(client.current);
  const [loaded, setLoaded] = useState<Loaded>();
  const [loadError, setLoadError] = useState<string>();
  const [screen, setScreen] = useState<Screen>({ kind: 'select' });
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const [p2, setP2] = useState<Source>('cpu');
  // The champions made on CREATE YOUR CHAMPION, read from the browser once.
  const [saved, setSaved] = useState<SavedChampion[]>(() => loadSaved());
  const keepSaved = useCallback((list: SavedChampion[]) => {
    setSaved(list);
    if (!storeSaved(list)) console.warn('The browser would not keep the champions; they last for this visit.');
  }, []);
  // The title's CREATE YOUR CHAMPION was open when the folder was chosen: the roster opens on the question mark.
  const createNext = useRef(false);
  // PLAY ONLINE: the panel, the room this page is in, the host's hello once it comes, and why the room ended.
  const [showOnline, setShowOnline] = useState(false);
  const [online, setOnline] = useState<Session>();
  const [hello, setHello] = useState<Hello>();
  const [left, setLeft] = useState<string>();
  // The title's PLAY ONLINE was open when the folder was chosen: the panel opens over the roster.
  const onlineNext = useRef(false);
  // The lobby, once this browser has given a name: open whenever the game is, but for the fights.
  const [name, setName] = useState(savedName);
  const lobbyRef = useRef<Lobby>(null);
  if (name && !lobbyRef.current) lobbyRef.current = new Lobby(name);
  const lobby = lobbyRef.current ?? undefined;
  const lobbyState = useLobby(lobby);
  // A match the lobby made, while both pages find each other in its room; `found` when the queue made it.
  const [matching, setMatching] = useState<{ name: string; found?: boolean; error?: string }>();
  const matchLink = useRef<Link>(null);
  // A stable handler: Fight rebuilds the whole match when its props change, and dragging a file
  // across the window re-renders Game (the title's drop state), which must not restart a fight.
  const backToSelect = useCallback(() => {
    setHello(undefined);
    setScreen({ kind: 'select' });
  }, []);
  /** Two pages met in a room, by the lobby or a code: the roster, online. */
  const startSession = useCallback((session: Session) => {
    setShowOnline(false);
    setMatching(undefined);
    setLeft(undefined);
    setHello(undefined);
    setOnline(session);
    setScreen({ kind: 'select' });
  }, []);
  /** Leaves the room for the roster on this keyboard alone. */
  const leaveOnline = useCallback(() => {
    online?.link.close();
    setOnline(undefined);
    setHello(undefined);
    setLeft(undefined);
    setScreen({ kind: 'select' });
  }, [online]);
  /**
   * NEXT OPPONENT, at the end of an online match or when the other has gone: out of the room and
   * back into the lobby's queue, the panel up with the wait counting, so a stranger can play one
   * after another without touching the mouse.
   */
  const nextOpponent = useCallback(() => {
    lobbyRef.current?.queueAgain();
    online?.link.close();
    setOnline(undefined);
    setHello(undefined);
    setLeft(undefined);
    setScreen({ kind: 'select' });
    setShowOnline(true);
  }, [online]);
  const rosterOnline = useMemo(() => (online ? { me: online.me, link: online.link, code: online.code } : undefined), [online]);
  const versusOnline = useMemo(() => (online ? { host: online.role === 'host', link: online.link } : undefined), [online]);

  const openKey = phase.kind === 'ready' ? phase.opened.info.buildKey + phase.opened.info.product : undefined;
  useEffect(() => {
    setLoaded(undefined);
    setLoadError(undefined);
    setScreen({ kind: 'select' });
    if (openKey === undefined) return;
    let stale = false;
    const data = client.current!;
    const info = phase.kind === 'ready' ? phase.opened.info : undefined;
    const edition = editionOf(info?.product ?? '', info?.version ?? '');
    void (async () => {
      try {
        void loadGameFonts(data);
        const [races, classes, portraits, screens, looks, maps, art] = await Promise.all([
          data.races(),
          data.classList(),
          data.portraits().catch((cause: unknown) => {
            console.warn('The game\'s portraits could not be read:', cause);
            return { races: {}, classes: {}, problems: [] };
          }),
          data.backdrops().catch(() => [] as LoadingScreen[]),
          // The legends this folder can draw; a folder whose creature tables cannot be read just has none.
          data.creatureDisplays(LEGENDS.flatMap((legend) => legend.displays)).catch((cause: unknown) => {
            console.warn('The legends could not be looked up:', cause);
            return [];
          }),
          // Which maps are on disk, for the stages; an install whose map table cannot be read fights on loading screens.
          data.maps().catch((cause: unknown) => {
            console.warn('The maps could not be listed:', cause);
            return [];
          }),
          // The edition's logo and loading screen; a screen without them still plays.
          loadEditionArt(data, edition).catch((cause: unknown) => {
            console.warn('The edition\'s art could not be read:', cause);
            return {} as EditionArt;
          }),
        ]);
        if (stale) return;
        if (portraits.problems.length > 0) console.warn('Portraits:', portraits.problems.join('; '));
        const urls = (images: Record<string, Image>) => new Map(Object.entries(images).map(([key, image]) => [key, pictureUrl(image)]));
        setLoaded({
          edition,
          art,
          races,
          classes,
          portraits: { races: urls(portraits.races), classes: urls(portraits.classes) },
          screens,
          stages: stagesFor(maps.map((map) => map.id), edition.world),
          legends: legendTiles(LEGENDS, looks, races),
          fighters: new Fighters(data, classes),
        });
      } catch (cause) {
        if (!stale) setLoadError(messageOf(cause));
      }
    })();
    return () => {
      stale = true;
    };
  }, [openKey]);

  // The open game's login theme under CHOOSE YOUR CHAMPION; the VS screen and the fight play their stage's own.
  useEffect(() => {
    if (!loaded || openKey === undefined) return;
    music.use(client.current!, openKey);
    if (screen.kind === 'select') music.play(loaded.edition.title, LEVEL.select);
  }, [loaded, screen.kind]);

  // The folder's other games, for switching edition from the select screen.
  const others = useMemo(
    () => (phase.kind === 'ready' ? playableProducts(phase.opened.products).filter((entry) => entry.product !== phase.opened.info.product) : []),
    [phase],
  );
  const switchTo = (product: string) => {
    if (phase.kind === 'ready') void openFolder(phase.files, product);
  };

  const records = useMemo(() => (phase.kind === 'ready' ? phase.records : []), [phase]);
  const product = phase.kind === 'ready' ? phase.opened.info.product : '';

  // The lobby's socket: closed until the roster is up and while a fight is on, busy in an online match.
  const fighting = screen.kind === 'fight';
  useEffect(() => {
    lobby?.setMode(!loaded || fighting ? 'off' : online ? 'busy' : 'free');
  }, [lobby, loaded, fighting, online]);
  useEffect(() => () => lobbyRef.current?.close(), []);

  // A match from the lobby: into its room as it says, and on to the roster once both are there.
  useEffect(() => {
    if (!lobby) return;
    return lobby.onMatch((match) => {
      setShowOnline(false);
      setMatching({ name: match.with.name, found: match.queued });
      matchLink.current = null;
      const shown = performance.now();
      let given = false;
      const giveUp = setTimeout(() => {
        given = true;
        matchLink.current?.close();
        matchLink.current = null;
        setMatching({ name: match.with.name, error: `${match.with.name} did not come into the room.` });
      }, 20_000);
      void enterRoom(match.code, match.role, product, (link) => {
        matchLink.current = link;
      }).then(
        (session) => {
          clearTimeout(giveUp);
          if (given || matchLink.current !== session.link) {
            session.link.close();
            return;
          }
          // A stranger from the queue: FOUND and their name stay up two seconds before the roster.
          const wait = match.queued ? Math.max(0, FOUND_MS - (performance.now() - shown)) : 0;
          setTimeout(() => {
            if (matchLink.current !== session.link) return;
            if (session.link.closed || !session.link.peer) {
              session.link.close();
              setMatching({ name: match.with.name, error: `${match.with.name} left the room.` });
            } else startSession(session);
          }, wait);
        },
        (cause: unknown) => {
          clearTimeout(giveUp);
          if (!given) setMatching({ name: match.with.name, error: messageOf(cause) });
        },
      );
    });
  }, [lobby, product, startSession]);

  /** The meeting given up or failed: back in the lobby, free; a stranger from the queue who never came puts this page back in it. */
  const endMatching = () => {
    matchLink.current?.close();
    matchLink.current = null;
    const again = matching?.found && matching.error !== undefined;
    setMatching(undefined);
    if (again) {
      lobby?.queueAgain();
      setShowOnline(true);
    }
    lobby?.setMode('free');
  };

  /** A name given on the panel: kept, and the lobby comes under it. */
  const giveName = (given: string) => {
    saveName(given);
    if (lobbyRef.current) lobbyRef.current.rename(given);
    setName(given);
  };

  // A notice from the lobby (a decline, a challenge that lapsed) while the panel is shut shows for a moment.
  useEffect(() => {
    if (!lobbyState.notice || showOnline) return;
    const timer = setTimeout(() => lobby?.clearNotice(), 4000);
    return () => clearTimeout(timer);
  }, [lobbyState.notice, showOnline, lobby]);

  useEffect(() => {
    if (!loaded || !onlineNext.current) return;
    onlineNext.current = false;
    setShowOnline(true);
  }, [loaded]);

  // The room: the other player going, going back to the roster, and the host's hello for the guest.
  useEffect(() => {
    if (!online) return;
    const { link } = online;
    const off = link.listen((message) => {
      if (message.t === 'peer' && !message.joined) setLeft('OPPONENT LEFT');
      // The other player unlocked while this one waits on the VS screen: back to the roster for both.
      else if (message.t === 'roster' && !message.locked && screenRef.current.kind === 'versus') setScreen({ kind: 'select' });
      else if (message.t === 'back') {
        link.forget('stage');
        link.forget('hello');
        setHello(undefined);
        setScreen({ kind: 'select' });
      } else if (message.t === 'hello' && online.role === 'guest') {
        const wrong = mismatch(message);
        if (wrong) setLeft(wrong);
        else setHello(message);
      }
    });
    const offClose = link.onClose(() => setLeft((why) => why ?? 'OPPONENT LEFT'));
    return () => {
      off();
      offClose();
    };
  }, [online]);

  // The room has ended: Enter goes back to the roster on this keyboard, N to the next opponent, Escape to the title.
  useEffect(() => {
    if (!left) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Enter' && event.code !== 'Escape' && !(event.code === 'KeyN' && lobby)) return;
      event.stopPropagation();
      event.preventDefault();
      if (event.code === 'Enter') leaveOnline();
      else if (event.code === 'KeyN') nextOpponent();
      else location.reload();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [left, leaveOnline, nextOpponent, lobby]);

  // The match over in an online fight (the fight screen keeps Enter for the rematch and Escape for new champions): N for the next opponent.
  useEffect(() => {
    if (!online || !lobby || left) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'KeyN' || event.repeat || screenRef.current.kind !== 'fight' || !matchOver()) return;
      event.stopPropagation();
      event.preventDefault();
      nextOpponent();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [online, lobby, left, nextOpponent]);

  /** The guest's two fighters as the hello names them: the ones built on the roster when they match, else built now from the specs. */
  const fightersFor = async (message: Hello, built: [BuiltFighter, BuiltFighter], pick: OnlinePick): Promise<[BuiltFighter, BuiltFighter]> => {
    const displayOf = (slug: string) => {
      for (const tile of loaded!.legends) if (tile.kind === 'legend' && tile.legend.slug === slug) return tile.displayId;
      return undefined;
    };
    const one = (i: 0 | 1) =>
      pick.specs[i].key === message.fighters[i].key ? Promise.resolve(built[i]) : loaded!.fighters.get(championOf(localize(message.fighters[i], displayOf)));
    return Promise.all([one(0), one(1)]);
  };

  /** Into the ring from the VS screen: offline at once; online the host sends its hello and goes, the guest goes on the hello's terms. */
  const startFight = (fighters: [BuiltFighter, BuiltFighter], ground: Ground, pick: OnlinePick | undefined) => {
    if (!online || !pick) {
      setScreen({ kind: 'fight', fighters, stage: ground });
      return;
    }
    const { link } = online;
    // The roster's and the VS screen's last messages are spent; the next roster starts afresh.
    link.forget('roster');
    link.forget('stage');
    if (online.role === 'host') {
      const message: Hello = {
        t: 'hello',
        version: VERSION,
        product,
        rules: chosenRules(),
        seed: crypto.getRandomValues(new Uint32Array(1))[0]!,
        game: 1,
        stage: stageKeyOf(ground),
        fighters: pick.specs,
        tables: [tableOf(fighters[0]), tableOf(fighters[1])],
      };
      link.send(message);
      // The host fights on the same hello the guest receives: the tables as JSON made them, not the live
      // objects, so nothing JSON cannot carry (an undefined in an array, a NaN) can differ between the two.
      const sent = decode(encode(message)) as Hello;
      setScreen({ kind: 'fight', fighters, stage: ground, net: { link, me: 0, host: true, hello: sent, notes: pick.notes } });
      return;
    }
    if (!hello) return;
    const notes = [...pick.notes];
    if (!sameStage(stageKeyOf(ground), hello.stage)) notes.push('The host chose ground your folder does not have, so you fight on none.');
    if (hello.product !== product) notes.push(`The host plays from ${hello.product} and you from ${product}: the fight keeps the host's timing, drawn with your own animations.`);
    const message = hello;
    link.forget('hello');
    void fightersFor(message, fighters, pick)
      .then((ready) => setScreen({ kind: 'fight', fighters: ready, stage: ground, net: { link, me: 1, host: false, hello: message, notes } }))
      .catch((cause: unknown) => setLeft(`The host's champions could not be built here: ${messageOf(cause)}`));
  };

  useEffect(() => {
    document.body.classList.toggle('ingame', phase.kind === 'ready' && loaded !== undefined);
  }, [phase.kind, loaded]);

  // Where the player is, for a report sent from the game (Reporter.tsx).
  useEffect(() => {
    const edition = loaded ? `${loaded.edition.game} ${loaded.edition.version} (${loaded.edition.product})` : undefined;
    if (phase.kind !== 'ready' || !loaded) {
      const screenName = loadError ? `Title, the folder could not be read: ${loadError}` : phase.kind === 'ready' ? 'Title, opening the folder' : `Title (${phase.kind})`;
      setWhere({ screen: screenName, edition });
      return;
    }
    const names = screen.kind === 'select' ? undefined : screen.fighters.map((f) => `${f.champion.name} (${f.champion.title})`).join(' vs ') + `, player 2: ${p2}`;
    const ground = screen.kind === 'fight' ? screen.stage : undefined;
    const stage = ground && (ground.stage ? `${ground.stage.name}, ${ground.stage.where}` : ground.screen ? `loading screen ${ground.screen.fileId}` : 'none');
    const screenName = { select: 'Choose your champion', versus: 'VS screen', fight: 'The fight' }[screen.kind];
    setWhere({ screen: screenName, edition, fighters: names, stage });
  }, [phase.kind, loaded, loadError, screen, p2]);

  const wantCreate = (yes: boolean) => {
    createNext.current = yes;
  };
  const wantOnline = (yes: boolean) => {
    onlineNext.current = yes;
  };
  if (phase.kind === 'choose') return <Title phase={phase} dragging={dragging} onPick={onPick} onChoose={(product) => void openFolder(phase.files, product)} onCreate={wantCreate} onOnline={wantOnline} />;
  if (phase.kind !== 'ready') return <Title phase={phase} dragging={dragging} onPick={onPick} onCreate={wantCreate} onOnline={wantOnline} />;
  if (loadError) return <Title phase={{ kind: 'error', message: loadError }} dragging={false} onPick={onPick} onCreate={wantCreate} onOnline={wantOnline} />;
  if (!loaded) return <Title phase={{ kind: 'opening', message: 'Summoning the roster…' }} dragging={false} onPick={onPick} onCreate={wantCreate} onOnline={wantOnline} />;

  // A challenge shows over any screen but a fight, unless this page is already in a match.
  const challenge = !online && !matching && screen.kind !== 'fight' ? lobbyState.incoming : undefined;

  const view = (() => {
    switch (screen.kind) {
      case 'select':
        return (
          <Select
            key={online?.code ?? 'here'}
            edition={loaded.edition}
            art={loaded.art}
            others={others}
            onEdition={switchTo}
            races={loaded.races}
            classes={loaded.classes}
            records={records}
            legends={loaded.legends}
            portraits={loaded.portraits}
            fighters={loaded.fighters}
            saved={saved}
            onSaved={keepSaved}
            startOnCreate={createNext.current}
            p2={online ? 'keyboard' : p2}
            onP2={setP2}
            onReady={(fighters, pick) => {
              createNext.current = false;
              setScreen({ kind: 'versus', fighters, pick });
            }}
            onBack={online ? leaveOnline : () => location.reload()}
            online={rosterOnline}
            paused={showOnline || left !== undefined || matching !== undefined || challenge !== undefined}
            onOnline={() => setShowOnline(true)}
          />
        );
      case 'versus':
        return (
          <Versus
            client={client.current!}
            fighters={screen.fighters}
            stages={loaded.stages}
            screens={loaded.screens}
            onFight={(ground) => startFight(screen.fighters, ground, screen.pick)}
            onBack={backToSelect}
            online={screen.pick ? versusOnline : undefined}
            start={screen.pick && online?.role === 'guest' ? hello?.stage : undefined}
          />
        );
      case 'fight':
        return (
          <>
            <Fight fighters={screen.fighters} stage={screen.stage} p2={screen.net ? 'keyboard' : p2} onBack={backToSelect} net={screen.net} />
            <FightUi
              fighters={screen.fighters}
              p2={screen.net ? 'keyboard' : p2}
              assets={{ client: client.current!, races: loaded.races, portraits: loaded.portraits }}
              me={screen.net?.me}
              next={screen.net !== undefined && lobby !== undefined}
            />
          </>
        );
    }
  })();

  return (
    <>
      {view}
      {showOnline && (
        <Online lobby={lobby} name={name} onName={giveName} product={product} onReady={startSession} onClose={() => setShowOnline(false)} />
      )}
      {!showOnline && lobbyState.notice && !challenge && !matching && <div class="lobby-toast">{lobbyState.notice}</div>}
      {matching && <Matching name={matching.name} found={matching.found} error={matching.error} onCancel={endMatching} />}
      {challenge && <Challenge from={challenge.name} until={challenge.until} onAccept={() => lobby?.accept()} onDecline={() => lobby?.decline()} />}
      {left && (
        <div class="guide-backdrop">
          <div class="guide">
            <div class="body create-first">
              <p class="big">{left}</p>
              <p class="dim">The online match is over.</p>
              {lobby && <button type="button" class="button" onClick={nextOpponent}>NEXT OPPONENT · N</button>}
              <button type="button" class="button" onClick={leaveOnline}>BACK TO THE ROSTER · ENTER</button>
              <button type="button" class="button" onClick={() => location.reload()}>THE TITLE · ESC</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
