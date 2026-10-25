import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { nightOf, type Result, type Standings } from '../src/board';
import { readReport } from '../src/index';
import type { Player } from '../src/lobby';
import { Client } from './client';

let lobbies = 0;
/** A lobby of its own for each test, with its players' sockets. */
function lobby() {
  const stub = env.LOBBY.getByName(`board-${++lobbies}`);
  const enter = async (name: string, id: string): Promise<Client> => {
    const response = await stub.fetch(`https://relay.test/lobby/ws?name=${encodeURIComponent(name)}&id=${id}`, { headers: { Upgrade: 'websocket' } });
    expect(response.status).toBe(101);
    return new Client(response.webSocket!);
  };
  return { stub, enter };
}

const send = (client: Client, message: object) => client.ws.send(JSON.stringify(message));
const ids = { chris: 'chris-0001', will: 'will-00002', third: 'third-0003' };

async function intoRoom(code: string, role: 'host' | 'guest'): Promise<Client> {
  const response = await SELF.fetch(`https://relay.test/rooms/${code}/ws?role=${role}`, { headers: { Upgrade: 'websocket' } });
  expect(response.status).toBe(101);
  return new Client(response.webSocket!);
}

/** Chris challenges Will, Will accepts, and both pages go into the room the lobby made. */
async function matched(enter: (name: string, id: string) => Promise<Client>) {
  const chris = await enter('Chris', ids.chris);
  const will = await enter('Will', ids.will);
  await will.next('here');
  send(chris, { t: 'challenge', to: ids.will });
  await will.next('challenged');
  send(will, { t: 'accept', from: ids.chris });
  const { code } = await chris.next<{ code: string }>('fight');
  const host = await intoRoom(code, 'host');
  const guest = await intoRoom(code, 'guest');
  await host.until(1);
  await guest.until(1);
  return { chris, will, host, guest, code };
}

const report = (game: number, winner: 'host' | 'guest', extra: object = {}) => ({ t: 'result', game, winner, rounds: 3, ticks: 4321, ...extra });

/** Waits until the lobby's board has `n` rows. */
async function rowsOf(stub: ReturnType<typeof lobby>['stub'], n: number, span: 'night' | 'all' = 'all'): Promise<Standings> {
  const deadline = Date.now() + 2000;
  for (;;) {
    const standings = await stub.standings(span);
    if (standings.rows.length >= n || Date.now() > deadline) return standings;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const result = (winner: string, loser: string): Result => ({
  t: 'result',
  winner: { id: `${winner.toLowerCase()}-0001`, name: winner },
  loser: { id: `${loser.toLowerCase()}-0001`, name: loser },
  rounds: 2,
  ticks: 3000,
});

describe('board', () => {
  it('turns the night over at four in the morning in New York, summer time or not', () => {
    expect(nightOf(Date.parse('2026-10-25T07:59:00Z'))).toBe('2026-10-24'); // 3:59 EDT
    expect(nightOf(Date.parse('2026-10-25T08:00:00Z'))).toBe('2026-10-25'); // 4:00 EDT
    expect(nightOf(Date.parse('2026-10-26T02:30:00Z'))).toBe('2026-10-25'); // 22:30 EDT
    expect(nightOf(Date.parse('2026-11-01T08:30:00Z'))).toBe('2026-10-31'); // 3:30 EST, the hour gone back
    expect(nightOf(Date.parse('2026-11-01T09:00:00Z'))).toBe('2026-11-01'); // 4:00 EST
  });

  it('reads a page\'s result and nothing else', () => {
    expect(readReport('{"t":"result","game":1,"winner":"guest","rounds":2,"ticks":99}')).toEqual({ t: 'result', game: 1, winner: 'guest', rounds: 2, ticks: 99 });
    expect(readReport('{"t":"result","game":1,"winner":"both","rounds":2,"ticks":99}')).toBe(undefined);
    expect(readReport('{"t":"hello","seed":7}')).toBe(undefined);
    expect(readReport('{"t":"result","game":1,"winner":"host","rounds":2,"ticks":9,"me":{"id":"x","name":"<b>"}}')!.me).toBe(undefined);
    expect(readReport('{"t":"result","game":1,"winner":"host","rounds":2,"ticks":9,"me":{"id":"will-00002","name":"Will"}}')!.me).toEqual({ id: 'will-00002', name: 'Will' });
  });

  it('counts a match both pages say ended the same way, under the names the lobby matched', async () => {
    const { stub, enter } = lobby();
    const { chris, will, host, guest } = await matched(enter);
    send(host, report(1, 'host'));
    send(guest, report(1, 'host'));
    let board = await rowsOf(stub, 2);
    expect(board.rows).toEqual([
      { rank: 1, name: 'Chris', wins: 1, losses: 0, best: 1, streak: 1 },
      { rank: 2, name: 'Will', wins: 0, losses: 1, best: 0, streak: 0 },
    ]);
    // The rematch, then another: Will wins both and passes Chris; Chris's streak ends.
    send(guest, report(2, 'guest'));
    send(host, report(2, 'guest'));
    send(host, report(3, 'guest', { ticks: 5000 }));
    send(guest, report(3, 'guest', { ticks: 5000 }));
    const deadline = Date.now() + 2000;
    while ((board = await stub.standings('all', ids.will)).rows[0]!.name !== 'Will' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(board.rows).toEqual([
      { rank: 1, name: 'Will', wins: 2, losses: 1, best: 2, streak: 2, me: true },
      { rank: 2, name: 'Chris', wins: 1, losses: 2, best: 1, streak: 0 },
    ]);
    expect(board.mine).toEqual(board.rows[0]);
    // Nobody passes the pages' word on to the other page.
    expect(host.kinds(1)).toEqual([]);
    expect(guest.kinds(1)).toEqual([]);
    for (const c of [chris, will, host, guest]) c.ws.close(1000, 'bye');
  });

  it('counts nothing for a match one page left, or that the two pages tell differently', async () => {
    const { stub, enter } = lobby();
    const { chris, will, host, guest } = await matched(enter);
    // They disagree on the ticks: one of them is not telling the truth, or not in step.
    send(host, report(1, 'host'));
    send(guest, report(1, 'host', { ticks: 4000 }));
    // The guest drops before the end; only the host ever says how it went.
    send(host, report(2, 'host'));
    guest.ws.close(1000, 'gone');
    await host.next('peer');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await stub.standings('all')).rows).toEqual([]);
    // The guest back in the same room, a new match from 1, told the same by both: that one counts.
    const back = await intoRoom((await chris.next<{ code: string }>('fight')).code, 'guest');
    send(host, report(1, 'guest'));
    send(back, report(1, 'guest'));
    const board = await rowsOf(stub, 2);
    expect(board.rows.map((r) => [r.name, r.wins, r.losses])).toEqual([['Will', 1, 0], ['Chris', 0, 1]]);
    for (const c of [chris, will, host, back]) c.ws.close(1000, 'bye');
  });

  it('counts a room made by code under the names the pages give', async () => {
    const { code } = await (await SELF.fetch('https://relay.test/rooms', { method: 'POST' })).json<{ code: string }>();
    const host = await intoRoom(code, 'host');
    const guest = await intoRoom(code, 'guest');
    await host.until(1);
    send(host, report(1, 'guest', { me: { id: 'code-host-1', name: 'Hosty' } }));
    send(guest, report(1, 'guest', { me: { id: 'code-guest-1', name: 'Guesty' } }));
    const main = env.LOBBY.getByName('lobby');
    const deadline = Date.now() + 2000;
    let board = await main.standings('all', 'code-guest-1');
    while (!board.mine && Date.now() < deadline) board = await main.standings('all', 'code-guest-1');
    expect(board.mine).toMatchObject({ name: 'Guesty', wins: 1, losses: 0 });
    expect(board.rows.find((r) => r.name === 'Hosty')).toMatchObject({ wins: 0, losses: 1 });
    for (const c of [host, guest]) c.ws.close(1000, 'bye');
  });

  it('starts each night at nothing and keeps the whole record', async () => {
    const { stub } = lobby();
    const friday = Date.parse('2026-10-24T02:00:00Z'); // 22:00 EDT on the 23rd
    const late = Date.parse('2026-10-24T07:30:00Z'); // 3:30 EDT: still the 23rd's night
    const saturday = Date.parse('2026-10-25T01:00:00Z'); // 21:00 EDT on the 24th
    await stub.result(result('Chris', 'Will'), friday);
    await stub.result(result('Chris', 'Will'), late);
    expect((await stub.standings('night', undefined, late)).rows.map((r) => [r.name, r.wins, r.losses, r.best])).toEqual([['Chris', 2, 0, 2], ['Will', 0, 2, 0]]);

    await stub.result(result('Will', 'Thrall'), saturday);
    const tonight = await stub.standings('night', 'chris-0001', saturday);
    expect(tonight.night).toBe('2026-10-24');
    // Chris has not fought tonight: not on tonight's board, and no row of his own for it.
    expect(tonight.rows.map((r) => [r.name, r.wins, r.losses, r.streak])).toEqual([['Will', 1, 0, 1], ['Thrall', 0, 1, 0]]);
    expect(tonight.mine).toBe(undefined);
    const all = await stub.standings('all', 'chris-0001', saturday);
    expect(all.rows.map((r) => [r.name, r.wins, r.losses, r.best, r.streak])).toEqual([
      ['Chris', 2, 0, 2, 2],
      ['Will', 1, 2, 1, 1],
      ['Thrall', 0, 1, 0, 0],
    ]);
    expect(all.mine).toMatchObject({ rank: 1, name: 'Chris' });
  });

  it('lists everyone here with what they have won and lost tonight', async () => {
    const { stub, enter } = lobby();
    await stub.result(result('Chris', 'Will'));
    await stub.result(result('Will', 'Chris'));
    await stub.result(result('Will', 'Chris'));
    const chris = await enter('Chris', 'chris-0001');
    const third = await enter('Third', ids.third);
    const here = await third.next<{ players: Player[] }>('here', 0);
    const deadline = Date.now() + 2000;
    let players = here.players;
    for (let k = here.k; players.length < 2 && Date.now() < deadline; ) {
      const next = await third.next<{ players: Player[] }>('here', k + 1);
      players = next.players;
      k = next.k;
    }
    expect(players).toEqual([
      { id: 'chris-0001', name: 'Chris', status: 'free', night: [1, 2] },
      { id: ids.third, name: 'Third', status: 'free' },
    ]);
    for (const c of [chris, third]) c.ws.close(1000, 'bye');
  });

  it('answers GET /lobby/board, most wins first, then the longest run, twenty at most', async () => {
    const main = env.LOBBY.getByName('lobby');
    // Twenty-two players: P1 beats everyone else once; P2 and P3 have two wins each, P3 in a row.
    const p = (k: number) => ({ id: `player-${String(k).padStart(4, '0')}`, name: `P${k}` });
    const fight = (w: number, l: number) => main.result({ t: 'result', winner: p(w), loser: p(l), rounds: 2, ticks: 100 });
    await fight(2, 4);
    await fight(5, 2);
    await fight(2, 6);
    await fight(3, 7);
    await fight(3, 8);
    for (let k = 4; k <= 22; k++) await fight(1, k);
    const response = await SELF.fetch('https://relay.test/lobby/board?span=all&id=player-0004', { headers: { Origin: 'https://makgora.clawdioslave.com' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://makgora.clawdioslave.com');
    const board = await response.json<Standings>();
    expect(board.span).toBe('all');
    expect(board.rows.length).toBe(20);
    expect(board.rows.slice(0, 3).map((r) => [r.rank, r.name, r.wins, r.best])).toEqual([
      [1, 'P1', 19, 19],
      [2, 'P3', 2, 2],
      [3, 'P2', 2, 1],
    ]);
    // P4 lost twice and won nothing: everyone who lost only once goes ahead, and P4's own row comes alone.
    expect(board.rows.some((r) => r.me)).toBe(false);
    expect(board.rows[19]).toMatchObject({ wins: 0, losses: 1 });
    expect(board.mine).toMatchObject({ name: 'P4', wins: 0, losses: 2, me: true });
    expect(board.mine!.rank).toBeGreaterThan(20);
    // No ids go out on the board, and a night that has results answers by default.
    expect(JSON.stringify(board)).not.toContain('player-');
    const night = await (await SELF.fetch('https://relay.test/lobby/board')).json<Standings>();
    expect(night.span).toBe('night');
    expect(night.rows[0]!.name).toBe('P1');
  });
});
