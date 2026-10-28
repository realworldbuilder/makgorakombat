import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { type Fight, type FightLog, hourOf, KEEP_FIGHTS, KEEP_MS, median, type NightReport, nightStart, summarize } from '../src/fights';
import type { Room } from '../src/index';
import type { Lobby } from '../src/lobby';
import { Client } from './client';

let lobbies = 0;
/** A lobby of its own for each test, with its players' sockets. */
function lobby() {
  const stub = env.LOBBY.getByName(`report-${++lobbies}`);
  const enter = async (name: string, id: string): Promise<Client> => {
    const response = await stub.fetch(`https://relay.test/lobby/ws?name=${encodeURIComponent(name)}&id=${id}`, { headers: { Upgrade: 'websocket' } });
    expect(response.status).toBe(101);
    return new Client(response.webSocket!);
  };
  return { stub, enter };
}

const send = (client: Client, message: object) => client.ws.send(JSON.stringify(message));
const ids = { chris: 'chris-0001', will: 'will-00002' };

async function intoRoom(code: string, role: 'host' | 'guest', id?: string): Promise<Client> {
  const response = await SELF.fetch(`https://relay.test/rooms/${code}/ws?role=${role}${id ? `&id=${id}` : ''}`, { headers: { Upgrade: 'websocket' } });
  expect(response.status).toBe(101);
  return new Client(response.webSocket!);
}

/** A frame as lockstep.ts lays one out: game, no ack, `n` idle inputs from `first`, and the hash after `tick`. */
function frame(game: number, first: number, n: number, hash?: { tick: number; value: number }): Uint8Array {
  const bytes = new Uint8Array(12 + n + (hash ? 6 : 0));
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x4b;
  bytes[1] = game;
  view.setInt32(2, -1);
  view.setUint32(6, first);
  bytes[10] = n;
  bytes[11 + n] = hash ? 1 : 0;
  if (hash) {
    view.setUint32(12 + n, hash.tick);
    view.setUint16(16 + n, hash.value);
  }
  return bytes;
}

const hello = (game: number, slug = 'nagrand-arena') => JSON.stringify({ t: 'hello', version: 'x', product: 'wow', seed: 7, game, stage: { kind: 'stage', slug }, fighters: [], tables: [] });

/** Waits until the lobby's log has `n` records today. */
async function records(stub: ReturnType<typeof lobby>['stub'], n: number): Promise<Fight[]> {
  const deadline = Date.now() + 8000;
  for (;;) {
    const { fights } = await stub.report('day');
    if (fights!.length >= n) return fights!;
    if (Date.now() > deadline) throw new Error(`waited for ${n} records, got ${JSON.stringify(fights)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Both in the queue, Chris having waited a minute and a half: the lobby makes the room, and both go in. */
async function queued(enter: (name: string, id: string) => Promise<Client>, stub: ReturnType<typeof lobby>['stub']) {
  const chris = await enter('Chris', ids.chris);
  const will = await enter('Will', ids.will);
  send(chris, { t: 'quick' });
  await chris.next('queued');
  await runInDurableObject(stub, async (_lobby: Lobby, state) => {
    const queue = (await state.storage.get<{ id: string; at: number }[]>('quick'))!;
    await state.storage.put('quick', queue.map((w) => ({ ...w, at: w.at - 90_000 })));
  });
  send(will, { t: 'quick' });
  const { code } = await chris.next<{ code: string }>('fight');
  const host = await intoRoom(code, 'host', 'seat-h');
  const guest = await intoRoom(code, 'guest', 'seat-g');
  await host.until(1);
  await guest.until(1);
  return { chris, will, host, guest, code };
}

/** Waits until `check` answers true. */
async function until(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 8000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('waited too long');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const fight = (start: number, ended: Fight['ended'], extra: Partial<Fight> = {}): Fight => ({
  code: 'BCDFGH',
  lobby: true,
  start,
  end: start + 60_000,
  game: ended === 'never' ? 0 : 1,
  host: { id: 'chris-0001', name: 'Chris' },
  guest: { id: 'will-00002', name: 'Will' },
  ended,
  reconnects: 0,
  ...extra,
});

describe('the night\'s report', () => {
  it('adds up a span: who came, the queue, how the matches ended, the busiest hour', () => {
    const at = (iso: string) => Date.parse(iso);
    const fights: Fight[] = [
      fight(at('2026-10-26T01:05:00Z'), 'finished', { waits: [90, 0] }), // 21:05 EDT
      fight(at('2026-10-26T01:40:00Z'), 'desync', { desyncAt: 1260, waits: [12, 30] }),
      fight(at('2026-10-26T02:10:00Z'), 'finished', { reconnects: 2, guest: { id: 'third-0003', name: 'Third' } }), // 22:10
      fight(at('2026-10-26T02:20:00Z'), 'dropped', { by: 'guest', reconnects: 1, waits: [null, 300] }),
      fight(at('2026-10-26T02:30:00Z'), 'left', { by: 'host' }),
      fight(at('2026-10-26T02:50:00Z'), 'never', { waits: [5, null] }),
    ];
    const report = summarize('night', fights, ['chris-0001', 'lurker-0004'], at('2026-10-26T03:00:00Z'), at('2026-10-25T08:00:00Z'));
    expect(report).toMatchObject({
      span: 'night',
      night: '2026-10-25',
      players: 4,
      started: 5,
      finished: 2,
      desyncs: 1,
      drops: 1,
      left: 1,
      never: 1,
      reconnects: 3,
      // 0, 5, 12, 30, 90, 300: the two in the middle, 12 and 30.
      wait: { n: 6, median: 21, worst: 300 },
      busiest: { hour: '2026-10-25 22:00', fights: 3 },
    });
    expect(report.hours[21]).toBe(2);
    expect(report.hours[22]).toBe(3);
    expect(report.hours.reduce((a, b) => a + b)).toBe(5);
  });

  it('answers nothing much for nothing', () => {
    const report = summarize('week', [], [], 1_000, 0);
    expect(report).toMatchObject({ players: 0, started: 0, wait: { n: 0, median: null, worst: null }, busiest: null });
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1])).toBe(2.5);
  });

  it('reads hours and nights in New York, as the board does', () => {
    expect(hourOf(Date.parse('2026-10-26T01:05:00Z'))).toEqual({ label: '2026-10-25 21:00', hour: 21 });
    expect(nightStart(Date.parse('2026-10-26T03:00:00Z'))).toBe(Date.parse('2026-10-25T08:00:00Z')); // 4 AM EDT
    expect(nightStart(Date.parse('2026-10-25T07:30:00Z'))).toBe(Date.parse('2026-10-24T08:00:00Z')); // 3:30 AM: still last night
    expect(nightStart(Date.parse('2026-11-01T12:00:00Z'))).toBe(Date.parse('2026-11-01T09:00:00Z')); // 4 AM EST, the hour gone back
  });

  it('keeps tonight apart from the day, the week and all, and lists the matches for a night or a day only', async () => {
    const { stub } = lobby();
    const now = Date.parse('2026-10-26T03:00:00Z'); // 23:00 EDT on the 25th
    await stub.fight(fight(Date.parse('2026-10-26T01:00:00Z'), 'finished'), now); // tonight
    await stub.fight(fight(Date.parse('2026-10-25T07:00:00Z'), 'finished'), now); // 3 AM: last night, but within the day
    await stub.fight(fight(Date.parse('2026-10-22T03:00:00Z'), 'desync'), now); // this week
    await stub.fight(fight(Date.parse('2026-10-10T03:00:00Z'), 'left'), now); // older
    const span = async (which: 'night' | 'day' | 'week' | 'all'): Promise<NightReport> => stub.report(which, now);
    expect((await span('night')).started).toBe(1);
    expect((await span('night')).fights!.length).toBe(1);
    expect((await span('day')).started).toBe(2);
    expect((await span('week')).started).toBe(3);
    expect((await span('week')).fights).toBe(undefined);
    const all = await span('all');
    expect(all.started).toBe(4);
    expect(all.from).toBe(Date.parse('2026-10-10T03:00:00Z'));
  });

  it('rolls off records older than thirty days or past the two thousandth', async () => {
    const { stub } = lobby();
    const now = Date.now();
    await runInDurableObject(stub, (instance: Lobby) => {
      const log = (instance as unknown as { log: FightLog }).log;
      log.add(fight(now - KEEP_MS - 120_000, 'finished'), now);
      for (let k = 0; k < KEEP_FIGHTS + 5; k++) log.add(fight(now - 1_000_000 + k, k < 5 ? 'left' : 'finished'), now);
    });
    const all = await stub.report('all', now);
    expect(all.started).toBe(KEEP_FIGHTS);
    // The oldest went first: the five who left were the first in.
    expect(all.left).toBe(0);
  });

  it('logs a queued match fought to the end, with the queue waits; then a desync the room sees in the hashes; then one left for the roster', async () => {
    const { stub, enter } = lobby();
    const { chris, will, host, guest, code } = await queued(enter, stub);
    host.ws.send(hello(1));
    await guest.until(2);
    send(host, { t: 'result', game: 1, winner: 'guest', rounds: 3, ticks: 4321 });
    send(guest, { t: 'result', game: 1, winner: 'guest', rounds: 3, ticks: 4321 });
    const [first] = await records(stub, 1);
    expect(first).toMatchObject({
      code,
      lobby: true,
      game: 1,
      stage: 'nagrand-arena',
      ended: 'finished',
      winner: 'guest',
      rounds: 3,
      ticks: 4321,
      reconnects: 0,
      host: { id: ids.chris, name: 'Chris' },
      guest: { id: ids.will, name: 'Will' },
    });
    expect(first!.waits![0]).toBeGreaterThanOrEqual(89);
    expect(first!.waits![1]).toBeLessThanOrEqual(2);
    expect(first!.end).toBeGreaterThanOrEqual(first!.start);

    // The rematch: the two agree at tick 60 and part at tick 120.
    host.ws.send(JSON.stringify({ t: 'rematch', game: 2, seed: 8 }));
    await guest.next('rematch');
    host.ws.send(frame(2, 0, 60, { tick: 60, value: 0xbeef }));
    guest.ws.send(frame(2, 0, 60, { tick: 60, value: 0xbeef }));
    host.ws.send(frame(2, 60, 60, { tick: 120, value: 0x1111 }));
    guest.ws.send(frame(2, 60, 60, { tick: 120, value: 0x2222 }));
    let all = await records(stub, 2);
    expect(all[1]).toMatchObject({ game: 2, stage: 'nagrand-arena', ended: 'desync', desyncAt: 120 });
    // The queue waits go on the room's first record only.
    expect(all[1]!.waits).toBe(undefined);

    // A new fight, and the guest takes everyone back to the roster before the end.
    host.ws.send(hello(1, 'ring-of-valor'));
    await guest.next('hello', 2);
    guest.ws.send('{"t":"back"}');
    all = await records(stub, 3);
    expect(all[2]).toMatchObject({ game: 1, stage: 'ring-of-valor', ended: 'left', by: 'guest' });

    const report = await stub.report('night');
    expect(report).toMatchObject({ players: 2, started: 3, finished: 1, desyncs: 1, left: 1, drops: 0 });
    expect(report.wait.worst).toBeGreaterThanOrEqual(89);
    for (const c of [chris, will, host, guest]) c.ws.close(1000, 'bye');
  });

  it('counts a reconnect, then logs the match as dropped when the player does not come back in time', async () => {
    const { stub, enter } = lobby();
    const { chris, will, host, guest, code } = await queued(enter, stub);
    host.ws.send(hello(1));
    await guest.until(2);
    guest.ws.close(4000, 'wifi');
    await host.next('peer', 1);
    const back = await intoRoom(code, 'guest', 'seat-g');
    await back.next('peer');
    back.ws.close(4000, 'wifi again');
    const room = env.ROOMS.getByName(code);
    await until(() => runInDurableObject(room, async (_room: Room, state) => (await state.storage.get<Record<string, unknown>>('away'))?.guest !== undefined));
    await runInDurableObject(room, async (instance: Room, state) => {
      const away = { guest: { id: 'seat-g', until: Date.now() - 1 } };
      await state.storage.put('away', away);
      (instance as unknown as { away: unknown }).away = away;
    });
    expect(await runDurableObjectAlarm(room)).toBe(true);
    const [dropped] = await records(stub, 1);
    expect(dropped).toMatchObject({ ended: 'dropped', by: 'guest', reconnects: 1, game: 1 });
    expect((await stub.report('night')).reconnects).toBe(1);
    for (const c of [chris, will, host]) c.ws.close(1000, 'bye');
  });

  it('logs a match the lobby made that never started, when its room closes', async () => {
    const { stub, enter } = lobby();
    const { chris, will, host, guest, code } = await queued(enter, stub);
    host.ws.close(1000, 'bye');
    guest.ws.close(1000, 'bye');
    const room = env.ROOMS.getByName(code);
    // Both gone, nothing fought: the room's ten minutes run out.
    await until(() =>
      runInDurableObject(room, (_room: Room, state) => !state.getWebSockets('host').concat(state.getWebSockets('guest')).some((ws) => ws.readyState === WebSocket.OPEN)),
    );
    expect(await runDurableObjectAlarm(room)).toBe(true);
    const [never] = await records(stub, 1);
    expect(never).toMatchObject({ code, ended: 'never', game: 0, host: { name: 'Chris' }, guest: { name: 'Will' } });
    expect(never!.waits![0]).toBeGreaterThanOrEqual(89);
    const report = await stub.report('night');
    expect(report).toMatchObject({ started: 0, never: 1 });
    for (const c of [chris, will]) c.ws.close(1000, 'bye');
  });

  it('answers GET /lobby/report with the board\'s conventions, tonight by default', async () => {
    const main = env.LOBBY.getByName('lobby');
    await main.fight(fight(Date.now() - 1000, 'finished'));
    const response = await SELF.fetch('https://relay.test/lobby/report', { headers: { Origin: 'https://makgora.clawdioslave.com' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://makgora.clawdioslave.com');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const report = await response.json<NightReport>();
    expect(report.span).toBe('night');
    expect(report.finished).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(report.fights)).toBe(true);
    const week = await (await SELF.fetch('https://relay.test/lobby/report?span=week')).json<NightReport>();
    expect(week.span).toBe('week');
    expect(week.fights).toBe(undefined);
    expect((await SELF.fetch('https://relay.test/lobby/report', { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
  });
});
