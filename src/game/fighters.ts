import type { ClassEntry } from '@mogshot/character/appearance';
import type { ItemSetInfo, ItemSummary, Slot } from '@mogshot/character/equipment';
import { posableRig, type PosableRig } from '@mogshot/model/posable';
import type { FighterResult, FightSoundSet } from '@mogshot/worker/api';
import type { DataClient } from '@mogshot/worker/client';
import { ALL_MOVE_NAMES, type MoveTable, resolveMoves } from '../engine/moves';
import { type FighterFx, loadFighterFx } from './fx';
import type { Tile, WeaponKit } from './roster';
import { savedChampion } from './saved';

/*
 * From a tile on the roster to a fighter in the ring: who to build (race, sex, class, gear),
 * the build itself in the worker, and the built fighter kept for the fight. Builds take a
 * second or so each, so the last few are kept while the players browse.
 */

/** Who a player has chosen, resolved to what the worker builds. */
export interface Champion {
  /** Stable key of the build, for the cache. */
  key: string;
  /** "NIGHT ELF" / "Scarletfire" / "TYRANDE WHISPERWIND" and "DRUID" / "HIGH PRIESTESS OF ELUNE". */
  name: string;
  title: string;
  raceId: number;
  sex: number;
  classId: number | undefined;
  choices: [number, number][];
  gear: [Slot, number][];
  /** A legend: the creature display the worker builds as the game draws it; raceId and sex are then its. */
  npc?: number;
}

export interface BuiltFighter {
  champion: Champion;
  result: FighterResult;
  rig: PosableRig;
  moves: MoveTable;
  /** The fighter's sounds, read after the build; undefined when they could not be. */
  sounds: Promise<FightSoundSet | undefined>;
  /** The game's models of the fighter's spells, read the first time they are asked for; none when they could not be. */
  fx: () => Promise<FighterFx>;
}

const KEEP = 8;

export class Fighters {
  private readonly built = new Map<string, Promise<BuiltFighter>>();
  private readonly sets = new Map<number, Promise<ItemSetInfo[]>>();
  private readonly found = new Map<string, Promise<boolean>>();

  constructor(private readonly client: DataClient, private readonly classes: readonly ClassEntry[]) {}

  /** The champion a tile stands for with the player's sex and class choices applied. */
  async champion(tile: Tile, sex: number, classId: number | undefined): Promise<Champion | undefined> {
    if (tile.kind === 'random' || tile.kind === 'create') return undefined;
    if (tile.kind === 'legend') {
      return {
        key: `legend:${tile.legend.slug}:${tile.displayId}`,
        name: tile.legend.name.toUpperCase(),
        title: tile.legend.title.toUpperCase(),
        raceId: tile.raceId,
        sex: tile.sex,
        classId: tile.legend.classId,
        choices: [],
        // The display's hands are empty: the legend's own weapons go in them, as this folder has them.
        gear: await this.weaponKit(tile.legend.weapons ?? []),
        npc: tile.displayId,
      };
    }
    if (tile.kind === 'saved') return savedChampion(tile.saved, tile.race, this.classes);
    const className = (id: number | undefined) => this.classes.find((c) => c.id === id)?.name.toUpperCase() ?? '';
    if (tile.kind === 'record') {
      const imported = await this.client.resolveImport(tile.record);
      return {
        key: `record:${tile.record.key}`,
        name: tile.record.name.toUpperCase(),
        title: `${tile.race.name.toUpperCase()} ${className(imported.classId ?? tile.record.classId)}`.trim(),
        raceId: tile.race.id,
        sex: imported.sex,
        classId: imported.classId ?? tile.record.classId,
        choices: imported.choices,
        gear: imported.gear.map(([slot, item]) => [slot, item.id]),
      };
    }
    const gear = classId === undefined ? [] : await this.bestKit(classId);
    return {
      key: `race:${tile.race.id}:${sex}:${classId ?? 0}`,
      name: tile.race.name.toUpperCase(),
      title: className(classId),
      raceId: tile.race.id,
      sex,
      classId,
      choices: [],
      gear,
    };
  }

  /** Whether the open folder has an item that can be worn in a slot. */
  private has(slot: Slot, id: number): Promise<boolean> {
    const key = `${slot}:${id}`;
    let found = this.found.get(key);
    if (!found) {
      found = this.client.searchItems(slot, String(id)).then((result) => result.items.some((item) => item.id === id), () => false);
      this.found.set(key, found);
    }
    return found;
  }

  /** The first of a legend's weapon kits whose every item the folder has, as item ids by slot; empty when none. */
  private async weaponKit(kits: readonly WeaponKit[]): Promise<[Slot, number][]> {
    for (const kit of kits) {
      const gear = (Object.entries(kit) as [Slot, number | undefined][]).flatMap(([slot, id]) => (id ? [[slot, id] as [Slot, number]] : []));
      if (gear.length === 0) continue;
      if ((await Promise.all(gear.map(([slot, id]) => this.has(slot, id)))).every(Boolean)) return gear;
    }
    return [];
  }

  /** The class's sets, as the worker lists them, read once per class. */
  setsOf(classId: number): Promise<ItemSetInfo[]> {
    let sets = this.sets.get(classId);
    if (!sets) {
      sets = this.client.sets(classId);
      sets.catch(() => this.sets.delete(classId));
      this.sets.set(classId, sets);
    }
    return sets;
  }

  /** An outfit drawn at random from the items of at least `minQuality` (4 is epic), for the creator. */
  randomOutfit(minQuality: number): Promise<[Slot, ItemSummary][]> {
    return this.client.randomOutfit(minQuality);
  }

  /** The class's best set, with weapons to match, as item ids by slot. */
  private async bestKit(classId: number): Promise<[Slot, number][]> {
    const list = await this.setsOf(classId);
    const best = list.reduce<ItemSetInfo | undefined>((top, set) => (top === undefined || set.level > top.level ? set : top), undefined);
    if (!best) return [];
    return [...best.pieces, ...best.weapons].map(([slot, item]) => [slot, item.id]);
  }

  /** The class's set weapons alone, for a legend whose own weapon the install lacks. */
  private async setWeapons(classId: number): Promise<[Slot, number][]> {
    const kit = await this.bestKit(classId);
    return kit.filter(([slot]) => slot === 'mainHand' || slot === 'offHand');
  }

  /** Build the champion, or hand back the one built before. */
  get(champion: Champion): Promise<BuiltFighter> {
    let fighter = this.built.get(champion.key);
    if (!fighter) {
      const build = (gear: [Slot, number][]) => this.client.fighter(champion.raceId, champion.sex, champion.choices, gear, [...ALL_MOVE_NAMES], champion.npc);
      fighter = build(champion.gear).then(async (first) => {
        // A legend none of whose weapons this install has would fight bare-handed: give it the
        // weapon of its class's set instead, so a shaman has a mace and a hunter a bow.
        if (first.wielding === 'unarmed' && champion.npc !== undefined && champion.classId !== undefined) {
          const weapons = await this.setWeapons(champion.classId);
          if (weapons.length > 0) {
            console.warn(`${champion.name}: ${first.scene.problems.join('; ')}; wielding the class set's weapon instead`);
            const gear = [...champion.gear.filter(([slot]) => slot !== 'mainHand' && slot !== 'offHand'), ...weapons];
            champion.gear = gear;
            return build(gear);
          }
        }
        return first;
      }).then((result) => {
        const rig = posableRig(result.rig);
        if (rig.meshCount !== result.scene.meshes.length) throw new Error(`The fighter's rig has ${rig.meshCount} meshes for ${result.scene.meshes.length} in the scene`);
        if (result.scene.problems.length > 0) console.warn(`${champion.name}: ${result.scene.problems.join('; ')}`);
        // The weapon's own swing and impact come from the main hand; the voice from the race and sex built.
        const mainHand = champion.gear.find(([slot]) => slot === 'mainHand')?.[1];
        const sounds = this.client
          .sounds(champion.raceId, champion.sex, champion.classId, mainHand, result.wielding)
          .catch((error: unknown) => {
            console.warn(`${champion.name} has no sound:`, error);
            return undefined;
          });
        let spells: Promise<FighterFx> | undefined;
        const fx = () => (spells ??= loadFighterFx(this.client, champion.classId, result.wielding));
        return { champion, result, rig, moves: resolveMoves(result.scene.animations, result.wielding), sounds, fx };
      });
      fighter.catch(() => this.built.delete(champion.key));
      this.built.set(champion.key, fighter);
      // Keep the last few only: each is tens of megabytes.
      while (this.built.size > KEEP) {
        const oldest = this.built.keys().next().value;
        if (oldest === undefined) break;
        this.built.delete(oldest);
      }
    } else {
      // Touched: it goes to the back of the line.
      this.built.delete(champion.key);
      this.built.set(champion.key, fighter);
      // A made champion's key leaves out its name, so one renamed since the build is handed back under its new name.
      const { name, title } = champion;
      fighter = fighter.then((built) => (built.champion.name === name && built.champion.title === title ? built : { ...built, champion: { ...built.champion, name, title } }));
    }
    return fighter;
  }
}
