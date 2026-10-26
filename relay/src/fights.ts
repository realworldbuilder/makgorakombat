/*
 * The night's log: one short record for every match a room saw, and who came to the lobby, so that
 * after a night with strangers somebody can say how many came, how long they waited, how many
 * matches were fought to the end and how many stopped on a desync or a player gone. The rooms tell
 * the lobby each match as it ends (a result both pages agree on, a desync the room saw in the
 * hashes, a player who left or dropped for good, a room that closed with nothing fought), as they
 * tell it results for the board; the lobby keeps the records in its own SQLite storage beside the
 * board, the last thirty days and two thousand matches at most. GET /lobby/report adds them up.
 */

import { type Fighter, nightOf } from './board';

export type Role = 'host' | 'guest';

/** How a match ended. */
export type Ending =
  /** Fought to the end, and both pages told the same result. */
  | 'finished'
  /** The two machines' hashes differed (at `desyncAt`), or the two pages told different results. */
  | 'desync'
  /** A player went on purpose before the end: back to the roster, or the tab closed. */
  | 'left'
  /** A player's socket dropped and they did not come back in time. */
  | 'dropped'
  /** The room closed without a match ever starting in it. */
  | 'never';

/** One match, as a room tells the lobby when it ends. */
export interface Fight {
  /** The room's code. */
  code: string;
  /** The lobby matched the two (a challenge or the queue); false for a room made with a code. */
  lobby: boolean;
  /** When the host's hello or rematch came, and when the match ended; ms since 1970. A match never started starts when its room opened. */
  start: number;
  end: number;
  /** The match number in the room's run of rematches; 0 for one never started. */
  game: number;
  /** The players under the ids and names the board would count them by, when the room knows them. */
  host?: Fighter;
  guest?: Fighter;
  /** The ground: a stage's slug, `screen:<id>` for a loading screen, or `none`. */
  stage?: string;
  ended: Ending;
  /** The first tick whose hashes differed, for a desync the room saw. */
  desyncAt?: number;
  /** Who left or dropped. */
  by?: Role;
  /** For a finished match: who won, the rounds and the ticks. */
  winner?: Role;
  rounds?: number;
  ticks?: number;
  /** How many times a player dropped and came back in time during the match. */
  reconnects: number;
  /** Seconds each player (host, guest) waited in the queue before the lobby matched them; null for one who did not queue. Only on a room's first record. */
  waits?: (number | null)[];
}

export type ReportSpan = 'night' | 'day' | 'week' | 'all';

/** The busiest hour of a span: the hour in New York, and the matches started in it. */
export interface Busiest {
  hour: string;
  fights: number;
}

/** What GET /lobby/report answers. */
export interface NightReport {
  span: ReportSpan;
  /** The night it is, as its date in New York, as on the board. */
  night: string;
  /** The window added up, ms since 1970; `from` is the oldest record kept for `all`. */
  from: number;
  to: number;
  /** Different players seen: in the lobby, or named in a match. */
  players: number;
  /** Matches started, and how they ended. */
  started: number;
  finished: number;
  desyncs: number;
  left: number;
  drops: number;
  /** Rooms that closed with nothing fought in them. */
  never: number;
  /** Players who dropped and came back in time, over all the matches. */
  reconnects: number;
  /** The queue: how many waits are known, the median and the worst, in seconds. */
  wait: { n: number; median: number | null; worst: number | null };
  /** The hour in New York with the most matches started; null with none. */
  busiest: Busiest | null;
  /** Matches started by hour of the day in New York, 0 to 23. */
  hours: number[];
  /** Every record, oldest first, for night and day only. */
  fights?: Fight[];
}

/** Records are kept this long at most, */
export const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** and this many at most, the oldest going first. */
export const KEEP_FIGHTS = 2000;
/** Lobby visits are kept as one row per player per hour, this many at most. */
export const KEEP_VISITS = 20_000;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const newYorkHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });

/** The hour a moment falls in, in New York: `2026-10-25 21:00`, and the hour of the day alone. */
export function hourOf(ms: number): { label: string; hour: number } {
  const parts = Object.fromEntries(newYorkHour.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { label: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:00`, hour: Number(parts.hour) };
}

/** When the night it is began: four in the morning in New York, which is always on the hour. */
export function nightStart(now: number): number {
  const night = nightOf(now);
  let start = Math.floor(now / HOUR_MS) * HOUR_MS;
  while (nightOf(start - HOUR_MS) === night) start -= HOUR_MS;
  return start;
}

/** The middle of a list of numbers; the mean of the two middle ones for an even count. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Adds the records up for a span; `seen` is the ids that came to the lobby in it. Pure, for the tests. */
export function summarize(span: ReportSpan, fights: Fight[], seen: Iterable<string>, now: number, from: number): NightReport {
  const players = new Set(seen);
  const waits: number[] = [];
  const hours = new Array<number>(24).fill(0);
  const byHour = new Map<string, number>();
  const report: NightReport = {
    span,
    night: nightOf(now),
    from,
    to: now,
    players: 0,
    started: 0,
    finished: 0,
    desyncs: 0,
    left: 0,
    drops: 0,
    never: 0,
    reconnects: 0,
    wait: { n: 0, median: null, worst: null },
    busiest: null,
    hours,
  };
  for (const fight of fights) {
    for (const who of [fight.host, fight.guest]) if (who) players.add(who.id);
    for (const wait of fight.waits ?? []) if (typeof wait === 'number') waits.push(wait);
    report.reconnects += fight.reconnects;
    if (fight.ended === 'never') {
      report.never++;
      continue;
    }
    report.started++;
    if (fight.ended === 'finished') report.finished++;
    else if (fight.ended === 'desync') report.desyncs++;
    else if (fight.ended === 'left') report.left++;
    else if (fight.ended === 'dropped') report.drops++;
    const { label, hour } = hourOf(fight.start);
    hours[hour]!++;
    byHour.set(label, (byHour.get(label) ?? 0) + 1);
  }
  report.players = players.size;
  report.wait = { n: waits.length, median: median(waits), worst: waits.length > 0 ? Math.max(...waits) : null };
  // Ties go to the earlier hour: the labels sort as the times do.
  for (const [hour, n] of [...byHour].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!report.busiest || n > report.busiest.fights) report.busiest = { hour, fights: n };
  }
  return report;
}

type StoredFight = { seq: number; start: number; data: string };
type StoredVisit = { id: string; hour: number };

export class FightLog {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS fights (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      start INTEGER NOT NULL,
      ending INTEGER NOT NULL,
      data TEXT NOT NULL
    )`);
    sql.exec('CREATE INDEX IF NOT EXISTS fights_start ON fights (start)');
    sql.exec(`CREATE TABLE IF NOT EXISTS visits (
      id TEXT NOT NULL,
      hour INTEGER NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (id, hour)
    )`);
  }

  /** A match's record, and the oldest rolled off. */
  add(fight: Fight, now = Date.now()): void {
    this.sql.exec('INSERT INTO fights (start, ending, data) VALUES (?, ?, ?)', fight.start, fight.end, JSON.stringify(fight));
    this.sql.exec('DELETE FROM fights WHERE ending < ?', now - KEEP_MS);
    this.sql.exec('DELETE FROM fights WHERE seq <= (SELECT seq FROM fights ORDER BY seq DESC LIMIT 1 OFFSET ?)', KEEP_FIGHTS);
  }

  /** A player came to the lobby: one row for them for the hour, and the oldest rolled off. */
  visit(id: string, name: string, now = Date.now()): void {
    const hour = Math.floor(now / HOUR_MS);
    this.sql.exec('INSERT OR REPLACE INTO visits (id, hour, name) VALUES (?, ?, ?)', id, hour, name);
    this.sql.exec('DELETE FROM visits WHERE hour < ?', Math.floor((now - KEEP_MS) / HOUR_MS));
    this.sql.exec('DELETE FROM visits WHERE rowid <= (SELECT rowid FROM visits ORDER BY rowid DESC LIMIT 1 OFFSET ?)', KEEP_VISITS);
  }

  /** The report for a span: night as the board's night, day and week the last 24 hours and 7 days, all everything kept. */
  report(span: ReportSpan, now = Date.now()): NightReport {
    const since = span === 'night' ? nightStart(now) : span === 'day' ? now - DAY_MS : span === 'week' ? now - 7 * DAY_MS : 0;
    const fights = this.sql
      .exec<StoredFight>('SELECT seq, start, data FROM fights WHERE start >= ? ORDER BY start, seq', since)
      .toArray()
      .map((row) => JSON.parse(row.data) as Fight);
    // A visit's row is its hour; the night turns at four sharp in New York, always on the hour.
    const visits = this.sql.exec<StoredVisit>('SELECT id, hour FROM visits WHERE hour >= ?', Math.floor(since / HOUR_MS)).toArray();
    // For all, the window opens at the oldest thing kept.
    const from = span === 'all' ? Math.min(now, fights[0]?.start ?? now, ...visits.map((v) => v.hour * HOUR_MS)) : since;
    const report = summarize(span, fights, visits.map((v) => v.id), now, from);
    if (span === 'night' || span === 'day') report.fights = fights;
    return report;
  }
}
