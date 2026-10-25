import { describe, expect, it } from 'vitest';
import { type Match, newMatch, noInputs } from '../../src/engine/engine';
import { TICK_MS } from '../../src/engine/stage';
import { decode, encode, type Hello, type Message } from '../../src/game/net/handshake';
import { Lockstep, stateText } from '../../src/game/net/lockstep';
import type { LobbyFight } from '../../src/game/net/lobby';
import { Link, RELAY_URL } from '../../src/game/net/relay';
import { VERSION } from '../../src/game/net/version';
import { Spectator, Watching } from '../../src/game/net/watch';
import { fakeTable, FULL_SET, MAGE, WARRIOR } from '../engine/fake';

/*
 * Watching a fight through a running relay, from node, in real time: two players matched by the
 * lobby, a third page that finds their fight in the lobby's list, a watcher from the start and
 * one who comes in halfway, and a rematch. Each watcher's match is held against the players'
 * after every frame it played. It needs a relay, so it runs only when asked:
 * MAKGORA_LIVE=1 MAKGORA_RELAY=http://localhost:8791 pnpm vitest run test/game/watch.live.test.ts
 */

const live = process.env.MAKGORA_LIVE === '1';
const base = process.env.MAKGORA_RELAY ?? RELAY_URL;

/** A socket into the lobby under a name, answering what it says in order. */
async function lobbySocket(name: string, id: string) {
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/lobby/ws?name=${name}&id=${id}`);
  const got: { t: string; [key: string]: unknown }[] = [];
  ws.addEventListener('message', (event) => {
    if (typeof event.data === 'string' && event.data !== 'pong') got.push(JSON.parse(event.data) as { t: string });
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const next = async <T,>(t: string, test: (m: T) => boolean = () => true): Promise<T> => {
    for (let k = 0; k < 200; k++) {
      const found = got.find((m) => m.t === t && test(m as T));
      if (found) return found as T;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`${name} waited for ${t}`);
  };
  return { ws, next, send: (message: object) => ws.send(JSON.stringify(message)) };
}

const next = (link: Link, kind: Message['t']) =>
  new Promise<Message>((resolve) => {
    const off = link.listen((message) => {
      if (message.t !== kind) return;
      off();
      resolve(message);
    });
  });

describe.skipIf(!live)('watching, through a running relay', () => {
  it('lists the lobby\'s fight, and two watchers see the players\' match tick for tick, through a rematch', async () => {
    const run = Math.random().toString(36).slice(2, 8);
    const ids = { chris: `chris-${run}`, will: `will-${run}`, third: `third-${run}` };
    const chris = await lobbySocket('Chris', ids.chris);
    const will = await lobbySocket('Will', ids.will);
    const third = await lobbySocket('Thrall', ids.third);
    chris.send({ t: 'challenge', to: ids.will });
    await will.next('challenged');
    will.send({ t: 'accept', from: ids.chris });
    const { code } = await chris.next<{ code: string }>('fight');
    const host = await Link.open(code, 'host', base);
    const guest = await Link.open(code, 'guest', base);
    chris.ws.close();
    will.ws.close();
    // The third page finds the fight in the lobby's list, under both names.
    const here = await third.next<{ fights: LobbyFight[] }>('here', (m) => m.fights?.some((f) => f.code === code));
    const listed = here.fights.find((f) => f.code === code)!;
    expect(listed.names).toEqual(['Chris', 'Will']);
    third.ws.close();

    const hello: Hello = {
      t: 'hello',
      version: VERSION,
      product: 'wow',
      rules: 'warcraft',
      seed: 777,
      game: 1,
      stage: { kind: 'none' },
      fighters: [
        { key: 'race:2:0:1', name: 'GARROSH', title: 'WARRIOR', raceId: 2, sex: 0, classId: 1, choices: [], gear: [] },
        { key: 'race:1:1:8', name: 'JAINA', title: 'MAGE', raceId: 1, sex: 1, classId: 8, choices: [], gear: [] },
      ],
      tables: [fakeTable(FULL_SET, 'oneHand', {}, WARRIOR), fakeTable(FULL_SET, 'twoHand', {}, MAGE)],
    };
    const first = new Spectator();
    const watchers = [{ spectator: first, socket: new Watching(listed.code, first, base), owed: 0, seen: new Map<string, string>() }];
    // The watcher from the start is in before the hello.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const got = next(guest, 'hello');
    host.send(hello);
    const sent = decode(encode(hello)) as Hello;
    await got;

    const script = (who: 0 | 1, t: number, game: number) => {
      const out = noInputs();
      out.right = who === 0 ? (t + game * 13) % 120 < 70 : false;
      out.left = who === 1 ? t % 100 < 50 : false;
      out.attack = t % 4 !== 0;
      out.jump = (t + who) % 89 === 0;
      out.abilities[t % 3] = t % 97 === who;
      return out;
    };
    type Side = { match: Match; lockstep: Lockstep; owed: number; states: Map<string, string> };
    const side = (who: 0 | 1, game: number, seed: number): Side => ({
      match: newMatch(sent.tables, seed, ['GARROSH', 'JAINA'], 'warcraft'),
      lockstep: new Lockstep((who === 0 ? host : guest).channel(), who, { game }),
      owed: 0,
      states: new Map(),
    });
    /** Plays `ticks` of game `game` in real time with both players and every watcher; a second watcher comes in at `join`. */
    const game = async (number: number, seed: number, ticks: number, join?: number): Promise<Side[]> => {
      const sides = [side(0, number, seed), side(1, number, seed)];
      const started = performance.now();
      await new Promise<void>((resolve, reject) => {
        let last = performance.now();
        const timer = setInterval(() => {
          const now = performance.now();
          const dt = now - last;
          last = now;
          sides.forEach((s, who) => {
            s.owed += dt;
            let steps = 0;
            while (s.owed >= TICK_MS && steps < 4 && s.lockstep.next < ticks) {
              if (!s.lockstep.step(s.match, (t) => script(who as 0 | 1, t, number))) {
                s.owed = Math.min(s.owed, TICK_MS);
                break;
              }
              s.owed -= TICK_MS;
              steps++;
              s.states.set(`${number}:${s.lockstep.next - 1}`, stateText(s.match));
            }
          });
          if (join !== undefined && watchers.length === 1 && sides[0]!.lockstep.next >= join) {
            const late = new Spectator();
            watchers.push({ spectator: late, socket: new Watching(listed.code, late, base), owed: 0, seen: new Map() });
          }
          for (const w of watchers) {
            w.owed += dt;
            const due = Math.min(Math.floor(w.owed / TICK_MS), ticks - w.spectator.next);
            const ran = w.spectator.play(due);
            w.owed = ran < due ? Math.min(w.owed, TICK_MS) : w.owed - due * TICK_MS;
            if (ran > 0 && w.spectator.game === number) w.seen.set(`${number}:${w.spectator.next - 1}`, stateText(w.spectator.match!));
          }
          const done = sides.every((s) => s.lockstep.next >= ticks) && watchers.every((w) => w.spectator.game === number && w.spectator.next >= ticks);
          if (watchers.some((w) => w.spectator.status() === 'desync') || sides.some((s) => s.lockstep.status().desync)) {
            clearInterval(timer);
            reject(new Error('desync'));
          } else if (done && (join === undefined || watchers.length === 2)) {
            clearInterval(timer);
            resolve();
          } else if (now - started > 90_000) {
            clearInterval(timer);
            reject(new Error(`stuck: players ${sides.map((s) => s.lockstep.next).join(' / ')}, watchers ${watchers.map((w) => `${w.spectator.game}:${w.spectator.next}:${w.spectator.status()}`).join(' / ')}`));
          }
        }, TICK_MS);
      });
      console.log(`game ${number}: ${ticks} ticks in ${((performance.now() - started) / 1000).toFixed(1)} s; watchers saw ${watchers.map((w) => w.seen.size).join(' and ')} frames`);
      for (const s of sides) s.lockstep.dispose();
      return sides;
    };

    const one = await game(1, sent.seed, 1800, 900);
    expect([...one[1]!.states.values()]).toEqual([...one[0]!.states.values()]);
    for (const w of watchers) {
      expect(w.seen.has('1:1799')).toBe(true);
      for (const [t, text] of w.seen) expect(text, t).toBe(one[0]!.states.get(t));
    }

    // The host calls the rematch; the watchers start over on its seed.
    const seed = (sent.seed + 2) >>> 0;
    host.send({ t: 'rematch', game: 2, seed });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const two = await game(2, seed, 600);
    for (const w of watchers) {
      expect(w.spectator.game).toBe(2);
      expect(w.seen.has('2:599')).toBe(true);
      for (const [t, text] of w.seen) if (t.startsWith('2:')) expect(text, t).toBe(two[0]!.states.get(t));
    }

    // The players go: the watchers hear the seats empty.
    host.close();
    guest.close();
    await new Promise((resolve) => setTimeout(resolve, 500));
    for (const w of watchers) expect(w.spectator.seats).toEqual({ host: false, guest: false });
    for (const w of watchers) w.socket.close();
  }, 240_000);
});
