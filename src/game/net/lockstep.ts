import { type Inputs, type Match, tick } from '../../engine/engine';

/*
 * The fight over the wire: two-player lockstep with a fixed input delay. Both machines run the
 * same deterministic engine from the same tables and seed, so only the inputs need to cross.
 * What a player presses on tick N is played on tick N + INPUT_DELAY, on both machines alike:
 * the delay gives each side's inputs that long to reach the other, and the local player waits
 * as long as the remote one so both see the same timing. A tick runs only when both inputs for
 * it are here; until then the fight holds still rather than guess. Every 60 ticks each side
 * hashes its match and sends the hash along; if the two ever differ the fight stops, since
 * every tick after would be wrong.
 *
 * Nothing here touches a browser: give it a Channel (a WebSocket through the relay, or a pair
 * of queues in a test) and call `step` from the frame loop.
 */

/** Ticks between pressing a key and the engine playing it: 66.7 ms at 60 Hz. */
export const INPUT_DELAY = 4;
/** Ticks between hashes of the match state. */
export const HASH_EVERY = 60;
/** How long the fight may hold before the HUD says WAITING FOR OPPONENT. */
export const WAIT_SHOWN_MS = 250;
/** At most this many inputs go in one frame; more wait for the next. */
const MAX_PER_FRAME = 60;
const FRAME_TAG = 0x4b;
/** Local hashes kept for a remote one that arrives late. */
const KEEP_HASHES = 16;

/** Either end of the wire. Strings are the screens' messages, bytes the fight's frames. */
export interface Channel {
  send(data: Uint8Array<ArrayBuffer> | string): void;
  onMessage(listener: (data: Uint8Array | string) => void): () => void;
  onClose(listener: () => void): () => void;
}

export interface LockstepStatus {
  /** Milliseconds the fight has been held waiting for the other player's inputs; 0 while it runs. */
  waiting: number;
  /** The hashes differed: the tick, and the two hashes. The fight stops. */
  desync: { tick: number; local: number; remote: number } | undefined;
  /** The wire is gone. */
  closed: boolean;
}

/** The seven buttons as bits: left, right, jump, attack, the three abilities. */
export function packInputs(inputs: Inputs): number {
  return (
    (inputs.left ? 1 : 0) |
    (inputs.right ? 2 : 0) |
    (inputs.jump ? 4 : 0) |
    (inputs.attack ? 8 : 0) |
    (inputs.abilities[0] ? 16 : 0) |
    (inputs.abilities[1] ? 32 : 0) |
    (inputs.abilities[2] ? 64 : 0)
  );
}

export function unpackInputs(bits: number): Inputs {
  return {
    left: (bits & 1) !== 0,
    right: (bits & 2) !== 0,
    jump: (bits & 4) !== 0,
    attack: (bits & 8) !== 0,
    abilities: [(bits & 16) !== 0, (bits & 32) !== 0, (bits & 64) !== 0],
  };
}

/** One frame on the wire: which game, what the sender has of ours, a run of its inputs, and its latest hash. */
export interface Frame {
  /** The match number, so a rematch never takes the last match's stragglers. */
  game: number;
  /** The last tick of ours the sender has every input up to; -1 for none. */
  ack: number;
  /** The tick of the first input. */
  first: number;
  inputs: number[];
  hash: { tick: number; value: number } | undefined;
}

export function encodeFrame(frame: Frame): Uint8Array<ArrayBuffer> {
  const n = frame.inputs.length;
  const bytes = new Uint8Array(11 + n + 1 + (frame.hash ? 6 : 0));
  const view = new DataView(bytes.buffer);
  bytes[0] = FRAME_TAG;
  bytes[1] = frame.game & 0xff;
  view.setInt32(2, frame.ack);
  view.setUint32(6, frame.first);
  bytes[10] = n;
  frame.inputs.forEach((bits, k) => (bytes[11 + k] = bits));
  bytes[11 + n] = frame.hash ? 1 : 0;
  if (frame.hash) {
    view.setUint32(12 + n, frame.hash.tick);
    view.setUint16(16 + n, frame.hash.value);
  }
  return bytes;
}

/** A frame, or undefined for bytes that are not one. */
export function decodeFrame(bytes: Uint8Array): Frame | undefined {
  if (bytes.length < 12 || bytes[0] !== FRAME_TAG) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = bytes[10]!;
  if (bytes.length < 12 + n) return undefined;
  const hashed = bytes[11 + n] === 1;
  if (hashed && bytes.length < 18 + n) return undefined;
  return {
    game: bytes[1]!,
    ack: view.getInt32(2),
    first: view.getUint32(6),
    inputs: Array.from(bytes.subarray(11, 11 + n)),
    hash: hashed ? { tick: view.getUint32(12 + n), value: view.getUint16(16 + n) } : undefined,
  };
}

/** FNV-1a over a string, folded to 16 bits, carrying the previous hash in. */
export function rollHash(previous: number, text: string): number {
  let h = (0x811c9dc5 ^ previous) >>> 0;
  for (let k = 0; k < text.length; k++) {
    h ^= text.charCodeAt(k);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ((h >>> 16) ^ h) & 0xffff;
}

/** The match's state as text, without the tables (they never change and are the same on both sides by the handshake). */
export function stateText(match: Match): string {
  return JSON.stringify(match, (key, value: unknown) => (key === 'tables' ? undefined : value));
}

interface Options {
  /** INPUT_DELAY unless a test asks otherwise. */
  delay?: number;
  /** The match number both sides agreed on; frames of another are ignored. */
  game?: number;
  /** The clock, for how long the fight has waited. */
  now?: () => number;
}

export class Lockstep {
  /** The next tick `step` runs. */
  next = 0;
  readonly delay: number;
  readonly game: number;
  /** Our inputs by tick, kept until the other side has them and they have been played. */
  private readonly mine = new Map<number, number>();
  /** The last tick we have an input of ours for. */
  private mineTop: number;
  /** Theirs by tick, until played. */
  private readonly theirs = new Map<number, number>();
  /** The last tick we have every one of theirs up to. */
  private theirsTop: number;
  /** The last tick of ours they have every input up to. */
  private acked = -1;
  private hash = 0;
  private readonly hashes = new Map<number, number>();
  /** The state text behind each kept hash, so a desync can be read: which field differed, on which side. */
  private readonly texts = new Map<number, string>();
  private readonly theirHashes = new Map<number, number>();
  private lastHash: { tick: number; value: number } | undefined;
  private waitingSince: number | undefined;
  private desync: LockstepStatus['desync'];
  private closed = false;
  private readonly now: () => number;
  private readonly unsubscribe: (() => void)[];

  constructor(private readonly channel: Channel, readonly local: 0 | 1, options: Options = {}) {
    this.delay = options.delay ?? INPUT_DELAY;
    this.game = (options.game ?? 0) & 0xff;
    this.now = options.now ?? (() => performance.now());
    // The first ticks, before anyone could have pressed anything, are empty on both sides.
    for (let t = 0; t < this.delay; t++) {
      this.mine.set(t, 0);
      this.theirs.set(t, 0);
    }
    this.mineTop = this.delay - 1;
    this.theirsTop = this.delay - 1;
    // Both sides start with the same empty ticks, so neither needs to send them.
    this.acked = this.delay - 1;
    this.unsubscribe = [
      channel.onMessage((data) => {
        if (typeof data !== 'string') this.receive(data);
      }),
      channel.onClose(() => {
        this.closed = true;
      }),
    ];
  }

  /**
   * Runs the next tick of `match` if both players' inputs for it are here, and returns whether it did.
   * `readLocal` is asked once for each of our ticks, `delay` ticks ahead of the one played; the
   * frames still unacknowledged go out on every call, so a lost one is sent again.
   */
  step(match: Match, readLocal: (forTick: number) => Inputs): boolean {
    if (this.desync || this.closed) return false;
    if (this.mineTop < this.next + this.delay) {
      this.mineTop++;
      this.mine.set(this.mineTop, packInputs(readLocal(this.mineTop)));
    }
    this.flush();
    const t = this.next;
    const theirs = this.theirs.get(t);
    const mine = this.mine.get(t);
    if (theirs === undefined || mine === undefined) {
      this.waitingSince ??= this.now();
      return false;
    }
    this.waitingSince = undefined;
    const inputs: [Inputs, Inputs] = this.local === 0 ? [unpackInputs(mine), unpackInputs(theirs)] : [unpackInputs(theirs), unpackInputs(mine)];
    tick(match, inputs);
    this.theirs.delete(t);
    if (t <= this.acked) this.mine.delete(t);
    this.next++;
    if (this.next % HASH_EVERY === 0) this.check(t, match);
    return true;
  }

  /** The match as it was hashed after tick `t`, while it is still kept; for reading a desync. */
  textAt(t: number): string | undefined {
    return this.texts.get(t);
  }

  status(): LockstepStatus {
    return {
      waiting: this.waitingSince === undefined ? 0 : this.now() - this.waitingSince,
      desync: this.desync,
      closed: this.closed,
    };
  }

  /** Stops listening to the wire; for a rematch, which starts a new Lockstep. */
  dispose(): void {
    this.unsubscribe.forEach((off) => off());
  }

  /** Sends what the other side does not have yet of ours, with our ack and our latest hash. */
  private flush(): void {
    const first = this.acked + 1;
    const last = Math.min(this.mineTop, first + MAX_PER_FRAME - 1);
    const inputs: number[] = [];
    for (let t = first; t <= last; t++) inputs.push(this.mine.get(t) ?? 0);
    this.channel.send(encodeFrame({ game: this.game, ack: this.theirsTop, first, inputs, hash: this.lastHash }));
  }

  private receive(bytes: Uint8Array): void {
    const frame = decodeFrame(bytes);
    if (!frame || frame.game !== this.game) return;
    // Duplicates and frames out of order are fine: each input is taken once, by its tick.
    frame.inputs.forEach((bits, k) => {
      const t = frame.first + k;
      if (t >= this.next && !this.theirs.has(t)) this.theirs.set(t, bits);
    });
    while (this.theirs.has(this.theirsTop + 1)) this.theirsTop++;
    if (frame.ack > this.acked) {
      for (let t = this.acked + 1; t <= frame.ack; t++) if (t < this.next) this.mine.delete(t);
      this.acked = frame.ack;
    }
    if (frame.hash) {
      const ours = this.hashes.get(frame.hash.tick);
      if (ours !== undefined) this.compare(frame.hash.tick, ours, frame.hash.value);
      else if (frame.hash.tick >= this.next) this.theirHashes.set(frame.hash.tick, frame.hash.value);
    }
  }

  /** After tick `t`: hash the match, rolling the last hash in, and hold it against theirs if it came first. */
  private check(t: number, match: Match): void {
    const text = stateText(match);
    this.hash = rollHash(this.hash, text);
    this.hashes.set(t, this.hash);
    this.texts.set(t, text);
    this.lastHash = { tick: t, value: this.hash };
    for (const old of this.hashes.keys()) if (old < t - HASH_EVERY * KEEP_HASHES) this.hashes.delete(old);
    for (const old of this.texts.keys()) if (old < t - HASH_EVERY * KEEP_HASHES) this.texts.delete(old);
    const theirs = this.theirHashes.get(t);
    if (theirs !== undefined) {
      this.theirHashes.delete(t);
      this.compare(t, this.hash, theirs);
    }
  }

  private compare(t: number, local: number, remote: number): void {
    if (local !== remote && !this.desync) this.desync = { tick: t, local, remote };
  }
}
