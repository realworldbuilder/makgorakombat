import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '../src/index';
import { channelName, MARK, madeAt, STALE_MS, sweepVoice } from '../src/voice';
import { Client } from './client';

/** Discord, as far as the relay asks it anything: every call it is sent, and channels and invites made up. */
function discord(fail?: 'invite') {
  const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  let channels = 0;
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== 'discord.com') throw new Error(`not Discord: ${url}`);
    const method = init?.method ?? 'GET';
    const path = url.pathname.replace('/api/v10', '');
    calls.push({ method, path, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bot test-token');
    if (method === 'POST' && path.endsWith('/channels')) return Response.json({ id: `20000000000000000${++channels}` });
    if (method === 'POST' && path.endsWith('/invites')) return fail === 'invite' ? new Response('Missing Permissions', { status: 403 }) : Response.json({ code: `inv${channels}` });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    return new Response('no such call', { status: 404 });
  });
  return { calls, spy };
}

afterEach(() => vi.restoreAllMocks());

async function room(): Promise<string> {
  const response = await SELF.fetch('https://relay.test/rooms', { method: 'POST' });
  return (await response.json<{ code: string }>()).code;
}

async function seat(code: string, role: 'host' | 'guest', id: string): Promise<Client> {
  const response = await SELF.fetch(`https://relay.test/rooms/${code}/ws?role=${role}&id=${id}`, { headers: { Upgrade: 'websocket' } });
  expect(response.status).toBe(101);
  return new Client(response.webSocket!);
}

const ask = (code: string, role: string, id?: string) => SELF.fetch(`https://relay.test/rooms/${code}/voice?role=${role}${id ? `&id=${id}` : ''}`, { method: 'POST' });

describe('voice', () => {
  it('says whether the relay has a bot to make channels with', async () => {
    expect(await (await SELF.fetch('https://relay.test/voice')).json()).toEqual({ on: true });
  });

  it('makes one channel for two on the first ask, hands both the same invite, and tells the other player', async () => {
    const { calls } = discord();
    const code = await room();
    const host = await seat(code, 'host', 'host-page-1');
    const guest = await seat(code, 'guest', 'guest-page-1');
    await host.next('peer');
    await guest.next('peer');

    const [first, second] = await Promise.all([ask(code, 'host', 'host-page-1'), ask(code, 'guest', 'guest-page-1')]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const { url } = await first.json<{ url: string }>();
    expect(url).toBe('https://discord.gg/inv1');
    expect(await second.json()).toEqual({ url });
    // Two asks at once: one channel, one invite.
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /guilds/1000000000000000001/channels', 'POST /channels/200000000000000001/invites']);
    expect(calls[0]!.body).toEqual({ name: `${MARK}Room ${code}`, type: 2, user_limit: 2 });
    expect(await guest.next('voice')).toMatchObject({ t: 'voice', url, by: 'host' });
    expect(await host.next('voice')).toMatchObject({ t: 'voice', url, by: 'guest' });
  });

  it('is only for the two players in the room', async () => {
    const { calls } = discord();
    const code = await room();
    await seat(code, 'host', 'host-page-2');
    expect((await ask(code, 'host', 'somebody-else')).status).toBe(403);
    expect((await ask(code, 'host')).status).toBe(403);
    expect((await ask(code, 'guest', 'host-page-2')).status).toBe(403);
    expect((await ask(code, 'watch', 'host-page-2')).status).toBe(400);
    expect((await ask('BCDFGH', 'host', 'host-page-2')).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it('lets the channel go when Discord will not invite to it, and the page hears so', async () => {
    const { calls } = discord('invite');
    const code = await room();
    await seat(code, 'host', 'host-page-3');
    const answer = await ask(code, 'host', 'host-page-3');
    expect(answer.status).toBe(502);
    expect(calls.map((c) => c.method)).toEqual(['POST', 'POST', 'DELETE']);
  });

  it('deletes the channel when the room closes', async () => {
    const { calls } = discord();
    const code = await room();
    const host = await seat(code, 'host', 'host-page-4');
    expect((await ask(code, 'host', 'host-page-4')).status).toBe(200);
    host.ws.close(1000, 'left');
    const stub = env.ROOMS.getByName(code);
    // Empty: the room's alarm is its ten minutes, and when it rings the room closes.
    await runInDurableObject(stub, async (_room: Room, state) => {
      for (let i = 0; i < 50 && state.getWebSockets('host').some((ws) => ws.readyState === WebSocket.OPEN); i++) await new Promise((r) => setTimeout(r, 20));
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/channels/200000000000000001' });
    expect(await runInDurableObject(stub, (_room: Room, state) => state.storage.get('voice'))).toBeUndefined();
  });

  it('names the channel for the two the lobby matched', () => {
    expect(channelName(['Chris', 'Will'], 'BCDFGH')).toBe(`${MARK}Chris vs Will`);
  });

  it('sweeps only its own voice channels older than the stale time', async () => {
    const at = (ms: number) => String((BigInt(ms - 1420070400000) << 22n) + 5n);
    const now = Date.UTC(2026, 9, 26);
    const old = at(now - STALE_MS - 1000);
    const young = at(now - 60_000);
    expect(madeAt(old)).toBe(now - STALE_MS - 1000);
    const deleted: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname.replace('/api/v10', '');
      if ((init?.method ?? 'GET') === 'DELETE') {
        deleted.push(path.split('/').at(-1)!);
        return new Response(null, { status: 204 });
      }
      return Response.json([
        { id: old, type: 2, name: `${MARK}Chris vs Will` },
        { id: young, type: 2, name: `${MARK}Room BCDFGH` },
        { id: at(now - STALE_MS * 2), type: 2, name: 'General' },
        { id: at(now - STALE_MS * 2), type: 0, name: `${MARK}text` },
      ]);
    });
    expect(await sweepVoice({ DISCORD_TOKEN: 't', DISCORD_GUILD: '1' }, now)).toBe(1);
    expect(deleted).toEqual([old]);
  });
});
