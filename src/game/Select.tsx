import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ClassEntry, Race } from '@mogshot/character/appearance';
import type { BuildInfoEntry } from '@mogshot/casc/build-info';
import type { ImportedRecord } from '@mogshot/import/record';
import { BRAND } from '../engine/brand';
import { GLYPHS } from './ActionBar';
import { type Edition, editionOf } from './edition';
import type { EditionArt } from './editionArt';
import { type KeyLayout, keyLayout, LAYOUT_WORDS, MENU_KEYS, ROSTER_KEYS, setKeyLayout } from '../engine/input';
import { type BuiltFighter, type Champion, type Fighters } from './fighters';
import { headshotOf, storedHeadshot } from './headshot';
import { usePadMode, usePadUse } from './pads';
import { Preview } from './Preview';
import { championTiles, classesOf, CREATE_TILE, cycleClass, factionOf, gridMove, randomTile, rosterTiles, sexFor, type Tile } from './roster';
import { Create } from './Create';
import { championRow, fullName, isBuiltin, madeKey, type SavedChampion, savedTiles, withoutSaved, withSaved } from './saved';
import { LogoArt, Presence } from './Title';
import { kitSpec, type ResourceKind } from '../engine/abilities';
import { HP } from '../engine/stage';
import { describeAbility } from './ui/describe';
import type { Line, Quality } from './ui/WowTooltip';
import { championOf, type FighterSpec, localize, plainSpec, type RosterMessage, specOf } from './net/handshake';
import type { Link } from './net/relay';

const RESOURCE_WORDS: Record<ResourceKind, string> = { rage: 'Rage: builds in combat', energy: '+100 Energy', mana: '+100 Mana', focus: '+100 Focus', runic: 'Runic Power: builds in combat', fury: 'Fury: builds in combat' };

/*
 * CHOOSE YOUR CHAMPION. Every race on a grid of the game's own portraits, the player's own
 * characters in a row above, the legends in a row above those, both players' cursors on it
 * at once, each champion drawn full size on its player's side as soon as the cursor rests
 * on it. After the last legend come the champions built into the game (Cassidy Darkstar), then
 * a question mark that opens CREATE YOUR CHAMPION, and the champions made there follow it,
 * newest first. The screen is dressed as the open game's edition: its name under our logo, one of
 * its loading screens behind, its colours; E switches to another game in the same folder.
 */

export type Source = 'keyboard' | 'gamepad' | 'cpu';

/** Online: which player this machine steers, and the wire the other player's cursor comes over. */
export interface OnlineRoster {
  me: 0 | 1;
  link: Link;
  code: string;
}

/** What an online roster hands on with the two fighters: the specs as their owners sent them, for the host's hello, and how this install drew the other's. */
export interface OnlinePick {
  specs: [FighterSpec, FighterSpec];
  notes: string[];
}

interface SelectProps {
  /** Which of the folder's games is open, and its art. */
  edition: Edition;
  art: EditionArt;
  /** The folder's other games, to switch to. */
  others: BuildInfoEntry[];
  onEdition: (product: string) => void;
  races: Race[];
  classes: ClassEntry[];
  records: ImportedRecord[];
  /** The legends the open folder can draw, as roster.legendTiles picks them. */
  legends: Tile[];
  /** Race portraits by `${race.key}:${sex}` and class icons by class key, as data URLs. */
  portraits: { races: Map<string, string>; classes: Map<string, string> };
  fighters: Fighters;
  /** The champions made on CREATE YOUR CHAMPION, oldest first as they are kept. */
  saved: SavedChampion[];
  onSaved: (saved: SavedChampion[]) => void;
  /** Open with player 1 on the question mark, as the title's CREATE YOUR CHAMPION asks. */
  startOnCreate?: boolean;
  p2: Source;
  onP2: (source: Source) => void;
  onReady: (fighters: [BuiltFighter, BuiltFighter], online?: OnlinePick) => void;
  onBack: () => void;
  online?: OnlineRoster;
  /** A panel is open over the roster and takes the keys. */
  paused?: boolean;
  /** O: PLAY ONLINE, from the roster. */
  onOnline?: () => void;
}

interface Cursor {
  zone: 'legends' | 'champions' | 'roster';
  index: number;
}

interface Player {
  cursor: Cursor;
  sex: number;
  classId: number | undefined;
  locked: boolean;
  champion: Champion | undefined;
  built: BuiltFighter | undefined;
  building: boolean;
  error: string | undefined;
}

const COLUMNS = 8;
/**
 * Only the legends on the select screen (William, 24 Oct 2026), unless the page is opened with
 * `?all` on the address, which brings back every race and the player's own characters.
 */
const LEGENDS_ONLY = !(typeof location !== 'undefined' && new URLSearchParams(location.search).has('all'));
const HOVER_MS = 200;

/** The roster hint for a player on a controller. */
const PAD_HINT: readonly [string, string] = ['d-pad move · A choose · B back', ' · Y ♂/♀ · LB/RB class'];

/** The roster hint per player under each layout. */
const ROSTER_HINTS: Readonly<Record<KeyLayout, readonly [[string, string], [string, string]]>> = {
  classic: [['WASD move · J choose · H back', ' · U ♂/♀ · K/L class'], ['arrows · , or Num1 choose · M back', ' · Right Shift ♂/♀ · . / class']],
  wow: [['arrows move · 1 choose · Backspace back', ' · 4 ♂/♀ · 2/3 class'], ['WASD move · J choose · H back', ' · U ♂/♀ · K/L class']],
};

const freshPlayer = (sex: number): Player => ({
  cursor: { zone: 'roster', index: 0 },
  sex,
  classId: undefined,
  locked: false,
  champion: undefined,
  built: undefined,
  building: false,
  error: undefined,
});

/** The legends' portraits are rendered once through the Mogshot command line and shipped with the game, as the browser has no portrait atlas for NPCs. */
const legendPortrait = (slug: string) => `${import.meta.env.BASE_URL}legends/${slug}.png`;

export function Select({ edition, art, others, onEdition, races, classes, records, legends, portraits, fighters, saved, onSaved, startOnCreate, p2, onP2, onReady, onBack, online, paused, onOnline }: SelectProps) {
  const roster = useMemo(() => rosterTiles(races), [races]);
  usePadMode('roster');
  const padUse = usePadUse();
  const [layout, setLayout] = useState<KeyLayout>(keyLayout());
  const champions = useMemo(() => championTiles(records, races), [records, races]);
  // The legends' row: the legends, the built-in champions, the question mark, and the champions made here, newest first.
  const legendRow = useMemo(() => championRow(legends, saved, races), [legends, saved, races]);
  const createAt = legendRow.indexOf(CREATE_TILE);
  // The rows from the top, leaving out the empty ones; the cursor moves up and down through them.
  // For now the ring is for the legends only (William, 24 Oct 2026); the races and your own
  // characters come back with `?all` on the address. An install with no legend the game
  // can draw still gets the full roster rather than an empty screen.
  const legendsOnly = LEGENDS_ONLY && legends.length > 0;
  /** A player's roster keys, or a controller's buttons once they play with one; the legends alone have no sex or class to change. */
  const hint = (who: 0 | 1) => {
    const [move, more] = padUse[who] ? PAD_HINT : ROSTER_HINTS[layout][who];
    return legendsOnly ? move : move + more;
  };
  const zones = useMemo(() => {
    const rows: { zone: Cursor['zone']; tiles: Tile[] }[] = [];
    rows.push({ zone: 'legends', tiles: legendRow });
    if (legendsOnly) return rows;
    if (champions.length > 0) rows.push({ zone: 'champions', tiles: champions });
    rows.push({ zone: 'roster', tiles: roster });
    return rows;
  }, [legendRow, champions, roster, legendsOnly]);
  /** Where the computer and a random pick choose from: the legends alone, or the races. */
  const pool: { zone: Cursor['zone']; tiles: Tile[] } = legendsOnly ? { zone: 'legends', tiles: legends } : { zone: 'roster', tiles: roster };
  // The ring opens on Tyrande against Thrall when the folder has them; otherwise on the roster.
  // CREATE YOUR CHAMPION, open over the roster for the player who chose the question mark.
  const [making, setMaking] = useState<{ who: 0 | 1; editing?: SavedChampion }>();
  const [players, setPlayers] = useState<[Player, Player]>(() => {
    const opening = (slug: string, sex: number): Player => {
      const index = legends.findIndex((tile) => tile.kind === 'legend' && tile.legend.slug === slug);
      const player = freshPlayer(sex);
      return index >= 0 ? { ...player, cursor: { zone: 'legends', index } } : player;
    };
    const first = opening('tyrande', 1);
    return [startOnCreate ? { ...first, cursor: { zone: 'legends', index: createAt } } : first, opening('thrall', 0)];
  });
  const playersRef = useRef(players);
  playersRef.current = players;
  // Each champion's own face by its key, drawn from the built model; the legends' and the player's own are drawn ahead of time.
  const [headshots, setHeadshots] = useState<Map<string, string>>(() => new Map());
  const face = (built: BuiltFighter) => {
    const url = headshotOf(built);
    if (url) setHeadshots((current) => (current.get(built.champion.key) === url ? current : new Map(current).set(built.champion.key, url)));
  };
  const makingRef = useRef(making);
  makingRef.current = making;
  const p2Ref = useRef(p2);
  p2Ref.current = p2;
  const othersRef = useRef(others);
  othersRef.current = others;
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  /** Online, the player steered from the other machine. */
  const them = online ? (online.me === 0 ? 1 : 0) : undefined;
  // The other player's latest cursor, the spec their champion was built from, and what this install drew otherwise.
  const [remote, setRemote] = useState<RosterMessage>();
  const remoteBuilt = useRef<string | undefined>(undefined);
  const remoteNotes = useRef<string[]>([]);
  // Each player's newest build request; older ones that finish late are dropped.
  const requests = useRef([0, 0]);
  const rng = useRef(Date.now() >>> 0);
  const draw = () => {
    rng.current = (Math.imul(rng.current, 1664525) + 1013904223) >>> 0;
    return rng.current / 4294967296;
  };

  const tilesOf = (zone: Cursor['zone']): Tile[] => (zone === 'legends' ? legendRow : zone === 'champions' ? champions : roster);
  const tileAt = (cursor: Cursor): Tile | undefined => tilesOf(cursor.zone)[cursor.index];

  /** The build key of a tile drawn ahead of time, under which its face is kept. */
  const faceKey = (tile: Extract<Tile, { kind: 'legend' | 'record' | 'saved' }>): string =>
    tile.kind === 'record'
      ? `record:${tile.record.key}`
      : tile.kind === 'saved'
        ? madeKey(tile.saved.raceId, tile.saved.sex, tile.saved.classId, tile.saved.choices, tile.saved.gear)
        : `legend:${tile.legend.slug}:${tile.displayId}`;

  const update = (who: 0 | 1, change: (player: Player) => Player) =>
    setPlayers((current) => {
      const next: [Player, Player] = [current[0], current[1]];
      next[who] = change(current[who]);
      return next;
    });

  /** Resolve the champion under a player's cursor and build it; the build is kept across hovers. */
  const summon = (who: 0 | 1, player: Player): Player => {
    const tile = tileAt(player.cursor);
    const id = ++requests.current[who]!;
    if (!tile || tile.kind === 'random' || tile.kind === 'create') return { ...player, champion: undefined, built: undefined, building: false, error: undefined };
    const sex = tile.kind === 'record' ? tile.record.sex : tile.kind === 'saved' ? tile.saved.sex : tile.kind === 'legend' ? tile.sex : sexFor(tile.race, player.sex);
    const classId = tile.kind !== 'race' ? undefined : (classesOf(tile.race, classes).some((c) => c.id === player.classId) ? player.classId : cycleClass(tile.race, classes, undefined, 1));
    void fighters
      .champion(tile, sex, classId)
      .then(async (champion) => {
        if (!champion) return;
        if (requests.current[who] !== id) return;
        update(who, (p) => ({ ...p, champion }));
        const built = await fighters.get(champion);
        if (requests.current[who] !== id) return;
        update(who, (p) => ({ ...p, built, building: false, error: undefined }));
        face(built);
      })
      .catch((cause: unknown) => {
        if (requests.current[who] !== id) return;
        update(who, (p) => ({ ...p, building: false, error: cause instanceof Error ? cause.message : String(cause) }));
      });
    return { ...player, classId, building: true, error: undefined };
  };

  // A rest on a tile summons it after a moment, so sweeping across the grid does not build every race.
  useEffect(() => {
    const timers = players.map((player, who) => {
      if (player.locked || who === them) return undefined;
      // A tile with no champion (random, the creator's) clears what was there, a build in flight included.
      const want = keyOf(tileAt(player.cursor), player);
      if (want === undefined ? !player.built && !player.building : player.built?.champion.key === want) return undefined;
      return setTimeout(() => update(who as 0 | 1, (p) => summon(who as 0 | 1, p)), HOVER_MS);
    });
    return () => timers.forEach((timer) => timer !== undefined && clearTimeout(timer));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players[0].cursor, players[0].sex, players[0].classId, players[1].cursor, players[1].sex, players[1].classId]);

  // Every legend and every champion of the player's own gets its face drawn in the background, one at a
  // time, waiting whenever a player's own summon is in flight so the cursor never queues behind it.
  useEffect(() => {
    let stopped = false;
    const wanted = [...legendRow, ...champions].filter((tile) => tile.kind === 'legend' || tile.kind === 'record' || tile.kind === 'saved');
    const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    void (async () => {
      await pause(800);
      for (const tile of wanted) {
        if (stopped) return;
        if (tile.kind !== 'legend' && tile.kind !== 'record' && tile.kind !== 'saved') continue;
        const key = faceKey(tile);
        const stored = storedHeadshot(key);
        if (stored) {
          setHeadshots((current) => (current.has(key) ? current : new Map(current).set(key, stored)));
          continue;
        }
        while (!stopped && playersRef.current.some((player) => player.building)) await pause(250);
        if (stopped) return;
        try {
          const champion = await fighters.champion(tile, tile.kind === 'record' ? tile.record.sex : tile.kind === 'saved' ? tile.saved.sex : tile.sex, undefined);
          if (!champion || stopped) continue;
          face(await fighters.get(champion));
        } catch (cause) {
          console.warn(`${nameOf(tile)}: no face:`, cause);
        }
        await pause(150);
      }
    })();
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legendRow, champions]);

  const keyOf = (tile: Tile | undefined, player: Player) => {
    if (!tile || tile.kind === 'random' || tile.kind === 'create') return undefined;
    if (tile.kind === 'record' || tile.kind === 'legend' || tile.kind === 'saved') return faceKey(tile);
    const classId = classesOf(tile.race, classes).some((c) => c.id === player.classId) ? player.classId : cycleClass(tile.race, classes, undefined, 1);
    return `race:${tile.race.id}:${sexFor(tile.race, player.sex)}:${classId ?? 0}`;
  };

  const move = (player: Player, dx: number, dy: number): Player => {
    const { cursor } = player;
    const at = zones.findIndex((row) => row.zone === cursor.zone);
    const into = (row: { zone: Cursor['zone']; tiles: Tile[] } | undefined, column: number): Player =>
      row ? { ...player, cursor: { zone: row.zone, index: Math.min(column, row.tiles.length - 1) } } : player;
    if (cursor.zone !== 'roster') {
      // A single row: left and right wrap along it, up and down step to the rows around it.
      const tiles = tilesOf(cursor.zone);
      if (dy > 0) return into(zones[at + 1], cursor.index);
      if (dy < 0) return into(zones[at - 1], cursor.index);
      return { ...player, cursor: { zone: cursor.zone, index: (cursor.index + dx + tiles.length) % tiles.length } };
    }
    const row = Math.floor(cursor.index / COLUMNS);
    if (dy < 0 && row === 0 && at > 0) return into(zones[at - 1], cursor.index % COLUMNS);
    return { ...player, cursor: { zone: 'roster', index: gridMove(cursor.index, roster.length, COLUMNS, dx, dy) } };
  };

  const confirm = (who: 0 | 1) => {
    const player = playersRef.current[who];
    if (!player.locked && tileAt(player.cursor)?.kind === 'create') {
      setMaking({ who });
      return;
    }
    update(who, (player) => {
      if (player.locked) return player;
      const tile = tileAt(player.cursor);
      if (tile?.kind === 'random') {
        const picked = randomTile(roster, draw);
        const index = picked ? roster.indexOf(picked) : 0;
        const allowed = picked?.kind === 'race' ? classesOf(picked.race, classes) : [];
        const classId = allowed.length > 0 ? allowed[Math.floor(draw() * allowed.length)]!.id : undefined;
        const sex = picked?.kind === 'race' ? sexFor(picked.race, draw() < 0.5 ? 0 : 1) : player.sex;
        // The pick lands first; the next confirm locks it.
        return summon(who, { ...player, cursor: { zone: 'roster', index }, sex, classId });
      }
      return { ...player, locked: true };
    });
  };

  /** Open the creator for a player: on the made champion under their cursor to edit it, or a new one. */
  const make = (who: 0 | 1) => {
    const tile = tileAt(playersRef.current[who].cursor);
    setMaking(tile?.kind === 'saved' ? { who, editing: tile.saved } : { who });
  };

  /** A made champion kept: the list stored, the player's cursor on its tile (just after the question mark when new), unlocked to choose it. */
  const keep = (entry: SavedChampion) => {
    if (!making) return;
    const isNew = !saved.some((s) => s.id === entry.id);
    const list = withSaved(saved, entry);
    onSaved(list);
    const at = savedTiles([...list].reverse(), races).findIndex((tile) => tile.id === `saved:${entry.id}`);
    const index = createAt + 1 + Math.max(0, at);
    const other = making.who === 0 ? 1 : 0;
    // The other player's cursor stays on the champion it was on when the new tile pushes the row along.
    if (isNew && !online) update(other, (p) => (p.cursor.zone === 'legends' && p.cursor.index > createAt ? { ...p, cursor: { ...p.cursor, index: p.cursor.index + 1 } } : p));
    update(making.who, (p) => ({ ...p, locked: false, cursor: { zone: 'legends', index } }));
    setMaking(undefined);
  };

  const discard = (id: string) => {
    if (!making) return;
    onSaved(withoutSaved(saved, id));
    update(making.who, (p) => ({ ...p, locked: false, cursor: { zone: 'legends', index: createAt } }));
    setMaking(undefined);
  };

  // Keys: both players on one keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (makingRef.current || pausedRef.current) return;
      const net = onlineRef.current;
      if (event.code === 'Escape') {
        const [a, b] = playersRef.current;
        // Online each unlocks only their own; Escape with nothing locked leaves the room.
        if (net) {
          if (playersRef.current[net.me].locked) update(net.me, (p) => ({ ...p, locked: false }));
          else onBack();
        } else if (a.locked || b.locked) setPlayers([{ ...a, locked: false }, { ...b, locked: false }]);
        else onBack();
        return;
      }
      // Another game in the same folder: its own edition of the ring, read afresh.
      // Online the room is on this game's files: switching games stays an offline thing.
      if (event.code === 'KeyE' && !onlineRef.current && othersRef.current.length > 0) {
        event.preventDefault();
        onEdition(othersRef.current[0]!.product);
        return;
      }
      if (event.code === 'Tab') {
        event.preventDefault();
        // Online player 2 is the other machine.
        if (net) return;
        const order: Source[] = ['keyboard', 'cpu', 'gamepad'];
        onP2(order[(order.indexOf(p2Ref.current) + 1) % order.length]!);
        return;
      }
      if (event.code === MENU_KEYS.create) {
        // N: the creator, on the made champion under player 1's cursor (or else player 2's), or a new one for player 1.
        const onMade = ([0, 1] as const).find((who) => tileAt(playersRef.current[who].cursor)?.kind === 'saved' && !playersRef.current[who].locked);
        make(net ? net.me : (onMade ?? 0));
        return;
      }
      if (event.code === 'KeyO' && !net && onOnline) {
        onOnline();
        return;
      }
      if (event.code === MENU_KEYS.layout) {
        setKeyLayout(keyLayout() === 'wow' ? 'classic' : 'wow');
        setLayout(keyLayout());
        return;
      }
      for (const who of [0, 1] as const) {
        // Online this machine's player answers to either player's roster keys.
        const keys = ROSTER_KEYS[keyLayout()];
        const action = net ? (who === net.me ? (keys[0][event.code] ?? keys[1][event.code]) : undefined) : keys[who][event.code];
        if (!action) continue;
        if (who === 1 && p2Ref.current === 'cpu') continue;
        event.preventDefault();
        if (action === 'confirm') confirm(who);
        else if (action === 'back') update(who, (p) => ({ ...p, locked: false }));
        else
          update(who, (player) => {
            if (player.locked) return player;
            const tile = tileAt(player.cursor);
            switch (action) {
              case 'up': return move(player, 0, -1);
              case 'down': return move(player, 0, 1);
              case 'left': return move(player, -1, 0);
              case 'right': return move(player, 1, 0);
              case 'sex': return { ...player, sex: player.sex === 0 ? 1 : 0 };
              case 'classPrev': return tile && tile.kind === 'race' ? { ...player, classId: cycleClass(tile.race, classes, player.classId, -1) } : player;
              case 'classNext': return tile && tile.kind === 'race' ? { ...player, classId: cycleClass(tile.race, classes, player.classId, 1) } : player;
            }
          });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, champions, legendRow, classes]);

  // The computer picks for itself once the player has locked in: a sweep across the grid, then a lock.
  useEffect(() => {
    if (p2 !== 'cpu' || !players[0].locked || players[1].locked) return;
    let steps = 6 + Math.floor(draw() * 6);
    const timer = setInterval(() => {
      if (steps-- > 0) {
        update(1, (player) => {
          const picked = randomTile(pool.tiles, draw);
          return { ...player, cursor: { zone: pool.zone, index: picked ? pool.tiles.indexOf(picked) : 0 } };
        });
        return;
      }
      clearInterval(timer);
      update(1, (player) => {
        const tile = tileAt(player.cursor);
        if (tile?.kind === 'legend') return summon(1, { ...player, locked: true });
        if (tile?.kind !== 'race') return player;
        const allowed = classesOf(tile.race, classes);
        const classId = allowed.length > 0 ? allowed[Math.floor(draw() * allowed.length)]!.id : undefined;
        return summon(1, { ...player, sex: sexFor(tile.race, draw() < 0.5 ? 0 : 1), classId, locked: true });
      });
    }, 140);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p2, players[0].locked, players[1].locked]);

  // Both locked and both built: into the ring. The other machine's player is built from the spec they sent, not from a tile here.
  useEffect(() => {
    const [a, b] = players;
    if (!(a.locked && b.locked && a.built && b.built)) return;
    const current = (who: 0 | 1) => (who === them ? remoteBuilt.current !== undefined && remoteBuilt.current === remote?.champion?.key : players[who].built!.champion.key === keyOf(tileAt(players[who].cursor), players[who]));
    if (!current(0) || !current(1)) return;
    const pick = (): OnlinePick | undefined => {
      if (them === undefined || !remote?.champion) return undefined;
      const specs: [FighterSpec, FighterSpec] = [specOf(a.built!.champion), specOf(b.built!.champion)];
      specs[them] = remote.champion;
      return { specs, notes: remoteNotes.current };
    };
    const timer = setTimeout(() => onReady([a.built!, b.built!], pick()), 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players]);

  // Online: this machine's cursor goes to the other each time it moves, rests, locks or resolves a champion.
  const mine = online ? players[online.me] : undefined;
  useEffect(() => {
    if (!online || !mine) return;
    online.link.send({
      t: 'roster',
      tile: tileAt(mine.cursor)?.id,
      sex: mine.sex,
      classId: mine.classId,
      locked: mine.locked,
      champion: mine.champion ? specOf(mine.champion) : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, mine?.cursor, mine?.sex, mine?.classId, mine?.locked, mine?.champion]);

  useEffect(() => online?.link.listen((message) => message.t === 'roster' && setRemote(message)), [online]);

  /** The other player's champion from their spec, as this install can draw it, and what it draws otherwise. */
  const buildRemote = async (spec: FighterSpec): Promise<{ built: BuiltFighter; notes: string[] }> => {
    const displayOf = (slug: string) => {
      for (const tile of legends) if (tile.kind === 'legend' && tile.legend.slug === slug) return tile.displayId;
      return undefined;
    };
    const fitted = localize(spec, displayOf);
    const notes: string[] = [];
    let built: BuiltFighter;
    try {
      built = await fighters.get(championOf(fitted));
    } catch (cause) {
      console.warn(`${spec.name} could not be built here:`, cause);
      built = await fighters.get(championOf(plainSpec(spec)));
      notes.push(`Your folder cannot draw ${spec.name}: they fight as a ${spec.title || 'plain champion'} here.`);
    }
    const missing = missingPieces(built.result.scene.problems);
    if (missing.length > 0) notes.push(`${missing.length} piece(s) of ${spec.name}'s gear are not in your folder, so they are drawn without them.`);
    return { built, notes };
  };

  // The other player's cursor and champion, as their messages say.
  useEffect(() => {
    if (them === undefined || !remote) return;
    const at = (id: string | undefined): Cursor => {
      for (const row of zones) {
        const index = row.tiles.findIndex((tile) => tile.id === id);
        if (index >= 0) return { zone: row.zone, index };
      }
      // A tile this machine lacks (their own champion): no cursor here; the plate still says who.
      return { zone: 'legends', index: -1 };
    };
    update(them, (p) => ({ ...p, cursor: at(remote.tile), sex: remote.sex, classId: remote.classId, locked: remote.locked }));
    const spec = remote.champion;
    if (!spec) {
      ++requests.current[them]!;
      remoteBuilt.current = undefined;
      update(them, (p) => ({ ...p, champion: undefined, built: undefined, building: false, error: undefined }));
      return;
    }
    if (players[them].champion?.key === spec.key) return;
    const id = ++requests.current[them]!;
    remoteBuilt.current = undefined;
    update(them, (p) => ({ ...p, champion: championOf(spec), building: true, error: undefined }));
    void buildRemote(spec)
      .then(({ built, notes }) => {
        if (requests.current[them] !== id) return;
        remoteBuilt.current = spec.key;
        remoteNotes.current = notes;
        update(them, (p) => ({ ...p, built, building: false }));
        face(built);
      })
      .catch((cause: unknown) => {
        if (requests.current[them] !== id) return;
        update(them, (p) => ({ ...p, building: false, error: cause instanceof Error ? cause.message : String(cause) }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, zones]);

  /**
   * The builder's problems that are files this install lacks. The rest (a texture the game data
   * names but the game draws without, a piece drawn another way) the builder recovers from, and
   * the plate says nothing of them; the full list stays in the status line's title.
   */
  const missingPieces = (problems: readonly string[]) => problems.filter((problem) => /is not installed|is not part of this build|^No painted body/.test(problem));

  const portraitOf = (tile: Tile, sex: number) => {
    if (tile.kind === 'random') return undefined;
    if (tile.kind === 'legend') return legendPortrait(tile.legend.slug);
    if (tile.kind === 'create') return undefined;
    return portraits.races.get(`${tile.race.key}:${tile.kind === 'record' ? tile.record.sex : tile.kind === 'saved' ? tile.saved.sex : sexFor(tile.race, sex)}`);
  };
  const nameOf = (tile: Tile) =>
    tile.kind === 'random' ? 'RANDOM' : tile.kind === 'create' ? 'CREATE' : tile.kind === 'record' ? tile.record.name : tile.kind === 'saved' ? fullName(tile.saved) : tile.kind === 'legend' ? tile.legend.name : tile.race.name;

  const tileView = (tile: Tile, zone: Cursor['zone'], index: number) => {
    const here = players.map((player) => player.cursor.zone === zone && player.cursor.index === index);
    const classId = tile.kind === 'record' ? tile.record.classId : tile.kind === 'saved' ? tile.saved.classId : undefined;
    const classKey = classId === undefined ? undefined : classes.find((c) => c.id === classId)?.key;
    return (
      <div
        key={tile.id}
        class={`tile ${tile.kind} ${factionOf(tile)} ${here[0] ? 'p1' : ''} ${here[1] ? 'p2' : ''} ${here[0] && players[0].locked ? 'locked1' : ''} ${here[1] && players[1].locked ? 'locked2' : ''}`}
        onClick={() => {
          const who = online?.me ?? 0;
          if (players[who].locked) return;
          update(who, (p) => ({ ...p, cursor: { zone, index } }));
          if (tile.kind === 'create') setMaking({ who });
        }}
        title={tile.kind === 'create' ? 'Create your champion' : undefined}
      >
        {tile.kind === 'random' ? (
          <span class="random">?</span>
        ) : tile.kind === 'create' ? (
          <>
            <span class="ask">?</span>
            <span class="name">CREATE</span>
          </>
        ) : tile.kind === 'legend' ? (
          <>
            <img
              class={headshots.has(`legend:${tile.legend.slug}:${tile.displayId}`) ? 'face' : ''}
              src={headshots.get(`legend:${tile.legend.slug}:${tile.displayId}`) ?? legendPortrait(tile.legend.slug)}
              alt={tile.legend.name}
              title={`${tile.legend.name}, ${tile.legend.title}`}
              draggable={false}
            />
            {/* The first name alone: the strip has no room for "Tyrande Whisperwind", and the plate says the rest. */}
            <span class="name">{tile.legend.name.split(' ')[0]}</span>
          </>
        ) : (
          <>
            {/* Each player's sex shows on their own cursor; otherwise the race's first. */}
            {(tile.kind === 'record' || tile.kind === 'saved') && headshots.has(faceKey(tile)) ? (
              <img class="face" src={headshots.get(faceKey(tile))} alt={nameOf(tile)} draggable={false} />
            ) : portraitOf(tile, here[0] ? players[0].sex : here[1] ? players[1].sex : tile.race.sexes[0] ?? 0) ? (
              <img src={portraitOf(tile, here[0] ? players[0].sex : here[1] ? players[1].sex : tile.race.sexes[0] ?? 0)} alt={tile.race.name} draggable={false} />
            ) : (
              <span class="noface">{tile.race.name}</span>
            )}
            {(tile.kind === 'record' || tile.kind === 'saved') && (
              <span class="name">
                {classKey && portraits.classes.get(classKey) && <img class="class" src={portraits.classes.get(classKey)} alt="" />}
                {nameOf(tile)}
              </span>
            )}
            {/* A built-in champion is not the player's to change; N still opens the creator on it, which says so. */}
            {tile.kind === 'saved' && !isBuiltin(tile.saved.id) && (
              <button
                type="button"
                class="edit"
                title={`Edit ${tile.saved.name} (N)`}
                onClick={(event) => {
                  event.stopPropagation();
                  setMaking({ who: online?.me ?? 0, editing: tile.saved });
                }}
              >
                EDIT
              </button>
            )}
          </>
        )}
      </div>
    );
  };

  /** The quality a tile's name and border are drawn in: legends legendary, your own epic, the races rare. */
  const qualityOf = (tile: Tile | undefined): Quality =>
    tile?.kind === 'legend' ? 'legendary' : tile?.kind === 'record' || tile?.kind === 'saved' || tile?.kind === 'create' ? 'epic' : tile?.kind === 'race' ? 'rare' : 'common';

  /** Each player's plate reads as the champion's tooltip, the way an item lists itself in a bag. */
  const plate = (who: 0 | 1) => {
    const player = players[who];
    const tile = tileAt(player.cursor);
    const champion = player.champion;
    const classId = champion?.classId ?? (tile?.kind === 'legend' ? tile.legend.classId : player.classId);
    const classEntry = classes.find((c) => c.id === classId);
    const classIcon = classEntry && portraits.classes.get(classEntry.key);
    const lines: Line[] = [];
    if (tile) {
      lines.push({ left: tile.kind === 'random' ? 'Random Champion' : tile.kind === 'create' ? 'Create Your Champion' : nameOf(tile), kind: 'name', hue: qualityOf(tile) });
      if (tile.kind === 'legend') lines.push({ left: 'Unique' });
      if (tile.kind === 'record' || tile.kind === 'saved') lines.push({ left: 'Soulbound' });
    }
    if (tile?.kind === 'create') {
      lines.push(
        { left: 'Use: Make a champion of your own: race, sex, class, look, armour and name. They join this row, ready to fight.', hue: 'green' },
        { kind: 'gap' },
        { left: '"Kept in this browser."', hue: 'gold' },
      );
    } else if (tile && tile.kind !== 'random') {
      const raceName = tile.kind === 'legend' ? (tile.race?.name ?? '') : tile.race.name;
      const sex = tile.kind === 'race' ? (sexFor(tile.race, player.sex) === 1 ? ' ♀' : ' ♂') : '';
      lines.push({
        left: `${raceName}${sex}`,
        right: (
          <>
            {classIcon && <img class="class" src={classIcon} alt="" />}
            {kitSpec(classId, player.built?.result.wielding ?? 'oneHand').className === 'CHAMPION' ? 'Champion' : (classEntry?.name ?? '')}
          </>
        ),
      });
      const weapon = player.built?.moves.weapon;
      if (weapon) {
        const speed = weapon.speed / 60;
        lines.push({ left: `${Number(weapon.damage.toFixed(1))} Damage`, right: `Speed ${speed.toFixed(2)}` });
        lines.push({ left: `(${(weapon.damage / speed).toFixed(1)} damage per second)` });
      }
      const kit = kitSpec(classId, player.built?.result.wielding ?? 'oneHand');
      lines.push({ left: `+${HP} Health` }, { left: `${RESOURCE_WORDS[kit.resource]}` });
      for (const ability of kit.abilities) {
        const tip = describeAbility(ability, kit.resource);
        lines.push({ left: `Use: ${ability.name}`, right: [tip.cost, tip.cooldown].filter(Boolean).join(', ') || tip.cast, hue: 'green', rightHue: 'grey' });
      }
      const faction = factionOf(tile);
      if (faction === 'alliance' || faction === 'horde') lines.push({ left: faction === 'alliance' ? 'Alliance' : 'Horde', hue: faction });
      if (tile.kind === 'legend') lines.push({ kind: 'gap' }, { left: `"${tile.legend.title}"`, hue: 'gold' });
    } else if (tile?.kind === 'random') {
      lines.push({ left: 'A champion is picked for you.', hue: 'gold' });
    } else if (!tile && champion) {
      // The other player's own champion, which this machine has no tile for.
      lines.push({ left: champion.name, kind: 'name', hue: 'epic' }, { left: 'Soulbound' }, { left: champion.title });
    }
    if (player.building && !player.built) lines.push({ left: BRAND.summoning, hue: 'grey', kind: 'small' });
    if (player.error) lines.push({ left: player.error, hue: 'red', kind: 'small' });
    const missing = player.built ? missingPieces(player.built.result.scene.problems) : [];
    if (missing.length > 0) lines.push({ left: `${missing.length} piece(s) not in this install: ${missing[0]}`, hue: 'red', kind: 'small' });
    return (
      <div class={`plate wow-tooltip ${who === 0 ? 'p1' : 'p2'} ${player.locked ? 'locked' : ''}`}>
        <div class="who">
          {online ? `PLAYER ${who + 1} · ${who === online.me ? 'YOU' : 'OPPONENT'}` : who === 0 ? 'PLAYER 1' : p2 === 'cpu' ? 'COMPUTER' : p2 === 'gamepad' ? 'PLAYER 2 · PAD' : 'PLAYER 2'}
        </div>
        {lines.map((line, i) =>
          line.kind === 'gap' ? (
            <div class="tt-gap" key={i} />
          ) : (
            <div class={`line ${line.kind ? `tt-${line.kind}` : ''} h-${line.hue ?? 'white'}`} key={i}>
              <span class="l">{line.left}</span>
              {line.right !== undefined && <span class={`r h-${line.rightHue ?? line.hue ?? 'white'}`}>{line.right}</span>}
            </div>
          ),
        )}
        {player.locked && <div class="stamp">{BRAND.chosen}</div>}
      </div>
    );
  };

  return (
    <div class={`screen select edition-${edition.key}`}>
      {art.backdrop && <div class="edition-backdrop" style={{ backgroundImage: `url(${art.backdrop})` }} aria-hidden="true" />}
      <div class="sides">
        <div class="side left">
          <Preview fighter={players[0].built} locked={players[0].locked} side="left" />
          {plate(0)}
        </div>
        {/* The logo and the call head the middle column, so the champions on either side stand the full height of the screen. */}
        <div class={`middle ${legendsOnly ? 'legends-only' : ''}`}>
        <header>
          <LogoArt small={!legendsOnly} />
          <div class="edition-mark" title={`${edition.game} ${edition.version}`}>
            <span class="glyph">{GLYPHS[edition.key]}</span>
            <span class="words">{edition.name.toUpperCase()}</span>
          </div>
          <h1>{BRAND.choose}</h1>
          {!online && <Presence online="O" />}
        </header>
        <div class={`grid ${legendsOnly ? 'legends-only' : ''}`}>
          <div class="label">{legends.length > 0 ? 'LEGENDS' : 'YOUR CHAMPIONS'}</div>
          <div
            class="tiles legends"
            // Legends only: two rows, widening as the champions made here join them, then a third.
            style={legendsOnly ? { gridTemplateColumns: `repeat(${Math.min(7, Math.max(4, Math.ceil(legendRow.length / 2)))}, minmax(0, 1fr))` } : undefined}
          >
            {legendRow.map((tile, i) => tileView(tile, 'legends', i))}
          </div>
          {!legendsOnly && (
          <>
          {champions.length > 0 && (
            <>
              <div class="label">YOUR CHARACTERS</div>
              <div class="tiles champions">{champions.map((tile, i) => tileView(tile, 'champions', i))}</div>
            </>
          )}
          <div class="label">THE RACES OF AZEROTH</div>
          <div class="tiles roster" style={{ gridTemplateColumns: `repeat(${COLUMNS}, 1fr)` }}>
            {roster.map((tile, i) => tileView(tile, 'roster', i))}
          </div>
          </>
          )}
        </div>
        </div>
        <div class="side right">
          <Preview fighter={players[1].built} locked={players[1].locked} side="right" />
          {plate(1)}
        </div>
      </div>
      {online ? (
        <footer class="controls">
          <span><b>ONLINE</b> room {online.code} · you are player {online.me + 1}</span>
          <span>{hint(0)}</span>
          <span><b>N</b> create / edit · <b>C</b> keys: {LAYOUT_WORDS[layout]} · <b>Esc</b> leave the room</span>
        </footer>
      ) : (
        <footer class="controls">
          <span><b>P1</b> {hint(0)}</span>
          <span><b>P2</b> {hint(1)}</span>
          <span><b>{padUse[0] ? 'X' : 'Tab'}</b> player 2: {p2} · <b>N</b> create / edit · <b>C</b> keys: {LAYOUT_WORDS[layout]} · <b>O</b> play online · <b>Esc</b> back</span>
          {others.length > 0 && (
            <button class="switch-edition" type="button" onClick={() => onEdition(others[0]!.product)}>
              <b>E</b> {editionOf(others[0]!.product, others[0]!.version).name}
            </button>
          )}
        </footer>
      )}
      {/* In the corner, as the game's own login screen gives its version. */}
      <div class="version">Version {import.meta.env.VITE_VERSION ?? 'dev'}</div>
      <p class="fine">A fan game, not made by or affiliated with Blizzard Entertainment. World of Warcraft is theirs; the fighters come from your own copy.</p>
      {making && (
        <Create
          races={races}
          classes={classes}
          portraits={portraits}
          fighters={fighters}
          saved={saved}
          editing={making.editing}
          onSave={keep}
          onDelete={discard}
          onCancel={() => setMaking(undefined)}
        />
      )}
    </div>
  );
}
