/*
 * What a room keeps of the fight for anyone who comes in to watch it late: the host's hello, its
 * last rematch, and every input either player has sent for the game they are on, by tick. The
 * players send each other an input only until the other has acknowledged it, so without this a
 * watcher could only ever see a fight from its first tick by being there at its first tick.
 *
 * This is the one place the relay reads what the players send, and it reads only the headers it
 * needs: the kind of a text message, the game number in a hello or a rematch, and of a frame its
 * tag, its game, its first tick and its run of inputs, in the layout src/game/net/lockstep.ts
 * writes (encodeFrame). A watcher is sent what was kept as one frame per run of inputs, in the
 * same layout, with the seat's byte in front as every frame to a watcher has.
 */

/** Watchers a room takes at once. Here and not in index.ts, whose exports the runtime takes for handlers. */
export const WATCH_CAP = 50;
/** The first byte of every frame of the fight. */
const FRAME_TAG = 0x4b;
/** The most of each player's inputs kept: an hour of fight at sixty ticks a second. */
export const KEEP_TICKS = 60 * 60 * 60;
/** Inputs in one frame at most: its count is one byte. */
const RUN = 255;
/** How far back a player's hashes are kept for the other's to meet: the pages hash every 60 ticks and keep 16. */
const KEEP_HASH_TICKS = 60 * 16;

/** The kind of a screen's message, from its first characters: every one is JSON with `t` first, as JSON.stringify writes it. */
export function kindOf(text: string): string | undefined {
  return /^\{"t":"([a-z]+)"/.exec(text)?.[1];
}

/** One player's inputs from the first tick the room saw, with no gaps. */
interface Log {
  from: number | undefined;
  bits: number[];
}

export class GameRecord {
  private hello: string | undefined;
  private rematchText: string | undefined;
  /** The game number the frames carry, as one byte; -1 before a hello. */
  private game = -1;
  private logs: [Log, Log] = [
    { from: undefined, bits: [] },
    { from: undefined, bits: [] },
  ];
  /** Each player's recent hashes of the match, by tick, and the first tick they differed at. */
  private hashes: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];
  private desync: number | undefined;

  /** The host's hello: a new fight, its first game. */
  start(text: string): void {
    this.hello = text;
    this.rematchText = undefined;
    this.begin(gameOf(text));
  }

  /** The host's rematch: the same fight, its next game. */
  rematch(text: string): void {
    if (this.hello === undefined) return;
    this.rematchText = text;
    this.begin(gameOf(text));
  }

  /** Back to the roster: nothing to watch until the next hello. */
  clear(): void {
    this.hello = undefined;
    this.rematchText = undefined;
    this.begin(-1);
  }

  /**
   * A frame from player `seat` (0 the host, 1 the guest); anything that is not a frame of this game
   * is passed over. Answers the tick at which the two players' hashes first differ, the once it is
   * seen: the same check each page makes, made here for the night's report.
   */
  take(seat: 0 | 1, bytes: Uint8Array): number | undefined {
    if (this.game < 0 || bytes.length < 12 || bytes[0] !== FRAME_TAG || bytes[1] !== this.game) return undefined;
    const n = bytes[10]!;
    if (bytes.length < 12 + n) return undefined;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const first = view.getUint32(6);
    this.keep(seat, first, n, bytes);
    return bytes[11 + n] === 1 && bytes.length >= 18 + n ? this.hashed(seat, view.getUint32(12 + n), view.getUint16(16 + n)) : undefined;
  }

  /** The tick of this game's desync, once one is seen. */
  desyncAt(): number | undefined {
    return this.desync;
  }

  /** A player's hash after tick `tick`, held against the other's for the same tick. */
  private hashed(seat: 0 | 1, tick: number, value: number): number | undefined {
    const mine = this.hashes[seat];
    if (mine.get(tick) === value) return undefined;
    mine.set(tick, value);
    // Each frame carries the latest hash: a short memory of the recent ones is enough.
    for (const old of mine.keys()) if (old < tick - KEEP_HASH_TICKS) mine.delete(old);
    const theirs = this.hashes[seat === 0 ? 1 : 0].get(tick);
    if (theirs === undefined || theirs === value || this.desync !== undefined) return undefined;
    this.desync = tick;
    return tick;
  }

  /** A frame's run of `n` inputs from tick `first` onto the player's log. */
  private keep(seat: 0 | 1, first: number, n: number, bytes: Uint8Array): void {
    const log = this.logs[seat];
    log.from ??= first;
    // A frame starts where the last acknowledged input ends, so most of each one is already here.
    for (let k = Math.max(0, log.from + log.bits.length - first); k < n && log.bits.length < KEEP_TICKS; k++) {
      // One socket is in order and loses nothing: a gap would mean a frame went missing before the room.
      if (first + k !== log.from + log.bits.length) break;
      log.bits.push(bytes[11 + k]!);
    }
  }

  /** What a watcher coming in now is sent: the hello, the rematch, then each player's inputs so far as tagged frames. */
  replay(): (string | Uint8Array)[] {
    if (this.hello === undefined) return [];
    const out: (string | Uint8Array)[] = [this.hello];
    if (this.rematchText !== undefined) out.push(this.rematchText);
    for (const seat of [0, 1] as const) {
      const { from, bits } = this.logs[seat];
      if (from === undefined) continue;
      for (let at = 0; at < bits.length; at += RUN) out.push(frame(seat, this.game, from + at, bits.slice(at, at + RUN)));
    }
    return out;
  }

  /** How many ticks of each player's inputs are kept; for the tests. */
  sizes(): [number, number] {
    return [this.logs[0].bits.length, this.logs[1].bits.length];
  }

  private begin(game: number): void {
    this.game = game < 0 ? -1 : game & 0xff;
    this.hashes = [new Map(), new Map()];
    this.desync = undefined;
    this.logs = [
      { from: undefined, bits: [] },
      { from: undefined, bits: [] },
    ];
  }
}

function gameOf(text: string): number {
  try {
    const game = (JSON.parse(text) as { game?: unknown }).game;
    return typeof game === 'number' ? game : 0;
  } catch {
    return 0;
  }
}

/** A frame as lockstep.ts lays one out, acknowledging nothing and with no hash, behind the seat's byte. */
function frame(seat: 0 | 1, game: number, first: number, inputs: number[]): Uint8Array {
  const bytes = new Uint8Array(1 + 12 + inputs.length);
  const view = new DataView(bytes.buffer);
  bytes[0] = seat;
  bytes[1] = FRAME_TAG;
  bytes[2] = game;
  view.setInt32(3, -1);
  view.setUint32(7, first);
  bytes[11] = inputs.length;
  bytes.set(inputs, 12);
  bytes[12 + inputs.length] = 0;
  return bytes;
}
