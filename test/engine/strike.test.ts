import { describe, expect, it } from 'vitest';
import { type Inputs, type Match, newMatch, tick } from '../../src/engine/engine';
import type { MoveTable, Strike } from '../../src/engine/moves';
import { RULES, type RulesName } from '../../src/engine/rules';
import { BODY, HP, TICK_MS } from '../../src/engine/stage';
import { fakeTable, inputs, place, rig, run, skipIntro, until } from './fake';

/** A one-hander's table whose swings and melee abilities all strike as `strike` says. */
function struckTable(strike: Strike): MoveTable {
  const table = fakeTable();
  table.moves = { ...table.moves, swing: { ...table.moves.swing, variations: table.moves.swing.variations.map((v) => ({ ...v, strike })) } };
  table.weapon = { ...table.weapon, range: strike.reach + BODY / 2 };
  table.kit = {
    ...table.kit,
    abilities: table.kit.abilities.map((a) => (a.kind === 'melee' ? { ...a, move: { ...a.move, variations: a.move.variations.map((v) => ({ ...v, strike })) } } : a)) as MoveTable['kit']['abilities'],
  };
  return table;
}

function struck(rules: RulesName, strike: Strike, gap = 1.5): Match {
  const match = newMatch([struckTable(strike), struckTable(strike)], 1, ['P1', 'P2'], rules);
  skipIntro(match);
  place(match, gap);
  return match;
}

/** Ticks from P1's press of attack (counted) to the tick its blow lands on P2, or -1. */
function landsAfter(match: Match, press: Inputs = inputs({ attack: true })): number {
  rig(match, 'hit');
  tick(match, [press, inputs()]);
  if (match.fighters[1].hp < HP) return 1;
  const n = until(match, (m) => m.fighters[1].hp < HP, 120);
  return n < 0 ? -1 : n + 1;
}

const BLOW: Strike = { contact: 0.5, reach: 2.0, height: 1.0 };

describe('measured strikes in the fight', () => {
  it('under the Warcraft rules a swing lands when the blade arrives, not at the fixed window', () => {
    const lead = RULES.warcraft.strike.lead;
    const expected = Math.ceil(((BLOW.contact - lead) * 1000) / (RULES.warcraft.swingRate * TICK_MS));
    expect(landsAfter(struck('warcraft', BLOW))).toBe(expected);
    // Unmeasured, the old window: a fifth of the way in.
    const plain = newMatch([fakeTable(), fakeTable()], 1);
    skipIntro(plain);
    place(plain, 1.5);
    expect(landsAfter(plain)).toBe(Math.ceil((RULES.warcraft.swingHit.from * 1000) / (RULES.warcraft.swingRate * TICK_MS)));
  });

  it('under KOMBAT a tap lands in the same few frames however long the wind-up', () => {
    for (const contact of [0.3, 0.5, 0.7]) {
      expect(landsAfter(struck('kombat', { ...BLOW, contact }))).toBe(RULES.kombat.strike.startup);
    }
  });

  it('reaches as far as the blade does, to the front of the body', () => {
    // 2.0 of blade and half a body between the two.
    expect(landsAfter(struck('kombat', BLOW, 2 + BODY / 2 - 0.1))).toBeGreaterThan(0);
    expect(landsAfter(struck('kombat', BLOW, 2 + BODY / 2 + 0.15))).toBe(-1);
  });

  it('reaches the front of a bigger body further off, and an attacker’s own size does not stretch it', () => {
    const sized = (attacker: number, target: number) => {
      const tables = [struckTable(BLOW), struckTable(BLOW)] as const;
      const match = newMatch([{ ...tables[0], body: attacker }, { ...tables[1], body: target }], 1, ['P1', 'P2'], 'kombat');
      skipIntro(match);
      place(match, 2 + BODY / 2 + 0.15);
      return match;
    };
    expect(landsAfter(sized(BODY / 2, BODY))).toBeGreaterThan(0);
    expect(landsAfter(sized(BODY, BODY / 2))).toBe(-1);
  });

  it('sparks where the weapon came in, kept on the body', () => {
    const match = struck('kombat', BLOW);
    landsAfter(match);
    const spark = match.sparks.at(-1)!;
    expect(spark.z).toBeCloseTo(1.0, 5);
    // On the front of P2's body, toward P1.
    expect(spark.x).toBeCloseTo(match.fighters[1].x - (BODY / 2) * 0.8, 5);
    const high = struck('kombat', { ...BLOW, height: 3 });
    landsAfter(high);
    expect(high.sparks.at(-1)!.z).toBeCloseTo(0.85 * high.tables[1].stature, 5);
  });

  it('a melee ability lands at its own contact too', () => {
    const match = struck('warcraft', BLOW);
    match.fighters[0].resource = 100;
    const n = landsAfter(match, inputs({ ability: 1 })); // Mortal Strike
    expect(n).toBe(Math.ceil(((BLOW.contact - RULES.warcraft.strike.lead) * 1000) / (RULES.warcraft.abilityRate * TICK_MS)));
  });

  it('under KOMBAT a held key cannot lock a fighter in hitstun, and the string still combos', () => {
    const held = struck('kombat', BLOW);
    let most = 0;
    for (let n = 0; n < 300; n++) {
      place(held, 1.5);
      tick(held, [inputs({ attack: true }), inputs()]);
      most = Math.max(most, held.combo[0]);
    }
    expect(most).toBe(1);

    const string = struck('kombat', BLOW);
    for (let blow = 0; blow < 3; blow++) {
      rig(string, 'hit');
      tick(string, [inputs({ attack: true }), inputs()]);
      run(string, 2);
      if (blow < 2) expect(until(string, (m) => m.combo[0] === blow + 1, 30)).toBeGreaterThanOrEqual(0);
    }
    expect(until(string, (m) => m.fighters[1].state === 'knockdown', 40)).toBeGreaterThanOrEqual(0);
    expect(string.combo[0]).toBe(3);
  });
});
