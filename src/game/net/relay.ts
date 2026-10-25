import { type Message, decode, encode } from './handshake';
import type { Channel } from './lockstep';

/*
 * The page's end of the relay (relay/ in this repository): make a room, join one, and the
 * open socket as a Link the screens talk through. Text is the screens' messages, bytes the
 * fight's frames. The relay is Chris's deploy unless SETTINGS names another, so anyone can
 * run their own; both players must use the same one.
 */

/** Chris's deploy on workers.dev. */
export const RELAY_URL = 'https://makgora-relay.clawdgross.workers.dev';
const STORAGE = 'makgora.relay';
/** A ping to the room this often keeps the socket open through quiet screens, and times the wire. */
const PING_MS = 5000;

/** The relay in use: the one named in SETTINGS, else Chris's. */
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

/** One player's open socket to the room. */
export class Link {
  /** The other player is in the room. */
  peer = false;
  closed = false;
  /** Milliseconds to the room and back, from the last ping; the way to the other player is about twice the half of it. */
  rtt: number | undefined;
  private readonly listeners = new Set<Listener>();
  private readonly bytes = new Set<(data: Uint8Array) => void>();
  private readonly closers = new Set<() => void>();
  private readonly sticky = new Map<string, Message>();
  private pingAt: number | undefined;
  private readonly timer: ReturnType<typeof setInterval>;

  private constructor(private readonly ws: WebSocket, readonly role: Role, readonly code: string) {
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('message', (event) => {
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
      if (message.t === 'peer') this.peer = message.joined;
      if (STICKY.has(message.t)) this.sticky.set(message.t, message);
      for (const listener of [...this.listeners]) listener(message);
    });
    ws.addEventListener('close', () => this.end());
    ws.addEventListener('error', () => this.end());
    this.timer = setInterval(() => this.ping(), PING_MS);
    this.ping();
  }

  /** Joins the room as host or guest; resolves once the socket is open. */
  static open(code: string, role: Role, base = relayUrl()): Promise<Link> {
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/rooms/${code}/ws?role=${role}`);
    return new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(new Link(ws, role, code)), { once: true });
      ws.addEventListener(
        'error',
        () => reject(new Error(role === 'guest' ? `No room ${code} on the relay, or it already has two players.` : `The relay at ${base} could not be reached.`)),
        { once: true },
      );
    });
  }

  send(message: Message): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(message));
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

  /** The socket as the lockstep sees it: bytes in and out, and the end. */
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
    try {
      this.ws.close(1000, 'left');
    } catch {
      // Already gone.
    }
    this.end();
  }

  private ping(): void {
    // One ping at a time; one unanswered for long is given up on.
    if (this.ws.readyState !== WebSocket.OPEN || (this.pingAt !== undefined && performance.now() - this.pingAt < PING_MS * 2)) return;
    this.pingAt = performance.now();
    this.ws.send('ping');
  }

  private end(): void {
    if (this.closed) return;
    this.closed = true;
    this.peer = false;
    clearInterval(this.timer);
    for (const listener of [...this.closers]) listener();
  }
}
