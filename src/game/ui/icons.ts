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
 * The spells whose icon to try, in order, for a name an install has no pinned file for: a status
 * effect takes the icon of a spell that causes it. A name not listed is looked up as is.
 */
const LOOKALIKES: Record<string, string[]> = {
  'Shoot': ['Shoot', 'Auto Shot'],
  'Stunned': ['Bash', 'Hammer of Justice'],
  'Feared': ['Fear', 'Psychic Scream'],
  'Slowed': ['Frostbolt'],
  'Shield': ['Power Word: Shield'],
  'Riposte': ['Riposte', 'Parry'],
  'Interrupted': ['Counterspell', 'Kick'],
};

/**
 * The icon file of every ability in the kits, the player's own spell's, so no two slots in the
 * game show the same picture (a test holds them to that). Looking a name up takes the lowest spell
 * id of that name, often a creature's copy wearing another spell's picture: checked against the
 * classic beta and retail on 26 Oct 2026, Crusader Strike came up as Smite, Holy Nova as Holy
 * Light, Raptor Strike as Overpower and Hover as Fear, and the classic beta, which has no death
 * knight, monk, demon hunter or evoker, lent Death Strike Mortal Strike's and both monk kicks
 * Kick's. The classic beta holds the retail files, so a pin is the same picture in either game.
 * Retail redrew Aimed Shot and Wrath in a style unlike the rest of the bar; the classic picture,
 * which both games have, is kept, as it is for Howl of Terror. The auto-attack, when the weapon has no
 * icon, is Heroic Strike's sword and Shoot is the bow: looked up by name they were a totem's fire,
 * a cat's face and a wand. Fear, Bash and Riposte picture the effects they cause. An install
 * without a file falls through to the name.
 */
export const PINNED: Record<string, number[]> = {
  // Warrior
  Charge: [132337],
  'Mortal Strike': [132355],
  Execute: [135358],
  // Paladin
  'Crusader Strike': [135891],
  'Hammer of Justice': [135963],
  'Holy Light': [135920],
  // Hunter
  'Aimed Shot': [135130],
  Disengage: [132294],
  'Raptor Strike': [1376046],
  // Rogue
  'Sinister Strike': [136189],
  'Kidney Shot': [132298],
  Evasion: [136205],
  // Priest
  'Mind Blast': [136224],
  'Holy Nova': [135922],
  'Power Word: Shield': [135940],
  // Death knight
  'Icy Touch': [237526],
  'Death Strike': [237517],
  'Death Coil': [136145],
  // Shaman
  'Lightning Bolt': [136048],
  'Earth Shock': [136026],
  Stormstrike: [132314],
  // Mage
  Frostbolt: [135846],
  'Frost Nova': [135848],
  Blink: [135736],
  // Warlock
  'Shadow Bolt': [136197],
  Corruption: [136118],
  'Howl of Terror': [136147],
  // Monk
  'Tiger Palm': [606551],
  'Rising Sun Kick': [642415],
  'Leg Sweep': [642414],
  // Druid
  Wrath: [136006],
  Moonfire: [136096],
  Rake: [132122],
  // Demon hunter
  'Chaos Strike': [1305152],
  'Fel Rush': [1247261],
  'Blade Dance': [1305149],
  // Evoker
  'Living Flame': [4622464],
  'Fire Breath': [4622458],
  Hover: [4622463],
  // The auto-attack and the effects.
  Attack: [132282],
  Shoot: [132222],
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
