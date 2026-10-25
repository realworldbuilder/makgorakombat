import { describe, expect, it } from 'vitest';
import type { ClassEntry, Race } from '@mogshot/character/appearance';
import {
  cleanName,
  defaultName,
  loadSaved,
  madeKey,
  newSavedId,
  SAVED_STORAGE,
  type SavedChampion,
  savedChampion,
  savedTiles,
  type Store,
  storeSaved,
  withoutSaved,
  withSaved,
} from '../../src/game/saved';
import { CREATE_TILE, factionOf, randomTile } from '../../src/game/roster';

const race = (id: number, name: string, faction: Race['faction']): Race => ({ id, name, key: name.toLowerCase(), file: name, faction, order: id, sexes: [0, 1] } as unknown as Race);
const RACES = [race(4, 'Night Elf', 'alliance'), race(2, 'Orc', 'horde')];
const CLASSES: ClassEntry[] = [
  { id: 1, name: 'Warrior', key: 'warrior', races: [2, 4] },
  { id: 11, name: 'Druid', key: 'druid', races: [4] },
];

const memory = (): Store & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
};

const thraka: SavedChampion = {
  id: 'abc',
  name: 'Thraka',
  raceId: 2,
  sex: 1,
  classId: 1,
  choices: [[17, 120], [3, 44]],
  gear: [['chest', 22416], ['mainHand', 21134]],
  armour: "Dreadnaught's Battlegear",
};

describe('saved champions', () => {
  it('build as a champion of their race and class under their own name', () => {
    const champion = savedChampion(thraka, RACES[1]!, CLASSES);
    expect(champion).toEqual({
      key: madeKey(2, 1, 1, thraka.choices, thraka.gear),
      name: 'THRAKA',
      title: 'ORC WARRIOR',
      raceId: 2,
      sex: 1,
      classId: 1,
      choices: [[17, 120], [3, 44]],
      gear: [['chest', 22416], ['mainHand', 21134]],
    });
    // The champion's lists are its own: the fighter cache may change its gear.
    expect(champion.gear).not.toBe(thraka.gear);
  });

  it('key on the look alone, whatever order the choices are in and whatever the name', () => {
    const a = madeKey(2, 1, 1, [[17, 120], [3, 44]], [['chest', 1], ['legs', 2]]);
    expect(madeKey(2, 1, 1, [[3, 44], [17, 120]], [['legs', 2], ['chest', 1]])).toBe(a);
    expect(madeKey(2, 1, 1, [[3, 45], [17, 120]], [['legs', 2], ['chest', 1]])).not.toBe(a);
    expect(madeKey(2, 0, 1, [[3, 44], [17, 120]], [['legs', 2], ['chest', 1]])).not.toBe(a);
    expect(savedChampion({ ...thraka, name: 'Other' }, RACES[1]!, CLASSES).key).toBe(savedChampion(thraka, RACES[1]!, CLASSES).key);
    expect(a.startsWith('made:2:1:1:')).toBe(true);
  });

  it('become tiles of the races the folder has, in the order made', () => {
    const elf: SavedChampion = { ...thraka, id: 'def', name: 'Leafy', raceId: 4, classId: 11 };
    const lost: SavedChampion = { ...thraka, id: 'ghi', raceId: 99 };
    const tiles = savedTiles([elf, lost, thraka], RACES);
    expect(tiles.map((tile) => tile.id)).toEqual(['saved:def', 'saved:abc']);
    expect(tiles.map(factionOf)).toEqual(['alliance', 'horde']);
    expect(tiles[0]?.kind === 'saved' && tiles[0].race.name).toBe('Night Elf');
  });

  it('go through storage and come back the same', () => {
    const store = memory();
    expect(loadSaved(store)).toEqual([]);
    const list = withSaved(withSaved([], thraka), { ...thraka, id: 'def', name: 'Second', classId: undefined, armour: undefined });
    expect(storeSaved(list, store)).toBe(true);
    expect(store.data.has(SAVED_STORAGE)).toBe(true);
    const back = loadSaved(store);
    expect(back).toHaveLength(2);
    expect(back[0]).toEqual(thraka);
    expect(back[1]).toMatchObject({ id: 'def', name: 'Second', classId: undefined });
  });

  it('replace an edited champion in its place and drop a deleted one', () => {
    const second = { ...thraka, id: 'def' };
    const list = withSaved(withSaved([], thraka), second);
    const edited = withSaved(list, { ...thraka, name: 'Renamed' });
    expect(edited.map((c) => [c.id, c.name])).toEqual([['abc', 'Renamed'], ['def', 'Thraka']]);
    expect(withoutSaved(edited, 'abc').map((c) => c.id)).toEqual(['def']);
  });

  it('read nothing from storage that is broken, blocked or full', () => {
    const store = memory();
    store.data.set(SAVED_STORAGE, '{not json');
    expect(loadSaved(store)).toEqual([]);
    store.data.set(SAVED_STORAGE, JSON.stringify({ id: 'abc' }));
    expect(loadSaved(store)).toEqual([]);
    // A hand-edited entry is dropped and the good one kept.
    store.data.set(SAVED_STORAGE, JSON.stringify([{ ...thraka, gear: [['pocket', 1]] }, { id: 'x' }, thraka]));
    expect(loadSaved(store)).toEqual([thraka]);
    const blocked: Store = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(loadSaved(blocked)).toEqual([]);
    expect(storeSaved([thraka], blocked)).toBe(false);
    expect(storeSaved([thraka], undefined)).toBe(false);
  });

  it('take names as the game does', () => {
    expect(cleanName('  thr4ka the GREAT  ')).toBe('Thrkathegrea');
    expect(cleanName('Zul\'jin')).toBe('Zuljin');
    expect(cleanName('élodïe')).toBe('Élodïe');
    expect(cleanName('123')).toBe('');
    expect(defaultName(RACES[0]!)).toBe('Nightelf');
  });

  it('get ids that differ', () => {
    expect(newSavedId(1000, () => 0.1)).not.toBe(newSavedId(1000, () => 0.2));
  });
});

describe('the creator\'s question mark', () => {
  it('is never a random pick and has no faction', () => {
    const tiles = [CREATE_TILE, ...savedTiles([thraka], RACES), CREATE_TILE];
    for (const draw of [0, 0.3, 0.6, 0.99]) expect(randomTile(tiles, () => draw)?.kind).toBe('saved');
    expect(randomTile([CREATE_TILE], () => 0.5)).toBeUndefined();
    expect(factionOf(CREATE_TILE)).toBe('');
  });
});
