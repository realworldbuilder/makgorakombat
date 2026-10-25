import { describe, expect, it } from 'vitest';
import { editionOf, playableProducts } from '../../src/game/edition';

describe('editions', () => {
  it('know each game in a folder by its product and version', () => {
    const retail = editionOf('wow', '12.1.5.70575');
    expect(retail.key).toBe('retail');
    expect(retail.name).toBe('Midnight Edition');
    expect(retail.world).toBe('retail');
    expect(retail.title.groups[0]).toEqual([7713732]);

    // WoW Forever live, and its beta, which shipped under the classic beta's product name.
    for (const [product, version] of [['wowf', '1.60.1.70532'], ['wow_classic_beta', '1.60.1.70205']] as const) {
      const forever = editionOf(product, version);
      expect(forever.key).toBe('forever');
      expect(forever.world).toBe('classic');
      expect(forever.title.groups[0]).toEqual([8176610]);
    }

    const era = editionOf('wow_classic_era', '1.15.7.61000');
    expect(era.key).toBe('classic');
    expect(era.world).toBe('classic');
    // Mists Classic stands in Cataclysm's rebuilt world.
    expect(editionOf('wow_classic', '5.5.1.63000').world).toBe('retail');
    // A retail build of an expansion not listed yet still gets music and a loading screen.
    const next = editionOf('wow_beta', '13.0.0.80000');
    expect(next.title.groups.length).toBeGreaterThan(0);
    expect(next.backdrops.length).toBeGreaterThan(0);
  });

  it('offer the active products, retail first', () => {
    const offered = playableProducts([
      { product: 'wowf', version: '1.60.1.70532', active: true },
      { product: 'wow', version: '12.1.5.70575', active: true },
      { product: 'wowt', version: '12.2.0.71000', active: false },
    ]);
    expect(offered.map((p) => p.product)).toEqual(['wow', 'wowf']);
  });
});
