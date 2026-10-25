import { describe, expect, it } from 'vitest';
import { newMatch, tick } from '../../src/engine/engine';
import type { Champion } from '../../src/game/fighters';
import { championOf, decode, encode, type Hello, localize, meet, mismatch, plainSpec, sameStage, specOf, stageKeyOf } from '../../src/game/net/handshake';
import { stateText } from '../../src/game/net/lockstep';
import { VERSION } from '../../src/game/net/version';
import { fakeTable, FULL_SET, HUNTER, PALADIN } from '../engine/fake';

const thrall: Champion = {
  key: 'legend:thrall:4527',
  name: 'THRALL',
  title: 'WARCHIEF OF THE HORDE',
  raceId: 2,
  sex: 0,
  classId: 7,
  choices: [],
  gear: [['mainHand', 17182]],
  npc: 4527,
};

const made: Champion = {
  key: 'made:4:1:11:abc',
  name: 'Scarletfire',
  title: 'NIGHT ELF DRUID',
  raceId: 4,
  sex: 1,
  classId: 11,
  choices: [[1, 3], [7, 2]],
  gear: [['head', 100], ['chest', 200]],
};

const hello = (): Hello => ({
  t: 'hello',
  version: VERSION,
  product: 'wow_classic',
  seed: 0xdeadbeef,
  game: 1,
  stage: { kind: 'stage', slug: 'gurubashi' },
  fighters: [specOf(thrall), specOf(made)],
  // A paladin's and a hunter's: kits, a shield, a bow, fatalities whose beats leave the loser alone.
  tables: [fakeTable(FULL_SET, 'oneHand', { Attack1H: 1300 }, PALADIN, true), fakeTable(FULL_SET, 'bow', {}, HUNTER)],
});

describe('the handshake', () => {
  it('sends the champions and the tables as text and rebuilds them unchanged', () => {
    const sent = hello();
    const text = encode(sent);
    const got = decode(text) as Hello;
    expect(got).toEqual(sent);
    expect(got.tables[0]).toEqual(sent.tables[0]);
    expect(got.tables[1].fatality.victim).toEqual(sent.tables[1].fatality.victim);
    expect(championOf(got.fighters[0])).toEqual(thrall);
    expect(championOf(got.fighters[1])).toEqual(made);
    // The tables are small enough for one message.
    expect(text.length).toBeLessThan(200_000);
  });

  it('a match on the rebuilt tables plays the same fight as on the originals', () => {
    const sent = hello();
    const got = decode(encode(sent)) as Hello;
    const a = newMatch(sent.tables, sent.seed, ['A', 'B']);
    const b = newMatch(got.tables, got.seed, ['A', 'B']);
    for (let t = 0; t < 1200; t++) {
      const both = [
        { left: false, right: t % 90 < 50, jump: t % 211 === 0, attack: t % 3 !== 0, abilities: [t % 120 === 5, t % 300 === 7, false] as [boolean, boolean, boolean] },
        { left: t % 70 < 30, right: false, jump: false, attack: t % 5 !== 0, abilities: [false, t % 150 === 9, t % 400 === 11] as [boolean, boolean, boolean] },
      ] as const;
      tick(a, [both[0], both[1]]);
      tick(b, [{ ...both[0] }, { ...both[1] }]);
    }
    expect(stateText(b)).toBe(stateText(a));
  });

  it('refuses another version with a message that says what to do', () => {
    expect(mismatch(meet('wow'))).toBeUndefined();
    expect(mismatch({ version: `${VERSION}x` })).toMatch(/different version.*reload/);
    // A page from before the fingerprint said 1.
    expect(mismatch({ version: 1 })).toMatch(/different version/);
    expect(VERSION).toMatch(/^[0-9a-f]{10}$/);
  });

  it('draws a legend with this install’s own display of it, or as its race when it has none', () => {
    const spec = specOf(thrall);
    expect(localize(spec, () => 4527)).toBe(spec);
    const ours = localize(spec, (slug) => (slug === 'thrall' ? 9000 : undefined));
    expect(ours.npc).toBe(9000);
    expect(ours.key).toBe('legend:thrall:9000');
    expect(localize(specOf(made), () => 1)).toEqual(specOf(made));
    const plain = plainSpec(spec);
    expect(plain.npc).toBeUndefined();
    expect(plain.raceId).toBe(2);
    expect(plain.key).not.toBe(spec.key);
  });

  it('names the ground by a key each install looks up in its own list', () => {
    expect(stageKeyOf({ stage: { slug: 'goldshire' } })).toEqual({ kind: 'stage', slug: 'goldshire' });
    expect(stageKeyOf({ screen: { id: 12 } })).toEqual({ kind: 'screen', id: 12 });
    expect(stageKeyOf({})).toEqual({ kind: 'none' });
    expect(sameStage({ kind: 'screen', id: 3 }, { kind: 'screen', id: 3 })).toBe(true);
    expect(sameStage({ kind: 'stage', slug: 'a' }, { kind: 'screen', id: 3 })).toBe(false);
  });

  it('ignores text that is not a message', () => {
    expect(decode('pong')).toBeUndefined();
    expect(decode('{"no":1}')).toBeUndefined();
    expect(decode(encode({ t: 'rematch', game: 2, seed: 5 }))).toEqual({ t: 'rematch', game: 2, seed: 5 });
  });
});
