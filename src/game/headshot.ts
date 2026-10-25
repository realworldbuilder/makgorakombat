import { type Camera, CharacterRenderer, DEFAULT_CAMERA } from '@mogshot/render/renderer';
import type { BuiltFighter } from './fighters';
import { pictureUrl } from './pixels';

/*
 * A champion's own face for the select screen and the unit frame: the built model, in its
 * idle stance, drawn head and shoulders from a little to one side, as the game's character
 * portraits are. Drawn once per champion in the browser and kept for the visit; the data URL
 * is also kept in localStorage so the roster shows every face at once next time.
 */

const SIZE = 256;
const DEGREE = Math.PI / 180;
const STORE = 'mk.headshot:';

let renderer: CharacterRenderer | undefined | null;
const cache = new Map<string, string>();

/** How the face is framed; the defaults were tuned by eye on a contact sheet of the legends. */
export interface Framing {
  /** Degrees the camera swings round from the front; negative looks from the model's right. */
  yaw: number;
  pitch: number;
  fov: number;
  /** Half the height in view, as a share of the body's height. */
  halfHeight: number;
  /** Where to aim below the head point, as a share of the body's height. */
  below: number;
}

export const FRAMING: Framing = { yaw: -22, pitch: 8, fov: 24, halfHeight: 0.21, below: 0.07 };

// For tuning from the console or a script: the fighters seen so far, drawn with any framing. Held
// weakly, so the aid does not keep a fighter (tens of megabytes) the roster's cache has let go.
const seen = new Map<string, WeakRef<BuiltFighter>>();
(window as unknown as { mkHeadshot?: unknown }).mkHeadshot = {
  keys: () => [...seen].flatMap(([key, ref]) => (ref.deref() ? [key] : [])),
  draw: (key: string, framing: Partial<Framing>) => {
    const fighter = seen.get(key)?.deref();
    return fighter ? drawFace(fighter, { ...FRAMING, ...framing }) : undefined;
  },
};

/** The face kept from an earlier visit, if any. */
export function storedHeadshot(key: string): string | undefined {
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const stored = localStorage.getItem(STORE + key) ?? undefined;
    if (stored) cache.set(key, stored);
    return stored;
  } catch {
    return undefined;
  }
}

/** The champion's face, drawn now if it has not been. Undefined when the browser cannot draw it. */
export function headshotOf(fighter: BuiltFighter): string | undefined {
  const key = fighter.champion.key;
  const known = storedHeadshot(key);
  if (known) return known;
  if (renderer === null) return undefined;
  try {
    renderer ??= new CharacterRenderer(document.createElement('canvas'));
  } catch (error) {
    console.warn('No headshots: ', error);
    renderer = null;
    return undefined;
  }
  seen.set(key, new WeakRef(fighter));
  try {
    const url = drawFace(fighter, FRAMING);
    cache.set(key, url);
    try {
      localStorage.setItem(STORE + key, url);
    } catch {
      // Full or disallowed: the face is drawn again next visit.
    }
    return url;
  } catch (error) {
    console.warn(`${fighter.champion.name}: no headshot:`, error);
    return undefined;
  }
}

/** Draws the face with the renderer, in the pose the scene was built in, where its head point is known. */
function drawFace(fighter: BuiltFighter, framing: Framing): string {
  renderer ??= new CharacterRenderer(document.createElement('canvas'));
  const draw = renderer;
  const { scene } = fighter.result;
  draw.setScene(scene);
  draw.holdFraming(scene.bounds);
  draw.setPose({ meshes: fighter.rig.pose(scene.pose.sequence, scene.pose.time), bounds: scene.bounds, pose: scene.pose });
  const { min, max } = scene.bounds;
  const tall = max[2] - min[2];
  // Aimed at the head where the model says it is, else near the top of the box (a raised weapon can make the box taller than the body).
  const head: [number, number, number] = scene.head
    ? [scene.head[0], scene.head[1], scene.head[2] - tall * framing.below]
    : [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2] + tall * (0.9 - framing.below)];
  const turned: Camera = { ...DEFAULT_CAMERA, yaw: framing.yaw * DEGREE, pitch: framing.pitch * DEGREE, fov: framing.fov * DEGREE };
  const camera = draw.aimAt(turned, head, tall * framing.halfHeight, 1);
  return pictureUrl(draw.renderImage(camera, { longSide: SIZE, aspect: 1, tight: false }));
}
