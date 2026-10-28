import type { AnimationInfo } from '@mogshot/character/scene';

/*
 * Animations as moves: a move is one model animation (or its variations) with a duration, found
 * by trying candidate names in order. Shared by the core move table and the class kits.
 */

/** When the auto-attack connects, as fractions of the swing animation. */
export interface HitWindow {
  /** The swing connects while t/duration is in [from, to]; a shot leaves when t passes `from`. */
  from: number;
  to: number;
  /** Past this fraction the fighter may start another action. */
  recover: number;
}

export interface Variation {
  sequence: number;
  /** Milliseconds. */
  duration: number;
  /** Where the blow of a strike is, measured from the model (game/strike.ts); without it the rules' fixed window stands in. */
  strike?: Strike;
}

/**
 * A strike as the model plays it: when the weapon (or the fist) is furthest out in front, how far
 * that is from the fighter's feet, and how high. Plain numbers, so the engine stays free of models.
 */
export interface Strike {
  /** Fraction of the clip. */
  contact: number;
  /** Yards ahead of the fighter's origin, at their own size. */
  reach: number;
  /** Yards above the ground. */
  height: number;
}

export interface Move {
  name: string;
  /** The model animation that was found; '' when none of the candidates exists and the move borrows another. */
  animation: string;
  /** At least one. Only `swing` collects every variation of its animation. */
  variations: Variation[];
  /** Wraps around when it ends; otherwise it holds its last frame until the engine moves on. */
  loop: boolean;
  hit?: HitWindow;
}

/** Groups a model's animations by name, each list sorted by variation. */
export type Finder = (names: readonly string[]) => AnimationInfo[] | undefined;

export function finderOf(animations: readonly AnimationInfo[]): Finder {
  const byName = new Map<string, AnimationInfo[]>();
  for (const a of animations) {
    const list = byName.get(a.name);
    if (list) list.push(a);
    else byName.set(a.name, [a]);
  }
  return (names) => {
    for (const name of names) {
      const list = byName.get(name);
      if (list && list.length > 0) return [...list].sort((a, b) => a.variation - b.variation);
    }
    return undefined;
  };
}

/** A move from the first of `names` the model has, else `fallback`'s animation under the new name. */
export function moveFrom(find: Finder, name: string, names: readonly string[], loop: boolean, fallback: Move, allVariations = false): Move {
  const found = find(names);
  if (!found) return { name, animation: '', variations: fallback.variations, loop };
  const variations = (allVariations ? found : [found[0]!]).map((a) => ({ sequence: a.sequence, duration: Math.max(1, a.duration) }));
  return { name, animation: found[0]!.name, variations, loop };
}
