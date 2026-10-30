import { describe, expect, it } from 'vitest';
import { distance, regionFor, whereOf } from '../src/place';

const ATLANTA = { lat: 33.75, lon: -84.39 };
const MIAMI = { lat: 25.76, lon: -80.19 };
const SEATTLE = { lat: 47.61, lon: -122.33 };
const LOS_ANGELES = { lat: 34.05, lon: -118.24 };
const LONDON = { lat: 51.51, lon: -0.13 };
const BERLIN = { lat: 52.52, lon: 13.4 };
const SYDNEY = { lat: -33.87, lon: 151.21 };
const TOKYO = { lat: 35.68, lon: 139.69 };

describe('where a room the lobby makes lives', () => {
  it('measures the way over the earth', () => {
    expect(distance(LONDON, LONDON)).toBe(0);
    expect(distance(ATLANTA, SEATTLE)).toBeGreaterThan(3500);
    expect(distance(ATLANTA, SEATTLE)).toBeLessThan(3600);
  });

  it('puts two players near each other in their own region', () => {
    expect(regionFor(ATLANTA, MIAMI)).toBe('enam');
    expect(regionFor(SEATTLE, LOS_ANGELES)).toBe('wnam');
    expect(regionFor(LONDON, BERLIN)).toBe('weur');
    expect(regionFor(SYDNEY, SYDNEY)).toBe('oc');
  });

  it('puts two far apart on the way between them, not by either end alone', () => {
    // Seattle to Atlanta: through a North American region, never Europe's or Asia's.
    expect(['wnam', 'enam']).toContain(regionFor(SEATTLE, ATLANTA));
    expect(['apac-ne', 'apac-se', 'oc']).toContain(regionFor(TOKYO, SYDNEY));
  });

  it('goes by the one it knows, and names none when it knows neither', () => {
    expect(regionFor(TOKYO, undefined)).toBe('apac-ne');
    expect(regionFor(undefined, LONDON)).toBe('weur');
    expect(regionFor(undefined, undefined)).toBe(undefined);
  });

  it('reads the edge\'s guess at the place, and nothing that is not one', () => {
    const at = (cf: Record<string, unknown> | undefined) => ({ cf }) as unknown as Request;
    expect(whereOf(at({ latitude: '33.74900', longitude: '-84.38800' }))).toEqual({ lat: 33.749, lon: -84.388 });
    expect(whereOf(at(undefined))).toBe(undefined);
    expect(whereOf(at({ colo: 'ATL' }))).toBe(undefined);
    expect(whereOf(at({ latitude: '', longitude: '' }))).toBe(undefined);
    expect(whereOf(at({ latitude: 'north', longitude: '-84' }))).toBe(undefined);
    expect(whereOf(at({ latitude: '91', longitude: '0' }))).toBe(undefined);
  });
});
