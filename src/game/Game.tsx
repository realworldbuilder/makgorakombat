import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ClassEntry, Race } from '@mogshot/character/appearance';
import type { Image } from '@mogshot/formats/blp';
import type { LoadingScreen } from '@mogshot/worker/api';
import { DataClient } from '@mogshot/worker/client';
import { callToFight } from './call';
import { type Edition, editionOf, playableProducts } from './edition';
import { type EditionArt, loadEditionArt } from './editionArt';
import { Fight, type NetFight, tableOf } from './Fight';
import { chosenRules, picksStageOnline } from './Settings';
import { type BuiltFighter, Fighters } from './fighters';
import { messageOf, useFolder } from './folder';
import { setPadForPlayer2 } from './pads';
import { LEVEL, music } from './music';
import { MusicTab } from './MusicTab';
import { VoiceTab } from './VoiceTab';
import { pictureUrl } from './pixels';
import { setWhere } from './report';
import { trackFight, trackFolder, trackWatch } from './track';
import { LEGENDS, legendTiles, type Tile } from './roster';
import { loadSaved, type SavedChampion, storeSaved } from './saved';
import { type OnlinePick, Select, type Source } from './Select';
import { championOf, decode, encode, type Hello, localize, mismatch, resultOf, sameStage, type StageKey, stageKeyOf } from './net/handshake';
import { Lobby, type LobbyFight, saveName, savedName } from './net/lobby';
import { delayFor } from './net/lockstep';
import type { Link } from './net/relay';
import { PlayerChat } from './PlayerChat';
import { VERSION } from './net/version';
import { Challenge, enterRoom, Matching, Online, type Session, useLobby } from './Online';
import { Title } from './Title';
import { loadGameFonts } from './ui/fonts';
import { FightUi } from './ui/FightUi';
import { BAY_STAGE, drawGround, type Ground, sharedStages, type Stage, stagesFor } from './stages';
import { BayDress } from './BayDress';
import { NextStage } from './NextStage';
import { Versus } from './Versus';
import { Watch } from './Watch';

/*
 * The screens: the title with the folder drop, CHOOSE YOUR CHAMPION, the VS screen with the
 * stage pick (online, the NEXT STAGE card with the stage the host drew), and the fight.
 * Everything the game knows about the open folder is loaded once here and handed down, with the
 * edition (edition.ts): which of the folder's games is open.
 */

/** Booby Bay off the queue, for trying it on a dev server alone: `?bay` on the address. Never on the built site. */
const DEV_BAY = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('bay');

/** How long a match from the queue shows FOUND and the opponent's name before the roster. */
const FOUND_MS = 2000;

/** What the fight screen shows of itself through window.mk: the live match, and the lockstep's match number online. */
type Shown = { match?: () => Parameters<typeof resultOf>[0] | undefined; net?: () => { game: number } | undefined };
const shown = () => (window as unknown as { mk?: Shown }).mk;

/** The fight on screen has ended its match, as the fight screen shows it through window.mk. */
function matchOver(): boolean {
  return shown()?.match?.()?.phase === 'matchEnd';
}

type Screen =
  | { kind: 'select' }
  | { kind: 'versus'; fighters: [BuiltFighter, BuiltFighter]; pick?: OnlinePick }
  /** Online, the stage drawn at random: `sent` is the host's hello; the guest's comes as `hello`. No `pick` on a rematch, whose fighters are built. */
  | { kind: 'next'; fighters: [BuiltFighter, BuiltFighter]; pick?: OnlinePick; sent?: Hello }
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
  const { phase, dragging, openFolder, onPick, closeFolder } = useFolder(client.current);
  const [loaded, setLoaded] = useState<Loaded>();
  const [loadError, setLoadError] = useState<string>();
  const [screen, setScreen] = useState<Screen>({ kind: 'select' });
  // Back on the title from the roster with the folder still open: everything read from it stays, only the screen changes.
  const [atTitle, setAtTitle] = useState(false);
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
  // Player 2 on PAD takes a lone controller; online this page is one player, and a pad plays it.
  useEffect(() => setPadForPlayer2(!online && p2 === 'gamepad'), [online, p2]);
  const lobbyState = useLobby(lobby);
  // BOOBY BAY (bay.ts): a match the bay made, or the dev server's ?bay. Its own beach is the only ground, and its dress is over every screen.
  const inBay = online?.bay ?? DEV_BAY;
  const stagesHere = () => (inBay ? [BAY_STAGE] : loaded!.stages);
  // A match the lobby made, while both pages find each other in its room; `found` when the queue made it.
  const [matching, setMatching] = useState<{ name: string; found?: boolean; error?: string }>();
  const matchLink = useRef<Link>(null);
  // Somebody else's fight, picked on the panel to watch.
  const [watching, setWatching] = useState<LobbyFight>();
  const watchFight = useCallback((fight: LobbyFight) => {
    setShowOnline(false);
    setWatching(fight);
  }, []);
  /** Done watching: back to the panel it was picked from. */
  const stopWatching = useCallback(() => {
    setWatching(undefined);
    setShowOnline(true);
  }, []);
  /** The lobby's match being met now; given up or replaced, its late callbacks change nothing. */
  const matchOn = useRef<object>(null);
  /** The VS screen a fight was started from, so its late or repeated Enter starts no second one. */
  const fightFrom = useRef<Screen>(null);
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
  /**
   * An online match over on the fight screen: this page's word on it to the room, once, for the
   * board. The room counts it when the other page says the same.
   */
  const reported = useRef<string>(null);
  const report = useCallback(() => {
    if (!online || online.link.closed || screenRef.current.kind !== 'fight') return;
    const mk = shown();
    const match = mk?.match?.();
    const id = lobbyRef.current?.id;
    const result = match && resultOf(match, mk?.net?.()?.game ?? 0, id && name ? { id, name } : undefined);
    if (!result) return;
    const key = `${online.code} ${result.game} ${result.ticks}`;
    if (reported.current === key) return;
    reported.current = key;
    online.link.send(result);
  }, [online, name]);
  useEffect(() => {
    if (!online || screen.kind !== 'fight') return;
    const timer = setInterval(report, 250);
    return () => clearInterval(timer);
  }, [online, screen.kind, report]);

  /** Leaves the room for the roster on this keyboard alone. */
  const leaveOnline = useCallback(() => {
    report();
    online?.link.close();
    setOnline(undefined);
    setHello(undefined);
    setLeft(undefined);
    setScreen({ kind: 'select' });
  }, [online, report]);
  /**
   * NEXT OPPONENT, at the end of an online match or when the other has gone: out of the room and
   * back into the lobby's queue, the panel up with the wait counting, so a stranger can play one
   * after another without touching the mouse.
   */
  const nextOpponent = useCallback(() => {
    report();
    lobbyRef.current?.queueAgain();
    online?.link.close();
    setOnline(undefined);
    setHello(undefined);
    setLeft(undefined);
    setScreen({ kind: 'select' });
    setShowOnline(true);
  }, [online, report]);
  /**
   * To the title, the folder kept open: the roster and anything mounted under it (a fight's sound and
   * WebGL among them) go as they would for any other screen, and ENTER THE RING comes straight back
   * without the drop or the encoding table read again. Online, the room is left first.
   */
  const toTitle = useCallback(() => {
    setShowOnline(false);
    setScreen({ kind: 'select' });
    setAtTitle(true);
  }, []);
  const rosterOnline = useMemo(() => (online ? { me: online.me, link: online.link, code: online.code } : undefined), [online]);
  const versusOnline = useMemo(() => (online ? { host: online.role === 'host', link: online.link } : undefined), [online]);

  const openKey = phase.kind === 'ready' ? phase.opened.info.buildKey + phase.opened.info.product : undefined;
  useEffect(() => {
    setLoaded(undefined);
    setLoadError(undefined);
    setScreen({ kind: 'select' });
    setAtTitle(false);
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

  // The open game's login theme under CHOOSE YOUR CHAMPION, and on the title come back to with the folder open;
  // the VS screen and the fight play their stage's own.
  useEffect(() => {
    if (!loaded || openKey === undefined) return;
    music.use(client.current!, openKey);
    if (screen.kind === 'select' || atTitle) music.play(loaded.edition.title, LEVEL.select);
  }, [loaded, screen.kind, atTitle]);

  /** ENTER THE RING on the title with the folder open: the roster again, with the panel the title's PLAY ONLINE asked for. */
  const enterRing = () => {
    setAtTitle(false);
    if (onlineNext.current) {
      onlineNext.current = false;
      setShowOnline(true);
    }
  };
  /** The title's change folder: the folder let go and its music with it, and the drop as on a fresh page. */
  const changeFolder = () => {
    music.stop();
    setAtTitle(false);
    closeFolder();
  };

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

  // The site's numbers (track.ts): a folder read, each fight begun and how, a fight watched.
  useEffect(() => {
    if (loaded) trackFolder(loaded.edition.key);
  }, [loaded]);
  useEffect(() => {
    if (screen.kind !== 'fight') return;
    const mode = screen.net ? 'online' : p2 === 'cpu' ? 'cpu' : 'local';
    trackFight(mode, screen.fighters[screen.net?.me ?? 0].champion.name);
    // Each fight screen once: a rematch or the next stage is a new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);
  useEffect(() => {
    if (watching) trackWatch();
  }, [watching]);

  // The lobby's socket: closed until the roster is up and while a fight is on (its NEXT STAGE card too) or watched, busy in an online match.
  const fighting = screen.kind === 'fight' || screen.kind === 'next' || watching !== undefined;
  useEffect(() => {
    lobby?.setMode(!loaded || atTitle || fighting ? 'off' : online ? 'busy' : 'free');
  }, [lobby, loaded, atTitle, fighting, online]);
  useEffect(() => () => lobbyRef.current?.close(), []);

  // A match from the lobby: into its room as it says, and on to the roster once both are there.
  useEffect(() => {
    if (!lobby) return;
    return lobby.onMatch((match) => {
      // The queue found someone, NEXT OPPONENT did, or a challenge this page made was taken up: call the player back.
      // One who has just accepted is looking already.
      if (match.queued || match.role === 'host') callToFight(match.queued ? `Found: ${match.with.name}. To ${match.bay ? 'Booby Bay' : 'the ring'}!` : `${match.with.name} accepted. To the ring!`);
      setShowOnline(false);
      setMatching({ name: match.with.name, found: match.queued });
      matchLink.current = null;
      const token = {};
      matchOn.current = token;
      const shown = performance.now();
      let given = false;
      const giveUp = setTimeout(() => {
        given = true;
        if (matchOn.current !== token) return;
        matchLink.current?.close();
        matchLink.current = null;
        setMatching({ name: match.with.name, error: `${match.with.name} did not come into the room.` });
      }, 20_000);
      void enterRoom(match.code, match.role, product, (link) => {
        // Given up (or another match came) while the room was still opening: this one is not wanted.
        if (matchOn.current !== token) link.close();
        else matchLink.current = link;
      }).then(
        (session) => {
          clearTimeout(giveUp);
          if (given || matchOn.current !== token || matchLink.current !== session.link) {
            session.link.close();
            return;
          }
          // A stranger from the queue: FOUND and their name stay up two seconds before the roster.
          const wait = match.queued ? Math.max(0, FOUND_MS - (performance.now() - shown)) : 0;
          setTimeout(() => {
            if (matchOn.current !== token || matchLink.current !== session.link) {
              session.link.close();
              return;
            }
            if (session.link.closed || !session.link.peer) {
              session.link.close();
              setMatching({ name: match.with.name, error: `${match.with.name} left the room.` });
            } else startSession({ ...session, them: match.with.name, bay: match.bay });
          }, wait);
        },
        (cause: unknown) => {
          clearTimeout(giveUp);
          if (!given && matchOn.current === token) setMatching({ name: match.with.name, error: messageOf(cause) });
        },
      );
    });
  }, [lobby, product, startSession]);

  /** The meeting given up or failed: back in the lobby, free; a stranger from the queue who never came puts this page back in it. */
  const endMatching = () => {
    matchOn.current = null;
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
      else {
        leaveOnline();
        toTitle();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [left, leaveOnline, nextOpponent, lobby, toTitle]);

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

  /** The host's hello on the wire, and the same hello as the guest will read it, for the host to fight on. */
  const sendHello = (message: Hello): Hello => {
    const { link } = online!;
    // The roster's and the VS screen's last messages are spent; the next roster starts afresh.
    link.forget('roster');
    link.forget('stage');
    link.send(message);
    // The host fights on the same hello the guest receives: the tables as JSON made them, not the live
    // objects, so nothing JSON cannot carry (an undefined in an array, a NaN) can differ between the two.
    return decode(encode(message)) as Hello;
  };
  const helloFor = (fighters: [BuiltFighter, BuiltFighter], pick: OnlinePick, stage: StageKey, seed: number, drawn?: boolean): Hello => ({
    t: 'hello',
    version: VERSION,
    product,
    rules: chosenRules(),
    seed,
    game: 1,
    stage,
    ...(drawn ? { drawn } : {}),
    // As long as the wire between the two pages needs, measured by their echoes while they chose.
    delay: delayFor(online?.link.echoes ?? []),
    fighters: pick.specs,
    tables: [tableOf(fighters[0]), tableOf(fighters[1])],
  });
  const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!;
  /** The stages both installs have, for the host's draw. */
  const shared = () => sharedStages(stagesHere(), online!.theirProduct);

  /** Into the ring from the VS screen: offline at once; online the host sends its hello and goes, the guest goes on the hello's terms. */
  const startFight = (fighters: [BuiltFighter, BuiltFighter], ground: Ground, pick: OnlinePick | undefined) => {
    if (!online || !pick) {
      setScreen({ kind: 'fight', fighters, stage: ground });
      return;
    }
    if (online.role === 'host') {
      const sent = sendHello(helloFor(fighters, pick, stageKeyOf(ground), newSeed()));
      setScreen({ kind: 'fight', fighters, stage: ground, net: { link: online.link, me: 0, host: true, hello: sent, notes: pick.notes } });
      return;
    }
    if (hello) guestFight(fighters, ground, pick, hello);
  };

  /** The guest into the ring on the host's hello; `pick` is the roster's, absent on a rematch drawn anew, whose fighters are already the host's. */
  const guestFight = (fighters: [BuiltFighter, BuiltFighter], ground: Ground, pick: OnlinePick | undefined, message: Hello) => {
    const { link } = online!;
    link.forget('roster');
    link.forget('stage');
    const notes = [...(pick?.notes ?? [])];
    if (!sameStage(stageKeyOf(ground), message.stage)) notes.push('The host chose ground your folder does not have, so you fight on none.');
    if (pick && message.product !== product) notes.push(`The host plays from ${message.product} and you from ${product}: the fight keeps the host's timing, drawn with your own animations.`);
    link.forget('hello');
    const from = screenRef.current;
    void (pick ? fightersFor(message, fighters, pick) : Promise.resolve(fighters))
      .then((ready) => from === screenRef.current && setScreen({ kind: 'fight', fighters: ready, stage: ground, net: { link, me: 1, host: false, hello: message, notes } }))
      .catch((cause: unknown) => setLeft(`The host's champions could not be built here: ${messageOf(cause)}`));
  };

  /** Both locked online: the host draws the ground and sends its hello at once, unless it picks by hand; the guest waits on the host's word. */
  const lockedOnline = (fighters: [BuiltFighter, BuiltFighter], pick: OnlinePick) => {
    if (online!.role === 'guest') setScreen({ kind: 'next', fighters, pick });
    else if (picksStageOnline()) setScreen({ kind: 'versus', fighters, pick });
    else {
      const seed = newSeed();
      const sent = sendHello(helloFor(fighters, pick, drawGround(shared(), loaded!.screens, seed), seed, true));
      setScreen({ kind: 'next', fighters, pick, sent });
    }
  };

  /** The NEXT STAGE card done: into the ring on the drawn ground. */
  const fightDrawn = (next: Extract<Screen, { kind: 'next' }>, ground: Ground) => {
    if (left) return;
    if (next.sent) setScreen({ kind: 'fight', fighters: next.fighters, stage: ground, net: { link: online!.link, me: 0, host: true, hello: next.sent, notes: next.pick?.notes ?? [] } });
    else if (hello) guestFight(next.fighters, ground, next.pick, hello);
  };

  // The guest: the host's hello settles which screen. A drawn ground shows the card (on a rematch too, from the fight);
  // a hello without one while the card waits means the host picked by hand, and the VS screen takes it into the ring.
  useEffect(() => {
    if (!online || online.role !== 'guest' || !hello) return;
    const now = screenRef.current;
    if (hello.drawn && now.kind === 'versus') setScreen({ kind: 'next', fighters: now.fighters, pick: now.pick });
    else if (hello.drawn && now.kind === 'fight' && now.net && hello.game !== now.net.hello.game) setScreen({ kind: 'next', fighters: now.fighters });
    else if (!hello.drawn && now.kind === 'next' && now.pick) setScreen({ kind: 'versus', fighters: now.fighters, pick: now.pick });
  }, [online, hello, screen.kind]);

  // The guest's card, waiting: the host's cursor on the VS screen means the host picks by hand, so the guest watches it there.
  useEffect(() => {
    if (!online || online.role !== 'guest' || screen.kind !== 'next' || !screen.pick || hello?.drawn) return;
    const { fighters, pick } = screen;
    return online.link.listen((message) => {
      if (message.t === 'stage') setScreen({ kind: 'versus', fighters, pick });
    });
  }, [online, screen, hello]);

  // The host's rematch online, unless it picks by hand: a new hello with the next game and a ground drawn anew from the
  // rematch's seed, and the card again, in place of the fight screen's own rematch on the same ground.
  useEffect(() => {
    if (!online || online.role !== 'host' || left) return;
    const onKey = (event: KeyboardEvent) => {
      const now = screenRef.current;
      if (event.code !== 'Enter' || event.repeat || now.kind !== 'fight' || !now.net || !matchOver() || picksStageOnline()) return;
      event.stopPropagation();
      event.preventDefault();
      const last = now.net.hello;
      const game = last.game + 1;
      const seed = (last.seed + game) >>> 0;
      const sent = sendHello({ ...last, game, seed, stage: drawGround(shared(), loaded!.screens, seed, last.stage), drawn: true });
      setScreen({ kind: 'next', fighters: now.fighters, sent });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [online, left, loaded]);

  useEffect(() => {
    document.body.classList.toggle('ingame', phase.kind === 'ready' && loaded !== undefined && !atTitle);
  }, [phase.kind, loaded, atTitle]);

  // Where the player is, for a report sent from the game (Reporter.tsx).
  useEffect(() => {
    const edition = loaded ? `${loaded.edition.game} ${loaded.edition.version} (${loaded.edition.product})` : undefined;
    if (phase.kind !== 'ready' || !loaded || atTitle) {
      const screenName = loadError
        ? `Title, the folder could not be read: ${loadError}`
        : atTitle && loaded
          ? 'Title, the folder open'
          : phase.kind === 'ready'
            ? 'Title, opening the folder'
            : `Title (${phase.kind})`;
      setWhere({ screen: screenName, edition });
      return;
    }
    const names = screen.kind === 'select' ? undefined : screen.fighters.map((f) => `${f.champion.name} (${f.champion.title})`).join(' vs ') + `, player 2: ${p2}`;
    const ground = screen.kind === 'fight' ? screen.stage : undefined;
    const stage = ground && (ground.stage ? `${ground.stage.name}, ${ground.stage.where}` : ground.screen ? `loading screen ${ground.screen.fileId}` : 'none');
    const screenName = { select: 'Choose your champion', versus: 'VS screen', next: 'Next stage card', fight: 'The fight' }[screen.kind];
    setWhere({ screen: screenName, edition, fighters: names, stage });
  }, [phase.kind, loaded, loadError, atTitle, screen, p2]);

  const wantCreate = (yes: boolean) => {
    createNext.current = yes;
  };
  const wantOnline = (yes: boolean) => {
    onlineNext.current = yes;
  };
  // A challenge come in, while it would show: the gong, the title, and the notification for a player who asked for one.
  const calling = loaded && !atTitle && !online && !matching && screen.kind !== 'fight' && !watching ? lobbyState.incoming : undefined;
  const callingKey = calling && `${calling.id} ${calling.until}`;
  useEffect(() => {
    if (calling) callToFight(`${calling.name} challenges you to Mak'gora.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callingKey]);

  if (phase.kind === 'choose') return <Title phase={phase} dragging={dragging} onPick={onPick} onChoose={(product) => void openFolder(phase.files, product)} onCreate={wantCreate} onOnline={wantOnline} />;
  if (phase.kind !== 'ready') return <Title phase={phase} dragging={dragging} onPick={onPick} onCreate={wantCreate} onOnline={wantOnline} />;
  if (loadError) return <Title phase={{ kind: 'error', message: loadError }} dragging={false} onPick={onPick} onCreate={wantCreate} onOnline={wantOnline} />;
  if (!loaded) return <Title phase={{ kind: 'opening', message: 'Summoning the roster…' }} dragging={false} onPick={onPick} onCreate={wantCreate} onOnline={wantOnline} />;
  if (atTitle) {
    return (
      <Title
        phase={phase}
        dragging={dragging}
        onPick={onPick}
        onCreate={wantCreate}
        onOnline={wantOnline}
        open={{ name: loaded.edition.game, onEnter: enterRing, onChange: changeFolder }}
      />
    );
  }

  // A challenge shows over any screen but a fight, unless this page is already in a match.
  const challenge = !online && !matching && screen.kind !== 'fight' && !watching ? lobbyState.incoming : undefined;

  const view = (() => {
    if (watching) {
      return (
        <Watch
          fight={watching}
          client={client.current!}
          fighters={loaded.fighters}
          legends={loaded.legends}
          stages={[...loaded.stages, BAY_STAGE]}
          screens={loaded.screens}
          assets={{ client: client.current!, races: loaded.races, portraits: loaded.portraits }}
          // Their pick on this install's roster, with none of the watcher's own champions in it: theirs are not here either.
          select={(roster, bay) => (
            <Select
              key={`watch ${watching.code}`}
              edition={loaded.edition}
              art={loaded.art}
              others={[]}
              onEdition={() => undefined}
              races={loaded.races}
              classes={loaded.classes}
              records={[]}
              legends={loaded.legends}
              portraits={loaded.portraits}
              fighters={loaded.fighters}
              saved={[]}
              onSaved={() => undefined}
              p2="keyboard"
              onP2={() => undefined}
              onReady={() => undefined}
              onBack={stopWatching}
              bay={bay}
              watch={roster}
            />
          )}
          onBack={stopWatching}
        />
      );
    }
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
              if (online && pick) lockedOnline(fighters, pick);
              else setScreen({ kind: 'versus', fighters, pick });
            }}
            onBack={online ? leaveOnline : toTitle}
            online={rosterOnline}
            paused={showOnline || left !== undefined || matching !== undefined || challenge !== undefined}
            onOnline={() => setShowOnline(true)}
            bay={inBay}
          />
        );
      case 'versus':
        return (
          <Versus
            client={client.current!}
            fighters={screen.fighters}
            stages={stagesHere()}
            screens={loaded.screens}
            onFight={(ground) => {
              // Once per VS screen, and only while it is still up: a ground still rising when the player
              // left, or a second Enter, would otherwise start a fight from the roster or send a second hello.
              if (screenRef.current !== screen || fightFrom.current === screen) return;
              fightFrom.current = screen;
              startFight(screen.fighters, ground, screen.pick);
            }}
            onBack={backToSelect}
            online={screen.pick ? versusOnline : undefined}
            start={screen.pick && online?.role === 'guest' && !hello?.drawn ? hello?.stage : undefined}
          />
        );
      case 'next':
        return (
          <NextStage
            client={client.current!}
            fighters={screen.fighters}
            stages={stagesHere()}
            screens={loaded.screens}
            ground={screen.sent ? screen.sent.stage : hello?.drawn ? hello.stage : undefined}
            onFight={(ground) => fightDrawn(screen, ground)}
            onBack={backToSelect}
            link={online!.link}
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
              feedback={{
                mode: screen.net ? 'online' : p2 === 'cpu' ? 'cpu' : 'local',
                stage: screen.stage.stage?.name ?? (screen.stage.screen ? 'a loading screen' : undefined),
                game: `${loaded.edition.game} ${loaded.edition.version}`,
              }}
            />
          </>
        );
    }
  })();

  return (
    <>
      {view}
      <MusicTab />
      {online && <VoiceTab key={online.code} link={online.link} them={online.them} />}
      {online && (
        <PlayerChat
          key={online.code}
          link={online.link}
          them={online.them}
          canType={() => screenRef.current.kind !== 'fight' || matchOver()}
          onPick={screen.kind === 'select'}
        />
      )}
      {showOnline && (
        <Online
          lobby={lobby}
          name={name}
          onName={giveName}
          product={product}
          onReady={startSession}
          onClose={() => setShowOnline(false)}
          onWatch={online ? undefined : watchFight}
        />
      )}
      {!showOnline && lobbyState.notice && !challenge && !matching && <div class="lobby-toast">{lobbyState.notice}</div>}
      {inBay && !watching && <BayDress quiet={screen.kind === 'fight'} />}
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
              <button
                type="button"
                class="button"
                onClick={() => {
                  leaveOnline();
                  toTitle();
                }}
              >
                THE TITLE · ESC
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
