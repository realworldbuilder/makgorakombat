import { describe, expect, it } from 'vitest';
import { decode, encode, type StageKey } from '../../src/game/net/handshake';
import { drawGround, sharedStages, STAGES, stagesFor, worldOfProduct } from '../../src/game/stages';

const ALL_MAPS = [0, 1, 530, 571, 631];
const slugs = (keys: StageKey[]) => keys.map((key) => (key.kind === 'stage' ? key.slug : key.kind));

describe('the stage drawn for an online match', () => {
  const stages = stagesFor(ALL_MAPS, 'retail');
  const screens = [{ id: 11 }, { id: 22 }, { id: 33 }];

  it('is the same ground for the same seed, on either machine and every time', () => {
    for (const seed of [0, 1, 2, 0xdeadbeef, 4294967295]) {
      expect(drawGround(stages, screens, seed)).toEqual(drawGround([...stages], [...screens], seed));
    }
  });

  it('reaches every stage across seeds, one rematch after another', () => {
    const seen = new Set(slugs(Array.from({ length: 64 }, (_, game) => drawGround(stages, screens, (1234 + game) >>> 0))));
    expect([...seen].sort()).toEqual(stages.map((stage) => stage.slug).sort());
  });

  it('draws a stage both installs have, never a loading screen while there is one', () => {
    for (let seed = 0; seed < 50; seed++) {
      const key = drawGround(stages, screens, seed);
      expect(key.kind).toBe('stage');
      expect(stages.some((stage) => key.kind === 'stage' && stage.slug === key.slug)).toBe(true);
    }
  });

  it('leaves out the ground just fought on when a rematch has anything else', () => {
    for (let seed = 0; seed < 50; seed++) {
      const last = drawGround(stages, screens, seed);
      expect(drawGround(stages, screens, seed + 1, last)).not.toEqual(last);
    }
    const one = stages.slice(0, 1);
    expect(drawGround(one, screens, 7, { kind: 'stage', slug: one[0]!.slug })).toEqual({ kind: 'stage', slug: one[0]!.slug });
  });

  it('falls back to one of the host\'s loading screens when no stage is shared, and to none without those', () => {
    for (let seed = 0; seed < 20; seed++) {
      const key = drawGround([], screens, seed);
      expect(key.kind).toBe('screen');
      expect(screens.some((screen) => key.kind === 'screen' && screen.id === key.id)).toBe(true);
    }
    expect(drawGround([], [], 5)).toEqual({ kind: 'none' });
  });

  it('is a key that crosses the wire unchanged', () => {
    const key = drawGround(stages, screens, 99);
    const back = decode(encode({ t: 'stage', stage: key }));
    expect(back).toEqual({ t: 'stage', stage: key });
  });
});

describe('the stages two installs share', () => {
  const valley = STAGES.find((stage) => stage.only === 'classic')!;

  it('reads the other install\'s world from its product where the product says it', () => {
    expect(worldOfProduct('wow')).toBe('retail');
    expect(worldOfProduct('wowt')).toBe('retail');
    expect(worldOfProduct('wow_classic_era')).toBe('classic');
    expect(worldOfProduct('wowf')).toBe('classic');
    // Progression classic may stand on either side of Cataclysm; the meeting does not carry the version.
    expect(worldOfProduct('wow_classic')).toBeUndefined();
    expect(worldOfProduct('wow_anniversary')).toBeUndefined();
  });

  it('keeps a classic-only stage between two classic-era installs', () => {
    const mine = stagesFor([0, 1], 'classic');
    expect(mine).toContain(valley);
    expect(sharedStages(mine, 'wow_classic_era')).toEqual(mine);
  });

  it('drops a classic-only stage when the other plays retail, or a classic whose world is not known', () => {
    const mine = stagesFor(ALL_MAPS, 'classic');
    expect(sharedStages(mine, 'wow')).not.toContain(valley);
    expect(sharedStages(mine, 'wow_classic')).not.toContain(valley);
    expect(sharedStages(mine, 'wow').length).toBe(mine.length - 1);
  });

  it('keeps every stage a retail host has for a retail guest, and those of the two continents for any guest', () => {
    const mine = stagesFor(ALL_MAPS, 'retail');
    expect(mine).not.toContain(valley);
    expect(sharedStages(mine, 'wow')).toEqual(mine);
    for (const product of ['wowf', 'wow_classic_era', 'wow_classic']) expect(sharedStages(mine, product)).toEqual(mine.filter((stage) => stage.map === 0 || stage.map === 1));
  });

  it('never draws Outland or a raid for a guest who may not have it', () => {
    const shared = sharedStages(stagesFor(ALL_MAPS, 'retail'), 'wowf');
    const away = STAGES.filter((stage) => stage.map !== 0 && stage.map !== 1).map((stage) => stage.slug);
    expect(away).toContain('frozen-throne');
    for (let seed = 0; seed < 200; seed++) {
      const key = drawGround(shared, [], seed);
      expect(key.kind === 'stage' && away.includes(key.slug)).toBe(false);
    }
  });

  it('never draws the classic-only stage for a retail guest', () => {
    const shared = sharedStages(stagesFor(ALL_MAPS, 'classic'), 'wow');
    for (let seed = 0; seed < 200; seed++) expect(drawGround(shared, [], seed)).not.toEqual({ kind: 'stage', slug: valley.slug });
  });

  it('is nothing when the host has no stage at all, so the draw is a loading screen', () => {
    expect(sharedStages(stagesFor([], 'retail'), 'wow')).toEqual([]);
    expect(drawGround(sharedStages([], 'wow'), [{ id: 4 }], 3)).toEqual({ kind: 'screen', id: 4 });
  });
});
