import type { Image } from '@mogshot/formats/blp';
import type { LoadingScreen } from '@mogshot/worker/api';
import type { PlaceScene } from '@mogshot/world/place';
import { sameStage, type StageKey } from './net/handshake';

/*
 * The stages: spots in the game world, drawn around the fighters from the install's own map
 * files. A stage is a point and a direction: the fighters stand along the line through the spot
 * that runs the way `facing` points (P1 at the near end), and the camera looks across it, toward
 * facing + 90°, so the backdrop is whatever lies that way. Coordinates are the game's own: x north,
 * y west, in yards, as `/mogshot spot` prints them.
 */

export interface Stage {
  slug: string;
  name: string;
  /** Where it is, in a word, for the strip. */
  where: string;
  /** The game's map id: 0 Eastern Kingdoms, 1 Kalimdor, 530 Outland, 571 Northrend, 631 Icecrown Citadel. */
  map: number;
  x: number;
  y: number;
  /** Height of the floor, to pick a storey; without it, the highest surface at the spot. */
  z?: number;
  /** Degrees anticlockwise from north: the stage line runs this way, the camera looks toward facing + 90°. */
  facing: number;
  /** How far the world is drawn around the spot, in yards. */
  reach: number;
  /** Why this spot. */
  why: string;
  /** Only in one game's world: 'classic' where retail has rebuilt the ground, 'retail' for maps classic never had. */
  only?: 'classic' | 'retail';
}

/** How far a stage draws unless it says otherwise: enough for a skyline, little enough for 60 fps. */
export const REACH = 260;

/**
 * Cut to the six that read clean behind a fight (William, 24 Oct 2026). Left out: the Valley of
 * Trials and Sentinel Hill, where buildings and rocks stood in front of the fighters, and
 * Dalaran, the Ring of Trials and the Gate of Icecrown. Their spots are in git history.
 *
 * After them, the legendary stages (26 Oct 2026): WoW's own answers to the stages every fighting
 * game has, the walled pit and the final boss's roof. The Frozen Throne is a raid's map, so only an
 * install with Wrath's raids draws it. Cut the same night for not reading well behind a fight
 * (William): the threshold of the Dark Portal and the Nether Bridge in Netherstorm. Tried and
 * left out: Thandol Span (broken in the middle on both worlds), the Gates of Ahn'Qiraj and
 * Karazhan (walls in front at fighting distance), Molten Core and Illidan's roof (no floor found at
 * the raid's coordinates), the outdoor Dark Portal in Hellfire (the stair leaves no flat ground).
 */
export const STAGES: Stage[] = [
  { slug: 'gurubashi', name: 'Gurubashi Arena', where: 'Stranglethorn Vale', map: 0, x: -13215, y: 250, facing: 0, reach: REACH, why: 'The pit: the game\'s own fighting ring, the stands all round.' },
  { slug: 'crossroads', name: 'The Crossroads', where: 'The Barrens', map: 1, x: -456, y: -2652, facing: 315, reach: REACH, why: 'The square under the watchtower, Barrens sky behind.' },
  { slug: 'valley-of-heroes', name: 'The Valley of Heroes', where: 'Stormwind', map: 0, x: -8975, y: 503, facing: 127, reach: REACH, only: 'classic', why: 'The bridge in from the gate, the city\'s blue roofs up the street; Cataclysm rebuilt it.' },
  { slug: 'goldshire', name: 'Goldshire', where: 'Elwynn Forest', map: 0, x: -9400, y: 50, facing: 315, reach: REACH, why: 'The flowered lawn beside the Lion\'s Pride, where duels have been fought since 2004.' },
  { slug: 'darnassus', name: 'The Gardens', where: 'Darnassus', map: 1, x: 9660, y: 2520, facing: 0, reach: REACH, why: 'Under the great tree, a canopy over the haze.' },
  { slug: 'thunder-bluff', name: 'Thunder Bluff', where: 'Mulgore', map: 1, x: -1300, y: 30, facing: 0, reach: REACH, why: 'The high rise: tents, totems and a drop on every side.' },
  { slug: 'the-maul', name: 'The Maul', where: 'Dire Maul', map: 1, x: -3750, y: 1090, facing: 90, reach: REACH, why: 'The ogres\' fighting pit outside Dire Maul, walled all round: Kalimdor\'s Gurubashi.' },
  { slug: 'frozen-throne', name: 'The Frozen Throne', where: 'Icecrown Citadel', map: 631, x: 503, y: -2124, z: 841, facing: 270, reach: REACH, why: 'The top of the citadel, the ice stair up to the Lich King\'s throne behind: the last fight of Wrath.' },
];

/** The stages an install can draw: those whose map it has on disk, and whose ground its game (see edition.ts) still has. */
export function stagesFor(maps: readonly number[], world: 'classic' | 'retail'): Stage[] {
  return STAGES.filter((stage) => maps.includes(stage.map) && (!stage.only || stage.only === world));
}

/**
 * Whose world another install's stages stand in, from its product name alone, which is all the
 * meeting tells. Retail and WoW Forever are sure; classic era is the 2004 ground; the progression
 * classic clients have crossed Cataclysm's rebuild by now or not, and only their version would say.
 */
export function worldOfProduct(product: string): 'classic' | 'retail' | undefined {
  if (product.startsWith('wowf') || product.startsWith('wow_classic_era')) return 'classic';
  if (product.startsWith('wow_classic') || product.startsWith('wow_anniversary')) return undefined;
  return 'retail';
}

/** The two continents of 2004, which every install has; Outland, Northrend and the raids' maps only retail surely has. */
const EVERY_INSTALL = [0, 1];

/**
 * The stages of this install the other one can draw too: a stage of one world only goes in when the
 * other is surely of that world, and a stage off the two continents only when the other is retail,
 * since the meeting does not say which expansion a classic client has reached.
 */
export function sharedStages(mine: readonly Stage[], theirProduct: string): Stage[] {
  const theirs = worldOfProduct(theirProduct);
  return mine.filter((stage) => (!stage.only || stage.only === theirs) && (EVERY_INSTALL.includes(stage.map) || theirs === 'retail'));
}

/** A number in [0, n) from a seed, stirred so that the seeds of one rematch after another land far apart. */
function drawn(seed: number, n: number): number {
  let h = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) % n;
}

/**
 * The ground of an online match, drawn by the host from the hello's seed, so the same seed always
 * gives the same ground: one of the stages both installs have, else one of the host's loading
 * screens, else none. `last`, the ground just fought on, is left out of a rematch's draw when there
 * is anything else to draw.
 */
export function drawGround(stages: readonly Stage[], screens: readonly { id: number }[], seed: number, last?: StageKey): StageKey {
  const pool: StageKey[] =
    stages.length > 0 ? stages.map((stage) => ({ kind: 'stage', slug: stage.slug })) : screens.map((screen) => ({ kind: 'screen', id: screen.id }));
  const fresh = last ? pool.filter((key) => !sameStage(key, last)) : pool;
  const from = fresh.length > 0 ? fresh : pool;
  return from.length > 0 ? from[drawn(seed, from.length)]! : { kind: 'none' };
}

/** The thumbnail shipped for a stage, rendered once through Mogshot's command line. */
export function thumbnailUrl(stage: Stage): string {
  return `${import.meta.env.BASE_URL}stages/${stage.slug}.jpg`;
}

/** What the fight stands on: a place in the world, or one of the loading screens, or nothing. */
export interface Ground {
  stage?: Stage;
  place?: PlaceScene;
  screen?: LoadingScreen;
  image?: Image;
}

/** Radians anticlockwise from north, as the worker takes them. */
export function facingRadians(stage: Stage): number {
  return (stage.facing * Math.PI) / 180;
}
