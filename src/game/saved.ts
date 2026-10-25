import type { ClassEntry, Race } from '@mogshot/character/appearance';
import type { Slot } from '@mogshot/character/equipment';
import type { Champion } from './fighters';
import type { Tile } from './roster';

/*
 * The champions the player has made on CREATE YOUR CHAMPION, kept in this browser: a list under
 * one key, each entry what the worker builds from (race, sex, class, the appearance choices the
 * player changed and the gear by item id) and the name it fights under. Every read and write
 * goes through try/catch, since storage can be full, blocked or hold something else.
 */

export interface SavedChampion {
  /** Stable for the life of the champion, so an edit replaces it and a delete finds it. */
  id: string;
  name: string;
  raceId: number;
  sex: number;
  classId: number | undefined;
  /** Only the options the player changed, by option id; the rest are the model's defaults. */
  choices: [number, number][];
  gear: [Slot, number][];
  /** What the gear came from, for the creator to show: a set's name, or 'Random'. */
  armour?: string;
}

export const SAVED_STORAGE = 'makgora.champions';
/** As many letters as the game allows in a name. */
export const NAME_LENGTH = 12;

/** The slice of Storage this needs, so the tests can hand in a map. */
export type Store = Pick<Storage, 'getItem' | 'setItem'>;

const browserStore = (): Store | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

const SLOTS = new Set<string>(['head', 'shoulder', 'back', 'chest', 'shirt', 'tabard', 'wrist', 'hands', 'waist', 'legs', 'feet', 'mainHand', 'offHand']);
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const pairs = (value: unknown): value is [unknown, unknown][] => Array.isArray(value) && value.every((pair) => Array.isArray(pair) && pair.length === 2);

/** One stored entry, or undefined when it is not one (an older shape, a hand edit). */
export function parseSaved(value: unknown): SavedChampion | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== 'string' || typeof entry.name !== 'string' || !whole(entry.raceId) || !whole(entry.sex)) return undefined;
  if (entry.classId !== undefined && entry.classId !== null && !whole(entry.classId)) return undefined;
  if (!pairs(entry.choices) || !entry.choices.every(([option, choice]) => whole(option) && whole(choice))) return undefined;
  if (!pairs(entry.gear) || !entry.gear.every(([slot, item]) => typeof slot === 'string' && SLOTS.has(slot) && whole(item))) return undefined;
  return {
    id: entry.id,
    name: cleanName(entry.name) || 'Champion',
    raceId: entry.raceId,
    sex: entry.sex,
    classId: whole(entry.classId) ? entry.classId : undefined,
    choices: entry.choices as [number, number][],
    gear: entry.gear as [Slot, number][],
    ...(typeof entry.armour === 'string' && { armour: entry.armour }),
  };
}

/** The saved champions, oldest first; none when there are none or they cannot be read. */
export function loadSaved(store: Store | undefined = browserStore()): SavedChampion[] {
  try {
    const raw = store?.getItem(SAVED_STORAGE);
    if (!raw) return [];
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.flatMap((entry) => parseSaved(entry) ?? []);
  } catch {
    return [];
  }
}

/** Keep the list; false when the browser would not (full, or storage blocked), and the list then lasts for this visit. */
export function storeSaved(list: readonly SavedChampion[], store: Store | undefined = browserStore()): boolean {
  try {
    if (!store) return false;
    store.setItem(SAVED_STORAGE, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** The list with `champion` in it: in its old place when it was there, at the end when it is new. */
export function withSaved(list: readonly SavedChampion[], champion: SavedChampion): SavedChampion[] {
  const at = list.findIndex((entry) => entry.id === champion.id);
  if (at < 0) return [...list, champion];
  return list.map((entry, i) => (i === at ? champion : entry));
}

export function withoutSaved(list: readonly SavedChampion[], id: string): SavedChampion[] {
  return list.filter((entry) => entry.id !== id);
}

export function newSavedId(now = Date.now(), draw = Math.random): string {
  return `${now.toString(36)}${Math.floor(draw() * 36 ** 4).toString(36).padStart(4, '0')}`;
}

/** A name as the game takes one: letters only, at most twelve, a capital and then small letters. */
export function cleanName(text: string): string {
  const letters = [...text.normalize('NFC')].filter((char) => /\p{L}/u.test(char)).slice(0, NAME_LENGTH).join('');
  return letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase();
}

/** The name a new champion of a race starts with: the race's own ("Night Elf" is Nightelf). */
export const defaultName = (race: Race): string => cleanName(race.name);

/** A short fingerprint of a look, for keys. FNV-1a over the text. */
const fingerprint = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(36);
};

/**
 * The build key of a made champion: what it is built from and nothing else, so the creator's
 * preview and the roster's tile share one build in the cache, and an edit that changes the look
 * gets a fresh one (and a fresh face). The name is not in it.
 */
export function madeKey(raceId: number, sex: number, classId: number | undefined, choices: readonly [number, number][], gear: readonly [Slot, number][]): string {
  const look = [...choices].sort((a, b) => a[0] - b[0]).map(([o, c]) => `${o}=${c}`).join(',');
  const worn = [...gear].sort((a, b) => a[0].localeCompare(b[0])).map(([s, i]) => `${s}=${i}`).join(',');
  return `made:${raceId}:${sex}:${classId ?? 0}:${fingerprint(`${look}|${worn}`)}`;
}

/** The champion a saved entry builds as. */
export function savedChampion(saved: SavedChampion, race: Race, classes: readonly ClassEntry[]): Champion {
  const className = classes.find((c) => c.id === saved.classId)?.name.toUpperCase() ?? '';
  return {
    key: madeKey(saved.raceId, saved.sex, saved.classId, saved.choices, saved.gear),
    name: saved.name.toUpperCase(),
    title: `${race.name.toUpperCase()} ${className}`.trim(),
    raceId: saved.raceId,
    sex: saved.sex,
    classId: saved.classId,
    choices: saved.choices.map(([o, c]) => [o, c]),
    gear: saved.gear.map(([s, i]) => [s, i]),
  };
}

/** The saved champions whose race the open folder has, as roster tiles, in the order made. */
export function savedTiles(list: readonly SavedChampion[], races: readonly Race[]): Tile[] {
  return list.flatMap((saved): Tile[] => {
    const race = races.find((r) => r.id === saved.raceId);
    return race ? [{ kind: 'saved', id: `saved:${saved.id}`, race, saved }] : [];
  });
}
