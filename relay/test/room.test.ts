import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ALPHABET, isCode } from '../src/code';
import { allowedOrigin, HELD_MAX, RECONNECT_MS, type Room } from '../src/index';
import { Client } from './client';

async function makeRoom(origin?: string): Promise<{ code: string; response: Response }> {
  const response = await SELF.fetch('https://relay.test/rooms', { method: 'POST', headers: origin ? { Origin: origin } : {} });
  const body = response.ok ? await response.clone().json<{ code: string }>() : { code: '' };
  return { code: body.code, response };
}

function join(code: string, role: string, id?: string): Promise<Response> {
  return SELF.fetch(`https://relay.test/rooms/${code}/ws?role=${role}${id ? `&id=${id}` : ''}`, { headers: { Upgrade: 'websocket' } });
}

async function connect(code: string, role: string, id?: string): Promise<Client> {
  const response = await join(code, role, id);
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

  it('keeps a dropped player\'s seat: the other hears they are away, then back, and they get what was sent meanwhile', async () => {
    const { code } = await makeRoom();
    const host = await connect(code, 'host', 'h1');
    const guest = await connect(code, 'guest', 'g1');
    await host.until(1);
    await guest.until(1);
    // A drop, not a goodbye: any close but 1000 or 1001.
    guest.ws.close(4000, 'wifi');
    await host.until(2);
    expect(host.json(1)).toEqual({ t: 'peer', joined: true, away: true });
    host.ws.send(JSON.stringify({ t: 'rematch', game: 2, seed: 9 }));
    host.ws.send(new Uint8Array([1, 2, 3]));
    host.ws.send(new Uint8Array([4, 5, 6]));
    // Nobody else may take the seat meanwhile, with another id or none.
    expect((await join(code, 'guest', 'someone')).status).toBe(409);
    expect((await join(code, 'guest')).status).toBe(409);
    const back = await connect(code, 'guest', 'g1');
    await back.until(4);
    await host.until(3);
    expect(host.json(2)).toEqual({ t: 'peer', joined: true, back: true });
    expect(back.json(0)).toEqual({ t: 'peer', joined: true, back: true });
    expect(back.got[1]).toBe('{"t":"rematch","game":2,"seed":9}');
    expect(new Uint8Array(back.got[2] as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(new Uint8Array(back.got[3] as ArrayBuffer)).toEqual(new Uint8Array([4, 5, 6]));
    // And the wire runs both ways again.
    back.ws.send('{"t":"back"}');
    await host.until(4);
    expect(host.got[3]).toBe('{"t":"back"}');
  });

  it('gives a kept seat up after RECONNECT_MS: the other hears the player left, and the seat is free', async () => {
    const { code } = await makeRoom();
    const stub = env.ROOMS.getByName(code);
    const host = await connect(code, 'host', 'h1');
    const guest = await connect(code, 'guest', 'g1');
    await host.until(1);
    const dropped = Date.now();
    guest.ws.close(4000, 'wifi');
    await host.until(2);
    const alarm = await runInDurableObject(stub, (_room: Room, state) => state.storage.getAlarm());
    expect(alarm).toBeGreaterThanOrEqual(dropped + RECONNECT_MS - 1000);
    expect(alarm).toBeLessThanOrEqual(Date.now() + RECONNECT_MS);
    // Not yet: an early alarm keeps the seat.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(host.got.length).toBe(2);
    expect((await join(code, 'guest', 'other')).status).toBe(409);
    // The window runs out.
    await runInDurableObject(stub, async (room: Room, state) => {
      const away = { guest: { id: 'g1', until: Date.now() - 1 } };
      await state.storage.put('away', away);
      (room as unknown as { away: unknown }).away = away;
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await host.until(3);
    expect(host.json(2)).toEqual({ t: 'peer', joined: false });
    const next = await connect(code, 'guest', 'someone-else');
    await next.until(1);
    expect(next.json(0)).toEqual({ t: 'peer', joined: true });
    // The host is still in, so the room has no alarm.
    expect(await runInDurableObject(stub, (_room: Room, state) => state.storage.getAlarm())).toBeNull();
  });

  it('holds at most HELD_MAX messages for an away player, giving up the oldest frames before any text', async () => {
    const { code } = await makeRoom();
    const host = await connect(code, 'host', 'h1');
    const guest = await connect(code, 'guest', 'g1');
    await host.until(1);
    guest.ws.close(4000, 'wifi');
    await host.until(2);
    host.ws.send('{"t":"stage","n":1}');
    const sent = HELD_MAX + 100;
    for (let k = 0; k < sent; k++) host.ws.send(new Uint8Array([k & 0xff, k >> 8]));
    // Every frame in the room before the guest comes back (a ping would not do: the runtime answers it ahead of the queue).
    const stub = env.ROOMS.getByName(code);
    const heldNow = () => runInDurableObject(stub, (room: Room) => (room as unknown as { held: { guest: unknown[] } }).held.guest);
    let last: unknown;
    for (let k = 0; k < 80; k++) {
      const held = await heldNow();
      const tail = held.at(-1);
      if (held.length === HELD_MAX && tail instanceof ArrayBuffer && new Uint8Array(tail)[0] === ((sent - 1) & 0xff)) break;
      last = held.length;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(last).not.toBeGreaterThan(HELD_MAX);
    const back = await connect(code, 'guest', 'g1');
    await back.until(1 + HELD_MAX);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(back.got.length).toBe(1 + HELD_MAX);
    expect(back.got[1]).toBe('{"t":"stage","n":1}');
    const frames = back.got.slice(2).map((m) => {
      const b = new Uint8Array(m as ArrayBuffer);
      return b[0]! | (b[1]! << 8);
    });
    // The last HELD_MAX - 1 frames, in the order sent.
    expect(frames[0]).toBe(sent - (HELD_MAX - 1));
    expect(frames.at(-1)).toBe(sent - 1);
    expect(frames.every((n, k) => k === 0 || n === frames[k - 1]! + 1)).toBe(true);
  });

  it('lets a page whose old socket still looks open take its own seat over', async () => {
    const { code } = await makeRoom();
    const host = await connect(code, 'host', 'h1');
    const guest = await connect(code, 'guest', 'g1');
    await host.until(1);
    await guest.until(1);
    expect((await join(code, 'guest', 'g2')).status).toBe(409);
    const again = await connect(code, 'guest', 'g1');
    await again.until(1);
    expect(again.json(0)).toEqual({ t: 'peer', joined: true, back: true });
    host.ws.send('{"t":"hello"}');
    await again.until(2);
    expect(again.got[1]).toBe('{"t":"hello"}');
    // The old socket is shut, and its close is not news to the host.
    for (let k = 0; k < 40 && !guest.closed; k++) await new Promise((resolve) => setTimeout(resolve, 25));
    expect(guest.closed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(host.kinds(2)).toEqual([]);
  });

  it('tells a returning player the other left on purpose while they were away', async () => {
    const { code } = await makeRoom();
    const host = await connect(code, 'host', 'h1');
    const guest = await connect(code, 'guest', 'g1');
    await guest.until(1);
    host.ws.close(4000, 'wifi');
    await guest.until(2);
    guest.ws.close(1000, 'left');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const back = await connect(code, 'host', 'h1');
    await back.until(1);
    expect(back.json(0)).toEqual({ t: 'peer', joined: false });
  });

  it('lets a page without an id go at once, as before seats were kept', async () => {
    const { code } = await makeRoom();
    const host = await connect(code, 'host');
    const guest = await connect(code, 'guest');
    await host.until(1);
    guest.ws.close(4000, 'wifi');
    await host.until(2);
    expect(host.json(1)).toEqual({ t: 'peer', joined: false });
    expect((await join(code, 'guest')).status).toBe(101);
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
