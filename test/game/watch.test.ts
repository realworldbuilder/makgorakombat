import { describe, expect, it } from 'vitest';
import { GameRecord, kindOf } from '../../relay/src/record';
import { type Inputs, type Match, newMatch, noInputs } from '../../src/engine/engine';
import { TICK_MS } from '../../src/engine/stage';
import { decode, encode, type FighterSpec, type Hello, type Message } from '../../src/game/net/handshake';
import { type Channel, encodeFrame, Lockstep, stateText } from '../../src/game/net/lockstep';
import { BUFFER, CATCH_UP, type Seats, Spectator } from '../../src/game/net/watch';
import { fakeTable, FULL_SET, MAGE, WARRIOR } from '../engine/fake';

/**
 * A room in memory, on a clock the test turns: the two players' channels through it, each message
 * taking its own time from one player to the other, and the watchers' feed as the relay makes it,
 * from the relay's own record of the game (relay/src/record.ts). A watcher hears a message some
 * time after the room did, and one who comes in late is sent the record first.
 */
class Room {
  now = 0;
  readonly record = new GameRecord();
  private readonly queue: { at: number; n: number; deliver: () => void }[] = [];
  private readonly listeners: [((data: Uint8Array | string) => void)[], ((data: Uint8Array | string) => void)[]] = [[], []];
  /** Each watcher, and when the last message on its wire arrives: a socket keeps its messages in order. */
  private readonly watchers: { spectator: Spectator; last: number }[] = [];
  private sent = 0;
  private seed = 4242;

  private draw(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private later(ms: number, deliver: () => void): void {
    this.queue.push({ at: this.now + ms, n: this.sent++, deliver });
  }

  /** Player `seat`'s end: what it sends reaches the room in 10 to 40 ms and the other player 10 to 40 ms after. */
  end(seat: 0 | 1): Channel {
    return {
      send: (data) => {
        const copy = typeof data === 'string' ? data : data.slice();
        this.later(10 + this.draw() * 30, () => this.atRoom(seat, copy));
      },
      onMessage: (listener) => {
        this.listeners[seat].push(listener);
        return () => this.listeners[seat].splice(this.listeners[seat].indexOf(listener), 1);
      },
      onClose: () => () => {},
    };
  }

  /** A watcher comes in: at the room it is sent the seats and the game so far, and from then on everything, all in order. */
  watch(spectator: Spectator): void {
    this.later(15, () => {
      const watcher = { spectator, last: 0 };
      this.watchers.push(watcher);
      for (const message of [JSON.stringify({ t: 'seats', host: true, guest: true }), ...this.record.replay()]) this.toWatcher(watcher, message);
    });
  }

  private toWatcher(watcher: { spectator: Spectator; last: number }, message: string | Uint8Array): void {
    const at = Math.max(this.now + 5 + this.draw() * 60, watcher.last);
    watcher.last = at;
    this.queue.push({ at, n: this.sent++, deliver: () => feed(watcher.spectator, message) });
  }

  /** As relay/src/index.ts does with a player's message: to the other player, into the record, and to the watchers. */
  private atRoom(seat: 0 | 1, data: Uint8Array | string): void {
    this.later(10 + this.draw() * 30, () => this.listeners[seat === 0 ? 1 : 0].forEach((listener) => listener(data)));
    let out: Uint8Array | string;
    if (typeof data === 'string') {
      const kind = kindOf(data);
      if (kind === 'hello' && seat === 0) this.record.start(data);
      else if (kind === 'rematch' && seat === 0) this.record.rematch(data);
      else if (kind === 'back') this.record.clear();
      else return;
      out = data;
    } else {
      this.record.take(seat, data);
      out = new Uint8Array([seat, ...data]);
    }
    for (const watcher of this.watchers) this.toWatcher(watcher, out);
  }

  advance(ms: number): void {
    this.now += ms;
    const due = this.queue.filter((m) => m.at <= this.now).sort((a, b) => a.at - b.at || a.n - b.n);
    for (const m of due) {
      this.queue.splice(this.queue.indexOf(m), 1);
      m.deliver();
    }
  }
}

/** What the watcher's socket does with a message (watch.ts, Watching). */
function feed(spectator: Spectator, message: string | Uint8Array): void {
  if (typeof message !== 'string') return spectator.frame(message);
  if (kindOf(message) === 'seats') return spectator.take(JSON.parse(message) as Seats);
  const decoded = decode(message);
  if (decoded) spectator.take(decoded);
}

/** A player who never stops, fixed by the tick (as in lockstep.test.ts). */
function script(player: 0 | 1, t: number, game = 1): Inputs {
  let h = (Math.imul(t + 1 + game * 7919, 2654435761) ^ Math.imul(player + 7, 40503)) >>> 0;
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

const spec = (name: string, classId: number): FighterSpec => ({ key: `race:2:0:${classId}`, name, title: 'Champion', raceId: 2, sex: 0, classId, choices: [], gear: [] });

/** The host's hello, as Game.tsx makes one, sent as text through the room. */
function helloOf(seed: number): Hello {
  return {
    t: 'hello',
    version: 'dev',
    product: 'wow',
    rules: 'warcraft',
    seed,
    game: 1,
    stage: { kind: 'none' },
    fighters: [spec('Garrosh', WARRIOR), spec('Jaina', MAGE)],
    tables: [fakeTable(FULL_SET, 'oneHand', {}, WARRIOR), fakeTable(FULL_SET, 'twoHand', {}, MAGE)],
  };
}

/** A match as Fight.tsx starts one on a hello: its tables as JSON made them, its names, its rules. */
const matchOf = (hello: Hello, seed: number): Match => newMatch(hello.tables, seed, [hello.fighters[0].name, hello.fighters[1].name], 'warcraft');

interface Player {
  match: Match;
  lockstep: Lockstep;
  owed: number;
  game: number;
  /** The state after each tick of the game on now. */
  states: string[];
}

interface Watcher {
  spectator: Spectator;
  owed: number;
  /** The state the watcher had after each frame it ran a tick in, by tick, to hold against the players'. */
  seen: Map<number, string>;
  /** The most it was behind the host once it had caught up. */
  behind: number;
}

/**
 * Two players play `ticks` ticks of each game through the room, sixty frames a second as the page
 * does, with watchers coming in as `join` says (by the host's tick); after game one the host calls
 * a rematch if `rematch` is given. The watchers play on as Fight.tsx's watch mode does.
 */
function play(ticks: number, options: { join: number[]; rematch?: number; seed?: number }) {
  const room = new Room();
  const seed = options.seed ?? 77;
  const hello = helloOf(seed);
  const sent = decode(encode(hello)) as Hello;
  const host: Player = { match: matchOf(sent, seed), lockstep: new Lockstep(room.end(0), 0, { game: 1, now: () => room.now }), owed: 0, game: 1, states: [] };
  room.end(0).send(encode(hello));
  // The guest starts on the hello when it comes, as Game.tsx does.
  let guest: Player | undefined;
  const offHello = room.end(1).onMessage((data) => {
    if (typeof data !== 'string') return;
    const message = decode(data) as Message;
    if (message.t === 'hello' && !guest) guest = { match: matchOf(message, message.seed), lockstep: new Lockstep(room.end(1), 1, { game: 1, now: () => room.now }), owed: 0, game: 1, states: [] };
    if (message.t === 'rematch' && guest && message.game !== guest.game) restart(guest, 1, message.game, message.seed);
  });
  const restart = (player: Player, who: 0 | 1, game: number, next: number) => {
    player.lockstep.dispose();
    player.game = game;
    player.lockstep = new Lockstep(room.end(who), who, { game, now: () => room.now });
    player.match = matchOf(sent, next);
    player.states = [];
  };
  const games = options.rematch === undefined ? 1 : 2;
  const watchers: Watcher[] = [];
  const toJoin = [...options.join];
  /** What each watcher saw of each game, kept when the game ends. */
  const gamesSeen: Map<number, string>[][] = [];
  const statesOf: string[][][] = [];
  for (let frame = 0; frame < 60 * 600; frame++) {
    room.advance(TICK_MS);
    for (const [who, player] of [[0, host] as const, [1, guest] as const]) {
      if (!player) continue;
      player.owed += TICK_MS;
      let steps = 0;
      while (player.owed >= TICK_MS && steps < 4 && player.lockstep.next < ticks) {
        if (!player.lockstep.step(player.match, (t) => script(who, t, player.game))) {
          player.owed = Math.min(player.owed, TICK_MS);
          break;
        }
        player.owed -= TICK_MS;
        steps++;
        player.states.push(stateText(player.match));
      }
    }
    while (toJoin.length > 0 && host.lockstep.next >= toJoin[0]!) {
      toJoin.shift();
      const spectator = new Spectator();
      room.watch(spectator);
      watchers.push({ spectator, owed: 0, seen: new Map(), behind: 0 });
    }
    for (const watcher of watchers) {
      // As the watch mode of Fight.tsx: the ticks the clock owes, a held fight running up no debt.
      watcher.owed += TICK_MS;
      // Never past the last tick the players play, so the end can be held against theirs.
      const due = Math.min(Math.floor(watcher.owed / TICK_MS), ticks - watcher.spectator.next);
      const ran = watcher.spectator.play(due);
      watcher.owed = ran < due ? Math.min(watcher.owed, TICK_MS) : watcher.owed - due * TICK_MS;
      const { match, next } = watcher.spectator;
      if (ran > 0 && match && next <= ticks) watcher.seen.set(next - 1, stateText(match));
      if (watcher.spectator.status() === 'playing' && host.lockstep.next < ticks) watcher.behind = Math.max(watcher.behind, host.lockstep.next - next);
    }
    const done = (p: Player | undefined) => p !== undefined && p.lockstep.next >= ticks;
    const watched = toJoin.length === 0 && watchers.every((w) => w.spectator.next >= ticks || w.spectator.status() === 'desync');
    if (done(host) && done(guest) && watched) {
      gamesSeen.push(watchers.map((w) => w.seen));
      statesOf.push([host.states, guest!.states]);
      if (gamesSeen.length === games) break;
      // The rematch, as the host's Enter on the match's end calls it.
      const next = (seed + 2) >>> 0;
      room.end(0).send(encode({ t: 'rematch', game: 2, seed: next }));
      restart(host, 0, 2, next);
      for (const w of watchers) {
        w.seen = new Map();
        w.behind = 0;
      }
      toJoin.push(...[options.rematch!].map((at) => host.lockstep.next + at));
    }
  }
  offHello();
  return { host, guest: guest!, watchers, gamesSeen, statesOf };
}

/** Every state a watcher had is the one both players had after the same tick, and it saw the last tick. */
function expectSame(seen: Map<number, string>, states: [string[], string[]], ticks: number): void {
  expect(states[0].length).toBe(ticks);
  expect(states[1]).toEqual(states[0]);
  expect(seen.has(ticks - 1)).toBe(true);
  for (const [t, text] of seen) expect(text, `tick ${t}`).toBe(states[0][t]);
}

describe('watching a fight', () => {
  it('rebuilds both players\' match exactly for 3000 ticks from the hello and the frames the room relays', () => {
    const { watchers, gamesSeen, statesOf } = play(3000, { join: [0] });
    const [watcher] = watchers;
    expect(watcher!.spectator.status()).not.toBe('desync');
    expectSame(gamesSeen[0]![0]!, statesOf[0] as [string[], string[]], 3000);
    // It ran a little behind the players, never far, and checked the players' hashes on the way.
    expect(watcher!.behind).toBeLessThanOrEqual(CATCH_UP + 8);
    expect(gamesSeen[0]![0]!.size).toBeGreaterThan(2000);
  });

  it('catches a watcher who comes in mid-fight up from the room\'s record, and on to the same end', () => {
    const { watchers, gamesSeen, statesOf } = play(3000, { join: [1500, 2900] });
    for (const [k, watcher] of watchers.entries()) {
      expect(watcher.spectator.status()).not.toBe('desync');
      expectSame(gamesSeen[0]![k]!, statesOf[0] as [string[], string[]], 3000);
    }
  });

  it('starts the next game over with the host\'s rematch, the seed and the match number it gives', () => {
    const { watchers, gamesSeen, statesOf, host } = play(1200, { join: [0, 300], rematch: 400 });
    expect(host.game).toBe(2);
    for (const k of [0, 1]) expectSame(gamesSeen[0]![k]!, statesOf[0] as [string[], string[]], 1200);
    // The two from game one, and the one who came in during game two, after the rematch.
    expect(watchers.length).toBe(3);
    for (const [k, watcher] of watchers.entries()) {
      expect(watcher.spectator.game).toBe(2);
      expectSame(gamesSeen[1]![k]!, statesOf[1] as [string[], string[]], 1200);
    }
    // Game two is not game one again.
    expect(statesOf[1]![0]![1199]).not.toBe(statesOf[0]![0]![1199]);
  });
});

describe('the watcher\'s pace', () => {
  const hello = decode(encode(helloOf(5))) as Hello;
  const frame = (seat: 0 | 1, first: number, n: number, game = 1) => new Uint8Array([seat, ...encodeFrame({ game, ack: -1, first, inputs: new Array<number>(n).fill(0), hash: undefined })]);

  it('waits for half a second of both players\' inputs, plays what the clock owes, and holds when a tick is missing', () => {
    const spectator = new Spectator();
    expect(spectator.play(1)).toBe(0);
    expect(spectator.status()).toBe('between');
    spectator.take(hello);
    expect(spectator.status()).toBe('buffering');
    // The first ticks are empty on both sides by the lockstep's delay and are never sent.
    spectator.frame(frame(0, 4, BUFFER - 10));
    expect(spectator.play(1)).toBe(0);
    spectator.frame(frame(1, 4, BUFFER - 4));
    expect(spectator.ahead()).toBe(BUFFER - 6);
    expect(spectator.play(1)).toBe(0);
    spectator.frame(frame(0, 4, BUFFER + 10));
    expect(spectator.ahead()).toBe(BUFFER);
    expect(spectator.play(1)).toBe(1);
    expect(spectator.status()).toBe('playing');
    expect(spectator.play(2)).toBe(2);
    expect(spectator.next).toBe(3);
    // Running dry holds the fight until half a second is in hand again.
    expect(spectator.play(100)).toBe(BUFFER - 3);
    expect(spectator.play(1)).toBe(0);
    expect(spectator.status()).toBe('buffering');
    spectator.frame(frame(1, BUFFER, 10));
    expect(spectator.play(1)).toBe(0);
    spectator.frame(frame(1, BUFFER + 10, BUFFER));
    spectator.frame(frame(0, BUFFER + 14, BUFFER));
    expect(spectator.play(1)).toBe(1);
  });

  it('runs ahead to half a second behind when far behind, and takes no frame of another game', () => {
    const spectator = new Spectator();
    spectator.take(hello);
    spectator.frame(frame(0, 4, 255));
    spectator.frame(frame(1, 4, 255));
    spectator.frame(frame(1, 259, 100, 2));
    expect(spectator.ahead()).toBe(259);
    expect(spectator.play(1)).toBe(259 - BUFFER);
    expect(spectator.play(1)).toBe(1);
    // A rematch: a new match from tick 0, on the rematch's seed.
    spectator.take({ t: 'rematch', game: 2, seed: 6 });
    expect(spectator.next).toBe(0);
    expect(spectator.match!.frame).toBe(0);
    expect(spectator.ahead()).toBe(4);
    spectator.take({ t: 'back' });
    expect(spectator.status()).toBe('between');
  });

  it('says DESYNC when its match is not the one the players hash', () => {
    const { host } = play(200, { join: [] });
    // A watcher on the wrong seed, fed the right inputs and the players' hashes.
    const spectator = new Spectator({ buffer: 1 });
    spectator.take({ ...hello, seed: 12345 });
    const hashes = (host.lockstep as unknown as { hashes: Map<number, number> }).hashes;
    const inputs = new Array<number>(200).fill(0);
    for (const seat of [0, 1] as const) spectator.frame(new Uint8Array([seat, ...encodeFrame({ game: 1, ack: -1, first: 4, inputs, hash: { tick: 59, value: hashes.get(59)! } })]));
    while (spectator.play(10) > 0);
    expect(spectator.status()).toBe('desync');
  });
});

describe('the pick, watched', () => {
  it('keeps each player\'s cursor as the room passes it on, through the hello, and lets it go back at the roster or when they leave', () => {
    const spectator = new Spectator();
    const roster = (tile: string) => ({ t: 'roster', tile, sex: 0, classId: undefined, locked: false, champion: undefined }) as const;
    spectator.take({ t: 'seats', host: true, guest: true });
    spectator.take({ t: 'pick', by: 'guest', roster: roster('legend:jaina') });
    spectator.take({ t: 'pick', by: 'host', roster: roster('legend:thrall') });
    expect(spectator.picks.map((pick) => pick?.tile)).toEqual(['legend:thrall', 'legend:jaina']);
    spectator.take(decode(encode(helloOf(5))) as Hello);
    expect(spectator.picks.map((pick) => pick?.tile)).toEqual(['legend:thrall', 'legend:jaina']);
    spectator.take({ t: 'back' });
    expect(spectator.picks).toEqual([undefined, undefined]);
    spectator.take({ t: 'pick', by: 'host', roster: roster('legend:tyrande') });
    spectator.take({ t: 'pick', by: 'guest', roster: roster('legend:jaina') });
    spectator.take({ t: 'seats', host: true, guest: false });
    expect(spectator.picks.map((pick) => pick?.tile)).toEqual(['legend:tyrande', undefined]);
  });
});
