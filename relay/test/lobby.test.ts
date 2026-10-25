import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { isCode } from '../src/index';
import { BEAT_MS, CHALLENGE_MS, cleanName, type Lobby, type Player } from '../src/lobby';
import { Client } from './client';

type Here = { players: Player[] };
type Fight = { code: string; role: 'host' | 'guest'; with: { id: string; name: string } };

let lobbies = 0;
/** A lobby of its own for each test, so one test's players are not in the next one's list. */
function lobby() {
  const stub = env.LOBBY.getByName(`test-${++lobbies}`);
  const enter = async (name: string, id: string, extra = ''): Promise<Client> => {
    const response = await stub.fetch(`https://relay.test/lobby/ws?name=${encodeURIComponent(name)}&id=${id}${extra}`, { headers: { Upgrade: 'websocket' } });
    expect(response.status).toBe(101);
    return new Client(response.webSocket!);
  };
  return { stub, enter };
}

const send = (client: Client, message: object) => client.ws.send(JSON.stringify(message));
const ids = { chris: 'chris-0001', will: 'will-00002', third: 'third-0003', fourth: 'fourth-004' };

/** Waits for a list of who is here that has the given ids in it, in order. */
async function hereWith(client: Client, wanted: string[], after = 0): Promise<Here & { k: number }> {
  for (let from = after; ; ) {
    const here = await client.next<Here>('here', from);
    if (JSON.stringify(here.players.map((p) => p.id)) === JSON.stringify(wanted)) return here;
    from = here.k + 1;
  }
}

describe('lobby', () => {
  it('takes names of 2 to 16 letters, digits and spaces', () => {
    expect(cleanName('  Will   Hsu ')).toBe('Will Hsu');
    expect(cleanName('Zuljin99')).toBe('Zuljin99');
    expect(cleanName('Thrall Doomhammer')).toBe(undefined);
    expect(cleanName('X')).toBe(undefined);
    expect(cleanName('<script>')).toBe(undefined);
    expect(cleanName('Ragnarós')).toBe('Ragnarós');
  });

  it('refuses a bad name or id, and is reached at /lobby/ws from the game pages only', async () => {
    const { stub } = lobby();
    const ws = { headers: { Upgrade: 'websocket' } };
    expect((await stub.fetch('https://relay.test/lobby/ws?name=X&id=chris-0001', ws)).status).toBe(400);
    expect((await stub.fetch('https://relay.test/lobby/ws?name=Chris&id=no', ws)).status).toBe(400);
    expect((await SELF.fetch('https://relay.test/lobby/ws?name=Chris&id=chris-0001', { headers: { Upgrade: 'websocket', Origin: 'https://evil.example' } })).status).toBe(403);
    const response = await SELF.fetch('https://relay.test/lobby/ws?name=Chris&id=route-0001', { headers: { Upgrade: 'websocket', Origin: 'https://makgora.clawdioslave.com' } });
    expect(response.status).toBe(101);
    const chris = new Client(response.webSocket!);
    await hereWith(chris, ['route-0001']);
    chris.ws.close(1000, 'bye');
  });

  it('tells everyone who is here as players come and go, and again on the beat', async () => {
    const { stub, enter } = lobby();
    const chris = await enter('Chris', ids.chris);
    expect((await chris.next<Here>('here')).players).toEqual([{ id: ids.chris, name: 'Chris', status: 'free' }]);
    const will = await enter('Will', ids.will);
    const both = await hereWith(chris, [ids.chris, ids.will]);
    expect(both.players[1]).toEqual({ id: ids.will, name: 'Will', status: 'free' });
    await hereWith(will, [ids.chris, ids.will]);

    // The same browser again takes its old place, not a second one.
    const seen = chris.got.length;
    const again = await enter('Will H', ids.will);
    const after = await hereWith(chris, [ids.chris, ids.will], seen);
    expect(after.players[1]!.name).toBe('Will H');
    expect(after.players).toHaveLength(2);

    // The beat: twenty seconds on, everyone is told again whether or not anything changed.
    const before = chris.got.length;
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await hereWith(chris, [ids.chris, ids.will], before);

    again.ws.close(1000, 'bye');
    await hereWith(chris, [ids.chris], before);
    chris.ws.close(1000, 'bye');
    will.ws.close(1000, 'bye');
  });

  it('makes a room when a challenge is accepted, the challenger hosting, and marks both busy', async () => {
    const { enter } = lobby();
    const chris = await enter('Chris', ids.chris);
    const will = await enter('Will', ids.will);
    const third = await enter('Thrall', ids.third);
    await hereWith(will, [ids.chris, ids.will, ids.third]);

    send(chris, { t: 'challenge', to: ids.will });
    const challenged = await will.next<{ from: { id: string; name: string }; ttl: number }>('challenged');
    expect(challenged.from).toEqual({ id: ids.chris, name: 'Chris' });
    expect(challenged.ttl).toBe(CHALLENGE_MS);
    expect((await chris.next<{ to: { name: string } }>('challenging')).to.name).toBe('Will');

    // Somebody else cannot cut in while Will is answering.
    send(third, { t: 'challenge', to: ids.will });
    expect((await third.next<{ message: string }>('error')).message).toMatch(/answering another challenge/);

    const seen = third.got.length;
    send(will, { t: 'accept', from: ids.chris });
    const host = await chris.next<Fight>('fight');
    const guest = await will.next<Fight>('fight');
    expect(host.role).toBe('host');
    expect(guest.role).toBe('guest');
    expect(host.code).toBe(guest.code);
    expect(isCode(host.code)).toBe(true);
    expect(host.with).toEqual({ id: ids.will, name: 'Will' });
    expect(guest.with).toEqual({ id: ids.chris, name: 'Chris' });

    const busy = await third.next<Here>('here', seen);
    expect(busy.players.map((p) => p.status)).toEqual(['busy', 'busy', 'free']);
    send(third, { t: 'challenge', to: ids.chris });
    expect((await third.next<{ message: string }>('error', seen)).message).toBe('Chris is in a match.');

    // The room is one the fight can use: the host's socket goes in.
    const room = await SELF.fetch(`https://relay.test/rooms/${host.code}/ws?role=host`, { headers: { Upgrade: 'websocket' } });
    expect(room.status).toBe(101);

    // Back from the fight, Chris's socket comes again and he is free.
    chris.ws.close(1000, 'fight');
    const back = await enter('Chris', ids.chris);
    const free = await hereWith(back, [ids.will, ids.third, ids.chris]);
    expect(free.players.map((p) => p.status)).toEqual(['busy', 'free', 'free']);
    // Coming back between fights of the same match, he says so and stays busy.
    const between = await enter('Chris', ids.chris, '&busy=1');
    const still = await hereWith(between, [ids.will, ids.third, ids.chris]);
    expect(still.players[2]!.status).toBe('busy');
    for (const c of [between, will, third]) c.ws.close(1000, 'bye');
  });

  it('tells the challenger of a decline, and the one challenged of a cancel', async () => {
    const { enter } = lobby();
    const chris = await enter('Chris', ids.chris);
    const will = await enter('Will', ids.will);
    await hereWith(chris, [ids.chris, ids.will]);

    send(chris, { t: 'challenge', to: ids.will });
    await will.next('challenged');
    send(will, { t: 'decline', from: ids.chris });
    expect(await chris.next('declined')).toMatchObject({ by: ids.will, reason: 'declined' });
    // Over: accepting it now finds nothing.
    send(will, { t: 'accept', from: ids.chris });
    expect((await will.next<{ message: string }>('error')).message).toBe('That challenge is over.');

    const seen = will.got.length;
    send(chris, { t: 'challenge', to: ids.will });
    await will.next('challenged', seen);
    send(chris, { t: 'cancel', to: ids.will });
    expect(await will.next('withdrawn', seen)).toMatchObject({ from: ids.chris, reason: 'cancelled' });

    // A challenger who leaves takes the challenge with them.
    const later = will.got.length;
    send(chris, { t: 'challenge', to: ids.will });
    await will.next('challenged', later);
    chris.ws.close(1000, 'bye');
    expect(await will.next('withdrawn', later)).toMatchObject({ from: ids.chris, reason: 'left' });
    expect(chris.kinds()).not.toContain('fight');
    will.ws.close(1000, 'bye');
  });

  it('lets a challenge lapse after thirty seconds unanswered', async () => {
    const { stub, enter } = lobby();
    const chris = await enter('Chris', ids.chris);
    const will = await enter('Will', ids.will);
    await hereWith(chris, [ids.chris, ids.will]);
    send(chris, { t: 'challenge', to: ids.will });
    await will.next('challenged');

    // The beat comes first, and the challenge outlasts it.
    const alarm = await runInDurableObject(stub, (_lobby: Lobby, state) => state.storage.getAlarm());
    expect(alarm).toBeLessThanOrEqual(Date.now() + BEAT_MS);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(chris.kinds()).not.toContain('declined');
    // Thirty seconds pass.
    await runInDurableObject(stub, async (_lobby: Lobby, state) => {
      const open = (await state.storage.get<{ at: number }[]>('challenges'))!;
      await state.storage.put('challenges', open.map((c) => ({ ...c, at: c.at - CHALLENGE_MS })));
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await chris.next('declined')).toMatchObject({ by: ids.will, reason: 'timeout' });
    expect(await will.next('withdrawn')).toMatchObject({ from: ids.chris, reason: 'timeout' });
    expect(await runInDurableObject(stub, (_lobby: Lobby, state) => state.storage.get('challenges'))).toEqual([]);
    chris.ws.close(1000, 'bye');
    will.ws.close(1000, 'bye');
  });

  it('pairs quick matches first come first served, the one who waited longer hosting', async () => {
    const { enter } = lobby();
    const chris = await enter('Chris', ids.chris);
    const will = await enter('Will', ids.will);
    const third = await enter('Thrall', ids.third);
    const fourth = await enter('Jaina', ids.fourth);
    await hereWith(fourth, [ids.chris, ids.will, ids.third, ids.fourth]);

    send(third, { t: 'quick' });
    await third.next('queued');
    // The next to ask, Chris, is paired with the one waiting, who hosts.
    send(chris, { t: 'quick' });
    const host = await third.next<Fight>('fight');
    const guest = await chris.next<Fight>('fight');
    expect(host).toMatchObject({ role: 'host', with: { id: ids.chris } });
    expect(guest).toMatchObject({ role: 'guest', code: host.code, with: { id: ids.third } });

    // The line is empty again: Jaina waits, and Will takes her up.
    send(fourth, { t: 'quick' });
    await fourth.next('queued');
    send(will, { t: 'quick' });
    expect(await fourth.next<Fight>('fight')).toMatchObject({ role: 'host', with: { id: ids.will, name: 'Will' } });
    expect(await will.next<Fight>('fight')).toMatchObject({ role: 'guest' });

    // Leaving the line: nobody is paired with someone who left it.
    const back = await enter('Chris', ids.chris);
    send(back, { t: 'quick' });
    await back.next('queued');
    send(back, { t: 'unquick' });
    await back.next('unqueued');
    const late = await enter('Rexxar', 'late-00005');
    send(late, { t: 'quick' });
    await late.next('queued');
    expect(back.kinds()).not.toContain('fight');
    for (const c of [back, late, will, third, fourth]) c.ws.close(1000, 'bye');
  });
});
