/*
 * Where a room the lobby makes should live. Cloudflare puts a Durable Object near whatever first
 * asks for it, and a room the lobby makes is first asked for by the lobby, so it would sit by the
 * lobby, wherever that is, rather than by the two who fight in it; every press then crosses to it
 * and back. The lobby knows roughly where each player came in (the edge's own guess at the
 * place, nothing finer than a city), and names the region whose centre makes the shortest way
 * from one player to the room and on to the other, the farther of the two breaking a tie.
 */

/** Roughly where a player is, in degrees. */
export interface Where {
  lat: number;
  lon: number;
}

/** Cloudflare's regions for a Durable Object, each by a city near the middle of where it runs them; plain apac is the two Asian ones together, and is left out. */
const REGIONS: Partial<Record<DurableObjectLocationHint, Where>> = {
  wnam: { lat: 37.4, lon: -122.1 },
  enam: { lat: 39.0, lon: -77.5 },
  sam: { lat: -23.5, lon: -46.6 },
  weur: { lat: 50.1, lon: 3.0 },
  eeur: { lat: 50.1, lon: 19.9 },
  'apac-ne': { lat: 35.7, lon: 139.7 },
  'apac-se': { lat: 1.35, lon: 103.8 },
  oc: { lat: -33.9, lon: 151.2 },
  afr: { lat: -26.2, lon: 28.0 },
  me: { lat: 25.2, lon: 55.3 },
};

/** Where the edge places the request, or undefined when it does not say. */
export function whereOf(request: Request): Where | undefined {
  const cf = (request as Request & { cf?: { latitude?: unknown; longitude?: unknown } }).cf;
  if (cf?.latitude === undefined || cf.latitude === '' || cf.longitude === undefined || cf.longitude === '') return undefined;
  const lat = Number(cf.latitude);
  const lon = Number(cf.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat, lon };
}

/** Kilometres between two places, over the earth. */
export function distance(a: Where, b: Where): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The region for a room between `a` and `b`; with only one known, the region nearest it; with neither, none. */
export function regionFor(a: Where | undefined, b: Where | undefined): DurableObjectLocationHint | undefined {
  const known = [a, b].filter((w): w is Where => w !== undefined);
  if (known.length === 0) return undefined;
  let best: { hint: DurableObjectLocationHint; sum: number; far: number } | undefined;
  for (const [hint, centre] of Object.entries(REGIONS) as [DurableObjectLocationHint, Where][]) {
    const legs = known.map((w) => distance(w, centre));
    const sum = legs.reduce((s, d) => s + d, 0);
    const far = Math.max(...legs);
    if (!best || sum < best.sum - 1 || (Math.abs(sum - best.sum) <= 1 && far < best.far)) best = { hint, sum, far };
  }
  return best!.hint;
}
