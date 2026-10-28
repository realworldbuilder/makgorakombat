import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { agentOf, buckets, type Hit, KEEP_MS, LIVE_MS, readHit } from '../src/site';

const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const HEADLESS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36';

let stores = 0;
/** A store of its own for each test. */
const store = () => env.SITE.getByName(`site-test-${++stores}`);

const hit = (visitor: string, more: Partial<Hit> = {}): Hit => ({ visitor, page: 'game', kind: 'view', device: 'desktop', browser: 'Chrome', os: 'Mac', ...more });

describe('a hit as a page sends it', () => {
  it('is read with the browser, the system and the device', () => {
    const read = readHit(JSON.stringify({ v: 'abcd1234efgh', p: 'welcome', k: 'view', r: 'https://www.reddit.com/r/wow/comments/1', w: 1440 }), { country: 'US', ua: CHROME_MAC });
    expect(read).toEqual({ visitor: 'abcd1234efgh', page: 'welcome', kind: 'view', detail: undefined, extra: undefined, ref: 'reddit.com', country: 'US', device: 'desktop', browser: 'Chrome', os: 'Mac' });
    expect(readHit(JSON.stringify({ v: 'abcd1234efgh', p: 'game', k: 'view' }), { ua: SAFARI_IPHONE })).toMatchObject({ device: 'phone', browser: 'Safari', os: 'iOS' });
  });

  it('is dropped when it is not one, or comes from a robot', () => {
    const ok = { v: 'abcd1234efgh', p: 'game', k: 'view' };
    expect(readHit('not json', { ua: CHROME_MAC })).toBeUndefined();
    expect(readHit(JSON.stringify({ ...ok, v: 'short' }), { ua: CHROME_MAC })).toBeUndefined();
    expect(readHit(JSON.stringify({ ...ok, p: 'admin' }), { ua: CHROME_MAC })).toBeUndefined();
    expect(readHit(JSON.stringify({ ...ok, k: 'purchase' }), { ua: CHROME_MAC })).toBeUndefined();
    expect(readHit(JSON.stringify(ok), { ua: HEADLESS })).toBeUndefined();
    expect(agentOf('Googlebot/2.1')).toBeUndefined();
  });

  it('is cut to size', () => {
    const read = readHit(JSON.stringify({ v: 'abcd1234efgh', p: 'game', k: 'error', x: 'x'.repeat(500), d: 'd'.repeat(100) }), { ua: CHROME_MAC });
    expect(read!.extra).toHaveLength(120);
    expect(read!.detail).toHaveLength(40);
  });
});

describe('the report', () => {
  it('counts visitors, views, how far they got and what they played', async () => {
    const site = store();
    const now = Date.now();
    await site.hit(hit('visitor-aaaa', { page: 'welcome', ref: 'reddit.com', country: 'US' }), now - 5000);
    await site.hit(hit('visitor-aaaa', { country: 'US' }), now - 4000);
    await site.hit(hit('visitor-aaaa', { kind: 'folder', detail: 'retail' }), now - 3000);
    await site.hit(hit('visitor-aaaa', { kind: 'fight', detail: 'online', extra: 'THRALL' }), now - 2000);
    await site.hit(hit('visitor-bbbb', { country: 'GB', device: 'phone', browser: 'Safari', os: 'iOS' }), now - 1000);
    await site.hit(hit('visitor-bbbb', { country: 'GB', device: 'phone', browser: 'Safari', os: 'iOS' }), now - 900);
    await site.hit(hit('visitor-cccc', { kind: 'fight', detail: 'cpu', extra: 'THRALL' }), now - 800);
    await site.hit(hit('visitor-cccc', { kind: 'error', extra: 'WebGL context lost' }), now - 700);

    const report = await site.report('week', now);
    expect(report.visitors).toBe(3);
    expect(report.newVisitors).toBe(3);
    expect(report.views).toBe(4);
    expect(report.funnel).toEqual({ welcome: 1, game: 2, folder: 1, fight: 2, online: 1 });
    expect(report.pages).toEqual([
      { key: 'game', visitors: 2, n: 3 },
      { key: 'welcome', visitors: 1, n: 1 },
    ]);
    expect(report.referrers.find((r) => r.key === 'reddit.com')).toEqual({ key: 'reddit.com', visitors: 1, n: 1 });
    expect(report.countries.map((c) => c.key)).toEqual(['GB', 'US']);
    expect(report.browsers).toEqual([
      { key: 'Chrome', visitors: 1, n: 2 },
      { key: 'Safari', visitors: 1, n: 2 },
    ]);
    expect(report.editions).toEqual([{ key: 'retail', visitors: 1, n: 1 }]);
    expect(report.champions).toEqual([{ key: 'THRALL', visitors: 2, n: 2 }]);
    expect(report.errors).toEqual([{ key: 'WebGL context lost', visitors: 1, n: 1 }]);
    expect(report.series).toHaveLength(8);
    expect(report.series.at(-1)).toMatchObject({ visitors: 2, views: 4 });
  });

  it('says who is on the site now from the hits and pings of the last few minutes', async () => {
    const site = store();
    const now = Date.now();
    await site.hit(hit('visitor-aaaa'), now - LIVE_MS - 1000);
    await site.hit(hit('visitor-bbbb', { kind: 'ping', page: 'welcome' }), now - 1000);
    await site.hit(hit('visitor-cccc', { kind: 'ping' }), now - 1000);
    const report = await site.report('day', now);
    expect(report.live).toBe(2);
    expect(report.livePages).toEqual({ welcome: 1, game: 1 });
    // A ping is not a page opened.
    expect(report.views).toBe(1);
  });

  it('tells a visitor new in the span from one who came back', async () => {
    const site = store();
    const now = Date.now();
    await site.hit(hit('visitor-aaaa'), now - 20 * 24 * 60 * 60 * 1000);
    await site.hit(hit('visitor-aaaa'), now - 1000);
    await site.hit(hit('visitor-bbbb'), now - 1000);
    const week = await site.report('week', now);
    expect(week.visitors).toBe(2);
    expect(week.newVisitors).toBe(1);
    expect((await site.report('month', now)).newVisitors).toBe(2);
  });

  it('lets the oldest go', async () => {
    const site = store();
    const now = Date.now();
    await site.hit(hit('visitor-aaaa'), now - KEEP_MS - 1000);
    await site.hit(hit('visitor-bbbb'), now - 1000);
    await site.prune(now);
    expect((await site.report('all', now)).visitors).toBe(1);
  });

  it('has every hour of the day and every day of the week, quiet ones too', () => {
    const now = Date.UTC(2026, 9, 26, 18, 30);
    const day = buckets('day', now - 24 * 60 * 60 * 1000, now);
    expect(day).toHaveLength(25);
    expect(day.at(-1)).toBe('2026-10-26 14:00');
    const week = buckets('week', now - 7 * 24 * 60 * 60 * 1000, now);
    expect(week).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']);
  });
});

describe('the worker', () => {
  it('takes a hit from the game and reports it', async () => {
    const sent = await SELF.fetch('https://relay.test/site/hit', {
      method: 'POST',
      headers: { Origin: 'https://realworldbuilder.github.io', 'Content-Type': 'text/plain', 'User-Agent': CHROME_MAC },
      body: JSON.stringify({ v: 'worker-test-1', p: 'game', k: 'view' }),
    });
    expect(sent.status).toBe(204);
    expect(sent.headers.get('Access-Control-Allow-Origin')).toBe('https://realworldbuilder.github.io');
    const report = await (await SELF.fetch('https://relay.test/site/report?span=day')).json<{ span: string; views: number }>();
    expect(report.span).toBe('day');
    expect(report.views).toBeGreaterThanOrEqual(1);
  });

  it('takes nothing from a page that may not use the relay', async () => {
    const sent = await SELF.fetch('https://relay.test/site/hit', { method: 'POST', headers: { Origin: 'https://example.com', 'User-Agent': CHROME_MAC }, body: '{}' });
    expect(sent.status).toBe(403);
  });
});
