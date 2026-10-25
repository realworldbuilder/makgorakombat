import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ALPHABET, isCode } from '../src/code';
import { allowedOrigin, type Room, WATCH_CAP } from '../src/index';
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

/** A frame as the game lays one out (src/game/net/lockstep.ts encodeFrame): game, ack, first tick, inputs, no hash. */
function frameOf(game: number, first: number, inputs: number[], ack = -1): Uint8Array {
  const bytes = new Uint8Array(12 + inputs.length);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x4b;
  bytes[1] = game;
  view.setInt32(2, ack);
  view.setUint32(6, first);
  bytes[10] = inputs.length;
  bytes.set(inputs, 11);
  return bytes;
}

/** A frame as a watcher has it: the seat's byte, then the frame. */
function seen(message: string | ArrayBuffer | undefined): { seat: number; first: number; inputs: number[]; game: number } {
  const bytes = new Uint8Array(message as ArrayBuffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return { seat: bytes[0]!, game: bytes[2]!, first: view.getUint32(7), inputs: Array.from(bytes.subarray(12, 12 + bytes[11]!)) };
}

const bytesIn = (client: Client) => client.got.filter((m) => typeof m !== 'string').map(seen);

describe('watching', () => {
  it('sends a watcher who comes late the hello and the game so far, then both players\' frames as they come, tagged by seat', async () => {
    const { code } = await makeRoom();
    const host = await connect(code, 'host');
    const guest = await connect(code, 'guest');
    await host.until(1);
    await guest.until(1);
    const hello = JSON.stringify({ t: 'hello', version: 'dev', seed: 7, game: 1 });
    host.ws.send(JSON.stringify({ t: 'roster', tile: 'race:2' }));
    host.ws.send(hello);
    // The frames start after the input delay; each sends again what the other has not acknowledged.
    host.ws.send(frameOf(1, 4, [1, 2, 3]));
    // The guest starts on the hello, as the game does.
    await guest.until(4);
    guest.ws.send(frameOf(1, 4, [8]));
    host.ws.send(frameOf(1, 4, [1, 2, 3, 4], 4));
    guest.ws.send(frameOf(1, 5, [9, 10], 6));
    // A straggler from another game is no part of this one.
    guest.ws.send(frameOf(0, 50, [77]));
    await guest.until(5);
    await host.until(4);

    const watcher = await connect(code, 'watch');
    await watcher.until(4);
    expect(watcher.json(0)).toEqual({ t: 'seats', host: true, guest: true });
    // The hello as the host sent it, and nothing of the roster.
    expect(watcher.got[1]).toBe(hello);
    expect(bytesIn(watcher)).toEqual([
      { seat: 0, game: 1, first: 4, inputs: [1, 2, 3, 4] },
      { seat: 1, game: 1, first: 4, inputs: [8, 9, 10] },
    ]);

    // From now on each frame as it comes, the seat in front and the frame as it was.
    const live = frameOf(1, 8, [5, 6], 6);
    host.ws.send(live);
    guest.ws.send(frameOf(1, 7, [11], 8));
    await watcher.until(6);
    expect(new Uint8Array(watcher.got[4] as ArrayBuffer)).toEqual(new Uint8Array([0, ...live]));
    expect(seen(watcher.got[5])).toEqual({ seat: 1, game: 1, first: 7, inputs: [11] });
    // The players are sent each other's frames unchanged, and nothing of the watcher.
    expect(new Uint8Array(guest.got[guest.got.length - 1] as ArrayBuffer)).toEqual(live);
    expect(host.kinds()).toEqual(['peer']);

    // The rematch goes to the watcher, and one who comes after it has the hello, the rematch and that game alone.
    const rematch = JSON.stringify({ t: 'rematch', game: 2, seed: 99 });
    host.ws.send(rematch);
    host.ws.send(frameOf(1, 10, [7]));
    host.ws.send(frameOf(2, 4, [20, 21]));
    await watcher.until(9);
    expect(watcher.got[6]).toBe(rematch);
    const after = await connect(code, 'watch');
    await after.until(4);
    expect(after.got.slice(1, 3)).toEqual([hello, rematch]);
    expect(bytesIn(after)).toEqual([{ seat: 0, game: 2, first: 4, inputs: [20, 21] }]);

    // Back to the roster: nothing to replay until the next hello.
    guest.ws.send(JSON.stringify({ t: 'back' }));
    await watcher.until(10);
    expect(watcher.json(9)).toEqual({ t: 'back' });
    const between = await connect(code, 'watch');
    await between.until(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(between.got.length).toBe(1);
  });

  it('drops whatever a watcher sends', async () => {
    const { code } = await makeRoom();
    const host = await connect(code, 'host');
    const guest = await connect(code, 'guest');
    await host.until(1);
    await guest.until(1);
    const watcher = await connect(code, 'watch');
    await watcher.until(1);
    watcher.ws.send(JSON.stringify({ t: 'hello', seed: 1, game: 1 }));
    watcher.ws.send(JSON.stringify({ t: 'back' }));
    watcher.ws.send(frameOf(1, 4, [1, 2, 3]));
    // The host speaks after: by the time its words are through, the watcher's would have been too.
    host.ws.send(JSON.stringify({ t: 'stage', stage: { kind: 'none' } }));
    await guest.until(2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(guest.kinds()).toEqual(['peer', 'stage']);
    expect(host.kinds()).toEqual(['peer']);
    // Nor did it make a game for the next watcher to be shown.
    const next = await connect(code, 'watch');
    await next.until(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(next.got.length).toBe(1);
  });

  it('tells watchers who comes and goes, and the players nothing of the watchers', async () => {
    const { code } = await makeRoom();
    const watcher = await connect(code, 'watch');
    await watcher.until(1);
    expect(watcher.json(0)).toEqual({ t: 'seats', host: false, guest: false });
    const host = await connect(code, 'host');
    await watcher.until(2);
    expect(watcher.json(1)).toEqual({ t: 'seats', host: true, guest: false });
    const guest = await connect(code, 'guest');
    await watcher.until(3);
    expect(watcher.json(2)).toEqual({ t: 'seats', host: true, guest: true });
    guest.ws.close(1000, 'bye');
    await watcher.until(4);
    expect(watcher.json(3)).toEqual({ t: 'seats', host: true, guest: false });
    // A watcher is no player: the guest's place is free, and the host was told only of the guest.
    await host.until(2);
    expect(host.kinds()).toEqual(['peer', 'peer']);
    watcher.ws.close(1000, 'bye');
    const back = await connect(code, 'guest');
    await back.until(1);
    expect(back.json(0)).toEqual({ t: 'peer', joined: true });
  });

  it(`takes ${WATCH_CAP} watchers and no more`, async () => {
    const { code } = await makeRoom();
    const watchers: Client[] = [];
    for (let k = 0; k < WATCH_CAP; k++) watchers.push(await connect(code, 'watch'));
    const refused = await join(code, 'watch');
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain('watching');
    // One goes, and there is room for one more.
    watchers[0]!.ws.close(1000, 'bye');
    let again: Response | undefined;
    for (let k = 0; k < 40 && again?.status !== 101; k++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      again = await join(code, 'watch');
    }
    expect(again?.status).toBe(101);
    // The players' seats are untouched by any of it.
    await connect(code, 'host');
    await connect(code, 'guest');
  });

  it('refuses to watch a room nobody made', async () => {
    expect((await join('BCDFGH', 'watch')).status).toBe(404);
  });
});
