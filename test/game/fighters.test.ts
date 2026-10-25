import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import type { FighterResult } from '@mogshot/worker/api';
import type { DataClient } from '@mogshot/worker/client';
import { type BuiltFighter, type Champion, Fighters, KEEP } from '../../src/game/fighters';
import { headshotOf } from '../../src/game/headshot';
import { fakeAnimations } from '../engine/fake';

// The headshot module reads the page at load: a window to hang its console aid on, and a document for its canvas.
vi.hoisted(() => {
  const page = globalThis as unknown as { window?: object; document?: object };
  page.window ??= {};
  page.document ??= { createElement: () => ({}) };
});
// No WebGL here: a renderer that draws nothing and keeps nothing.
vi.mock('@mogshot/render/renderer', () => ({
  DEFAULT_CAMERA: { yaw: 0, pitch: 0, fov: 0.5, zoom: 1, panX: 0, panY: 0 },
  CharacterRenderer: class {
    setScene() {}
    holdFraming() {}
    setPose() {}
    aimAt(camera: unknown) {
      return camera;
    }
    renderImage() {
      return { width: 1, height: 1, pixels: new Uint8ClampedArray(4) };
    }
  },
}));
vi.mock('../../src/game/pixels', () => ({ pictureUrl: () => 'data:image/png;base64,' }));
vi.mock('@mogshot/model/posable', () => ({ posableRig: (rig: { meshes: unknown[] }) => ({ meshCount: rig.meshes.length, pose: () => [] }) }));

// The collector, for checking that nothing holds a fighter the cache has let go.
setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

const champion = (n: number): Champion => ({ key: `race:${n}:0:1`, name: `C${n}`, title: '', raceId: n, sex: 0, classId: 1, choices: [], gear: [] });

/** A data client that builds a small fighter, a few megabytes like the real ones would be, and counts the builds. */
function fakeClient() {
  const builds: number[] = [];
  const client = {
    fighter: async (raceId: number) => {
      builds.push(raceId);
      return {
        scene: {
          meshes: [],
          textures: [{ width: 512, height: 512, pixels: new Uint8Array(512 * 512 * 4) }],
          bounds: { min: [0, 0, 0], max: [1, 1, 2] },
          problems: [],
          animations: fakeAnimations(),
          pose: { sequence: 0, time: 0, duration: 0, preset: undefined },
        },
        rig: { meshes: [] },
        wielding: 'oneHand',
        raceId,
        sex: 0,
        ms: 0,
      } as unknown as FighterResult;
    },
    sounds: async () => undefined,
  };
  return { builds, client: client as unknown as DataClient };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the fighters kept', () => {
  it('keeps the last few builds, the one asked for last kept longest', async () => {
    const { builds, client } = fakeClient();
    const fighters = new Fighters(client, []);
    for (let n = 0; n < KEEP; n++) await fighters.get(champion(n));
    expect(builds).toHaveLength(KEEP);
    // The first is asked for again: the second is now the oldest, and goes when one more is built.
    await fighters.get(champion(0));
    await fighters.get(champion(KEEP));
    expect(builds).toHaveLength(KEEP + 1);
    await fighters.get(champion(0));
    expect(builds).toHaveLength(KEEP + 1);
    await fighters.get(champion(1));
    expect(builds).toHaveLength(KEEP + 2);
    expect(builds.at(-1)).toBe(1);
  });

  it('lets a fighter go once it is out of the cache, its headshot drawn or not', async () => {
    const { client } = fakeClient();
    const fighters = new Fighters(client, []);
    // Built and drawn in a function of its own, so that the test holds it only weakly.
    const buildAndDraw = async (n: number) => {
      const fighter = await fighters.get(champion(n));
      expect(headshotOf(fighter)).toMatch(/^data:/);
      return new WeakRef<BuiltFighter>(fighter);
    };
    const first = await buildAndDraw(0);
    const last = await buildAndDraw(1);
    for (let n = 2; n <= KEEP; n++) await fighters.get(champion(n));
    await settle();
    gc();
    expect(first.deref()).toBeUndefined();
    expect(last.deref()).toBeDefined();
  });
});
