import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ALPHABET, allowedOrigin, isCode, type Room } from '../src/index';
import { Client } from './client';

async function makeRoom(origin?: string): Promise<{ code: string; response: Response }> {
  const response = await SELF.fetch('https://relay.test/rooms', { method: 'POST', headers: origin ? { Origin: origin } : {} });
  const body = response.ok ? await response.clone().json<{ code: string }>() : { code: '' };
  return { code: body.code, response };
}

function join(code: string, role: string): Promise<Response> {
  return SELF.fetch(`https://relay.test/rooms/${code}/ws?role=${role}`, { headers: { Upgrade: 'websocket' } });
}

async function connect(code: string, role: string): Promise<Client> {
  const response = await join(code, role);
  expect(response.status).toBe(101);
  return new Client(response.webSocket!);
}

describe('relay', () => {
  it('makes a room under six unambiguous consonants', async () => {
    const { code, response } = await makeRoom();
    expect(response.status).toBe(200);
    expect(isCode(code)).toBe(true);
    expect([...code].every((c) => ALPHABET.includes(c))).toBe(true);
    expect(code).not.toMatch(/[AEIOUYL0-9]/);
  });

  it('tells each side when the other joins, and passes text and bytes through unchanged', async () => {
    const { code } = await makeRoom();
    const host = await connect(code, 'host');
    const guest = await connect(code, 'guest');
    await host.until(1);
    await guest.until(1);
    expect(host.json(0)).toEqual({ t: 'peer', joined: true });
    expect(guest.json(0)).toEqual({ t: 'peer', joined: true });

    host.ws.send(JSON.stringify({ t: 'hello', seed: 7 }));
    const frame = new Uint8Array([1, 0, 0, 0, 5, 3, 0b1010101]);
    guest.ws.send(frame);
    await guest.until(2);
    await host.until(2);
    expect(guest.got[1]).toBe('{"t":"hello","seed":7}');
    expect(new Uint8Array(host.got[1] as ArrayBuffer)).toEqual(frame);
    // Nothing comes back to the sender.
    expect(host.got.length).toBe(2);
    expect(guest.got.length).toBe(2);
  });

  it('keeps one host and one guest', async () => {
    const { code } = await makeRoom();
    await connect(code, 'host');
    expect((await join(code, 'host')).status).toBe(409);
    await connect(code, 'guest');
    expect((await join(code, 'guest')).status).toBe(409);
    expect((await join(code, 'referee')).status).toBe(400);
  });

  it('refuses a code nobody made', async () => {
    expect((await join('BCDFGH', 'host')).status).toBe(404);
    expect((await join('HELLO1', 'host')).status).toBe(404);
  });

  it('tells the one left behind that the other went', async () => {
    const { code } = await makeRoom();
    const host = await connect(code, 'host');
    const guest = await connect(code, 'guest');
    await host.until(1);
    guest.ws.close(1000, 'bye');
    await host.until(2);
    expect(host.json(1)).toEqual({ t: 'peer', joined: false });
    // The guest's place is free again.
    const back = await connect(code, 'guest');
    await back.until(1);
    expect(back.json(0)).toEqual({ t: 'peer', joined: true });
  });

  it('answers ping itself', async () => {
    const { code } = await makeRoom();
    const host = await connect(code, 'host');
    host.ws.send('ping');
    await host.until(1);
    expect(host.got[0]).toBe('pong');
  });

  it('forgets a room nobody has been in for ten minutes, but not one in use', async () => {
    const { code } = await makeRoom();
    const stub = env.ROOMS.getByName(code);
    const alarm = await runInDurableObject(stub, (_room: Room, state) => state.storage.getAlarm());
    expect(alarm).toBeGreaterThan(Date.now() + 9 * 60 * 1000);
    // Somebody comes in: no alarm while they are there.
    const host = await connect(code, 'host');
    expect(await runInDurableObject(stub, (_room: Room, state) => state.storage.getAlarm())).toBeNull();
    host.ws.close(1000, 'bye');
    // Gone again: the ten minutes start over, and when they run out the code is free.
    let rearmed: number | null = null;
    for (let k = 0; k < 40 && rearmed === null; k++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      rearmed = await runInDurableObject(stub, (_room: Room, state) => state.storage.getAlarm());
    }
    expect(rearmed).not.toBeNull();
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await join(code, 'host')).status).toBe(404);
  });

  it('lets the game pages in and keeps other sites out', async () => {
    expect(allowedOrigin('https://realworldbuilder.github.io')).toBe(true);
    expect(allowedOrigin('https://makgora.clawdioslave.com')).toBe(true);
    expect(allowedOrigin('http://localhost:5183')).toBe(true);
    expect(allowedOrigin('http://localhost')).toBe(true);
    expect(allowedOrigin('https://evil.example')).toBe(false);
    expect(allowedOrigin('http://localhost.evil.example')).toBe(false);
    const { response } = await makeRoom('http://localhost:5183');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5183');
    expect((await makeRoom('https://evil.example')).response.status).toBe(403);
    const preflight = await SELF.fetch('https://relay.test/rooms', { method: 'OPTIONS', headers: { Origin: 'https://realworldbuilder.github.io' } });
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});
