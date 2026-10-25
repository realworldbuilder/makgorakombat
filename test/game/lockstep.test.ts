import { describe, expect, it } from 'vitest';
import { type Inputs, type Match, newMatch, noInputs, tick } from '../../src/engine/engine';
import { TICK_MS } from '../../src/engine/stage';
import { type Channel, decodeFrame, encodeFrame, HASH_EVERY, INPUT_DELAY, Lockstep, packInputs, stateText, unpackInputs, WAIT_SHOWN_MS } from '../../src/game/net/lockstep';
import { fakeTable, FULL_SET, MAGE, WARRIOR } from '../engine/fake';

/**
 * Two ends of a wire in memory, on a clock the test turns: each message takes its own time to
 * cross, so they can overtake each other, and `drop` can lose any of them.
 */
class Wire {
  now = 0;
  private readonly queue: { at: number; to: 0 | 1; data: Uint8Array | string; n: number }[] = [];
  private readonly listeners: [((data: Uint8Array | string) => void)[], ((data: Uint8Array | string) => void)[]] = [[], []];
  private readonly closers: [(() => void)[], (() => void)[]] = [[], []];
  private sent = 0;
  private seed = 12345;
  delivered = 0;

  constructor(
    private readonly latency: (draw: () => number) => number,
    private readonly drop: (data: Uint8Array | string, from: 0 | 1) => boolean = () => false,
  ) {}

  private draw = (): number => {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  };

  end(side: 0 | 1): Channel {
    return {
      send: (data) => {
        if (this.drop(data, side)) return;
        // A copy, as a socket would make: the sender may reuse its buffer.
        const copy = typeof data === 'string' ? data : data.slice();
        this.queue.push({ at: this.now + this.latency(this.draw), to: side === 0 ? 1 : 0, data: copy, n: this.sent++ });
      },
      onMessage: (listener) => {
        this.listeners[side].push(listener);
        return () => this.listeners[side].splice(this.listeners[side].indexOf(listener), 1);
      },
      onClose: (listener) => {
        this.closers[side].push(listener);
        return () => this.closers[side].splice(this.closers[side].indexOf(listener), 1);
      },
    };
  }

  /** Turns the clock on and hands over everything that has arrived by then, in order of arrival. */
  advance(ms: number): void {
    this.now += ms;
    const due = this.queue.filter((m) => m.at <= this.now).sort((a, b) => a.at - b.at || a.n - b.n);
    for (const m of due) {
      this.queue.splice(this.queue.indexOf(m), 1);
      this.delivered++;
      for (const listener of this.listeners[m.to]) listener(m.data);
    }
  }

  close(): void {
    for (const side of this.closers) for (const listener of side) listener();
  }
}

/** A player who never stops: walks in bursts, swings most of the time, now and then jumps or uses an ability. Fixed by the tick. */
function script(player: 0 | 1, t: number): Inputs {
  let h = (Math.imul(t + 1, 2654435761) ^ Math.imul(player + 7, 40503)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  const burst = Math.floor(t / 37 + player * 3) % 5;
  const out = noInputs();
  out.left = burst === 1;
  out.right = burst === 2 || burst === 3;
  out.attack = (h & 3) !== 0;
  out.jump = h % 97 === 0;
  if (h % 41 === 0) out.abilities[(h >>> 8) % 3] = true;
  return out;
}

const tables = () => [fakeTable(FULL_SET, 'oneHand', {}, WARRIOR), fakeTable(FULL_SET, 'twoHand', {}, MAGE)] as const;
const freshMatch = (seed: number): Match => {
  const [a, b] = tables();
  return newMatch([a, b], seed, ['HOST', 'GUEST']);
};

interface Side {
  match: Match;
  lockstep: Lockstep;
  owed: number;
  /** The hash of the state after each tick, by tick. */
  states: string[];
}

/**
 * Plays both sides frame by frame, sixty frames a second as the page does, until each has run
 * `ticks` ticks. The guest's page starts `lag` ms after the host's.
 */
function play(wire: Wire, ticks: number, options: { lag?: number; seed?: number; meddle?: (sides: [Side, Side], frame: number) => void } = {}): [Side, Side] {
  const seed = options.seed ?? 99;
  const side = (who: 0 | 1): Side => ({ match: freshMatch(seed), lockstep: new Lockstep(wire.end(who), who, { now: () => wire.now }), owed: 0, states: [] });
  const sides: [Side, Side] = [side(0), side(1)];
  const lag = options.lag ?? 0;
  for (let frame = 0; frame < 60 * 600; frame++) {
    wire.advance(TICK_MS);
    sides.forEach((side, who) => {
      if (who === 1 && wire.now < lag) return;
      side.owed += TICK_MS;
      let steps = 0;
      // As Fight.tsx does: up to four ticks a frame, and a held fight does not run up a debt.
      while (side.owed >= TICK_MS && steps < 4 && side.lockstep.next < ticks) {
        if (!side.lockstep.step(side.match, (t) => script(who as 0 | 1, t))) {
          side.owed = Math.min(side.owed, TICK_MS);
          break;
        }
        side.owed -= TICK_MS;
        steps++;
        side.states.push(stateText(side.match));
      }
    });
    options.meddle?.(sides, frame);
    if (sides.every((side) => side.lockstep.next >= ticks)) break;
    if (sides.some((side) => side.lockstep.status().desync)) break;
  }
  return sides;
}

/** The same match on one machine, with each player's inputs played INPUT_DELAY ticks after they were scripted. */
function reference(ticks: number, seed = 99): string[] {
  const match = freshMatch(seed);
  const out: string[] = [];
  for (let t = 0; t < ticks; t++) {
    const at = t - INPUT_DELAY;
    tick(match, at < 0 ? [noInputs(), noInputs()] : [script(0, t), script(1, t)]);
    out.push(stateText(match));
  }
  return out;
}

describe('lockstep frames', () => {
  it('packs the seven buttons into a byte and back', () => {
    for (let bits = 0; bits < 128; bits++) expect(packInputs(unpackInputs(bits))).toBe(bits);
    const pressed = { ...noInputs(), right: true, attack: true, abilities: [false, false, true] as [boolean, boolean, boolean] };
    expect(unpackInputs(packInputs(pressed))).toEqual(pressed);
  });

  it('encodes a frame in a few bytes', () => {
    const frame = { game: 3, ack: 41, first: 40, inputs: [0, 9, 127], hash: { tick: 59, value: 0xbeef } };
    const bytes = encodeFrame(frame);
    expect(bytes.length).toBe(11 + 3 + 1 + 6);
    expect(decodeFrame(bytes)).toEqual(frame);
    expect(decodeFrame(encodeFrame({ ...frame, hash: undefined }))).toEqual({ ...frame, hash: undefined });
    expect(decodeFrame(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});

describe('lockstep', () => {
  it('keeps two matches identical for 3000 ticks over a wire that is slow, uneven and out of order', () => {
    // 20 to 90 ms each way: a message often overtakes the one before it.
    const wire = new Wire((draw) => 20 + draw() * 70);
    const [host, guest] = play(wire, 3000, { lag: 140 });
    expect(host.lockstep.next).toBe(3000);
    expect(guest.lockstep.next).toBe(3000);
    expect(host.lockstep.status().desync).toBeUndefined();
    expect(guest.lockstep.status().desync).toBeUndefined();
    expect(host.states.length).toBe(3000);
    for (let t = 0; t < 3000; t++) if (host.states[t] !== guest.states[t]) throw new Error(`the matches part at tick ${t}`);
    expect(stateText(host.match)).toBe(stateText(guest.match));
    expect(JSON.stringify(host.match)).toBe(JSON.stringify(guest.match));
    // And it is the fight one machine would play with the inputs four ticks late.
    expect(host.states).toEqual(reference(3000));
    // The script fights: somebody was hurt.
    expect(host.match.fighters.some((f) => f.hp < 100) || host.match.round > 1).toBe(true);
  });

  it('recovers dropped frames by sending again', () => {
    let lost = 0;
    // Loses a third of everything the host sends for the first two seconds, and every frame it sends with tick 200 in it the first five times.
    const wire = new Wire(
      () => 30,
      (data, from) => {
        if (typeof data === 'string' || from !== 0) return false;
        const frame = decodeFrame(data)!;
        const holds200 = frame.first <= 200 && frame.first + frame.inputs.length > 200;
        if ((holds200 && lost < 5) || (frame.first < 120 && (frame.first + frame.inputs.length) % 3 === 0)) {
          lost++;
          return true;
        }
        return false;
      },
    );
    const [host, guest] = play(wire, 600);
    expect(lost).toBeGreaterThan(5);
    expect(guest.lockstep.next).toBe(600);
    expect(host.states).toEqual(guest.states);
    expect(host.states).toEqual(reference(600));
  });

  it('holds the fight while the other side is silent, and says so after a moment', () => {
    // A wire that loses everything the guest sends for its first second.
    const wire = new Wire(() => 25, (_data, from) => from === 1 && wire.now < 1000);
    let longest = 0;
    const [host] = play(wire, 300, {
      meddle: ([h]) => {
        longest = Math.max(longest, h.lockstep.status().waiting);
      },
    });
    expect(longest).toBeGreaterThan(WAIT_SHOWN_MS);
    // It went on once the guest got through, and the wait is over.
    expect(host.lockstep.next).toBe(300);
    expect(host.lockstep.status().waiting).toBe(0);
  });

  it('stops both sides when the matches differ', () => {
    const wire = new Wire(() => 30);
    const [host, guest] = play(wire, 3000, {
      meddle: ([, g], frame) => {
        if (frame === 200) g.match.fighters[0].x += 0.001;
      },
    });
    const caught = host.lockstep.status().desync ?? guest.lockstep.status().desync;
    expect(caught).toBeDefined();
    expect(caught!.local).not.toBe(caught!.remote);
    // Within a hash or two of the meddling, and no further.
    expect(Math.max(host.lockstep.next, guest.lockstep.next)).toBeLessThan(200 + 3 * HASH_EVERY);
    const frozen = host.lockstep.next;
    if (host.lockstep.status().desync) expect(host.lockstep.step(host.match, () => noInputs())).toBe(false);
    expect(host.lockstep.next).toBe(frozen);
  });

  it('notices the wire closing, and a rematch ignores the last match', () => {
    const wire = new Wire(() => 10);
    const a = new Lockstep(wire.end(0), 0, { game: 1, now: () => wire.now });
    const b = new Lockstep(wire.end(1), 1, { game: 2, now: () => wire.now });
    const ma = freshMatch(1);
    const mb = freshMatch(1);
    for (let k = 0; k < 30; k++) {
      wire.advance(TICK_MS);
      a.step(ma, () => noInputs());
      b.step(mb, () => noInputs());
    }
    // Different games: neither takes the other's inputs past the empty first ticks.
    expect(a.next).toBe(INPUT_DELAY);
    expect(b.next).toBe(INPUT_DELAY);
    wire.close();
    expect(a.status().closed).toBe(true);
    expect(a.step(ma, () => noInputs())).toBe(false);
  });
});
