import { type Message, decode, encode } from './handshake';
import type { Channel } from './lockstep';

/*
 * The page's end of the relay (relay/ in this repository): make a room, join one, and the
 * open socket as a Link the screens talk through. Text is the screens' messages, bytes the
 * fight's frames. The relay is the one the site was built for unless SETTINGS names another, so
 * anyone can run their own; both players must use the same one.
 */

/**
 * The relay the site was built for: the repository's RELAY_URL variable, which the Deploy workflow
 * hands the build as VITE_RELAY_URL once the Relay workflow has deployed one; Chris's deploy on
 * workers.dev until then.
 */
export const RELAY_URL = ((import.meta.env.VITE_RELAY_URL as string | undefined) || 'https://makgora-relay.clawdgross.workers.dev').replace(/\/$/, '');
const STORAGE = 'makgora.relay';
/**
 * A ping to the room this often keeps the socket open through quiet screens, times the wire, and
 * tells the room this page is still there: it takes a seat silent for six seconds for dropped.
 */
const PING_MS = 2000;
/** A ping unanswered this long means the socket is dead though it never closed (Wi-Fi pulled): it is dropped and made again. */
const DEAD_MS = 4000;
/** How long the room keeps a dropped player's seat (RECONNECT_MS in relay/src/index.ts), and so how long the link tries to get back to it. */
export const RECONNECT_MS = 20_000;
/** The waits between tries at the room after a drop: one second, doubling, then five seconds each. */
const RETRY_MS = [1000, 2000, 4000, 5000];
/** A try that has not opened in this long is given up for the next. */
const TRY_MS = 4000;
/** Screens' messages sent while the socket is down wait for it, up to this many. */
const QUEUE_MAX = 100;

/** The relay in use: the one named in SETTINGS, else the site's. */
export function relayUrl(): string {
  try {
    const kept = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE) : null;
    if (kept) return kept;
  } catch {
    // Storage blocked: the default.
  }
  return RELAY_URL;
}

/** Name another relay, or the default again with an empty one. */
export function setRelayUrl(url: string): void {
  try {
    const clean = url.trim().replace(/\/+$/, '');
    if (clean === '' || clean === RELAY_URL) localStorage.removeItem(STORAGE);
    else localStorage.setItem(STORAGE, clean);
  } catch {
    // Storage blocked: nothing kept.
  }
}

export type Role = 'host' | 'guest';

/** Six letters, upper case, of the relay's alphabet. */
export const CODE_LETTERS = 'BCDFGHJKMNPQRSTVWXZ';
export function cleanCode(text: string): string {
  return text.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
}

/** Makes a room on the relay and answers its code. */
export async function createRoom(base = relayUrl()): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${base}/rooms`, { method: 'POST' });
  } catch {
    throw new Error(`The relay at ${base} could not be reached.`);
  }
  if (!response.ok) throw new Error(`The relay would not make a room: ${response.status} ${await response.text()}`);
  const { code } = (await response.json()) as { code: string };
  return code;
}

type Listener = (message: Message) => void;

/** Messages a screen opened late still wants: the last of each of these kinds is kept and handed to a new listener. */
const STICKY = new Set<Message['t']>(['meet', 'roster', 'stage', 'hello']);

/** How the wire stands, for a screen that shows it. */
export interface Wire {
  /** The other player's socket dropped and the room is keeping their seat. */
  away: boolean;
  /** Our own socket dropped and the link is trying the room again. */
  reconnecting: boolean;
  /** While either: when the seat is given up, on performance.now()'s clock. */
  until: number | undefined;
}

/** An id for this link's seat: the room lets back only the page that gives it again. */
function seatId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/**
 * One player's socket to the room. When it drops without being closed here (a train, a Wi-Fi
 * blip), the link makes it again on its own, as the same seat, for as long as the room keeps the
 * seat; the screens and the fight hold the Link the whole time and only see `wire()` change.
 * Only once it has given up, or is closed, do the onClose listeners hear of it.
 */
export class Link {
  /** The other player is in the room (away counts as in). */
  peer = false;
  closed = false;
  /** Milliseconds to the room and back, from the last ping; the way to the other player is about twice the half of it. */
  rtt: number | undefined;
  private ws: WebSocket;
  private readonly listeners = new Set<Listener>();
  private readonly bytes = new Set<(data: Uint8Array) => void>();
  private readonly closers = new Set<() => void>();
  private readonly wires = new Set<(wire: Wire) => void>();
  private readonly sticky = new Map<string, Message>();
  private readonly queued: string[] = [];
  private pingAt: number | undefined;
  private pingedAt = -Infinity;
  private readonly timer: ReturnType<typeof setInterval>;
  /** When the other's seat went away, while it is. */
  private awayAt: number | undefined;
  /** When our socket dropped, while the link is getting back. */
  private droppedAt: number | undefined;
  private tries = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private trying: WebSocket | undefined;
  private readonly online = () => {
    // The network is back: try now rather than at the end of the wait.
    if (this.droppedAt !== undefined && this.retry !== undefined && !this.trying) {
      clearTimeout(this.retry);
      this.retry = undefined;
      this.again();
    }
  };

  private constructor(ws: WebSocket, readonly role: Role, readonly code: string, private readonly url: string) {
    this.ws = ws;
    this.attach(ws);
    this.timer = setInterval(() => this.watch(), 500);
    if (typeof window !== 'undefined') window.addEventListener('online', this.online);
    this.ping();
  }

  /** Joins the room as host or guest; resolves once the socket is open. */
  static open(code: string, role: Role, base = relayUrl(), id = seatId()): Promise<Link> {
    const url = `${base.replace(/^http/, 'ws')}/rooms/${code}/ws?role=${role}&id=${encodeURIComponent(id)}`;
    const ws = new WebSocket(url);
    return new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(new Link(ws, role, code, url)), { once: true });
      ws.addEventListener(
        'error',
        () => reject(new Error(role === 'guest' ? `No room ${code} on the relay, or it already has two players.` : `The relay at ${base} could not be reached.`)),
        { once: true },
      );
    });
  }

  /** Sends a screen's message; while the socket is being made again it waits for it. */
  send(message: Message): void {
    const text = encode(message);
    if (this.ws.readyState === WebSocket.OPEN && this.droppedAt === undefined) this.ws.send(text);
    else if (!this.closed && this.queued.length < QUEUE_MAX) this.queued.push(text);
  }

  /** Every message from now on, and the last meet, roster, stage and hello already here. */
  listen(listener: Listener): () => void {
    this.listeners.add(listener);
    for (const message of this.sticky.values()) listener(message);
    return () => this.listeners.delete(listener);
  }

  /** Forgets a kept message, once the screen it was for is gone. */
  forget(kind: Message['t']): void {
    this.sticky.delete(kind);
  }

  onClose(listener: () => void): () => void {
    this.closers.add(listener);
    return () => this.closers.delete(listener);
  }

  wire(): Wire {
    const away = this.awayAt !== undefined;
    const reconnecting = this.droppedAt !== undefined;
    const since = reconnecting ? this.droppedAt : this.awayAt;
    return { away, reconnecting, until: since === undefined ? undefined : since + RECONNECT_MS };
  }

  /** The wire as it stands now and whenever it changes. */
  onWire(listener: (wire: Wire) => void): () => void {
    this.wires.add(listener);
    listener(this.wire());
    return () => this.wires.delete(listener);
  }

  /** The socket as the lockstep sees it: bytes in and out, and the end. Frames sent while it is down are lost, and the lockstep sends them again. */
  channel(): Channel {
    return {
      send: (data) => {
        if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
      },
      onMessage: (listener) => {
        const bytes = (data: Uint8Array) => listener(data);
        this.bytes.add(bytes);
        return () => this.bytes.delete(bytes);
      },
      onClose: (listener) => this.onClose(listener),
    };
  }

  close(): void {
    // Closed on purpose: the room lets the seat go at once (1000), and no try is made again.
    this.end();
    for (const ws of [this.ws, this.trying]) {
      try {
        ws?.close(1000, 'left');
      } catch {
        // Already gone.
      }
    }
  }

  private attach(ws: WebSocket): void {
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('message', (event) => {
      if (ws !== this.ws) return;
      const data = event.data as string | ArrayBuffer;
      if (typeof data !== 'string') {
        const view = new Uint8Array(data);
        for (const listener of this.bytes) listener(view);
        return;
      }
      if (data === 'pong') {
        if (this.pingAt !== undefined) this.rtt = performance.now() - this.pingAt;
        this.pingAt = undefined;
        return;
      }
      const message = decode(data);
      if (!message) return;
      if (message.t === 'peer') this.heard(message);
      if (STICKY.has(message.t)) this.sticky.set(message.t, message);
      for (const listener of [...this.listeners]) listener(message);
    });
    ws.addEventListener('close', () => ws === this.ws && this.dropped());
    ws.addEventListener('error', () => ws === this.ws && this.dropped());
  }

  /** The room's word on the other player. */
  private heard(message: Extract<Message, { t: 'peer' }>): void {
    this.peer = message.joined;
    const awayAt = message.away ? (this.awayAt ?? performance.now()) : undefined;
    if (awayAt === this.awayAt) return;
    this.awayAt = awayAt;
    this.told();
  }

  private told(): void {
    const wire = this.wire();
    for (const listener of [...this.wires]) listener(wire);
  }

  /** Every half second: a ping when one is due, and a socket whose ping went unanswered too long is taken for dropped. */
  private watch(): void {
    if (this.closed || this.droppedAt !== undefined) return;
    if (this.pingAt !== undefined && performance.now() - this.pingAt > DEAD_MS) {
      const dead = this.ws;
      this.dropped();
      try {
        dead.close(4000, 'no answer');
      } catch {
        // Already gone.
      }
      return;
    }
    if (performance.now() - this.pingedAt >= PING_MS) this.ping();
  }

  private ping(): void {
    if (this.ws.readyState !== WebSocket.OPEN || this.pingAt !== undefined) return;
    this.pingAt = this.pingedAt = performance.now();
    this.ws.send('ping');
  }

  /** The socket went without being closed here: try the room again, as the same seat, while it keeps it. */
  private dropped(): void {
    if (this.closed || this.droppedAt !== undefined) return;
    this.droppedAt = performance.now();
    this.pingAt = undefined;
    this.tries = 0;
    this.told();
    this.wait();
  }

  private wait(): void {
    const left = this.droppedAt! + RECONNECT_MS - performance.now();
    const delay = RETRY_MS[Math.min(this.tries, RETRY_MS.length - 1)]!;
    this.tries++;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.again();
    }, Math.max(0, Math.min(delay, left)));
  }

  private again(): void {
    if (this.closed || this.droppedAt === undefined) return;
    if (performance.now() - this.droppedAt >= RECONNECT_MS) {
      this.end();
      return;
    }
    const ws = new WebSocket(this.url);
    this.trying = ws;
    let done = false;
    const failed = () => {
      if (done) return;
      done = true;
      clearTimeout(slow);
      if (this.trying === ws) this.trying = undefined;
      try {
        ws.close();
      } catch {
        // Never opened.
      }
      if (!this.closed) this.wait();
    };
    const slow = setTimeout(failed, TRY_MS);
    ws.addEventListener('error', failed, { once: true });
    ws.addEventListener('close', failed, { once: true });
    ws.addEventListener(
      'open',
      () => {
        if (done) return;
        done = true;
        clearTimeout(slow);
        ws.removeEventListener('error', failed);
        ws.removeEventListener('close', failed);
        this.trying = undefined;
        if (this.closed) {
          ws.close(1000, 'left');
          return;
        }
        this.ws = ws;
        this.attach(ws);
        this.droppedAt = undefined;
        for (const text of this.queued.splice(0)) ws.send(text);
        this.told();
        this.ping();
      },
      { once: true },
    );
  }

  private end(): void {
    if (this.closed) return;
    this.closed = true;
    this.peer = false;
    this.awayAt = undefined;
    this.droppedAt = undefined;
    this.queued.length = 0;
    clearInterval(this.timer);
    if (this.retry !== undefined) clearTimeout(this.retry);
    if (typeof window !== 'undefined') window.removeEventListener('online', this.online);
    for (const listener of [...this.closers]) listener();
  }
}
