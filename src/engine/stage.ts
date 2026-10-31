import { multiply, rotation, translation } from '@mogshot/math/mat4';

/** The engine steps at 60 Hz; every duration below is in frames unless it says ms. */
export const TICK_MS = 1000 / 60;

/** The stage runs from x = -HALF to x = +HALF. Characters face +X; Z is up. */
export const HALF = 5;
/** Where the fighters start: P1 at -START_X facing +1, P2 at +START_X facing -1. */
export const START_X = 2.2;
/** Minimum distance between two human bodies, feet to feet: they stand shoulder to shoulder, not inside each other. */
export const BODY = 1.25;
/** A human's head, standing, in yards: the size every other body is measured against. */
export const HUMAN_HEAD = 1.85;

/**
 * The room a body takes in front of its feet, for a fighter `size` times a human's height whose head
 * is `lean` yards ahead of its feet: a gnome needs a little less than a human, a tauren, hunched
 * forward over his hooves, a good deal more. Depth grows slower than height.
 */
export function bodyRadius(size: number, lean = 0): number {
  return (BODY / 2) * (0.5 + 0.5 * size) + 1.1 * Math.max(0, lean);
}

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
 * Which way a fighter looks, about Z: 0 along +X, π along -X, and `turn` (0 to 1) of the quarter
 * turn from there to the camera, which looks along +Y from -Y (CAMERA's yaw), so both sides turn the short way.
 */
export function yawOf(facing: number, turn = 0): number {
  return facing >= 0 ? (-turn * Math.PI) / 2 : Math.PI + (turn * Math.PI) / 2;
}

/**
 * The world matrix of a fighter standing at (x, 0, z): translation × a rotation about Z by `yawOf`.
 * Models face +X, so a fighter facing -1 is turned half way round, and one with `turn` 1 faces the camera.
 */
export function worldMatrix(x: number, z: number, facing: number, turn = 0): Float32Array {
  const move = translation(x, 0, z);
  if (facing >= 0 && turn === 0) return move;
  return multiply(new Float32Array(16), move, rotation('z', yawOf(facing, turn)));
}
