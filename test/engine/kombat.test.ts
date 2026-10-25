import { describe, expect, it } from 'vitest';
import { cpuInputs } from '../../src/engine/cpu';
import { actionable, type Inputs, type Match, tick } from '../../src/engine/engine';
import { RULES } from '../../src/engine/rules';
import { fighterView } from '../../src/engine/view';
import { HP, ROUND_FRAMES } from '../../src/engine/stage';
import { fakeMatch, HUNTER, inputs, MAGE, NONE, PALADIN, place, rig, ROGUE, run, skipIntro, until, WARRIOR } from './fake';

const K = RULES.kombat;

/** A KOMBAT match in the fight phase with the fighters `gap` apart. */
function kombat(gap = 1.5, seed = 1, classes: [number, number] = [WARRIOR, WARRIOR], shields: [boolean, boolean] = [false, false]): Match {
  const match = fakeMatch(seed, classes, shields, 'kombat');
  skipIntro(match);
  expect(match.phase).toBe('fight');
  place(match, gap);
  return match;
}

/** One tick with `who` pressing attack, the other holding `held`. */
function tap(match: Match, who: 0 | 1 = 0, held: Inputs = inputs()): void {
  const both: [Inputs, Inputs] = [inputs(), inputs()];
  both[who] = inputs({ attack: true });
  both[who === 0 ? 1 : 0] = held;
  tick(match, both);
}

const texts = (match: Match, side: 0 | 1) => match.texts.filter((t) => t.side === side).map((t) => `${t.kind}:${t.text}`);

describe('KOMBAT: attacks on the press', () => {
  it('a tap swings at once, in reach or not, with no swing timer', () => {
    const match = kombat(1.5);
    const f = match.fighters[0];
    tap(match);
    expect(f.state).toBe('attack');
    expect(f.swingT).toBe(0);
    const far = kombat(6);
    tap(far);
    expect(far.fighters[0].state).toBe('attack');
    expect(texts(far, 0)).not.toContain('info:OUT OF RANGE');
  });

  it('a second tap during the swing chains the next blow, and the third knocks down', () => {
    const match = kombat(1.5);
    const [a, b] = match.fighters;
    rig(match, 'hit');
    tap(match);
    expect(until(match, (m) => m.fighters[1].hp < HP, 30)).toBeGreaterThan(0);
    expect(b.hp).toBe(HP - 8);
    expect(a.chain).toBe(0);
    // The press for the second blow, inside the first swing's recovery: it goes the moment the hitstop is over.
    run(match, 2);
    rig(match, 'hit');
    tap(match);
    expect(until(match, (m) => m.fighters[0].chain === 1, 10)).toBeGreaterThanOrEqual(0);
    expect(a.variation).toBe(1);
    expect(until(match, (m) => m.fighters[1].hp < HP - 8, 30)).toBeGreaterThan(0);
    expect(b.hp).toBe(HP - 16);
    // The second landed while the first still held the victim: a combo.
    expect(match.combo[0]).toBe(2);
    expect(texts(match, 0)).toContain('combo:2 HITS');
    expect(b.state).toBe('hit');
    run(match, 2);
    rig(match, 'hit');
    tap(match);
    expect(until(match, (m) => m.fighters[0].chain === 2, 10)).toBeGreaterThanOrEqual(0);
    expect(until(match, (m) => m.fighters[1].hp < HP - 16, 30)).toBeGreaterThan(0);
    expect(b.hp).toBe(HP - 28);
    expect(b.state).toBe('knockdown');
    expect(match.combo[0]).toBe(3);
    expect(texts(match, 0)).toContain('combo:3 HITS');
  });

  it('a fighter who is down cannot be hit again, so the string does not loop', () => {
    const match = kombat(1.5);
    const b = match.fighters[1];
    b.state = 'knockdown';
    b.move = 'knockdown';
    tap(match);
    run(match, 30);
    expect(b.hp).toBe(HP);
  });

  it('holding the key repeats the first blow as soon as each swing recovers', () => {
    const match = kombat(1.5);
    const a = match.fighters[0];
    const held: [Inputs, Inputs] = [inputs({ attack: true }), inputs()];
    let swings = 0;
    let last = a.swings;
    for (let n = 0; n < 120; n++) {
      tick(match, held);
      if (a.swings !== last) {
        last = a.swings;
        swings++;
        expect(a.chain).toBe(0);
      }
    }
    expect(swings).toBeGreaterThanOrEqual(4);
  });
});

describe('KOMBAT: hitstun', () => {
  it('a landed swing holds the victim for the hitstop and 14 frames more', () => {
    const match = kombat(1.5);
    const b = match.fighters[1];
    rig(match, 'hit');
    tap(match);
    expect(until(match, (m) => m.fighters[1].hp < HP, 30)).toBeGreaterThan(0);
    expect(b.hitstop).toBe(K.swingHitstop);
    expect(b.hitstun).toBe(K.hitstun.light);
    expect(actionable(match, 1)).toBe(false);
    run(match, K.swingHitstop + K.hitstun.light - 1);
    expect(actionable(match, 1)).toBe(false);
    run(match, 1);
    expect(actionable(match, 1)).toBe(true);
    // The combo against them ends with it.
    expect(match.combo[0]).toBe(0);
  });

  it('a melee ability holds the victim longer', () => {
    const match = kombat(1.5);
    const [a, b] = match.fighters;
    a.resource = 100;
    rig(match, 'hit');
    tick(match, [inputs({ ability: 1 }), inputs()]); // Mortal Strike
    expect(until(match, (m) => m.fighters[1].hp < HP, 60)).toBeGreaterThan(0);
    expect(b.hitstun).toBe(K.hitstun.heavy);
  });
});

describe('KOMBAT: block', () => {
  it('holding back takes a blow from the front on the guard: chip damage, block stun, no hitstun', () => {
    const match = kombat(1.5);
    const b = match.fighters[1];
    const back = inputs({ right: true });
    tap(match, 0, back);
    expect(until(match, (m) => m.fighters[1].state === 'block', 30, [inputs(), back])).toBeGreaterThan(0);
    expect(b.hp).toBe(HP - Math.round(8 * K.block!.chip));
    expect(b.hitstun).toBe(0);
    expect(b.lag).toBe(K.block!.stun);
    expect(match.combo[0]).toBe(0);
    expect(texts(match, 1).filter((t) => t.startsWith('block:BLOCK'))).toHaveLength(1);
    // Held in the block for its stun, then free.
    run(match, K.swingHitstop + K.block!.stun, [inputs(), back]);
    expect(actionable(match, 1)).toBe(true);
  });

  it('a blow from behind is not blocked: the guard is held away from where it comes', () => {
    const match = kombat(1.5);
    const [a, b] = match.fighters;
    // P2 holds right, away from P1; then P1 is over to that side, as after jumping across.
    run(match, 3, [inputs(), inputs({ right: true })]);
    a.x = b.x + 1.2;
    a.facing = -1;
    rig(match, 'hit');
    tap(match, 0, inputs({ right: true }));
    expect(until(match, (m) => m.fighters[1].hp < HP, 30, [inputs(), inputs({ right: true })])).toBeGreaterThan(0);
    expect(b.hp).toBe(HP - 8);
    expect(b.hitstun).toBeGreaterThan(0);
    expect(b.state).toBe('hit');
  });

  it('a fighter in the middle of a swing cannot block', () => {
    const match = kombat(1.5);
    const b = match.fighters[1];
    // P1 swings; a frame later P2 swings back holding away, and P1's blow lands first.
    rig(match, 'hit');
    tap(match);
    tick(match, [inputs(), inputs({ attack: true, right: true })]);
    expect(b.state).toBe('attack');
    expect(until(match, (m) => m.fighters[1].hp < HP, 30, [inputs(), inputs({ right: true })])).toBeGreaterThan(0);
    expect(b.hp).toBe(HP - 8);
  });
});

describe('KOMBAT: no dice', () => {
  it('no swing misses, is dodged, parried or blocked by the table in 200 swings rigged to', () => {
    const match = kombat(1.5, 1, [WARRIOR, WARRIOR], [false, true]);
    const [, b] = match.fighters;
    const outcomes = ['miss', 'dodge', 'parry', 'block'] as const;
    for (let n = 0; n < 200; n++) {
      place(match, 1.5);
      b.hp = HP;
      match.timer = ROUND_FRAMES;
      rig(match, outcomes[n % outcomes.length]!);
      tap(match);
      run(match, 60);
      expect(b.hp).toBeLessThan(HP);
      expect(texts(match, 1).some((t) => /^(miss|dodge|parry):/.test(t))).toBe(false);
      expect(match.texts.some((t) => t.kind === 'block')).toBe(false);
    }
    expect(match.phase).toBe('fight');
  });

  it('a crit is half again', () => {
    const match = kombat(1.5);
    // A state whose next draw is under the crit chance.
    let seed = 1;
    while ((Math.imul(seed, 1664525) + 1013904223) >>> 0 >= K.hitTable.crit * 0.5 * 4294967296) seed++;
    match.rng = seed;
    tap(match);
    until(match, (m) => m.fighters[1].hp < HP, 30);
    expect(match.fighters[1].hp).toBe(HP - 12);
  });
});

/** Ticks each of `steps` once for P1, P2 idle. */
function keys(match: Match, steps: Inputs[]): void {
  for (const step of steps) tick(match, [step, inputs()]);
}

describe('KOMBAT: movement', () => {
  it('walks faster than the Warcraft rules and backs off at their old forward speed', () => {
    const match = kombat(4);
    const f = match.fighters[0];
    const x = f.x;
    run(match, 10, [inputs({ right: true }), inputs()]);
    expect(f.x - x).toBeCloseTo(10 * K.walk, 5);
    const y = f.x;
    run(match, 10, [inputs({ left: true }), inputs()]);
    expect(y - f.x).toBeCloseTo(10 * K.back, 5);
  });

  it('a double tap forward runs at the opponent, and the run can be cut into a swing', () => {
    const match = kombat(6);
    const f = match.fighters[0];
    const x = f.x;
    keys(match, [inputs({ right: true }), inputs({ right: true }), inputs(), inputs(), inputs({ right: true })]);
    expect(f.state).toBe('run');
    run(match, K.dash!.frames, [inputs({ right: true }), inputs()]);
    expect(f.state).not.toBe('run');
    // Two frames of walking, then the run's ten.
    expect(f.x - x).toBeCloseTo(2 * K.walk + K.dash!.frames * K.dash!.speed, 5);
    // A second run, cut into a swing four frames in.
    place(match, 6);
    run(match, 20);
    keys(match, [inputs({ right: true }), inputs(), inputs({ right: true })]);
    expect(f.state).toBe('run');
    keys(match, [inputs(), inputs(), inputs(), inputs({ attack: true })]);
    expect(f.state).toBe('run');
    tick(match, [inputs(), inputs()]);
    expect(f.state).toBe('attack');
  });

  it('two presses too far apart, or a long first press, only walk', () => {
    const match = kombat(6);
    const f = match.fighters[0];
    keys(match, [inputs({ right: true }), ...Array.from({ length: K.dash!.window + 1 }, () => inputs()), inputs({ right: true })]);
    expect(f.state).toBe('walk');
    keys(match, [inputs(), ...Array.from({ length: K.dash!.tap + 2 }, () => inputs({ right: true })), inputs(), inputs({ right: true })]);
    expect(f.state).toBe('walk');
  });

  it('a double tap back hops away, out of reach of a swing for its first frames', () => {
    const match = kombat(1.5);
    const [a, b] = match.fighters;
    const x = b.x;
    rig(match, 'hit');
    tap(match);
    // P2 hops back as P1's blow is about to land.
    const steps = [inputs({ right: true }), inputs(), inputs({ right: true })];
    for (const step of steps) tick(match, [inputs(), step]);
    expect(b.state).toBe('backdash');
    run(match, 6);
    expect(b.hp).toBe(HP);
    expect(a.hitDone).toBe(true);
    run(match, 10);
    expect(b.x - x).toBeGreaterThan(K.dash!.backFrames * K.dash!.backSpeed - 0.01);
  });
});

describe('KOMBAT: the jumping attack', () => {
  /** P1 jumps from `gap` away and presses attack on the way up. */
  function jumpIn(gap: number): Match {
    const match = kombat(gap);
    tick(match, [inputs({ jump: true }), inputs()]);
    tick(match, [inputs({ attack: true }), inputs()]);
    return match;
  }

  it('waits for the top of the jump, hits a grounded target under it and lands into a short recovery', () => {
    const match = jumpIn(1.6);
    const [a, b] = match.fighters;
    expect(a.state).toBe('jump');
    expect(until(match, (m) => m.fighters[0].state === 'attack', 40)).toBeGreaterThan(0);
    expect(a.vz).toBeLessThanOrEqual(0);
    expect(a.airAttack).toBe(true);
    rig(match, 'hit');
    expect(until(match, (m) => m.fighters[1].hp < HP, 40)).toBeGreaterThan(0);
    expect(b.hp).toBe(HP - 8);
    expect(b.hitstun).toBeGreaterThan(0);
    expect(until(match, (m) => !m.fighters[0].airborne, 60)).toBeGreaterThan(0);
    expect(a.lag).toBe(K.airAttack!.recover);
    expect(actionable(match, 0)).toBe(false);
    run(match, K.airAttack!.recover);
    expect(actionable(match, 0)).toBe(true);
  });

  it('one attack a jump', () => {
    const match = jumpIn(5);
    const a = match.fighters[0];
    let swings = 0;
    let last = a.swings;
    for (let n = 0; n < 60; n++) {
      tick(match, [inputs({ attack: n % 2 === 0 }), inputs()]);
      if (a.swings !== last) {
        last = a.swings;
        if (a.airborne) swings++;
      }
    }
    expect(swings).toBe(1);
  });

  it('the Warcraft rules swing nothing in the air', () => {
    const match = fakeMatch();
    skipIntro(match);
    place(match, 1.6);
    tick(match, [inputs({ jump: true }), inputs()]);
    run(match, 30, [inputs({ attack: true }), inputs()]);
    expect(match.fighters[0].airAttack).toBe(false);
  });
});

describe('KOMBAT: specials', () => {
  it('an ability pressed once a swing is active cancels the swing into it at once', () => {
    const match = kombat(1.5);
    const a = match.fighters[0];
    a.resource = 100;
    rig(match, 'hit');
    tap(match);
    expect(until(match, (m) => m.fighters[1].hp < HP, 30)).toBeGreaterThan(0);
    const swung = a.t;
    rig(match, 'hit');
    tick(match, [inputs({ ability: 1 }), inputs()]); // Mortal Strike, during the hitstop
    expect(until(match, (m) => m.fighters[0].state === 'ability', 10)).toBeGreaterThanOrEqual(0);
    // Well before the swing would have let go of them by itself.
    expect(swung).toBeLessThan(K.swingHit.recover * 1000);
    expect(until(match, (m) => m.fighters[1].hp < HP - 8, 60)).toBeGreaterThan(0);
    expect(match.fighters[1].hp).toBe(HP - 8 - 18);
    expect(match.combo[0]).toBe(2);
  });

  it('half the global cooldown, half the cast, twice the mana', () => {
    const match = kombat(5, 1, [MAGE, WARRIOR]);
    const mage = match.fighters[0];
    tick(match, [inputs({ ability: 0 }), inputs()]); // Frostbolt
    expect(mage.gcd).toBe(K.gcd);
    expect(mage.cast?.total).toBe(45);
    expect(fighterView(match, 0).abilities[0]!.castTime).toBe(45);
    mage.resource = 50;
    mage.cast = undefined;
    mage.state = 'idle';
    tick(match, NONE);
    expect(mage.resource).toBeCloseTo(50 + 2 * match.tables[0].kit.regen, 5);
  });
});

describe('KOMBAT: determinism', () => {
  function scripted(frame: number): [Inputs, Inputs] {
    const a = inputs({
      right: frame % 7 < 4 || frame % 41 === 2,
      left: frame % 11 === 0,
      attack: frame % 9 < 2,
      jump: frame % 53 === 0,
      abilities: [frame % 61 === 0, frame % 97 === 0, frame % 37 === 0],
    });
    const b = inputs({
      left: frame % 5 < 3,
      right: frame % 29 > 25,
      attack: frame % 13 < 3,
      jump: frame % 71 === 0,
      abilities: [frame % 47 === 0, frame % 89 === 0, frame % 41 === 0],
    });
    return [a, b];
  }

  it('the same seed and inputs give the same match after 2000 ticks', () => {
    const a = fakeMatch(42, [MAGE, WARRIOR], [false, false], 'kombat');
    const b = fakeMatch(42, [MAGE, WARRIOR], [false, false], 'kombat');
    for (let f = 0; f < 2000; f++) {
      tick(a, scripted(f));
      tick(b, scripted(f));
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.round > 1 || a.fighters[0].hp + a.fighters[1].hp < 2 * HP).toBe(true);
  });
});

describe('KOMBAT: the CPU', () => {
  it('blocks some of the swings thrown at it in reach, and takes the rest', () => {
    const match = kombat(1.5, 7);
    const [a, b] = match.fighters;
    let blocked = 0;
    let hit = 0;
    for (let n = 0; n < 60; n++) {
      // Each swing finds both fighters on their feet and free, whatever the last one left.
      place(match, 1.5);
      match.timer = ROUND_FRAMES;
      for (const f of [a, b]) {
        f.hp = HP;
        f.state = 'idle';
        f.move = 'idle';
        f.hitstun = 0;
        f.lag = 0;
        f.queued = false;
        f.hitstop = 0;
      }
      const was = b.hp;
      tick(match, [inputs({ attack: true }), cpuInputs(match, 1)]);
      let guarded = false;
      for (let k = 0; k < 59; k++) {
        tick(match, [inputs(), cpuInputs(match, 1)]);
        if (b.state === 'block') guarded = true;
      }
      if (guarded) blocked++;
      else if (b.hp < was) hit++;
    }
    expect(blocked).toBeGreaterThanOrEqual(10);
    expect(hit).toBeGreaterThanOrEqual(10);
  });

  it('follows a blow that lands with the rest of the string, to the knockdown', () => {
    const match = kombat(1.5, 3);
    const a = match.fighters[0];
    let best = 0;
    let down = false;
    for (let n = 0; n < 600 && !down; n++) {
      tick(match, [inputs(), cpuInputs(match, 1)]);
      best = Math.max(best, match.combo[1]);
      if (a.state === 'knockdown') down = true;
    }
    expect(best).toBeGreaterThanOrEqual(3);
    expect(down).toBe(true);
  });

  it('runs in with a double tap from afar', () => {
    const match = kombat(9, 5, [ROGUE, ROGUE]);
    let ran = false;
    for (let n = 0; n < 180 && !ran; n++) {
      tick(match, [inputs(), cpuInputs(match, 1)]);
      if (match.fighters[1].state === 'run') ran = true;
    }
    expect(ran).toBe(true);
  });

  // A string, a special and a second string keep a fighter reeling for up to about 1.8 s; nothing should hold them 2.5.
  const LONGEST_COMBO = 150;

  it('two CPUs fight it out: no one is held in hitstun for long, both act, and the rounds are won', () => {
    for (const [seed, classes] of [[1, [WARRIOR, WARRIOR]], [2, [ROGUE, PALADIN]], [3, [MAGE, WARRIOR]], [4, [HUNTER, ROGUE]]] as const) {
      const match = fakeMatch(seed, [classes[0], classes[1]], [false, false], 'kombat');
      const reeling = [0, 0];
      const longest = [0, 0];
      let blocks = 0;
      const acted = [false, false];
      for (let n = 0; n < 6000 && match.phase !== 'matchEnd'; n++) {
        tick(match, [cpuInputs(match, 0), cpuInputs(match, 1)]);
        for (const i of [0, 1] as const) {
          // Reeling from blows, not held by a stun ability: a stun is its own clock (Kidney Shot, Hammer of Justice).
          reeling[i] = match.fighters[i].hitstun > 0 && !(match.fighters[i].stunT > 0) ? reeling[i]! + 1 : 0;
          longest[i] = Math.max(longest[i]!, reeling[i]!);
          if (match.fighters[i].state === 'block' && match.fighters[i].t === 0) blocks++;
          const state = match.fighters[i].state;
          if (state === 'attack' || state === 'ability' || state === 'cast' || state === 'dash') acted[i] = true;
        }
      }
      expect(Math.max(...longest)).toBeLessThanOrEqual(LONGEST_COMBO);
      expect(acted).toEqual([true, true]);
      expect(match.round > 1 || match.phase === 'matchEnd').toBe(true);
      expect(blocks).toBeGreaterThan(0);
    }
  });

  it('still performs its fatality in the finish', () => {
    const match = kombat(1.5, 3);
    match.fighters[0].hp = 7;
    match.fighters[1].resource = 60;
    rig(match, 'hit');
    tap(match, 1);
    expect(until(match, (m) => m.phase === 'finish', 60)).toBeGreaterThan(0);
    for (let n = 0; n < 300 && match.phase === 'finish'; n++) tick(match, [inputs(), cpuInputs(match, 1)]);
    expect(match.phase).toBe('fatality');
    expect(match.fighters[1].state).toBe('finisher');
  });
});
