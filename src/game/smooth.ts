import type { Placement } from './arena';

/*
 * Drawing between the engine's steps. The engine moves sixty times a second; a screen that draws
 * a hundred and twenty or a hundred and forty-four would show each step two or three times over,
 * and the fighters would move in little jerks. So the frame is drawn part of the way from the
 * step before to the last one, as far as the time left over since that step says: always a
 * moment the engine passed through or between, never a guess at one it has not reached.
 */

/** Further than this in one step (yards) is a jump, a blink or a new round: drawn where it lands, not slid across. */
export const SNAP = 1;

const lerp = (a: number, b: number, w: number) => a + (b - a) * w;

/**
 * A fighter `alpha` of the way from one step's placement to the next's (0 the one before, 1 the
 * last). The clip's time is carried along with the place, unless the clip changed or went back
 * to its start, when the last step's is drawn: half way between the end of a loop and its start
 * is the middle of it.
 */
export function between(from: Placement, to: Placement, alpha: number): Placement {
  const w = Math.min(1, Math.max(0, alpha));
  const jump = Math.abs(to.x - from.x) > SNAP || Math.abs(to.z - from.z) > SNAP;
  const sameClip = to.sequence === from.sequence && to.time >= from.time;
  return {
    ...to,
    x: jump ? to.x : lerp(from.x, to.x, w),
    z: jump ? to.z : lerp(from.z, to.z, w),
    time: sameClip ? lerp(from.time, to.time, w) : to.time,
    ...(to.turn !== undefined && { turn: lerp(from.turn ?? 0, to.turn, w) }),
  };
}

/** An easing written per engine step (`ease` of the way each sixtieth of a second), for a frame `ms` long. */
export function easeFor(ease: number, ms: number, stepMs: number): number {
  return 1 - (1 - ease) ** (Math.max(0, ms) / stepMs);
}
