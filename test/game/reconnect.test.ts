import { describe, expect, it } from 'vitest';
import { type Inputs, type Match, newMatch, noInputs, tick } from '../../src/engine/engine';
import { TICK_MS } from '../../src/engine/stage';
import { type Channel, decodeFrame, INPUT_DELAY, Lockstep, stateText } from '../../src/game/net/lockstep';
import { fakeTable, FULL_SET, MAGE, WARRIOR } from '../engine/fake';

/**
 * Two players' sockets through a room, in memory, on a clock the test turns, where one player's
 * socket can be cut and made again as the relay and the Link do it: while a side is cut, what it
 * sends is lost (the Link's channel drops frames on a closed socket), and what is sent to it is
 * held by the room, the newest `held` messages, and handed over in order when it is back.
 */
class Room {
  now = 0;
  /** The largest run of inputs any frame carried after a side came back. */
  biggestAfter = 0;
  private readonly queue: { at: number; to: 0 | 1; data: Uint8Array; n: number }[] = [];
  private readonly listeners: [((data: Uint8Array | string) => void)[], ((data: Uint8Array | string) => void)[]] = [[], []];
  private readonly cut: [boolean, boolean] = [false, false];
  private readonly holding: [Uint8Array[], Uint8Array[]] = [[], []];
  private returned = false;
  private sent = 0;
  private seed = 4242;

  constructor(private readonly held: number) {}

  private draw = (): number => {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  };

  /** 20 to 60 ms each way, as a real wire wanders. */
  private latency(): number {
    return 20 + this.draw() * 40;
  }

  end(side: 0 | 1): Channel {
    return {
      send: (data) => {
        if (typeof data === 'string' || this.cut[side]) return;
        if (this.returned) this.biggestAfter = Math.max(this.biggestAfter, decodeFrame(data)?.inputs.length ?? 0);
        this.queue.push({ at: this.now + this.latency(), to: side === 0 ? 1 : 0, data: data.slice(), n: this.sent++ });
      },
      onMessage: (listener) => {
        this.listeners[side].push(listener);
        return () => this.listeners[side].splice(this.listeners[side].indexOf(listener), 1);
      },
      // The Link only says it closed once it has given up, which these tests never reach.
      onClose: () => () => {},
    };
  }

  /** The side's socket drops: what was on its way to it is lost with the socket, as on a real wire. */
  drop(side: 0 | 1): void {
    this.cut[side] = true;
    for (const m of this.queue.filter((m) => m.to === side)) this.queue.splice(this.queue.indexOf(m), 1);
  }

  /** The side is back in its seat: the room hands it what it held, in order. */
  back(side: 0 | 1): void {
    this.cut[side] = false;
    this.returned = true;
    for (const data of this.holding[side].splice(0)) this.queue.push({ at: this.now + this.latency(), to: side, data, n: this.sent++ });
  }

  advance(ms: number): void {
    this.now += ms;
    const due = this.queue.filter((m) => m.at <= this.now).sort((a, b) => a.at - b.at || a.n - b.n);
    for (const m of due) {
      this.queue.splice(this.queue.indexOf(m), 1);
      if (this.cut[m.to]) {
        // Arrived at the room for a side that is away: held, the newest kept.
        const held = this.holding[m.to];
        held.push(m.data);
        if (held.length > this.held) held.shift();
        continue;
      }
      for (const listener of this.listeners[m.to]) listener(m.data);
    }
  }
}

/** A player who never stops, fixed by the tick: walks in bursts, swings, now and then jumps or casts. */
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

const freshMatch = (seed: number): Match =>
  newMatch([fakeTable(FULL_SET, 'oneHand', {}, WARRIOR), fakeTable(FULL_SET, 'twoHand', {}, MAGE)], seed, ['HOST', 'GUEST']);

function reference(ticks: number, seed: number): string[] {
  const match = freshMatch(seed);
  const out: string[] = [];
  for (let t = 0; t < ticks; t++) {
    const at = t - INPUT_DELAY;
    tick(match, at < 0 ? [noInputs(), noInputs()] : [script(0, t), script(1, t)]);
    out.push(stateText(match));
  }
  return out;
}

interface Side {
  match: Match;
  lockstep: Lockstep;
  owed: number;
  states: string[];
}

interface Cut {
  side: 0 | 1;
  /** The tick of the cutting side at which its socket drops. */
  atTick: number;
  ms: number;
}

/**
 * Both pages frame by frame, sixty a second, as Fight.tsx steps them, until each has run `ticks`
 * ticks; `cut` drops one side's socket at a tick for a while and then brings it back.
 */
function play(room: Room, ticks: number, cut: Cut, seed = 7) {
  const side = (who: 0 | 1): Side => ({ match: freshMatch(seed), lockstep: new Lockstep(room.end(who), who, { now: () => room.now }), owed: 0, states: [] });
  const sides: [Side, Side] = [side(0), side(1)];
  let droppedAt: number | undefined;
  let backAt: number | undefined;
  let longestWait = 0;
  let desyncSeen = false;
  for (let frame = 0; frame < 60 * 600; frame++) {
    room.advance(TICK_MS);
    if (droppedAt === undefined && sides[cut.side].lockstep.next >= cut.atTick) {
      droppedAt = room.now;
      room.drop(cut.side);
    } else if (droppedAt !== undefined && backAt === undefined && room.now - droppedAt >= cut.ms) {
      backAt = room.now;
      room.back(cut.side);
    }
    for (const who of [0, 1] as const) {
      const s = sides[who];
      s.owed += TICK_MS;
      let steps = 0;
      while (s.owed >= TICK_MS && steps < 4 && s.lockstep.next < ticks) {
        if (!s.lockstep.step(s.match, (t) => script(who, t))) {
          s.owed = Math.min(s.owed, TICK_MS);
          break;
        }
        s.owed -= TICK_MS;
        steps++;
        s.states.push(stateText(s.match));
      }
      const status = s.lockstep.status();
      longestWait = Math.max(longestWait, status.waiting);
      if (status.desync) desyncSeen = true;
    }
    if (sides.every((s) => s.lockstep.next >= ticks)) break;
  }
  return { sides, longestWait, desyncSeen, resumedIn: backAt === undefined ? undefined : room.now - backAt };
}

describe('a socket cut mid-fight and made again', () => {
  const ticks = 3000;
  const truth = reference(ticks, 7);

  const cases: { name: string; cut: Cut; held: number }[] = [
    { name: 'the guest, for a second', cut: { side: 1, atTick: 600, ms: 1000 }, held: 600 },
    { name: 'the host, for five seconds', cut: { side: 0, atTick: 1200, ms: 5000 }, held: 600 },
    { name: 'the guest, for fifteen seconds, more than the room holds', cut: { side: 1, atTick: 1500, ms: 15_000 }, held: 600 },
    { name: 'the host, for fifteen seconds, in a room that slept and held nothing', cut: { side: 0, atTick: 2000, ms: 15_000 }, held: 0 },
  ];

  for (const { name, cut, held } of cases) {
    it(`keeps both matches identical for ${ticks} ticks when ${name} drops`, () => {
      const room = new Room(held);
      const { sides, longestWait, desyncSeen } = play(room, ticks, cut);
      const [host, guest] = sides;
      expect(desyncSeen).toBe(false);
      expect(host.lockstep.next).toBe(ticks);
      expect(guest.lockstep.next).toBe(ticks);
      expect(host.states.length).toBe(ticks);
      for (let t = 0; t < ticks; t++) {
        if (host.states[t] !== truth[t] || guest.states[t] !== truth[t]) throw new Error(`tick ${t} differs`);
      }
      // The fight held for the length of the cut, give or take the wire, rather than running on.
      expect(longestWait).toBeGreaterThan(cut.ms - 200);
      expect(longestWait).toBeLessThan(cut.ms + 500);
      // The backlog after the return is a handful of ticks, well inside one frame's sixty.
      expect(room.biggestAfter).toBeLessThanOrEqual(16);
    });
  }
});
