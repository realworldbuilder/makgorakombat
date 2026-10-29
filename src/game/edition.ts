import type { Cue } from './music';

/*
 * Which World of Warcraft the open folder is. One install folder can hold several games side
 * by side (retail in _retail_, WoW Forever in _forever_, the classic clients in _classic_*_),
 * each its own product in .build.info, and each draws the ring differently: its own races,
 * classes and legends' looks, its own world for the stages, and its own login screen. The
 * edition is that login screen's dress for CHOOSE YOUR LEGEND: a loading screen of its own
 * behind the champions, its title music and its colours, under the edition's name and a glyph
 * of our own drawing. The game's official logos are left out on purpose. Everything is read from
 * the install by file id, the first id it has winning, so a build that moves a file only falls
 * back.
 */

export type EditionKey = 'retail' | 'forever' | 'classic';

export interface Edition {
  key: EditionKey;
  /** The product as .build.info names it: wow, wowf, wow_classic_era... */
  product: string;
  /** e.g. "12.1.5.70575" */
  version: string;
  /** The game's name, as its login screen says it. */
  game: string;
  /** What this edition of the ring is called. */
  name: string;
  /** Whose world the stages stand in: the 2004 ground, or retail's rebuilt one. */
  world: 'classic' | 'retail';
  /** Loading screens of this game to stand the select screen in front of, in order. */
  backdrops: number[];
  /** The login screen's music. */
  title: Cue;
}

/** The 2004 login theme, "Legends of Azeroth": WoW Forever's own copy, then the original file. */
const LEGENDS_OF_AZEROTH: Cue = { key: 'title:legends', groups: [[8176610], [53223]] };

/** Retail by expansion: its name and main title, newest first. The 2004 theme is the fallback for all. */
const EXPANSIONS: Record<number, { name: string; music: number; backdrops: number[] }> = {
  // Midnight: Assault on Quel'Danas, Windrunner Spire, Zul'Aman.
  12: { name: 'Midnight', music: 7713732, backdrops: [7578182, 7266211, 7488404] },
  // The War Within.
  11: { name: 'The War Within', music: 6075186, backdrops: [] },
  // Dragonflight.
  10: { name: 'Dragonflight', music: 4880327, backdrops: [] },
};

/** The original Eastern Kingdoms and Kalimdor loading screens, wide and then 4:3. */
const OLD_WORLD = [343001, 343002, 131839, 131848];

const parse = (version: string) => {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return { major, minor };
};

/** The edition of an installed product, from its name and version in .build.info. */
export function editionOf(product: string, version: string): Edition {
  const { major, minor } = parse(version);
  // WoW Forever is wowf; its beta shipped as wow_classic_beta at 1.60, a version no classic client has had.
  if (product.startsWith('wowf') || (major === 1 && minor >= 60)) {
    return {
      key: 'forever',
      product,
      version,
      game: 'World of Warcraft: Forever',
      name: 'Forever Edition',
      world: 'classic',
      // Its own loading screens, drawn in ink: Kalimdor, the Eastern Kingdoms, Dalaran, then the 2004 ones.
      backdrops: [7963779, 7963776, 7963775, ...OLD_WORLD],
      title: LEGENDS_OF_AZEROTH,
    };
  }
  if (product.startsWith('wow_classic') || product.startsWith('wow_anniversary') || (major > 0 && major < 10)) {
    return {
      key: 'classic',
      product,
      version,
      game: 'World of Warcraft Classic',
      name: 'Classic Edition',
      // Cataclysm rebuilt the old world; the classic clients before it stand on the 2004 ground.
      world: major >= 4 ? 'retail' : 'classic',
      backdrops: OLD_WORLD,
      title: { key: 'title:classic', groups: [[53223], [8176610]] },
    };
  }
  const expansion = EXPANSIONS[major] ?? EXPANSIONS[Math.max(...Object.keys(EXPANSIONS).map(Number))]!;
  const newest = Object.keys(EXPANSIONS).map(Number).sort((a, b) => b - a);
  return {
    key: 'retail',
    product,
    version,
    game: `World of Warcraft: ${expansion.name}`,
    name: `${expansion.name} Edition`,
    world: 'retail',
    backdrops: [...expansion.backdrops, ...newest.flatMap((m) => EXPANSIONS[m]!.backdrops), ...OLD_WORLD],
    title: { key: `title:${major}`, groups: [[expansion.music], ...LEGENDS_OF_AZEROTH.groups] },
  };
}

/** The products of a folder worth offering, one per edition and version, in the order the editions are listed. */
export function playableProducts<T extends { product: string; version: string; active: boolean }>(products: readonly T[]): T[] {
  const order: Record<EditionKey, number> = { retail: 0, forever: 1, classic: 2 };
  return products
    .filter((entry) => entry.active)
    .sort((a, b) => order[editionOf(a.product, a.version).key] - order[editionOf(b.product, b.version).key]);
}
