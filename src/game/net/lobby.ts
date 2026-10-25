import { relayUrl, type Role } from './relay';

/*
 * The page's end of the relay's lobby: the player here under the name they gave, the list of who
 * else is, and the challenges and quick matches that end in a room. One socket for as long as the
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
  /** In line for a quick match. */
  queued: boolean;
  /** The last thing worth saying: a decline, a refusal. */
  notice?: string;
}

export const EMPTY: LobbyState = { connected: false, players: [], queued: false };

/** What the lobby sends. */
export type LobbyMessage =
  | { t: 'here'; players: LobbyPlayer[] }
  | { t: 'challenged'; from: { id: string; name: string }; ttl: number }
  | { t: 'challenging'; to: { id: string; name: string }; ttl: number }
  | { t: 'declined'; by: string; reason: string }
  | { t: 'withdrawn'; from: string; reason: string }
  | { t: 'queued' }
  | { t: 'unqueued' }
  | { t: 'fight'; code: string; role: Role; with: { id: string; name: string } }
  | { t: 'error'; message: string };

/** A match the lobby made: the room, this page's part in it, and the other player. */
export interface Match {
  code: string;
  role: Role;
  with: { id: string; name: string };
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

let visitId: string | undefined;
/** The random id this browser keeps, made the first time it is asked for. */
export function playerId(): string {
  try {
    const kept = localStorage.getItem(ID);
    if (kept && /^[A-Za-z0-9-]{8,40}$/.test(kept)) return kept;
    const made = crypto.randomUUID();
    localStorage.setItem(ID, made);
    return made;
  } catch {
    visitId ??= crypto.randomUUID();
    return visitId;
  }
}

const nameOf = (state: LobbyState, id: string) => state.players.find((p) => p.id === id)?.name ?? state.outgoing?.name ?? 'They';

/** Folds one message from the lobby into the state; `now` is this page's clock, for the thirty seconds. */
export function fold(state: LobbyState, message: LobbyMessage, now: number): LobbyState {
  switch (message.t) {
    case 'here':
      return { ...state, players: message.players };
    case 'challenged':
      return { ...state, incoming: { ...message.from, until: now + message.ttl }, notice: undefined };
    case 'challenging':
      return { ...state, outgoing: { ...message.to, until: now + message.ttl }, queued: false, notice: undefined };
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
      return { ...state, queued: true, outgoing: undefined, notice: undefined };
    case 'unqueued':
      return { ...state, queued: false };
    case 'fight':
      return { ...state, incoming: undefined, outgoing: undefined, queued: false, notice: undefined };
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
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private heard = 0;
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

  quick(on: boolean): void {
    this.send({ t: on ? 'quick' : 'unquick' });
  }

  /** Forgets the last notice once it has been read. */
  clearNotice(): void {
    if (this.state.notice) this.set({ ...this.state, notice: undefined });
  }

  close(): void {
    this.setMode('off');
    this.watchers.clear();
    this.matches.clear();
  }

  private connect(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    const busy = this.mode === 'busy';
    const query = `name=${encodeURIComponent(this.name)}&id=${encodeURIComponent(this.id)}${busy ? '&busy=1' : ''}`;
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
      this.set(fold(this.state, message, performance.now()));
      if (message.t === 'fight') {
        this.busy = true;
        for (const listener of [...this.matches]) listener({ code: message.code, role: message.role, with: message.with });
      }
    });
    const lost = () => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      clearInterval(this.pingTimer);
      this.set({ ...EMPTY, notice: this.state.notice });
      this.again();
    };
    ws.addEventListener('close', lost);
    ws.addEventListener('error', lost);
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
