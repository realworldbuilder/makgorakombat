import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';

/*
 * The site's own numbers, for the two of us who make it: who comes to the welcome page and the
 * game, from where, on what, and how far they get (a World of Warcraft folder opened, a fight, a
 * fight online). The pages send one short hit as they open and as those things happen, and a ping
 * a minute while they are in front, so the report can say how many are on the site now. A visitor
 * is a random id the browser keeps, nothing more: no address, no name, no cookie; the country is
 * the one Cloudflare already reads off the request. One Durable Object keeps it all in SQLite for
 * ninety days, 200,000 hits at most, the oldest going first. GET /site/report adds it up.
 */

/** The one store's name. */
export const SITE = 'site';
/** Hits are kept this long at most, */
export const KEEP_MS = 90 * 24 * 60 * 60 * 1000;
/** and this many at most. */
export const KEEP_HITS = 200_000;
/** A visitor whose last hit or ping is this recent is on the site now. */
export const LIVE_MS = 3 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The pages that count, */
export const PAGES = ['welcome', 'game'] as const;
/** and what a hit may say happened: the page opened, a folder read (detail: its edition), a fight begun (detail: cpu, local or online; extra: the champion), a fight watched, an error on the page (extra: its message), or only a ping. */
export const KINDS = ['view', 'folder', 'fight', 'watch', 'error', 'ping'] as const;
export const DEVICES = ['phone', 'tablet', 'desktop'] as const;

export type Page = (typeof PAGES)[number];
export type Kind = (typeof KINDS)[number];
export type Device = (typeof DEVICES)[number];

/** One hit, as the worker hands it on. */
export interface Hit {
  visitor: string;
  page: Page;
  kind: Kind;
  detail?: string;
  extra?: string;
  /** The site the visitor came from, its host alone; empty for none. */
  ref?: string;
  country?: string;
  device?: Device;
  browser?: string;
  os?: string;
}

export type SiteSpan = 'day' | 'week' | 'month' | 'all';

/** A bucket of the series: an hour for a day, a date otherwise, in New York. */
export interface Bucket {
  label: string;
  visitors: number;
  views: number;
}

/** A row of a top list: the thing, how many different visitors, and how many times. */
export interface Count {
  key: string;
  visitors: number;
  n: number;
}

/** What GET /site/report answers. */
export interface SiteReport {
  span: SiteSpan;
  from: number;
  to: number;
  /** On the site in the last three minutes, and on which page. */
  live: number;
  livePages: Record<string, number>;
  /** Different visitors in the span, those first seen in it, and pages opened. */
  visitors: number;
  newVisitors: number;
  views: number;
  series: Bucket[];
  /** How far they got: different visitors who opened the welcome page, the game, a folder, fought, fought online. */
  funnel: { welcome: number; game: number; folder: number; fight: number; online: number };
  pages: Count[];
  referrers: Count[];
  countries: Count[];
  devices: Count[];
  browsers: Count[];
  systems: Count[];
  editions: Count[];
  modes: Count[];
  champions: Count[];
  watched: number;
  errors: Count[];
}

const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });

/** The date and hour a moment falls in, in New York: `2026-10-26` and `2026-10-26 21:00`. */
export function bucketOf(ms: number): { day: string; hour: string } {
  const parts = Object.fromEntries(dayFormat.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { day, hour: `${day} ${parts.hour}:00` };
}

/** Where the span starts: the last 24 hours, 7 days, 30 days, or everything kept. */
export function spanStart(span: SiteSpan, now: number): number {
  return span === 'day' ? now - DAY_MS : span === 'week' ? now - 7 * DAY_MS : span === 'month' ? now - 30 * DAY_MS : now - KEEP_MS;
}

/** The empty buckets of a span, oldest first, so a quiet hour or day still shows as nothing. */
export function buckets(span: SiteSpan, from: number, now: number): string[] {
  const labels: string[] = [];
  // By the hour even for days, so a day of 23 or 25 hours is still one day.
  for (let t = from; t <= now; t += HOUR_MS) {
    const { day, hour } = bucketOf(t);
    const label = span === 'day' ? hour : day;
    if (labels[labels.length - 1] !== label) labels.push(label);
  }
  const last = span === 'day' ? bucketOf(now).hour : bucketOf(now).day;
  if (labels[labels.length - 1] !== last) labels.push(last);
  return labels;
}

/** The browser and system a user agent names, roughly; undefined for a robot or a headless browser, whose hits are not kept. */
export function agentOf(ua: string): { browser: string; os: string } | undefined {
  if (ua === '' || /bot|crawl|spider|slurp|headless|preview|lighthouse|curl|wget|python|node-fetch/i.test(ua)) return undefined;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS/.test(ua)
        ? 'Firefox'
        : /CriOS|Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Other';
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'Mac'
        : /Windows/.test(ua)
          ? 'Windows'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Other';
  return { browser, os };
}

const clip = (value: unknown, n: number): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, n) : undefined);

/** A hit as a page sends it, `{v,p,k,d?,x?,r?,w?}`, checked and cut to size; undefined for anything else. */
export function readHit(text: string, extra: { country?: string; ua: string }): Hit | undefined {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!body || typeof body !== 'object') return undefined;
  const { v, p, k, d, x, r, w } = body;
  if (typeof v !== 'string' || !/^[A-Za-z0-9-]{8,40}$/.test(v)) return undefined;
  if (!PAGES.includes(p as Page) || !KINDS.includes(k as Kind)) return undefined;
  const agent = agentOf(extra.ua);
  if (!agent) return undefined;
  let ref: string | undefined;
  if (typeof r === 'string' && r !== '') {
    try {
      ref = new URL(r).hostname.replace(/^www\./, '').slice(0, 80);
    } catch {
      ref = undefined;
    }
  }
  const width = typeof w === 'number' ? w : 0;
  const device: Device = /iPad|Tablet/.test(extra.ua) || (/Android/.test(extra.ua) && !/Mobile/.test(extra.ua)) ? 'tablet' : /Mobi|iPhone|Android/.test(extra.ua) || (width > 0 && width < 600) ? 'phone' : 'desktop';
  return {
    visitor: v,
    page: p as Page,
    kind: k as Kind,
    detail: clip(d, 40),
    extra: clip(x, 120),
    ref,
    country: clip(extra.country, 4),
    device,
    ...agent,
  };
}

type KeyCount = { key: string | null; visitors: number; n: number };

export class Site extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS hits (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      t INTEGER NOT NULL,
      visitor TEXT NOT NULL,
      page TEXT NOT NULL,
      kind TEXT NOT NULL,
      detail TEXT,
      extra TEXT,
      ref TEXT,
      country TEXT,
      device TEXT,
      browser TEXT,
      os TEXT
    )`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS hits_t ON hits (t)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS seen (visitor TEXT PRIMARY KEY, t INTEGER NOT NULL, page TEXT NOT NULL)');
  }

  /** A page's hit: kept, unless it is only a ping; either way the visitor is on the site now. */
  async hit(hit: Hit, now = Date.now()): Promise<void> {
    this.sql.exec('INSERT OR REPLACE INTO seen (visitor, t, page) VALUES (?, ?, ?)', hit.visitor, now, hit.page);
    if (hit.kind === 'ping') return;
    this.sql.exec(
      'INSERT INTO hits (t, visitor, page, kind, detail, extra, ref, country, device, browser, os) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      now,
      hit.visitor,
      hit.page,
      hit.kind,
      hit.detail ?? null,
      hit.extra ?? null,
      hit.ref ?? null,
      hit.country ?? null,
      hit.device ?? null,
      hit.browser ?? null,
      hit.os ?? null,
    );
    // Now and then, the oldest roll off.
    if (Math.random() < 0.02) this.prune(now);
  }

  /** Hits older than ninety days, past the 200,000th, and visitors not seen for a day go. */
  prune(now = Date.now()): void {
    this.sql.exec('DELETE FROM hits WHERE t < ?', now - KEEP_MS);
    this.sql.exec('DELETE FROM hits WHERE seq <= (SELECT seq FROM hits ORDER BY seq DESC LIMIT 1 OFFSET ?)', KEEP_HITS);
    this.sql.exec('DELETE FROM seen WHERE t < ?', now - DAY_MS);
  }

  /** The numbers for a span. */
  async report(span: SiteSpan, now = Date.now()): Promise<SiteReport> {
    const from = spanStart(span, now);
    const one = <T extends Record<string, SqlStorageValue>>(query: string, ...args: SqlStorageValue[]): T => this.sql.exec<T>(query, ...args).one();
    const top = (column: string, where = '', limit = 12): Count[] =>
      this.sql
        .exec<KeyCount>(`SELECT ${column} AS key, COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS n FROM hits WHERE t >= ? ${where} GROUP BY key ORDER BY visitors DESC, n DESC, key LIMIT ?`, from, limit)
        .toArray()
        .map((row) => ({ key: row.key ?? 'none', visitors: row.visitors, n: row.n }));
    const distinct = (where: string) => one<{ n: number }>(`SELECT COUNT(DISTINCT visitor) AS n FROM hits WHERE t >= ? ${where}`, from).n;

    const live = this.sql.exec<{ page: string; n: number }>('SELECT page, COUNT(*) AS n FROM seen WHERE t >= ? GROUP BY page', now - LIVE_MS).toArray();
    const newVisitors = one<{ n: number }>('SELECT COUNT(*) AS n FROM (SELECT visitor FROM hits GROUP BY visitor HAVING MIN(t) >= ?)', from).n;

    // The series: every hour of the last day, or every day of the span, with what fell in it.
    const labels = buckets(span, span === 'all' ? Math.max(from, one<{ t: number | null }>('SELECT MIN(t) AS t FROM hits').t ?? now) : from, now);
    const filled = new Map(labels.map((label) => [label, { visitors: new Set<string>(), views: 0 }]));
    for (const row of this.sql.exec<{ t: number; visitor: string; kind: string }>("SELECT t, visitor, kind FROM hits WHERE t >= ? AND kind = 'view'", from)) {
      const { day, hour } = bucketOf(row.t);
      const bucket = filled.get(span === 'day' ? hour : day);
      if (!bucket) continue;
      bucket.visitors.add(row.visitor);
      bucket.views++;
    }

    return {
      span,
      from,
      to: now,
      live: live.reduce((sum, row) => sum + row.n, 0),
      livePages: Object.fromEntries(live.map((row) => [row.page, row.n])),
      visitors: distinct(''),
      newVisitors,
      views: one<{ n: number }>("SELECT COUNT(*) AS n FROM hits WHERE t >= ? AND kind = 'view'", from).n,
      series: [...filled].map(([label, bucket]) => ({ label, visitors: bucket.visitors.size, views: bucket.views })),
      funnel: {
        welcome: distinct("AND kind = 'view' AND page = 'welcome'"),
        game: distinct("AND kind = 'view' AND page = 'game'"),
        folder: distinct("AND kind = 'folder'"),
        fight: distinct("AND kind = 'fight'"),
        online: distinct("AND kind = 'fight' AND detail = 'online'"),
      },
      pages: top('page', "AND kind = 'view'"),
      referrers: top("COALESCE(ref, 'direct')", "AND kind = 'view'"),
      countries: top('country', "AND kind = 'view'", 20),
      devices: top('device', "AND kind = 'view'"),
      browsers: top('browser', "AND kind = 'view'"),
      systems: top('os', "AND kind = 'view'"),
      editions: top('detail', "AND kind = 'folder'"),
      modes: top('detail', "AND kind = 'fight'"),
      champions: top('extra', "AND kind = 'fight'", 15),
      watched: distinct("AND kind = 'watch'"),
      errors: top('extra', "AND kind = 'error'", 10),
    };
  }
}
