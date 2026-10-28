import { relayUrl, type Role } from './relay';

/*
 * The page's end of the relay's lobby: the player here under the name they gave, the list of who
 * else is, how many are online, waiting and fighting, and the challenges and the queue that end
 * in a room. One socket for as long as the
 * game is open with a folder, closed while a fight is on and opened again after; it comes back by
 * itself when the wire drops. What the lobby has said is folded into one state the screens draw.
 */

const NAME = 'makgora.name';
const ID = 'makgora.id';
/** A ping this often keeps the socket open; the lobby itself says who is here every 20 seconds. */
const PING_MS = 25_000;
/** Heard nothing for this long: the socket is dead whatever it says, and is opened again. */
const DEAF_MS = 50_000;

export interface LobbyPlayer {
  id: string;
  name: string;
  status: 'free' | 'busy';
  /** Tonight's wins and losses, once they have fought tonight. */
  night?: [number, number];
}

/** A fight on now, as the lobby lists it for watching: its room, and the host's and the guest's names and ids. */
export interface LobbyFight {
  code: string;
  names: [string, string];
  ids: [string, string];
  /** When both came into the room, by the relay's clock. */
  since: number;
}

/** The lobby's numbers, as every list of who is here and GET /lobby/stats give them. */
export interface Counts {
  online: number;
  waiting: number;
  fighting: number;
}

/** A challenge one way or the other: who, and when it lapses (this page's clock). */
export interface Pending {
  id: string;
  name: string;
  until: number;
}

export interface LobbyState {
  /** The socket is open. */
  connected: boolean;
  /** Everyone here, this player too, in the order they came. */
  players: LobbyPlayer[];
  /** The challenge this player made and waits on. */
  outgoing?: Pending;
  /** The challenge this player has been sent. */
  incoming?: Pending;
  /** In the queue, waiting for anybody. */
  queued: boolean;
  /** When this page went into the queue (its own clock), for the count-up. */
  queuedAt?: number;
  /** Waiting in Booby Bay, the queue's secret corner (bay.ts), where only those who found it are paired. */
  bay?: boolean;
  /** How many are online, waiting and fighting. */
  counts: Counts;
  /** The fights on now that the lobby made, to watch. */
  fights: LobbyFight[];
  /** The last thing worth saying: a decline, a refusal. */
  notice?: string;
}

export const EMPTY: LobbyState = { connected: false, players: [], queued: false, counts: { online: 0, waiting: 0, fighting: 0 }, fights: [] };

/** What the lobby sends. */
export type LobbyMessage =
  | ({ t: 'here'; players: LobbyPlayer[]; fights?: LobbyFight[] } & Partial<Counts>)
  | { t: 'challenged'; from: { id: string; name: string }; ttl: number }
  | { t: 'challenging'; to: { id: string; name: string }; ttl: number }
  | { t: 'declined'; by: string; reason: string }
  | { t: 'withdrawn'; from: string; reason: string }
  | { t: 'queued'; since?: number; bay?: boolean }
  | { t: 'unqueued'; reason?: string }
  | { t: 'fight'; code: string; role: Role; with: { id: string; name: string }; bay?: boolean }
  | { t: 'error'; message: string };

/** A match the lobby made: the room, this page's part in it, and the other player. */
export interface Match {
  code: string;
  role: Role;
  with: { id: string; name: string };
  /** The queue made it, not a challenge: a stranger, whom the page shows before the roster. */
  queued: boolean;
  /** Booby Bay made it: both play its two champions. */
  bay?: boolean;
}

/** A display name as the lobby takes it: letters, digits and single spaces, 2 to 16; undefined when it is not one. */
export function cleanName(raw: string): string | undefined {
  const name = raw.trim().replace(/\s+/g, ' ');
  return /^[\p{L}\p{N} ]{2,16}$/u.test(name) ? name : undefined;
}

/** What may be typed into the name field as it is typed: anything else is dropped, and no more than 16. */
export function typingName(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} ]/gu, '').replace(/ {2,}/g, ' ').replace(/^ /, '').slice(0, 16);
}

/** The name this browser gave, if it gave one. */
export function savedName(): string | undefined {
  try {
    return cleanName(localStorage.getItem(NAME) ?? '');
  } catch {
    return undefined;
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME, name);
  } catch {
    // Storage blocked: the name lasts for this visit.
  }
}

/** The lobby's numbers without coming into it, from GET /lobby/stats. */
export async function lobbyStats(base = relayUrl()): Promise<Counts> {
  const response = await fetch(`${base}/lobby/stats`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`The relay answered ${response.status}.`);
  const { online, waiting, fighting } = (await response.json()) as Counts;
  return { online: Number(online) || 0, waiting: Number(waiting) || 0, fighting: Number(fighting) || 0 };
}

/** Which board: tonight's (from four in the morning in New York) or all time's. */
export type Span = 'night' | 'all';

/** A line on the board, as GET /lobby/board answers it. */
export interface BoardRow {
  rank: number;
  name: string;
  wins: number;
  losses: number;
  /** The longest run of wins, and the run going now. */
  best: number;
  streak: number;
  /** This player's own row. */
  me?: boolean;
}

export interface Standings {
  span: Span;
  /** The night, as its date in New York. */
  night: string;
  rows: BoardRow[];
  /** This player's row, wherever it stands; absent when they have no record in the span. */
  mine?: BoardRow;
}

/** The board's top and this player's own row, from GET /lobby/board. */
export async function lobbyBoard(span: Span, id?: string, base = relayUrl()): Promise<Standings> {
  const response = await fetch(`${base}/lobby/board?span=${span}${id ? `&id=${encodeURIComponent(id)}` : ''}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`The relay answered ${response.status}.`);
  return (await response.json()) as Standings;
}

/** How many the panel shows. */
export const TOP = 10;

/** The rows the TOP TEN panel shows (or the first `top`), and this player's own row under them when it is not among them. */
export function topTen(standings: Standings, top = TOP): { rows: BoardRow[]; pinned?: BoardRow } {
  const rows = standings.rows.slice(0, top);
  const pinned = standings.mine && !rows.some((row) => row.me) ? standings.mine : undefined;
  return pinned ? { rows, pinned } : { rows };
}

/** A record as WHO'S HERE shows it: "3-1". */
export const recordText = ([wins, losses]: [number, number]) => `${wins}-${losses}`;

/** A fresh id; randomUUID is only there on https and localhost, not on a dev server reached by its address. */
function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

let visitId: string | undefined;
/** The random id this browser keeps, made the first time it is asked for. */
export function playerId(): string {
  try {
    const kept = localStorage.getItem(ID);
    if (kept && /^[A-Za-z0-9-]{8,40}$/.test(kept)) return kept;
    const made = newId();
    localStorage.setItem(ID, made);
    return made;
  } catch {
    visitId ??= newId();
    return visitId;
  }
}

const nameOf = (state: LobbyState, id: string) => state.players.find((p) => p.id === id)?.name ?? state.outgoing?.name ?? 'They';

/** Folds one message from the lobby into the state; `now` is this page's clock, for the thirty seconds. */
export function fold(state: LobbyState, message: LobbyMessage, now: number): LobbyState {
  switch (message.t) {
    case 'here': {
      const { online = message.players.length, waiting = 0, fighting = 0 } = message;
      return { ...state, players: message.players, counts: { online, waiting, fighting }, fights: message.fights ?? [] };
    }
    case 'challenged':
      return { ...state, incoming: { ...message.from, until: now + message.ttl }, notice: undefined };
    case 'challenging':
      return { ...state, outgoing: { ...message.to, until: now + message.ttl }, queued: false, queuedAt: undefined, notice: undefined };
    case 'declined': {
      if (state.outgoing?.id !== message.by) return state;
      const name = nameOf(state, message.by);
      const why: Record<string, string> = {
        declined: `${name} declined.`,
        timeout: `${name} did not answer.`,
        left: `${name} left.`,
        busy: `${name} went into another match.`,
      };
      return { ...state, outgoing: undefined, notice: why[message.reason] ?? `${name} cannot fight now.` };
    }
    case 'withdrawn': {
      if (state.incoming?.id !== message.from) return state;
      const name = state.incoming.name;
      const why: Record<string, string> = { cancelled: `${name} took the challenge back.`, left: `${name} left.` };
      return { ...state, incoming: undefined, notice: why[message.reason] ?? state.notice };
    }
    case 'queued':
      // Already waiting (asked twice): the count-up goes on from where it was.
      // Into the bay or out of it is a new wait, counted from nothing.
      return { ...state, queued: true, queuedAt: state.queued && !!state.bay === !!message.bay ? state.queuedAt : now, bay: message.bay === true, outgoing: undefined, notice: undefined };
    case 'unqueued':
      return {
        ...state,
        queued: false,
        queuedAt: undefined,
        bay: undefined,
        notice: message.reason === 'idle' ? 'Ten minutes and nobody came; you are out of the queue. Q to wait again.' : state.notice,
      };
    case 'fight':
      return { ...state, incoming: undefined, outgoing: undefined, queued: false, queuedAt: undefined, bay: undefined, notice: undefined };
    case 'error':
      return { ...state, notice: message.message };
  }
}

/** Whether the socket should be open, and if so whether this page is in an online match. */
export type LobbyMode = 'off' | 'free' | 'busy';

export class Lobby {
  state: LobbyState = EMPTY;
  private ws: WebSocket | undefined;
  private mode: LobbyMode = 'off';
  /** The socket open now was opened busy, or the lobby has made it busy with a match. */
  private busy = false;
  /** This page wants to be in the queue: a socket opened free asks for it as it opens (requeue=1), after a match or a dropped wire. */
  private wantQueue = false;
  /** The queue this page wants is Booby Bay's: kept through a match, so NEXT OPPONENT goes back into the bay. */
  private wantBay = false;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private heard = 0;
  /** Another tab of this browser took this page's place in the lobby: no trying again until this tab is looked at. */
  private replaced = false;
  private readonly onVisible = () => {
    if (document.visibilityState !== 'visible' || !this.replaced || this.mode === 'off' || this.ws) return;
    this.replaced = false;
    this.connect();
  };
  private readonly watchers = new Set<(state: LobbyState) => void>();
  private readonly matches = new Set<(match: Match) => void>();

  constructor(
    private name: string,
    readonly id = playerId(),
    private readonly base = relayUrl(),
  ) {}

  /**
   * Off closes the socket; free or busy opens it. One open the other way comes again, so the lobby
   * lists the page as it is: free once back from an online match, busy in one the lobby did not
   * make (a code), unless the lobby made it busy itself.
   */
  setMode(mode: LobbyMode): void {
    this.mode = mode;
    if (mode === 'off') return this.shut();
    if (!this.ws) return this.connect();
    if ((mode === 'busy') !== this.busy) {
      this.shut();
      this.connect();
    }
  }

  /** Another name: the socket comes again under it. */
  rename(name: string): void {
    this.name = name;
    if (this.mode === 'off') return;
    this.shut();
    this.connect();
  }

  watch(listener: (state: LobbyState) => void): () => void {
    this.watchers.add(listener);
    listener(this.state);
    return () => this.watchers.delete(listener);
  }

  onMatch(listener: (match: Match) => void): () => void {
    this.matches.add(listener);
    return () => this.matches.delete(listener);
  }

  /** The other players, without this one. */
  others(): LobbyPlayer[] {
    return this.state.players.filter((p) => p.id !== this.id);
  }

  challenge(id: string): void {
    this.send({ t: 'challenge', to: id });
  }

  cancel(): void {
    if (this.state.outgoing) this.send({ t: 'cancel', to: this.state.outgoing.id });
    this.set({ ...this.state, outgoing: undefined });
  }

  accept(): void {
    if (this.state.incoming) this.send({ t: 'accept', from: this.state.incoming.id });
    this.set({ ...this.state, incoming: undefined });
  }

  decline(): void {
    if (this.state.incoming) this.send({ t: 'decline', from: this.state.incoming.id });
    this.set({ ...this.state, incoming: undefined });
  }

  /** Into the queue or out of it; `bay` into Booby Bay's corner of it (a page already waiting moves there). */
  quick(on: boolean, bay = false): void {
    this.wantQueue = on;
    this.wantBay = on && bay;
    this.send(on ? (bay ? { t: 'quick', bay: true } : { t: 'quick' }) : { t: 'unquick' });
  }

  /** Out of the queue and no wish to be put back in it, connected or not: the panel shut. */
  leaveQueue(): void {
    const asked = this.state.queued || this.wantQueue;
    this.wantQueue = false;
    this.wantBay = false;
    if (asked && this.ws?.readyState === WebSocket.OPEN) this.send({ t: 'unquick' });
  }

  /**
   * NEXT OPPONENT: into the queue as soon as the lobby has this page free. A socket open free asks
   * now; otherwise the next one opened free (once the match is left) comes in with requeue=1.
   */
  queueAgain(): void {
    this.wantQueue = true;
    if (this.ws?.readyState === WebSocket.OPEN && !this.busy) this.send(this.wantBay ? { t: 'quick', bay: true } : { t: 'quick' });
  }

  /** Forgets the last notice once it has been read. */
  clearNotice(): void {
    if (this.state.notice) this.set({ ...this.state, notice: undefined });
  }

  close(): void {
    this.setMode('off');
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
    this.watchers.clear();
    this.matches.clear();
  }

  private connect(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.replaced = false;
    const busy = this.mode === 'busy';
    const query = `name=${encodeURIComponent(this.name)}&id=${encodeURIComponent(this.id)}${busy ? '&busy=1' : this.wantQueue ? `&busy=0&requeue=1${this.wantBay ? '&bay=1' : ''}` : ''}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${this.base.replace(/^http/, 'ws')}/lobby/ws?${query}`);
    } catch {
      this.again();
      return;
    }
    this.ws = ws;
    this.busy = busy;
    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      this.retry = 0;
      this.heard = Date.now();
      this.set({ ...this.state, connected: true });
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (Date.now() - this.heard > DEAF_MS) ws.close();
        else if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, PING_MS);
    });
    ws.addEventListener('message', (event) => {
      if (this.ws !== ws) return;
      this.heard = Date.now();
      if (typeof event.data !== 'string' || event.data === 'pong') return;
      let message: LobbyMessage;
      try {
        message = JSON.parse(event.data) as LobbyMessage;
      } catch {
        return;
      }
      // Matched the moment it came back with requeue=1, the page never heard it was queued: it was, all the same.
      const wasQueued = this.state.queued || this.wantQueue;
      this.set(fold(this.state, message, performance.now()));
      if (message.t === 'queued') {
        this.wantQueue = true;
        this.wantBay = message.bay === true;
      } else if (message.t === 'unqueued' || message.t === 'challenging') {
        this.wantQueue = false;
        this.wantBay = false;
      } else if (message.t === 'fight') {
        this.wantQueue = false;
        // A challenge is never the bay's: only a match the bay made keeps the page there for the next one.
        this.wantBay = message.bay === true;
      }
      // A refusal (asking for the queue while still in a match) leaves the wish unmet, not pending.
      else if (message.t === 'error' && !this.state.queued) this.wantQueue = false;
      if (message.t === 'fight') {
        this.busy = true;
        for (const listener of [...this.matches]) listener({ code: message.code, role: message.role, with: message.with, queued: wasQueued, bay: message.bay === true });
      }
    });
    const lost = (event?: CloseEvent) => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      clearInterval(this.pingTimer);
      // 4000: a newer socket of this browser (another tab) took the place. Trying again would take it
      // back, and that tab would do the same a second later, for ever; this one waits to be looked at.
      if (event?.code === 4000) {
        this.replaced = true;
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible);
        this.set({ ...EMPTY, notice: 'The game is open online in another tab of this browser.' });
        return;
      }
      this.set({ ...EMPTY, notice: this.state.notice });
      this.again();
    };
    ws.addEventListener('close', (event) => lost(event));
    ws.addEventListener('error', () => lost());
  }

  /** Tries again after a wait that doubles each time, up to fifteen seconds. */
  private again(): void {
    if (this.mode === 'off' || this.retryTimer !== undefined) return;
    const wait = Math.min(15_000, 1000 * 2 ** this.retry++);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.mode !== 'off' && !this.ws) this.connect();
    }, wait);
  }

  private shut(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = undefined;
    this.busy = false;
    try {
      ws?.close(1000, 'away');
    } catch {
      // Already gone.
    }
    if (ws) this.set({ ...EMPTY });
  }

  private send(message: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
    else this.set({ ...this.state, notice: 'Not in the lobby yet; trying to reach it.' });
  }

  private set(state: LobbyState): void {
    this.state = state;
    for (const listener of [...this.watchers]) listener(state);
  }
}
