import { describe, expect, it } from 'vitest';
import { identity } from '@mogshot/math/mat4';
import { PLACE_VERTEX_SIZE, type PlaceScene } from '@mogshot/world/place';
import { floorAt, floorProfile } from '../../src/game/ground';
import { existsSync } from 'node:fs';
import { editionOf } from '../../src/game/edition';
import { STAGES, stagesFor } from '../../src/game/stages';

/** A sheet of ground over x, y in [-10, 10] at the height `z(x)`, as a place's terrain mesh. */
function sheet(z: (x: number) => number): PlaceScene['terrain'][number] {
  const corners: [number, number][] = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
  const vertices = new Uint8Array(corners.length * PLACE_VERTEX_SIZE);
  const view = new DataView(vertices.buffer);
  corners.forEach(([x, y], i) => {
    view.setFloat32(i * PLACE_VERTEX_SIZE, x, true);
    view.setFloat32(i * PLACE_VERTEX_SIZE + 4, y, true);
    view.setFloat32(i * PLACE_VERTEX_SIZE + 8, z(x), true);
  });
  return { vertices, indices: new Uint16Array([0, 1, 2, 0, 2, 3]), blend: { width: 1, height: 1, pixels: new Uint8Array(4) }, transform: identity(), draws: [] };
}

const place = (terrain: PlaceScene['terrain']): PlaceScene => ({ terrain, meshes: [], textures: [], props: [], propTextures: [], instances: [], reach: 100, ground: [0, 0, 0], problems: [] });

describe('the floor under the stage line', () => {
  it('follows a leaning lawn', () => {
    const profile = floorProfile(place([sheet((x) => x * 0.05)]));
    expect(floorAt(profile, 0)).toBeCloseTo(0, 3);
    expect(floorAt(profile, 4)).toBeCloseTo(0.2, 3);
    expect(floorAt(profile, -5.5)).toBeCloseTo(-0.275, 3);
  });

  it('ignores a roof over the spot and carries the floor past the loaded edge', () => {
    const profile = floorProfile(place([sheet(() => 0.3), sheet(() => 4)]));
    expect(floorAt(profile, 2)).toBeCloseTo(0.3, 3);
    expect(floorAt(profile, 50)).toBeCloseTo(0.3, 3);
  });

  it('is flat without a place', () => {
    expect(floorAt(undefined, 3)).toBe(0);
  });
});

describe('the stages', () => {
  it('have distinct slugs and facings in degrees', () => {
    expect(new Set(STAGES.map((s) => s.slug)).size).toBe(STAGES.length);
    for (const stage of STAGES) expect(stage.facing).toBeGreaterThanOrEqual(0);
    for (const stage of STAGES) expect(stage.facing).toBeLessThan(360);
  });

  it('each ship a thumbnail', () => {
    for (const stage of STAGES) expect(existsSync(`public/stages/${stage.slug}.jpg`), stage.slug).toBe(true);
  });

  it('are offered by the maps on disk and the game the install is', () => {
    const world = (product: string, version: string) => editionOf(product, version).world;
    const classic = stagesFor([0, 1], world('wow_classic_beta', '1.60.1.70205')).map((s) => s.slug);
    expect(classic).toContain('valley-of-heroes');
    expect(classic).toContain('gurubashi');
    // WoW Forever's live client stands on the 2004 ground too.
    expect(stagesFor([0, 1], world('wowf', '1.60.1.70532')).map((s) => s.slug)).toContain('valley-of-heroes');
    const retail = stagesFor([0, 1, 530, 571], world('wow', '12.1.5.70575')).map((s) => s.slug);
    expect(retail).toContain('thunder-bluff');
    expect(retail).not.toContain('valley-of-heroes');
    // The legendary stages: the raid's map and Outland only where the install has them.
    expect(stagesFor([0, 1, 530, 571, 615, 631], 'retail').map((s) => s.slug)).toEqual(expect.arrayContaining(['the-maul', 'zangarmarsh', 'obsidian-sanctum', 'frozen-throne']));
    expect(classic).not.toContain('obsidian-sanctum');
    expect(classic).toContain('the-maul');
    expect(classic).not.toContain('frozen-throne');
    // A map the install lacks takes its stages with it.
    expect(stagesFor([1], 'retail').map((s) => s.slug)).not.toContain('gurubashi');
    // The obstructed and the cut ones stay out.
    for (const gone of ['valley-of-trials', 'sentinel-hill', 'dalaran', 'ring-of-trials', 'icecrown']) expect(retail).not.toContain(gone);
  });
});
