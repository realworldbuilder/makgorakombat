import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';
import { cleanName } from './lobby';

/*
 * What players say at the end of a fight, for the two of us. The match-end screen offers SEND
 * FEEDBACK (F); what is written comes here as POST /feedback, sent as plain text so the browser
 * asks no leave first, with the fight it followed: when, the two champions, the ground, who won,
 * against the computer, a friend at the same keyboard or somebody online, which side the sender
 * played, the game and the build. The name the player gave the lobby comes too, if they gave one;
 * nothing else of theirs. One Durable Object keeps it in SQLite, a year and 10,000 messages at
 * most, the oldest going first.
 *
 * A page may send a few: FEEDBACK_PER_IP in FEEDBACK_WINDOW_MS from one address, counted in the
 * object's memory and never written down, so a restart forgets them; and FEEDBACK_PER_DAY from
 * everyone together, counted from what is kept, so a flood stops at a day's worth whatever its
 * addresses. Reading it back is GET /feedback with the FEEDBACK_TOKEN secret as a bearer token.
 */

/** The one store's name. */
export const FEEDBACK = 'feedback';
/** The most a message may say, as the game's box allows. */
export const MAX_FEEDBACK = 1000;
/** The most a request may carry, the message and the fight together. */
export const MAX_BODY = 4096;
/** One address may send this many, */
export const FEEDBACK_PER_IP = 5;
/** in this long. */
export const FEEDBACK_WINDOW_MS = 10 * 60 * 1000;
/** Everyone together, this many a day. */
export const FEEDBACK_PER_DAY = 500;
/** Kept this long at most, */
export const KEEP_MS = 365 * 24 * 60 * 60 * 1000;
/** and this many at most. */
export const KEEP_FEEDBACK = 10_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export const MODES = ['cpu', 'local', 'online'] as const;
export type Mode = (typeof MODES)[number];

/** A message as it is kept and read back. */
export interface Feedback {
  id: number;
  /** When it came, in milliseconds. */
  t: number;
  text: string;
  /** One to five, when the player gave one. */
  rating?: number;
  mode: Mode;
  /** The two champions, player 1's first. */
  fighters: string[];
  stage?: string;
  /** The side that won the match, 0 or 1; none for a match with no winner. */
  winner?: 0 | 1;
  /** The side the sender played: online their own, at one keyboard none. */
  me?: 0 | 1;
  game?: string;
  build?: string;
  /** The name they gave the lobby, if any. */
  name?: string;
}

/** A message as the worker hands it on, before it has an id and a time. */
export type Incoming = Omit<Feedback, 'id' | 't'>;

const clip = (value: unknown, n: number): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, n) : undefined);
const side = (value: unknown): 0 | 1 | undefined => (value === 0 || value === 1 ? value : undefined);

/**
 * A message as a page sends it, `{text, rating?, mode, fighters, stage?, winner?, me?, game?, build?, name?}`,
 * checked and cut to size; or why it is refused, with the status to answer.
 */
export function readFeedback(body: string): Incoming | { refused: string; status: number } {
  if (body.length > MAX_BODY) return { refused: 'Too long.', status: 413 };
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(body);
  } catch {
    return { refused: 'Not JSON.', status: 400 };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { refused: 'Not a message.', status: 400 };
  const text = typeof value.text === 'string' ? value.text.trim() : '';
  if (text === '') return { refused: 'Nothing written.', status: 400 };
  if (text.length > MAX_FEEDBACK) return { refused: `At most ${MAX_FEEDBACK} characters.`, status: 413 };
  if (!MODES.includes(value.mode as Mode)) return { refused: 'mode is cpu, local or online.', status: 400 };
  const fighters = value.fighters;
  if (!Array.isArray(fighters) || fighters.length !== 2) return { refused: 'fighters is the two champions.', status: 400 };
  const names = fighters.map((f) => clip(f, 60));
  if (!names[0] || !names[1]) return { refused: 'fighters is the two champions.', status: 400 };
  const rating = value.rating;
  if (rating !== undefined && rating !== null && !(Number.isInteger(rating) && (rating as number) >= 1 && (rating as number) <= 5)) {
    return { refused: 'rating is 1 to 5.', status: 400 };
  }
  const message: Incoming = { text, mode: value.mode as Mode, fighters: [names[0], names[1]] };
  if (typeof rating === 'number') message.rating = rating;
  const stage = clip(value.stage, 80);
  if (stage) message.stage = stage;
  const winner = side(value.winner);
  if (winner !== undefined) message.winner = winner;
  const me = side(value.me);
  if (me !== undefined) message.me = me;
  const game = clip(value.game, 30);
  if (game) message.game = game;
  const build = clip(value.build, 40);
  if (build) message.build = build;
  const name = typeof value.name === 'string' ? cleanName(value.name) : undefined;
  if (name) message.name = name;
  return message;
}

/** Whether a request carries the token, compared in constant time; never when no token is set. */
export async function authorized(header: string | null, token: string | undefined): Promise<boolean> {
  if (!token || !header?.startsWith('Bearer ')) return false;
  const digest = async (text: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return crypto.subtle.timingSafeEqual(await digest(header.slice('Bearer '.length).trim()), await digest(token));
}

/** The messages as lines to read in a terminal, newest first. */
export function asText(messages: readonly Feedback[]): string {
  const sides = (m: Feedback, n: 0 | 1) => `${m.fighters[n]}${m.winner === n ? ' (won)' : ''}${m.me === n ? ' [sender]' : ''}`;
  return messages
    .map((m) => {
      const about = [m.mode, `${sides(m, 0)} vs ${sides(m, 1)}`, m.stage, m.rating ? `${'*'.repeat(m.rating)}${'.'.repeat(5 - m.rating)}` : undefined, m.name ? `from ${m.name}` : undefined, m.game, m.build && `build ${m.build}`];
      return `#${m.id} ${new Date(m.t).toISOString()} · ${about.filter(Boolean).join(' · ')}\n${m.text}\n`;
    })
    .join('\n');
}

type Row = {
  id: number;
  t: number;
  text: string;
  rating: number | null;
  mode: string;
  p1: string;
  p2: string;
  stage: string | null;
  winner: number | null;
  me: number | null;
  game: string | null;
  build: string | null;
  name: string | null;
};

function fromRow(row: Row): Feedback {
  const message: Feedback = { id: row.id, t: row.t, text: row.text, mode: row.mode as Mode, fighters: [row.p1, row.p2] };
  if (row.rating !== null) message.rating = row.rating;
  if (row.stage !== null) message.stage = row.stage;
  if (row.winner === 0 || row.winner === 1) message.winner = row.winner;
  if (row.me === 0 || row.me === 1) message.me = row.me;
  if (row.game !== null) message.game = row.game;
  if (row.build !== null) message.build = row.build;
  if (row.name !== null) message.name = row.name;
  return message;
}

export class FeedbackStore extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  /** When each address last sent, in memory only. */
  private readonly sent = new Map<string, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      t INTEGER NOT NULL,
      text TEXT NOT NULL,
      rating INTEGER,
      mode TEXT NOT NULL,
      p1 TEXT NOT NULL,
      p2 TEXT NOT NULL,
      stage TEXT,
      winner INTEGER,
      me INTEGER,
      game TEXT,
      build TEXT,
      name TEXT
    )`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS feedback_t ON feedback (t)');
  }

  /** Keeps a message, unless its address or everyone has sent enough for now: then why not. */
  async add(message: Incoming, address: string, now = Date.now()): Promise<{ ok: true; id: number } | { ok: false; refused: string; status: number }> {
    const recent = (this.sent.get(address) ?? []).filter((t) => t > now - FEEDBACK_WINDOW_MS);
    if (recent.length >= FEEDBACK_PER_IP) return { ok: false, refused: 'Thanks, that is plenty for now.', status: 429 };
    const today = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM feedback WHERE t > ?', now - DAY_MS).one().n;
    if (today >= FEEDBACK_PER_DAY) return { ok: false, refused: 'The box is full for today.', status: 429 };
    recent.push(now);
    this.sent.set(address, recent);
    // The map is let go of addresses that have gone quiet.
    if (this.sent.size > 1000) for (const [key, times] of this.sent) if (times.every((t) => t <= now - FEEDBACK_WINDOW_MS)) this.sent.delete(key);
    const { id } = this.sql
      .exec<{ id: number }>(
        'INSERT INTO feedback (t, text, rating, mode, p1, p2, stage, winner, me, game, build, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
        now,
        message.text,
        message.rating ?? null,
        message.mode,
        message.fighters[0],
        message.fighters[1],
        message.stage ?? null,
        message.winner ?? null,
        message.me ?? null,
        message.game ?? null,
        message.build ?? null,
        message.name ?? null,
      )
      .one();
    this.prune(now);
    return { ok: true, id };
  }

  /** Messages older than a year, and past the 10,000th, go. */
  prune(now = Date.now()): void {
    this.sql.exec('DELETE FROM feedback WHERE t < ?', now - KEEP_MS);
    this.sql.exec('DELETE FROM feedback WHERE id <= (SELECT id FROM feedback ORDER BY id DESC LIMIT 1 OFFSET ?)', KEEP_FEEDBACK);
  }

  /** The newest `limit` messages, or those before the id `before`, newest first. */
  async list(limit = 100, before?: number): Promise<Feedback[]> {
    const rows = before === undefined
      ? this.sql.exec<Row>('SELECT * FROM feedback ORDER BY id DESC LIMIT ?', limit)
      : this.sql.exec<Row>('SELECT * FROM feedback WHERE id < ? ORDER BY id DESC LIMIT ?', before, limit);
    return rows.toArray().map(fromRow);
  }
}
