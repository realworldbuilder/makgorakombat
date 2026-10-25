import { describe, expect, it, vi } from 'vitest';
import { Arena } from '../../src/game/arena';

// No WebGL here: a renderer that only writes down what it was asked to hold.
const made: { scene?: { meshes: unknown[]; textures: unknown[] }; place?: unknown; backdrop?: unknown }[] = [];
vi.mock('@mogshot/render/renderer', () => ({
  CharacterRenderer: class {
    held: (typeof made)[number] = {};
    constructor() {
      made.push(this.held);
    }
    setFocus() {}
    setScene(scene: { meshes: unknown[]; textures: unknown[] }) {
      this.held.scene = scene;
    }
    setPlace(place: unknown) {
      this.held.place = place;
    }
    setBackdrop(backdrop: unknown) {
      this.held.backdrop = backdrop;
    }
  },
}));

describe('the ring', () => {
  it('empties its renderer and gives up its WebGL context when disposed', () => {
    const loseContext = vi.fn();
    const context = { getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null) };
    const canvas = { getContext: (kind: string) => (kind === 'webgl2' ? context : null) } as unknown as HTMLCanvasElement;
    const ring = new Arena(canvas);
    const held = made.at(-1)!;
    held.scene = { meshes: [{}], textures: [{}] };
    held.place = {};
    held.backdrop = {};
    ring.dispose();
    expect(held.scene).toMatchObject({ meshes: [], textures: [] });
    expect(held.place).toBeUndefined();
    expect(held.backdrop).toBeUndefined();
    expect(loseContext).toHaveBeenCalledOnce();
  });
});
