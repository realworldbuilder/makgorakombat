/*
 * The board: who has won and lost how often, by the id each browser keeps, under the name they
 * were last seen by. The lobby keeps it in its own SQLite storage, one row a player, and the rooms
 * tell it each match's result once both pages have said the same thing about it. Every row has
 * the player's whole record and the record of the night, a night running from four in the
 * morning in New York to four the next; a row last touched on an earlier night starts the night
 * at nothing. GET /lobby/board answers the top twenty of either, most wins first.
 */

/** One side of a result: the browser's id and the name it fought under. */
export interface Fighter {
  id: string;
  name: string;
}

/** A match fought to its end, as a room tells the lobby. */
export interface Result {
  t: 'result';
  winner: Fighter;
  loser: Fighter;
  /** Rounds fought, and the ticks the match ran for. */
  rounds: number;
  ticks: number;
}

export type Span = 'night' | 'all';

/** A line on the board. */
export interface Row {
  rank: number;
  name: string;
  wins: number;
  losses: number;
  /** The longest run of wins, and the run going now. */
  best: number;
  streak: number;
  /** The asking player's own row. */
  me?: boolean;
}

export interface Standings {
  span: Span;
  /** The night it is, as its date in New York. */
  night: string;
  rows: Row[];
  /** The asking player's row, whether or not it is among the rows; absent when they have none. */
  mine?: Row;
}

/** How many rows the board shows. */
export const BOARD_SIZE = 20;
/** The night turns over at this hour in New York. */
const NIGHT_HOUR = 4;

const newYork = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });

/** The night a moment belongs to: the date in New York, the date before until four in the morning. */
export function nightOf(ms: number): string {
  const parts = Object.fromEntries(newYork.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const day = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  if (Number(parts.hour) < NIGHT_HOUR) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

// A type, not an interface, so it satisfies the SQL rows' index signature.
type Stored = {
  id: string;
  name: string;
  wins: number;
  losses: number;
  best: number;
  streak: number;
  night: string;
  night_wins: number;
  night_losses: number;
  night_best: number;
  night_streak: number;
};

const ORDER: Record<Span, string> = {
  all: 'wins DESC, best DESC, streak DESC, losses ASC, name ASC',
  night: 'night_wins DESC, night_best DESC, night_streak DESC, night_losses ASC, name ASC',
};

export class Board {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS board (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      best INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      night TEXT NOT NULL DEFAULT '',
      night_wins INTEGER NOT NULL DEFAULT 0,
      night_losses INTEGER NOT NULL DEFAULT 0,
      night_best INTEGER NOT NULL DEFAULT 0,
      night_streak INTEGER NOT NULL DEFAULT 0
    )`);
  }

  /** A match's result onto both rows. The same browser on both sides counts nothing. */
  record(result: Result, now = Date.now()): void {
    if (result.winner.id === result.loser.id) return;
    const night = nightOf(now);
    this.add(result.winner, true, night);
    this.add(result.loser, false, night);
  }

  /** The top of the board for the span, and the asking player's own row. */
  standings(span: Span, id?: string, now = Date.now()): Standings {
    const night = nightOf(now);
    // Only rows touched tonight are on tonight's board; a player with a whole record and nothing tonight is not.
    const where = span === 'night' ? 'WHERE night = ? AND night_wins + night_losses > 0' : 'WHERE wins + losses > 0';
    const rows = this.sql.exec<Stored>(`SELECT * FROM board ${where} ORDER BY ${ORDER[span]}`, ...(span === 'night' ? [night] : [])).toArray();
    const all = rows.map((row, k) => this.row(row, span, k + 1, row.id === id));
    const mine = all.find((row) => row.me);
    return { span, night, rows: all.slice(0, BOARD_SIZE), ...(mine ? { mine } : {}) };
  }

  /** Tonight's wins and losses for each of the ids that has any. */
  tonight(ids: string[], now = Date.now()): Map<string, [number, number]> {
    const records = new Map<string, [number, number]>();
    if (ids.length === 0) return records;
    const night = nightOf(now);
    const rows = this.sql
      .exec<Stored>(`SELECT * FROM board WHERE night = ? AND id IN (${ids.map(() => '?').join(', ')})`, night, ...ids)
      .toArray();
    for (const row of rows) if (row.night_wins + row.night_losses > 0) records.set(row.id, [row.night_wins, row.night_losses]);
    return records;
  }

  private add(who: Fighter, won: boolean, night: string): void {
    const old = this.sql.exec<Stored>('SELECT * FROM board WHERE id = ?', who.id).toArray()[0];
    const tonight = old?.night === night;
    const streak = won ? (old?.streak ?? 0) + 1 : 0;
    const nightStreak = won ? (tonight ? old.night_streak : 0) + 1 : 0;
    this.sql.exec(
      `INSERT OR REPLACE INTO board (id, name, wins, losses, best, streak, night, night_wins, night_losses, night_best, night_streak)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      who.id,
      who.name,
      (old?.wins ?? 0) + (won ? 1 : 0),
      (old?.losses ?? 0) + (won ? 0 : 1),
      Math.max(old?.best ?? 0, streak),
      streak,
      night,
      (tonight ? old.night_wins : 0) + (won ? 1 : 0),
      (tonight ? old.night_losses : 0) + (won ? 0 : 1),
      Math.max(tonight ? old.night_best : 0, nightStreak),
      nightStreak,
    );
  }

  private row(stored: Stored, span: Span, rank: number, me: boolean): Row {
    const row: Row =
      span === 'night'
        ? { rank, name: stored.name, wins: stored.night_wins, losses: stored.night_losses, best: stored.night_best, streak: stored.night_streak }
        : { rank, name: stored.name, wins: stored.wins, losses: stored.losses, best: stored.best, streak: stored.streak };
    if (me) row.me = true;
    return row;
  }
}
