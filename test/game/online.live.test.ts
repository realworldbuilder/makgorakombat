import { createServer, connect as dial, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { newMatch, noInputs } from '../../src/engine/engine';
import { TICK_MS } from '../../src/engine/stage';
import { decode, encode, type Hello, meet, mismatch, type Message } from '../../src/game/net/handshake';
import { Lockstep, stateText } from '../../src/game/net/lockstep';
import { createRoom, Link, RELAY_URL } from '../../src/game/net/relay';
import { VERSION } from '../../src/game/net/version';
import { fakeTable, FULL_SET, MAGE, WARRIOR } from '../engine/fake';

/*
 * Online play against a deployed relay, from node: a room, a host and a guest, the handshake,
 * and twenty seconds of a fight in lockstep in real time. It needs the network, so it runs only
 * when asked: MAKGORA_LIVE=1 pnpm vitest run test/game/online.live.test.ts
 * (MAKGORA_RELAY=https://... for a relay other than the default; the pulled Wi-Fi needs one on
 * plain http, as `wrangler dev` in relay/ serves it).
 */

const live = process.env.MAKGORA_LIVE === '1';
const base = process.env.MAKGORA_RELAY ?? RELAY_URL;

const next = (link: Link, kind: Message['t']) =>
  new Promise<Message>((resolve) => {
    const off = link.listen((message) => {
      if (message.t !== kind) return;
      off();
      resolve(message);
    });
  });

/** The fight, both sides on the same tables and seed, stepping at 60 Hz as the page does; `meddle` is called every frame. */
async function fight(host: Link, guest: Link, hello: Hello, ticks: number, meddle?: (sides: { lockstep: Lockstep }[]) => void) {
  const sides = ([0, 1] as const).map((who) => ({
    match: newMatch(hello.tables, hello.seed, ['THRALL', 'NIGHT ELF']),
    lockstep: new Lockstep((who === 0 ? host : guest).channel(), who, { game: hello.game }),
    owed: 0,
    held: 0,
    states: [] as string[],
  }));
  const script = (who: 0 | 1, t: number) => {
    const out = noInputs();
    out.right = who === 0 ? t % 120 < 70 : false;
    out.left = who === 1 ? t % 100 < 50 : false;
    out.attack = t % 4 !== 0;
    out.abilities[t % 3] = t % 97 === who;
    return out;
  };
  const started = performance.now();
  await new Promise<void>((resolve, reject) => {
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      sides.forEach((side, who) => {
        side.owed += dt;
        let steps = 0;
        while (side.owed >= TICK_MS && steps < 4 && side.lockstep.next < ticks) {
          if (!side.lockstep.step(side.match, (t) => script(who as 0 | 1, t))) {
            side.owed = Math.min(side.owed, TICK_MS);
            side.held++;
            break;
          }
          side.owed -= TICK_MS;
          steps++;
          side.states.push(stateText(side.match));
        }
      });
      meddle?.(sides);
      if (sides.some((side) => side.lockstep.status().desync)) {
        clearInterval(timer);
        reject(new Error('desync'));
      } else if (sides.every((side) => side.lockstep.next >= ticks)) {
        clearInterval(timer);
        resolve();
      } else if (now - started > 90_000) {
        clearInterval(timer);
        reject(new Error(`stuck at ${sides.map((s) => s.lockstep.next).join(' / ')}`));
      }
    }, TICK_MS);
  });
  return sides;
}

/** The hello both tests fight on. */
const HELLO: Hello = {
  t: 'hello',
  version: VERSION,
  product: 'wow',
  seed: 4242,
  game: 1,
  stage: { kind: 'stage', slug: 'gurubashi' },
  fighters: [
    { key: 'legend:thrall:1', name: 'THRALL', title: 'WARCHIEF', raceId: 2, sex: 0, classId: 7, choices: [], gear: [], npc: 1 },
    { key: 'race:4:1:11', name: 'NIGHT ELF', title: 'DRUID', raceId: 4, sex: 1, classId: 11, choices: [], gear: [] },
  ],
  tables: [fakeTable(FULL_SET, 'oneHand', {}, WARRIOR), fakeTable(FULL_SET, 'twoHand', {}, MAGE)],
};

describe.skipIf(!live)('online, through the deployed relay', () => {
  it('meets, sends the hello, and keeps two matches in step for 1200 ticks', async () => {
    const code = await createRoom(base);
    const host = await Link.open(code, 'host', base);
    const hostSaw = next(host, 'peer');
    const guest = await Link.open(code, 'guest', base);
    await hostSaw;
    expect(host.peer).toBe(true);

    // Both say their version, as the panel does.
    const theirs = [next(host, 'meet'), next(guest, 'meet')];
    host.send(meet('wow'));
    guest.send(meet('wow_classic'));
    for (const m of await Promise.all(theirs)) expect(mismatch(m as { version: string })).toBeUndefined();

    // The hello, tables and all, through the relay in one message.
    const hello = HELLO;
    const got = next(guest, 'hello');
    host.send(hello);
    const received = (await got) as Hello;
    expect(received).toEqual(decode(encode(hello)));
    console.log(`hello: ${encode(hello).length} bytes`);

    const TICKS = 1200;
    const started = performance.now();
    const sides = await fight(host, guest, received, TICKS);
    const seconds = (performance.now() - started) / 1000;
    console.log(`${TICKS} ticks in ${seconds.toFixed(1)} s (${(TICKS / 60).toFixed(1)} s of fight); frames held waiting: host ${sides[0]!.held}, guest ${sides[1]!.held}; ping ${host.rtt?.toFixed(0)} ms`);
    expect(sides[0]!.states.length).toBe(TICKS);
    expect(sides[1]!.states).toEqual(sides[0]!.states);

    // The guest goes: the host hears of it.
    const gone = next(host, 'peer');
    guest.close();
    expect(await gone).toEqual({ t: 'peer', joined: false });
    host.close();
  }, 90_000);

  it('holds the fight through the guest\'s socket dropping for seconds, and goes on in step once it is back', async () => {
    const code = await createRoom(base);
    const host = await Link.open(code, 'host', base);
    const hostSaw = next(host, 'peer');
    const guest = await Link.open(code, 'guest', base);
    await hostSaw;
    const heard: string[] = [];
    host.onWire((wire) => heard.push(`host ${wire.away ? 'away' : 'here'}`));
    guest.onWire((wire) => heard.push(`guest ${wire.reconnecting ? 'reconnecting' : 'open'}`));
    let closes = 0;
    host.onClose(() => closes++);
    guest.onClose(() => closes++);

    // The socket drops at tick 300 and the network stays gone for six seconds: every try at the room fails meanwhile.
    const Real = globalThis.WebSocket;
    class Refused extends EventTarget {
      readyState = 3;
      binaryType = 'arraybuffer';
      constructor() {
        super();
        setTimeout(() => {
          this.dispatchEvent(new Event('error'));
          this.dispatchEvent(new Event('close'));
        }, 20);
      }
      close() {}
    }
    const TICKS = 1500;
    let cutAt: number | undefined;
    let backAt: number | undefined;
    const started = performance.now();
    const sides = await fight(host, guest, HELLO, TICKS, (s) => {
      if (cutAt === undefined && s[1]!.lockstep.next >= 300) {
        cutAt = performance.now();
        (globalThis as { WebSocket: unknown }).WebSocket = Refused;
        (guest as unknown as { ws: WebSocket }).ws.close(4000, 'cut');
      } else if (cutAt !== undefined && backAt === undefined && performance.now() - cutAt >= 6000) {
        backAt = performance.now();
        globalThis.WebSocket = Real;
      }
    });
    const seconds = (performance.now() - started) / 1000;
    console.log(`${TICKS} ticks in ${seconds.toFixed(1)} s with a 6 s cut; held: host ${sides[0]!.held}, guest ${sides[1]!.held}; heard: ${heard.join(', ')}`);
    expect(sides[0]!.states.length).toBe(TICKS);
    expect(sides[1]!.states).toEqual(sides[0]!.states);
    expect(heard).toContain('host away');
    expect(heard).toContain('guest reconnecting');
    expect(heard.at(-1)).toMatch(/here|open/);
    expect(host.wire()).toEqual({ away: false, reconnecting: false, until: undefined });
    expect(guest.wire()).toEqual({ away: false, reconnecting: false, until: undefined });
    expect(closes).toBe(0);
    // It took the cut and the next try to come back, not the whole of the room's patience.
    expect(seconds).toBeGreaterThan(TICKS / 60 + 5);
    expect(seconds).toBeLessThan(TICKS / 60 + 12);
    guest.close();
    host.close();
  }, 120_000);

  // A pulled Wi-Fi: no close reaches either end, the old socket just goes silent. A proxy in front of the guest black-holes it.
  it.skipIf(!base.startsWith('http://'))('rides out the guest\'s Wi-Fi going for ten seconds with no close on either end', async () => {
    const target = new URL(base);
    let dark = false;
    const pairs: { a: Socket; b: Socket; dead: boolean }[] = [];
    const proxy = createServer((a) => {
      if (dark) return a.destroy();
      const b = dial(Number(target.port), target.hostname);
      const pair = { a, b, dead: false };
      pairs.push(pair);
      a.on('data', (d) => pair.dead || b.write(d));
      b.on('data', (d) => pair.dead || a.write(d));
      a.on('error', () => b.destroy());
      b.on('error', () => a.destroy());
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const through = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;

    const code = await createRoom(base);
    const host = await Link.open(code, 'host', base);
    const hostSaw = next(host, 'peer');
    const guest = await Link.open(code, 'guest', through);
    await hostSaw;
    const heard: string[] = [];
    host.onWire((wire) => heard.push(`host ${wire.away ? 'away' : 'here'}`));
    guest.onWire((wire) => heard.push(`guest ${wire.reconnecting ? 'reconnecting' : 'open'}`));
    let closes = 0;
    host.onClose(() => closes++);
    guest.onClose(() => closes++);

    const TICKS = 1500;
    let cutAt: number | undefined;
    let lightAt: number | undefined;
    const started = performance.now();
    const sides = await fight(host, guest, HELLO, TICKS, (s) => {
      if (cutAt === undefined && s[1]!.lockstep.next >= 300) {
        cutAt = performance.now();
        dark = true;
        for (const pair of pairs) pair.dead = true;
      } else if (cutAt !== undefined && lightAt === undefined && performance.now() - cutAt >= 10_000) {
        lightAt = performance.now();
        dark = false;
      }
    });
    const seconds = (performance.now() - started) / 1000;
    console.log(`${TICKS} ticks in ${seconds.toFixed(1)} s with the Wi-Fi gone 10 s; held: host ${sides[0]!.held}, guest ${sides[1]!.held}; heard: ${heard.join(', ')}`);
    expect(sides[0]!.states.length).toBe(TICKS);
    expect(sides[1]!.states).toEqual(sides[0]!.states);
    expect(heard).toContain('host away');
    expect(heard).toContain('guest reconnecting');
    expect(host.wire()).toEqual({ away: false, reconnecting: false, until: undefined });
    expect(guest.wire()).toEqual({ away: false, reconnecting: false, until: undefined });
    expect(closes).toBe(0);
    guest.close();
    host.close();
    for (const pair of pairs) {
      pair.a.destroy();
      pair.b.destroy();
    }
    proxy.close();
  }, 120_000);
});
