import { multiply, rotation, translation } from '@mogshot/math/mat4';

/** The engine steps at 60 Hz; every duration below is in frames unless it says ms. */
export const TICK_MS = 1000 / 60;

/** The stage runs from x = -HALF to x = +HALF. Characters face +X; Z is up. */
export const HALF = 5;
/** Where the fighters start: P1 at -START_X facing +1, P2 at +START_X facing -1. */
export const START_X = 2.2;
/** Minimum distance between two bodies; the physics step pushes them apart below it. */
export const BODY = 0.9;
/** Ground speed per frame: a run forwards (4.2 yards a second), a backpedal away. */
export const WALK = 0.07;
export const BACK = 0.045;
/** Jump: initial vertical speed and the gravity taken off it every frame. */
export const JUMP_V = 0.19;
export const GRAVITY = 0.0085;

/** The box the camera holds on (`holdFraming`); also the bounds of every merged pose. */
export const STAGE_BOX: { min: [number, number, number]; max: [number, number, number] } = {
  min: [-5.5, -1, 0],
  max: [5.5, 1, 3.2],
};

/** Yaw -π/2 puts +X on screen-right, so P1 walks right to reach P2. */
export const CAMERA = {
  yaw: -Math.PI / 2,
  pitch: (7 * Math.PI) / 180,
  fov: (32 * Math.PI) / 180,
  zoom: 1.12,
  panX: 0,
  panY: 0.1,
};

/** A round lasts 60 s. */
export const ROUND_FRAMES = 3600;
export const HP = 100;
/** "ROUND n" then "FIGHT!" before the fighters can move. */
export const INTRO_FRAMES = 150;
/** How long the dazed loser can be finished before dropping on their own: 4 s, room to enter a fatality's sequence. */
export const FINISH_FRAMES = 240;
/** Slow motion on the knockout. `frames` is counted in real frames. */
export const KO_SLOWMO = { frames: 90, rate: 0.3 };
/** Winner celebrates, then the next round (or the match result). */
export const ROUND_END_FRAMES = 180;
/** Rounds needed to win the mak'gora. */
export const ROUNDS_TO_WIN = 2;

/**
 * The world matrix of a fighter standing at (x, 0, z): translation × (facing < 0 ? rotation π about Z : identity).
 * Models face +X, so a fighter facing -1 is turned half way round.
 */
export function worldMatrix(x: number, z: number, facing: number): Float32Array {
  const move = translation(x, 0, z);
  if (facing >= 0) return move;
  return multiply(new Float32Array(16), move, rotation('z', Math.PI));
}
