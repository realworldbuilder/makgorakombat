import type { Race } from '@mogshot/character/appearance';
import type { DataClient } from '@mogshot/worker/client';
import type { Champion } from '../fighters';
import { pictureUrl } from '../pixels';

/*
 * The pictures the fight's interface shows: the spell icons on the action bar, read from the
 * game's own Spell tables through the worker and kept as data URLs for the rest of the visit;
 * a weapon's own icon for the auto-attack; the champion's portrait from the select screen.
 */

/** What the interface needs from the open folder. */
export interface UiAssets {
  client: DataClient;
  races: readonly Race[];
  /** Race portraits by `${race.key}:${sex}` and class icons by class key, as data URLs. */
  portraits: { races: Map<string, string>; classes: Map<string, string> };
}

/**
 * The spells whose icon to try, in order, for a name the build may not have: the classic client
 * has no death knight, monk, demon hunter or evoker spells, so theirs borrow a look-alike; a
 * status effect takes the icon of a spell that causes it. A name not listed is looked up as is.
 */
const LOOKALIKES: Record<string, string[]> = {
  'Icy Touch': ['Icy Touch', 'Frost Shock', 'Frostbolt'],
  'Death Strike': ['Death Strike', 'Mortal Strike', 'Heroic Strike'],
  'Death Coil': ['Death Coil', 'Shadow Bolt'],
  'Tiger Palm': ['Tiger Palm', 'Hamstring', 'Sinister Strike'],
  'Rising Sun Kick': ['Rising Sun Kick', 'Kick'],
  'Leg Sweep': ['Leg Sweep', 'Kick', 'Gouge'],
  'Chaos Strike': ['Chaos Strike', 'Mortal Strike'],
  'Fel Rush': ['Fel Rush', 'Charge'],
  'Blade Dance': ['Whirlwind', 'Blade Dance'],
  'Living Flame': ['Living Flame', 'Fireball'],
  'Fire Breath': ['Fire Breath', 'Flamestrike', 'Fireball'],
  'Azure Strike': ['Azure Strike', 'Arcane Missiles', 'Arcane Explosion'],
  // The build's lowest "Hover" is a creature spell wearing Fear's icon.
  'Hover': ['Levitate', 'Slow Fall', 'Hover'],
  'Kill Shot': ['Kill Shot', 'Aimed Shot'],
  'Disengage': ['Disengage', 'Feign Death'],
  'Shoot': ['Shoot', 'Auto Shot'],
  'Stunned': ['Bash', 'Hammer of Justice'],
  'Feared': ['Fear', 'Psychic Scream'],
  'Slowed': ['Frostbolt'],
  'Shield': ['Power Word: Shield'],
  'Riposte': ['Riposte', 'Parry'],
  'Interrupted': ['Counterspell', 'Kick'],
};

/**
 * The icon files of the player's own spell, tried before the name, where looking the name up
 * finds something else (checked against the classic beta and retail on 25 Oct 2026): retail's
 * lowest Chaos Strike, Fel Rush, Fire Breath and Living Flame are creature spells with other
 * pictures, classic's lowest Fear wears the game's placeholder, and Bash and Riposte change picture
 * from one game to the other. Retail redrew Aimed Shot and Wrath in a style unlike the rest of
 * the bar; the classic picture, which both games have, is kept so a kit looks the same in either.
 * The auto-attack, when the weapon has no icon, is Heroic Strike's sword and Shoot is the bow:
 * looked up by name they were a totem's fire, a cat's face and a wand. An install without a file
 * falls through to the name.
 */
const PINNED: Record<string, number[]> = {
  'Aimed Shot': [135130],
  Wrath: [136006],
  Attack: [132282],
  Shoot: [132222],
  'Chaos Strike': [1305152],
  'Fel Rush': [1247261],
  'Blade Dance': [1305149],
  'Fire Breath': [4622458],
  'Living Flame': [4622464],
  Fear: [136183],
  Bash: [132114],
  Riposte: [132336],
};

/** One set of icons per open folder, kept for the visit: a new fight shows its bar at once instead of names first. */
const shared = new WeakMap<DataClient, Icons>();

export function iconsFor(assets: UiAssets): Icons {
  let icons = shared.get(assets.client);
  if (!icons) shared.set(assets.client, (icons = new Icons(assets)));
  return icons;
}

export class Icons {
  private readonly urls = new Map<number, Promise<string | undefined>>();
  private readonly spells = new Map<string, Promise<number>>();

  constructor(private readonly assets: UiAssets) {}

  /** A picture by file id, as a data URL; undefined when the file cannot be read. */
  picture(fileId: number): Promise<string | undefined> {
    if (!fileId) return Promise.resolve(undefined);
    let url = this.urls.get(fileId);
    if (!url) {
      url = this.assets.client
        .icon(fileId)
        .then((image) => (image ? pictureUrl(image) : undefined))
        .catch(() => undefined);
      this.urls.set(fileId, url);
    }
    return url;
  }

  /** The icon file ids of spells by name; 0 for one no spell has. Names asked together are looked up together. */
  private spellFile(name: string): Promise<number> {
    let file = this.spells.get(name);
    if (!file) {
      // Everything asked for in the same tick goes in one request.
      pending.push(name);
      const batch = flush(this.assets.client);
      file = batch.then((ids) => ids.get(name) ?? 0);
      this.spells.set(name, file);
    }
    return file;
  }

  /** The icon of a spell by name, or of a look-alike when this build has no such spell; undefined when none has one. */
  async spell(name: string): Promise<string | undefined> {
    const candidates = LOOKALIKES[name] ?? [name];
    // The spell's own picture first, then each look-alike's.
    for (const candidate of [name, ...candidates.filter((c) => c !== name)]) {
      for (const pinned of PINNED[candidate] ?? []) {
        const url = await this.picture(pinned);
        if (url) return url;
      }
    }
    for (const candidate of candidates) {
      const fileId = await this.spellFile(candidate);
      if (fileId) {
        const url = await this.picture(fileId);
        if (url) return url;
      }
    }
    return undefined;
  }

  /** An item's icon, or undefined. */
  async item(id: number | undefined): Promise<string | undefined> {
    if (!id) return undefined;
    const [icon] = await this.assets.client.itemIcons([id]).catch(() => []);
    return icon?.fileId ? this.picture(icon.fileId) : undefined;
  }

  /** The class picture from the character creation screen, for an ability no spell pictures. */
  classIcon(classKey: string): string | undefined {
    return this.assets.portraits.classes.get(classKey);
  }

  /** The champion's portrait as the select screen showed it: a legend's shipped picture, or the race and sex's. */
  portrait(champion: Champion): string | undefined {
    if (champion.npc !== undefined) {
      const slug = champion.key.split(':')[1];
      if (slug) return `${import.meta.env.BASE_URL}legends/${slug}.png`;
    }
    const race = this.assets.races.find((r) => r.id === champion.raceId);
    return race ? this.assets.portraits.races.get(`${race.key}:${champion.sex}`) : undefined;
  }
}

let pending: string[] = [];
let flushing: Promise<Map<string, number>> | undefined;

/** One worker request for every spell name asked for in the current tick. */
function flush(client: DataClient): Promise<Map<string, number>> {
  if (!flushing) {
    flushing = new Promise((resolve) => {
      queueMicrotask(() => {
        const names = pending;
        pending = [];
        flushing = undefined;
        resolve(
          client
            .spellIcons(names)
            .then((icons) => new Map(icons.map((icon) => [icon.name, icon.fileId])))
            .catch(() => new Map<string, number>()),
        );
      });
    });
  }
  return flushing;
}
