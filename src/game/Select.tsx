import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ClassEntry, Race } from '@mogshot/character/appearance';
import type { BuildInfoEntry } from '@mogshot/casc/build-info';
import type { ImportedRecord } from '@mogshot/import/record';
import { BRAND } from '../engine/brand';
import { GLYPHS } from './ActionBar';
import { type Edition, editionOf } from './edition';
import type { EditionArt } from './editionArt';
import { type BuiltFighter, type Champion, type Fighters } from './fighters';
import { headshotOf, storedHeadshot } from './headshot';
import { Preview } from './Preview';
import { championTiles, classesOf, cycleClass, factionOf, gridMove, randomTile, rosterTiles, sexFor, type Tile } from './roster';
import { Guide, type GuidePage } from './Guide';
import { LogoArt } from './Title';
import { kitSpec, type ResourceKind } from '../engine/abilities';
import { HP } from '../engine/stage';
import { describeAbility } from './ui/describe';
import type { Line, Quality } from './ui/WowTooltip';

const RESOURCE_WORDS: Record<ResourceKind, string> = { rage: 'Rage: builds in combat', energy: '+100 Energy', mana: '+100 Mana', focus: '+100 Focus', runic: 'Runic Power: builds in combat', fury: 'Fury: builds in combat' };

/*
 * CHOOSE YOUR CHAMPION. Every race on a grid of the game's own portraits, the player's own
 * characters in a row above, the legends in a row above those, both players' cursors on it
 * at once, each champion drawn full size on its player's side as soon as the cursor rests
 * on it. The screen is dressed as the open game's edition: its name under our logo, one of its
 * loading screens behind, its colours; E switches to another game in the same folder.
 */

export type Source = 'keyboard' | 'gamepad' | 'cpu';

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
  p2: Source;
  onP2: (source: Source) => void;
  onReady: (fighters: [BuiltFighter, BuiltFighter]) => void;
  onBack: () => void;
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
/** Only the legends on the select screen. */
const LEGENDS_ONLY = true;
const HOVER_MS = 200;

const KEYS: Record<number, Record<string, 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'sex' | 'classPrev' | 'classNext'>> = {
  0: { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right', KeyJ: 'confirm', KeyH: 'back', KeyU: 'sex', KeyK: 'classPrev', KeyL: 'classNext' },
  1: {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Numpad1: 'confirm', Comma: 'confirm', Numpad4: 'back', KeyM: 'back',
    Numpad0: 'sex', ShiftRight: 'sex', Numpad2: 'classPrev', Period: 'classPrev', Numpad3: 'classNext', Slash: 'classNext',
  },
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

export function Select({ edition, art, others, onEdition, races, classes, records, legends, portraits, fighters, p2, onP2, onReady, onBack }: SelectProps) {
  const roster = useMemo(() => rosterTiles(races), [races]);
  const champions = useMemo(() => championTiles(records, races), [records, races]);
  // The rows from the top, leaving out the empty ones; the cursor moves up and down through them.
  // For now the ring is for the legends only (William, 24 Oct 2026); the races and your own
  // characters come back by setting LEGENDS_ONLY to false. An install with no legend the game
  // can draw still gets the full roster rather than an empty screen.
  const legendsOnly = LEGENDS_ONLY && legends.length > 0;
  const zones = useMemo(() => {
    const rows: { zone: Cursor['zone']; tiles: Tile[] }[] = [];
    if (legends.length > 0) rows.push({ zone: 'legends', tiles: legends });
    if (legendsOnly) return rows;
    if (champions.length > 0) rows.push({ zone: 'champions', tiles: champions });
    rows.push({ zone: 'roster', tiles: roster });
    return rows;
  }, [legends, champions, roster, legendsOnly]);
  /** Where the computer and a random pick choose from: the legends alone, or the races. */
  const pool: { zone: Cursor['zone']; tiles: Tile[] } = legendsOnly ? { zone: 'legends', tiles: legends } : { zone: 'roster', tiles: roster };
  // The ring opens on Tyrande against Thrall when the folder has them; otherwise on the roster.
  const [guide, setGuide] = useState<GuidePage>();
  const [players, setPlayers] = useState<[Player, Player]>(() => {
    const opening = (slug: string, sex: number): Player => {
      const index = legends.findIndex((tile) => tile.kind === 'legend' && tile.legend.slug === slug);
      const player = freshPlayer(sex);
      return index >= 0 ? { ...player, cursor: { zone: 'legends', index } } : player;
    };
    return [opening('tyrande', 1), opening('thrall', 0)];
  });
  const playersRef = useRef(players);
  playersRef.current = players;
  // Each champion's own face by its key, drawn from the built model; the legends' and the player's own are drawn ahead of time.
  const [headshots, setHeadshots] = useState<Map<string, string>>(() => new Map());
  const face = (built: BuiltFighter) => {
    const url = headshotOf(built);
    if (url) setHeadshots((current) => (current.get(built.champion.key) === url ? current : new Map(current).set(built.champion.key, url)));
  };
  const guideRef = useRef(guide);
  guideRef.current = guide;
  const p2Ref = useRef(p2);
  p2Ref.current = p2;
  const othersRef = useRef(others);
  othersRef.current = others;
  // Each player's newest build request; older ones that finish late are dropped.
  const requests = useRef([0, 0]);
  const rng = useRef(Date.now() >>> 0);
  const draw = () => {
    rng.current = (Math.imul(rng.current, 1664525) + 1013904223) >>> 0;
    return rng.current / 4294967296;
  };

  const tilesOf = (zone: Cursor['zone']): Tile[] => (zone === 'legends' ? legends : zone === 'champions' ? champions : roster);
  const tileAt = (cursor: Cursor): Tile | undefined => tilesOf(cursor.zone)[cursor.index];

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
    if (!tile || tile.kind === 'random') return { ...player, champion: undefined, built: undefined, building: false, error: undefined };
    const sex = tile.kind === 'record' ? tile.record.sex : tile.kind === 'legend' ? tile.sex : sexFor(tile.race, player.sex);
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
      if (player.locked || player.built?.champion.key === keyOf(tileAt(player.cursor), player)) return undefined;
      return setTimeout(() => update(who as 0 | 1, (p) => summon(who as 0 | 1, p)), HOVER_MS);
    });
    return () => timers.forEach((timer) => timer !== undefined && clearTimeout(timer));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players[0].cursor, players[0].sex, players[0].classId, players[1].cursor, players[1].sex, players[1].classId]);

  // Every legend and every champion of the player's own gets its face drawn in the background, one at a
  // time, waiting whenever a player's own summon is in flight so the cursor never queues behind it.
  useEffect(() => {
    let stopped = false;
    const wanted = [...legends, ...champions].filter((tile) => tile.kind === 'legend' || tile.kind === 'record');
    const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    void (async () => {
      await pause(800);
      for (const tile of wanted) {
        if (stopped) return;
        if (tile.kind !== 'legend' && tile.kind !== 'record') continue;
        const key = tile.kind === 'record' ? `record:${tile.record.key}` : `legend:${tile.legend.slug}:${tile.displayId}`;
        const stored = storedHeadshot(key);
        if (stored) {
          setHeadshots((current) => (current.has(key) ? current : new Map(current).set(key, stored)));
          continue;
        }
        while (!stopped && playersRef.current.some((player) => player.building)) await pause(250);
        if (stopped) return;
        try {
          const champion = await fighters.champion(tile, tile.kind === 'record' ? tile.record.sex : tile.sex, undefined);
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
  }, [legends, champions]);

  const keyOf = (tile: Tile | undefined, player: Player) => {
    if (!tile || tile.kind === 'random') return undefined;
    if (tile.kind === 'record') return `record:${tile.record.key}`;
    if (tile.kind === 'legend') return `legend:${tile.legend.slug}:${tile.displayId}`;
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

  const confirm = (who: 0 | 1) =>
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

  // Keys: both players on one keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (guideRef.current) return;
      if (event.code === 'Escape') {
        const [a, b] = playersRef.current;
        if (a.locked || b.locked) setPlayers([{ ...a, locked: false }, { ...b, locked: false }]);
        else onBack();
        return;
      }
      // Another game in the same folder: its own edition of the ring, read afresh.
      if (event.code === 'KeyE' && othersRef.current.length > 0) {
        event.preventDefault();
        onEdition(othersRef.current[0]!.product);
        return;
      }
      if (event.code === 'Tab') {
        event.preventDefault();
        const order: Source[] = ['keyboard', 'cpu', 'gamepad'];
        onP2(order[(order.indexOf(p2Ref.current) + 1) % order.length]!);
        return;
      }
      for (const who of [0, 1] as const) {
        const action = KEYS[who]![event.code];
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
  }, [roster, champions, legends, classes]);

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

  // Both locked and both built: into the ring.
  useEffect(() => {
    const [a, b] = players;
    if (!(a.locked && b.locked && a.built && b.built)) return;
    if (a.built.champion.key !== keyOf(tileAt(a.cursor), a) || b.built.champion.key !== keyOf(tileAt(b.cursor), b)) return;
    const timer = setTimeout(() => onReady([a.built!, b.built!]), 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players]);

  /**
   * The builder's problems that are files this install lacks. The rest (a texture the game data
   * names but the game draws without, a piece drawn another way) the builder recovers from, and
   * the plate says nothing of them; the full list stays in the status line's title.
   */
  const missingPieces = (problems: readonly string[]) => problems.filter((problem) => /is not installed|is not part of this build|^No painted body/.test(problem));

  const portraitOf = (tile: Tile, sex: number) => {
    if (tile.kind === 'random') return undefined;
    if (tile.kind === 'legend') return legendPortrait(tile.legend.slug);
    return portraits.races.get(`${tile.race.key}:${tile.kind === 'record' ? tile.record.sex : sexFor(tile.race, sex)}`);
  };
  const nameOf = (tile: Tile) => (tile.kind === 'random' ? 'RANDOM' : tile.kind === 'record' ? tile.record.name : tile.kind === 'legend' ? tile.legend.name : tile.race.name);

  const tileView = (tile: Tile, zone: Cursor['zone'], index: number) => {
    const here = players.map((player) => player.cursor.zone === zone && player.cursor.index === index);
    const classKey = tile.kind === 'record' ? classes.find((c) => c.id === tile.record.classId)?.key : undefined;
    return (
      <div
        key={tile.id}
        class={`tile ${tile.kind} ${factionOf(tile)} ${here[0] ? 'p1' : ''} ${here[1] ? 'p2' : ''} ${here[0] && players[0].locked ? 'locked1' : ''} ${here[1] && players[1].locked ? 'locked2' : ''}`}
        onClick={() => update(0, (p) => (p.locked ? p : { ...p, cursor: { zone, index } }))}
      >
        {tile.kind === 'random' ? (
          <span class="random">?</span>
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
            {tile.kind === 'record' && headshots.has(`record:${tile.record.key}`) ? (
              <img class="face" src={headshots.get(`record:${tile.record.key}`)} alt={tile.record.name} draggable={false} />
            ) : portraitOf(tile, here[0] ? players[0].sex : here[1] ? players[1].sex : tile.race.sexes[0] ?? 0) ? (
              <img src={portraitOf(tile, here[0] ? players[0].sex : here[1] ? players[1].sex : tile.race.sexes[0] ?? 0)} alt={tile.race.name} draggable={false} />
            ) : (
              <span class="noface">{tile.race.name}</span>
            )}
            {tile.kind === 'record' && (
              <span class="name">
                {classKey && portraits.classes.get(classKey) && <img class="class" src={portraits.classes.get(classKey)} alt="" />}
                {tile.record.name}
              </span>
            )}
          </>
        )}
      </div>
    );
  };

  /** The quality a tile's name and border are drawn in: legends legendary, your own epic, the races rare. */
  const qualityOf = (tile: Tile | undefined): Quality => (tile?.kind === 'legend' ? 'legendary' : tile?.kind === 'record' ? 'epic' : tile?.kind === 'race' ? 'rare' : 'common');

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
      lines.push({ left: tile.kind === 'random' ? 'Random Champion' : nameOf(tile), kind: 'name', hue: qualityOf(tile) });
      if (tile.kind === 'legend') lines.push({ left: 'Unique' });
      if (tile.kind === 'record') lines.push({ left: 'Soulbound' });
    }
    if (tile && tile.kind !== 'random') {
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
        lines.push({ left: `${weapon.damage} Damage`, right: `Speed ${speed.toFixed(2)}` });
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
    }
    if (player.building && !player.built) lines.push({ left: BRAND.summoning, hue: 'grey', kind: 'small' });
    if (player.error) lines.push({ left: player.error, hue: 'red', kind: 'small' });
    const missing = player.built ? missingPieces(player.built.result.scene.problems) : [];
    if (missing.length > 0) lines.push({ left: `${missing.length} piece(s) not in this install: ${missing[0]}`, hue: 'red', kind: 'small' });
    return (
      <div class={`plate wow-tooltip ${who === 0 ? 'p1' : 'p2'} ${player.locked ? 'locked' : ''}`}>
        <div class="who">{who === 0 ? 'PLAYER 1' : p2 === 'cpu' ? 'COMPUTER' : p2 === 'gamepad' ? 'PLAYER 2 · PAD' : 'PLAYER 2'}</div>
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
        </header>
        <div class={`grid ${legendsOnly ? 'legends-only' : ''}`}>
          {legends.length > 0 && (
            <>
              <div class="label">LEGENDS</div>
              <div class="tiles legends">{legends.map((tile, i) => tileView(tile, 'legends', i))}</div>
            </>
          )}
          {!legendsOnly && (
          <>
          <div class="label">YOUR CHAMPIONS</div>
          <div class="tiles champions">
            {champions.map((tile, i) => tileView(tile, 'champions', i))}
            <button class="tile create" type="button" onClick={() => setGuide('champion')} title="How to get your own characters into the ring">
              <span class="plus">+</span>
              {champions.length > 0 ? 'ADD A CHAMPION' : 'CREATE YOUR CHAMPION'}
            </button>
          </div>
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
      <footer class="controls">
        <span><b>P1</b> WASD move · J choose · H back{legendsOnly ? '' : ' · U ♂/♀ · K/L class'}</span>
        <span><b>P2</b> arrows · , or Num1 choose · M back{legendsOnly ? '' : ' · Right Shift ♂/♀ · . / class'}</span>
        <span><b>Tab</b> player 2: {p2} · <b>Esc</b> back</span>
        {others.length > 0 && (
          <button class="switch-edition" type="button" onClick={() => onEdition(others[0]!.product)}>
            <b>E</b> {editionOf(others[0]!.product, others[0]!.version).name}
          </button>
        )}
      </footer>
      {guide && <Guide page={guide} onPage={setGuide} onClose={() => setGuide(undefined)} />}
    </div>
  );
}
