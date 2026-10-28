import { type Match, newMatch, tick } from '../../engine/engine';
import { isRulesName, type RulesName } from '../../engine/rules';
import { decode, type Hello, type Message } from './handshake';
import { decodeFrame, HASH_EVERY, INPUT_DELAY, rollHash, stateText, unpackInputs } from './lockstep';
import { relayUrl } from './relay';

/*
 * Watching somebody else's fight. The room sends a watcher the host's hello, every rematch, and
 * both players' frames with a byte in front saying whose (relay/src/index.ts); the engine is pure
 * and seeded, so a third machine that plays the hello's tables and seed on both players' inputs,
 * tick by tick, sees the fight they see. The watcher only ever runs behind: it starts once it has
 * half a second of both players' inputs in hand, plays sixty ticks a second, and holds when a
 * tick's inputs are not here yet, until it has half a second again. One who came in mid-fight is
 * sent the game so far and runs through it quickly up to that half second behind.
 *
 * The players' frames carry their hashes of the match, so the watcher checks its own against
 * them as the players check each other's; a watcher that differs says so rather than show a
 * fight that is not the one being fought.
 *
 * The Spectator touches no browser: feed it what the room sends and call `play` from the frame
 * loop. Watching is the socket to the room that feeds one.
 */

/** Ticks of both players' inputs in hand before the watcher plays: half a second. */
export const BUFFER = 30;
/** More than this many in hand and the watcher runs ahead to get back to BUFFER. */
export const CATCH_UP = 90;
/** The most ticks run in one frame while catching up: ten seconds of fight. */
const MOST_PER_FRAME = 600;
/** A ping this often keeps the socket to the room open. */
const PING_MS = 5000;
/** One line of chat a watcher every this long, as the relay takes them (relay/src/chat.ts). */
export const CHAT_GAP_MS = 1500;
/** The most characters in a line of chat. */
export const CHAT_MAX = 140;

/** A line of the watchers' chat, as the room sends it. */
export interface ChatLine {
  name: string;
  text: string;
  /** When it was said, by the relay's clock. */
  at: number;
}

/** The room's word on which players are in. */
export interface Seats {
  t: 'seats';
  host: boolean;
  guest: boolean;
}

export type WatchStatus = 'between' | 'buffering' | 'playing' | 'desync';

interface Options {
  /** The rule set when the hello names none this build knows; the watcher's own choice, as the players fall back to theirs. */
  rules?: () => RulesName;
  /** Ticks in hand before playing; BUFFER unless a test asks otherwise. */
  buffer?: number;
}

export class Spectator {
  /** The fight's hello, while there is one; undefined between fights. */
  hello: Hello | undefined;
  /** The match as the watcher has played it. */
  match: Match | undefined;
  /** The match number on now, and its seed. */
  game = 0;
  seed = 0;
  seats = { host: false, guest: false };
  /** The next tick to play. */
  next = 0;
  /** Both players' inputs by tick, until played. */
  private inputs: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];
  private playing = false;
  private hash = 0;
  private readonly ours = new Map<number, number>();
  private readonly theirs = new Map<number, number>();
  private desync: { tick: number; local: number; remote: number } | undefined;
  private readonly buffer: number;
  private readonly rules: () => RulesName;
  private readonly listeners = new Set<() => void>();

  constructor(options: Options = {}) {
    this.buffer = options.buffer ?? BUFFER;
    this.rules = options.rules ?? (() => 'warcraft');
  }

  /** A message from the room: the hello, a rematch, back to the roster, or who is in. */
  take(message: Message | Seats): void {
    switch (message.t) {
      case 'seats':
        this.seats = { host: message.host, guest: message.guest };
        break;
      case 'hello':
        this.hello = message;
        this.begin(message.game, message.seed);
        break;
      case 'rematch':
        if (!this.hello || message.game === this.game) return;
        this.begin(message.game, message.seed);
        break;
      case 'back':
        this.hello = undefined;
        this.match = undefined;
        this.inputs = [new Map(), new Map()];
        break;
      default:
        return;
    }
    for (const listener of [...this.listeners]) listener();
  }

  /** A frame from the room: the seat's byte, then the frame as the player sent it. */
  frame(bytes: Uint8Array): void {
    const seat = bytes[0];
    if ((seat !== 0 && seat !== 1) || !this.match) return;
    const frame = decodeFrame(bytes.subarray(1));
    if (!frame || frame.game !== (this.game & 0xff)) return;
    const mine = this.inputs[seat];
    frame.inputs.forEach((bits, k) => {
      const t = frame.first + k;
      if (t >= this.next && !mine.has(t)) mine.set(t, bits);
    });
    if (frame.hash) {
      const ours = this.ours.get(frame.hash.tick);
      if (ours !== undefined) this.compare(frame.hash.tick, ours, frame.hash.value);
      else if (frame.hash.tick >= this.next) this.theirs.set(frame.hash.tick, frame.hash.value);
    }
  }

  /** Hears of each new hello, rematch, return to the roster and change of seats. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** How many ticks from the next one on have both players' inputs here. */
  ahead(): number {
    let n = 0;
    while (this.has(this.next + n)) n++;
    return n;
  }

  /**
   * Plays the ticks `due` by the clock, and returns how many it ran. Nothing until a buffer's worth
   * is in hand; a missing tick holds the fight until there is a buffer's worth again; far behind,
   * it runs more than are due to get back to a buffer's worth behind.
   */
  play(due: number): number {
    const match = this.match;
    if (!match || this.desync) return 0;
    const ahead = this.ahead();
    if (!this.playing) {
      if (ahead < this.buffer) return 0;
      this.playing = true;
    }
    if (ahead === 0) {
      this.playing = false;
      return 0;
    }
    const wanted = ahead > CATCH_UP ? Math.max(due, ahead - this.buffer) : due;
    const n = Math.min(wanted, ahead, MOST_PER_FRAME);
    for (let k = 0; k < n; k++) this.step(match);
    return n;
  }

  status(): WatchStatus {
    if (this.desync) return 'desync';
    if (!this.match) return 'between';
    return this.playing ? 'playing' : 'buffering';
  }

  private has(t: number): boolean {
    return t < INPUT_DELAY || (this.inputs[0].has(t) && this.inputs[1].has(t));
  }

  /** One tick, as the players' lockstep plays it, hashed where theirs is. */
  private step(match: Match): void {
    const t = this.next;
    const bits = (seat: 0 | 1) => (t < INPUT_DELAY ? 0 : this.inputs[seat].get(t)!);
    tick(match, [unpackInputs(bits(0)), unpackInputs(bits(1))]);
    this.inputs[0].delete(t);
    this.inputs[1].delete(t);
    this.next++;
    if (this.next % HASH_EVERY !== 0) return;
    this.hash = rollHash(this.hash, stateText(match));
    this.ours.set(t, this.hash);
    for (const old of this.ours.keys()) if (old < t - HASH_EVERY * 16) this.ours.delete(old);
    const theirs = this.theirs.get(t);
    if (theirs !== undefined) {
      this.theirs.delete(t);
      this.compare(t, this.hash, theirs);
    }
  }

  private compare(t: number, local: number, remote: number): void {
    if (local !== remote && !this.desync) this.desync = { tick: t, local, remote };
  }

  /** A new match on the hello's tables, as the guest starts one: its names, the seed and the match number given. */
  private begin(game: number, seed: number): void {
    const hello = this.hello!;
    this.game = game;
    this.seed = seed;
    const names: [string, string] = [hello.fighters[0].name, hello.fighters[1].name];
    const rules = isRulesName(hello.rules) ? hello.rules : this.rules();
    this.match = newMatch(hello.tables, seed, names, rules);
    this.next = 0;
    this.inputs = [new Map(), new Map()];
    this.playing = false;
    this.hash = 0;
    this.ours.clear();
    this.theirs.clear();
    this.desync = undefined;
  }
}

/**
 * The socket to a room as a watcher, feeding a Spectator. Besides the keep-alive it sends only the
 * watchers' chat, under `name`, which the room passes to the other watchers and never to the players.
 */
export class Watching {
  closed = false;
  private readonly ws: WebSocket;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly closers = new Set<() => void>();
  private readonly chatters = new Set<(line: ChatLine) => void>();

  constructor(readonly code: string, readonly spectator: Spectator, base = relayUrl(), name?: string) {
    this.ws = new WebSocket(`${base.replace(/^http/, 'ws')}/rooms/${code}/ws?role=watch${name ? `&name=${encodeURIComponent(name)}` : ''}`);
    this.ws.binaryType = 'arraybuffer';
    this.ws.addEventListener('message', (event) => {
      const data = event.data as string | ArrayBuffer;
      if (typeof data !== 'string') return spectator.frame(new Uint8Array(data));
      if (data === 'pong') return;
      if (data.startsWith('{"t":"seats"')) return spectator.take(JSON.parse(data) as Seats);
      if (data.startsWith('{"t":"chat"')) {
        const { name: who, text, at } = JSON.parse(data) as ChatLine;
        for (const listener of [...this.chatters]) listener({ name: who, text, at });
        return;
      }
      const message = decode(data);
      if (message) spectator.take(message);
    });
    this.ws.addEventListener('close', () => this.end());
    this.ws.addEventListener('error', () => this.end());
    this.timer = setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send('ping');
    }, PING_MS);
  }

  onClose(listener: () => void): () => void {
    this.closers.add(listener);
    return () => this.closers.delete(listener);
  }

  /** Every line of chat from now on, the room's last few first as it sends them on arrival. */
  onChat(listener: (line: ChatLine) => void): () => void {
    this.chatters.add(listener);
    return () => this.chatters.delete(listener);
  }

  /** A line of chat to the other watchers; it comes back like theirs once the room has taken it. */
  say(text: string): void {
    const line = text.trim().slice(0, CHAT_MAX);
    if (line !== '' && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'chat', text: line }));
  }

  close(): void {
    try {
      this.ws.close(1000, 'done watching');
    } catch {
      // Already gone.
    }
    this.end();
  }

  private end(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    for (const listener of [...this.closers]) listener();
  }
}
