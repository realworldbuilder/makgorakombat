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
 * (MAKGORA_RELAY=https://... for a relay other than the default).
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
    const hello: Hello = {
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
    const got = next(guest, 'hello');
    host.send(hello);
    const received = (await got) as Hello;
    expect(received).toEqual(decode(encode(hello)));
    console.log(`hello: ${encode(hello).length} bytes`);

    // The fight, both sides on the same tables and seed, stepping at 60 Hz as the page does.
    const sides = ([0, 1] as const).map((who) => ({
      match: newMatch(received.tables, received.seed, ['THRALL', 'NIGHT ELF']),
      lockstep: new Lockstep((who === 0 ? host : guest).channel(), who, { game: 1 }),
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
    const TICKS = 1200;
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
          while (side.owed >= TICK_MS && steps < 4 && side.lockstep.next < TICKS) {
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
        if (sides.some((side) => side.lockstep.status().desync)) {
          clearInterval(timer);
          reject(new Error('desync'));
        } else if (sides.every((side) => side.lockstep.next >= TICKS)) {
          clearInterval(timer);
          resolve();
        } else if (now - started > 60_000) {
          clearInterval(timer);
          reject(new Error(`stuck at ${sides.map((s) => s.lockstep.next).join(' / ')}`));
        }
      }, TICK_MS);
    });
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
});
