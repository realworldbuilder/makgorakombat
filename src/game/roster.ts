import type { ClassEntry, Race } from '@mogshot/character/appearance';
import type { ImportedRecord } from '@mogshot/import/record';
import type { CreatureLook } from '@mogshot/worker/api';
import type { SavedChampion } from './saved';

/*
 * The roster: every race the game lets you create, one tile each, in the character creation
 * screen's order with the Alliance first, then the neutral races, then the Horde; a random
 * tile; above them, the champions the player made on CREATE YOUR CHAMPION and their own
 * characters as the Mogshot addon captured them; and above those the legends: named Warcraft characters drawn as the game draws them.
 */

export type Faction = 'alliance' | 'horde' | 'neutral';

/** A named character of Warcraft, drawn from the game's own NPC look (a creature display built on a player model). */
export interface Legend {
  /** The portrait's file name under public/legends/ and the tile's key. */
  slug: string;
  name: string;
  title: string;
  faction: Faction;
  /**
   * Creature display ids for this character, the preferred look first; the first one the
   * open folder has, drawn on a player model, is used. Retail has the newer looks; the
   * classic beta only the old ones. A look with a model of its own (a dragon, a boss model)
   * cannot be built as a fighter, so it is not listed here; a legend with none is kept in
   * the list with a `note` saying why, and gets no tile.
   */
  displays: number[];
  /**
   * The legend's weapons, by item id, worn over the display's empty hands: kits in order of
   * preference, the first whose main hand the open folder has being worn. Retail's artifact
   * first, then the NPC weapon the classic files name ("Monster - Mace, Thrall's Hammer").
   */
  weapons?: WeaponKit[];
  /** The class whose kit the legend fights with (WoW class id: 1 warrior, 3 hunter, 5 priest, 7 shaman, 11 druid, 12 demon hunter). */
  classId?: number;
  note?: string;
}

export interface WeaponKit {
  mainHand?: number;
  offHand?: number;
}

export type Tile =
  | { kind: 'race'; id: string; race: Race }
  | { kind: 'record'; id: string; race: Race; record: ImportedRecord }
  | { kind: 'saved'; id: string; race: Race; saved: SavedChampion }
  | { kind: 'legend'; id: string; legend: Legend; displayId: number; raceId: number; sex: number; race: Race | undefined }
  | { kind: 'random'; id: 'random' }
  /** The question mark after the legends that opens CREATE YOUR CHAMPION. */
  | { kind: 'create'; id: 'create' };

export const CREATE_TILE: Tile = { kind: 'create', id: 'create' };

/**
 * The legends offered, in row order. Display ids checked on 24 Oct 2026 against the retail
 * client (12.1.5.70448) and the classic beta (1.60.1), each drawn on a player model: see the
 * README for how to check one. Most modern looks of these characters are unique models
 * (Jaina since Mists, Sylvanas and Anduin in retail, the Lich King), which the fighter path
 * cannot draw; they are listed with a note so the gap is a known one.
 */
export const LEGENDS: Legend[] = [
  // The white robe: Legion's Tyrande in retail, the original in the classic beta.
  { slug: 'tyrande', name: 'Tyrande Whisperwind', title: 'High Priestess of Elune', faction: 'alliance', displays: [73234, 7274], weapons: [{ mainHand: 266096 }, { mainHand: 260897 }], classId: 5 },
  // Retail's black-plate Thrall (npc 253222) and the classic one.
  { slug: 'thrall', name: 'Thrall', title: 'Warchief of the Horde', faction: 'horde', displays: [19015, 4527], weapons: [{ mainHand: 128819 }, { mainHand: 270931 }, { mainHand: 12183 }], classId: 7 },
  // Only the classic beta has her banshee queen look on a player model; every retail look is a model of her own.
  { slug: 'sylvanas', name: 'Sylvanas Windrunner', title: 'Banshee Queen', faction: 'horde', displays: [11657], weapons: [{ mainHand: 128826 }, { mainHand: 5259 }], classId: 3 },
  { slug: 'malfurion', name: 'Malfurion Stormrage', title: 'Archdruid', faction: 'alliance', displays: [127688, 39162], weapons: [{ mainHand: 128306 }], classId: 11 },
  // Before the Betrayer: the Moon Guard captain of the War of the Ancients. The demon hunter is a model of his own.
  { slug: 'illidan', name: 'Illidan Stormrage', title: 'Captain of the Moon Guard', faction: 'neutral', displays: [72623], weapons: [{ mainHand: 32837, offHand: 32838 }, { mainHand: 18583, offHand: 18584 }], classId: 12 },
  // Young Varian (npc 68925); King Varian is a model of his own.
  { slug: 'varian', name: 'Varian Wrynn', title: 'Prince of Stormwind', faction: 'alliance', displays: [47044], weapons: [{ mainHand: 253230 }], classId: 1 },
  { slug: 'cairne', name: 'Cairne Bloodhoof', title: 'High Chieftain', faction: 'horde', displays: [64785, 4307], weapons: [{ mainHand: 128808 }, { mainHand: 14084 }], classId: 1 },
  { slug: 'voljin', name: "Vol'jin", title: 'Darkspear Chieftain', faction: 'horde', displays: [10357], weapons: [{ mainHand: 280842 }, { mainHand: 14085 }], classId: 7 },
  { slug: 'jaina', name: 'Jaina Proudmoore', title: 'Lady of Theramore', faction: 'alliance', displays: [], note: 'Every look of hers the retail files name (87892, 80015, 46819 and the rest) is a model of her own; the classic Theramore look is not named in either install.' },
  { slug: 'arthas', name: 'Arthas Menethil', title: 'The Lich King', faction: 'neutral', displays: [], note: 'Prince Arthas (27545) and the Lich King (22234, 24191, 121920) are models of their own.' },
  { slug: 'garrosh', name: 'Garrosh Hellscream', title: 'Warchief', faction: 'horde', displays: [], note: 'His looks (32904, 56248, 87839) are models of their own; the Garrosh\'ar grunts are not him.' },
  { slug: 'anduin', name: 'Anduin Wrynn', title: 'King of Stormwind', faction: 'alliance', displays: [], note: 'Every Anduin from prince (44414) to king (82047, 115995) is a model of his own.' },
  { slug: 'velen', name: 'Prophet Velen', title: 'Leader of the Draenei', faction: 'alliance', displays: [], note: 'His looks (17822, 52926, 67048) are models of their own.' },
  { slug: 'grom', name: 'Grommash Hellscream', title: 'Chieftain of the Warsong', faction: 'horde', displays: [], note: 'His looks (53153, 71043, 86807) are models of their own.' },
];

/**
 * The legend tiles the open folder can draw: for each legend the first of its displays the
 * folder has on a player model. `looks` is what the worker found for every legend's ids.
 */
export function legendTiles(legends: readonly Legend[], looks: readonly CreatureLook[], races: readonly Race[]): Tile[] {
  const tiles: Tile[] = [];
  for (const legend of legends) {
    for (const displayId of legend.displays) {
      const look = looks.find((l) => l.id === displayId);
      if (!look?.humanoid) continue;
      const { raceId, sex } = look.humanoid;
      tiles.push({ kind: 'legend', id: `legend:${legend.slug}`, legend, displayId, raceId, sex, race: races.find((r) => r.id === raceId) });
      break;
    }
  }
  return tiles;
}

/** The faction a tile's border shows. */
export function factionOf(tile: Tile): Faction | 'unknown' | '' {
  if (tile.kind === 'random' || tile.kind === 'create') return '';
  if (tile.kind === 'legend') return tile.legend.faction;
  return tile.race.faction;
}

const FACTION_ORDER = { alliance: 0, neutral: 1, unknown: 1, horde: 2 } as const;

export function rosterTiles(races: readonly Race[]): Tile[] {
  const sorted = [...races].sort((a, b) => FACTION_ORDER[a.faction] - FACTION_ORDER[b.faction] || a.order - b.order || a.name.localeCompare(b.name));
  return [...sorted.map((race): Tile => ({ kind: 'race', id: `race:${race.id}`, race })), { kind: 'random', id: 'random' }];
}

/** The player's characters that are of a race the roster has, newest capture first as the addon lists them. */
export function championTiles(records: readonly ImportedRecord[], races: readonly Race[]): Tile[] {
  const tiles: Tile[] = [];
  for (const record of records) {
    const race = races.find((r) => r.id === record.raceId) ?? races.find((r) => r.file.toLowerCase() === record.race.toLowerCase());
    if (race) tiles.push({ kind: 'record', id: `record:${record.key}`, race, record });
  }
  return tiles;
}

/** The classes a race can be, in the game's order. */
export function classesOf(race: Race, classes: readonly ClassEntry[]): ClassEntry[] {
  return classes.filter((c) => c.races.includes(race.id));
}

/** The class next to `classId` among those a race can be, wrapping; the first when the class is not one of them. */
export function cycleClass(race: Race, classes: readonly ClassEntry[], classId: number | undefined, step: 1 | -1): number | undefined {
  const allowed = classesOf(race, classes);
  if (allowed.length === 0) return undefined;
  const at = allowed.findIndex((c) => c.id === classId);
  if (at < 0) return allowed[0]!.id;
  return allowed[(at + step + allowed.length) % allowed.length]!.id;
}

/** A sex the race has a model for, keeping the player's choice when it has both. */
export function sexFor(race: Race, wanted: number): number {
  return race.sexes.includes(wanted) ? wanted : (race.sexes[0] ?? 0);
}

/** A tile other than the random one and the creator's, chosen with a step of the match's generator so a rematch can differ. */
export function randomTile(tiles: readonly Tile[], draw: () => number): Tile | undefined {
  const picks = tiles.filter((tile) => tile.kind !== 'random' && tile.kind !== 'create');
  if (picks.length === 0) return undefined;
  return picks[Math.floor(draw() * picks.length) % picks.length];
}

/** The grid position of a tile index in a grid `columns` wide. */
export const gridMove = (index: number, count: number, columns: number, dx: number, dy: number): number => {
  if (count === 0) return 0;
  const rows = Math.ceil(count / columns);
  let row = Math.floor(index / columns);
  let column = index % columns;
  column = (column + dx + columns) % columns;
  row = (row + dy + rows) % rows;
  let next = row * columns + column;
  // Off the end of a short last row: come round to its start, or back up a row.
  if (next >= count) next = dy !== 0 ? row * columns : count - 1;
  return next;
};
