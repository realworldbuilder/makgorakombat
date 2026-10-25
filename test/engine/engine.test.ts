import { describe, expect, it } from 'vitest';
import { DOT_TICK_FRAMES, GCD_FRAMES } from '../../src/engine/abilities';
import { BRAND } from '../../src/engine/brand';
import { cpuInputs } from '../../src/engine/cpu';
import { type Inputs, type Match, newMatch, poseOf, tick } from '../../src/engine/engine';
import { BODY, FINISH_FRAMES, HALF, HP, INTRO_FRAMES, KO_SLOWMO, ROUND_END_FRAMES, START_X } from '../../src/engine/stage';
import { fakeMatch, fakeTable, FULL_SET, HUNTER, inputs, MAGE, NONE, PALADIN, place, PRIEST, rig, ROGUE, run, SHAMAN, skipIntro, until, WARLOCK, WARRIOR } from './fake';

/** A match in the fight phase with the fighters `gap` apart. */
function fighting(gap = 1.5, seed = 1, classes: [number, number] = [WARRIOR, WARRIOR], shields: [boolean, boolean] = [false, false]): Match {
  const match = fakeMatch(seed, classes, shields);
  skipIntro(match);
  expect(match.phase).toBe('fight');
  place(match, gap);
  return match;
}

/** One tap of the attack key by `attacker`, then the swing's 1000 ms. The roll is rigged to `outcome`. */
function swing(match: Match, attacker: 0 | 1, outcome: Parameters<typeof rig>[1] = 'hit', held: [Inputs, Inputs] = NONE): void {
  rig(match, outcome);
  const both: [Inputs, Inputs] = [{ ...held[0] }, { ...held[1] }];
  both[attacker] = { ...both[attacker], attack: true };
  tick(match, both);
  run(match, 70, held);
}

/** Presses ability `n` for `who` on one tick. */
function press(match: Match, who: 0 | 1, n: number, outcome?: Parameters<typeof rig>[1]): void {
  if (outcome) rig(match, outcome);
  const both: [Inputs, Inputs] = [inputs(), inputs()];
  both[who] = inputs({ ability: n });
  tick(match, both);
}

const texts = (match: Match, side: 0 | 1) => match.texts.filter((t) => t.side === side).map((t) => `${t.kind}:${t.text}`);

describe('intro', () => {
  it('starts on the marks with ROUND 1 and reaches FIGHT!', () => {
    const match = fakeMatch();
    expect(match.fighters[0].x).toBe(-START_X);
    expect(match.fighters[1].x).toBe(START_X);
    expect(match.fighters[0].facing).toBe(1);
    expect(match.fighters[1].facing).toBe(-1);
    expect(match.banner?.text).toBe(BRAND.round(1));
    run(match, INTRO_FRAMES - 59);
    expect(match.banner?.text).toBe(BRAND.fight);
    expect(match.phase).toBe('intro');
    run(match, 60);
    expect(match.phase).toBe('fight');
  });

  it('ignores inputs during the intro', () => {
    const match = fakeMatch();
    run(match, 50, [inputs({ right: true, attack: true, ability: 0 }), inputs()]);
    expect(match.fighters[0].x).toBe(-START_X);
    expect(match.fighters[0].state).toBe('intro');
  });
});

describe('movement', () => {
  it('clamps to the stage walls', () => {
    const match = fighting(4.4);
    run(match, 400, [inputs({ left: true }), inputs({ right: true })]);
    expect(match.fighters[0].x).toBe(-HALF);
    expect(match.fighters[1].x).toBe(HALF);
  });

  it('never lets the bodies overlap below BODY', () => {
    const match = fighting(4.4);
    for (let i = 0; i < 300; i++) {
      tick(match, [inputs({ right: true }), inputs({ left: true })]);
      expect(Math.abs(match.fighters[0].x - match.fighters[1].x)).toBeGreaterThanOrEqual(BODY - 1e-9);
    }
  });

  it('gives way to the fighter in the corner', () => {
    const match = fighting(4.4);
    run(match, 400, [inputs({ left: true }), inputs({ left: true })]);
    expect(match.fighters[0].x).toBe(-HALF);
    expect(match.fighters[1].x).toBeCloseTo(-HALF + BODY, 5);
  });

  it('runs forward and backpedals at different speeds', () => {
    const match = fighting(4.4);
    const x0 = match.fighters[0].x;
    tick(match, [inputs({ right: true }), inputs()]);
    const forward = match.fighters[0].x - x0;
    expect(match.fighters[0].move).toBe('walk');
    expect(match.tables[0].moves.walk.animation).toBe('Run');
    tick(match, [inputs({ left: true }), inputs()]);
    const back = match.fighters[0].x - x0 - forward;
    expect(forward).toBeCloseTo(0.07, 6);
    expect(back).toBeCloseTo(-0.045, 6);
    expect(match.fighters[0].move).toBe('back');
    expect(match.tables[0].moves.back.animation).toBe('Walkbackwards');
  });

  it('jumps and lands back on the ground', () => {
    const match = fighting(4.4);
    tick(match, [inputs({ jump: true }), inputs()]);
    expect(match.fighters[0].airborne).toBe(true);
    expect(match.fighters[0].move).toBe('jumpStart');
    const frames = until(match, (m) => !m.fighters[0].airborne, 200);
    expect(frames).toBeGreaterThan(20);
    expect(match.fighters[0].z).toBe(0);
    expect(match.fighters[0].move).toBe('jumpEnd');
  });
});

describe('the auto-attack', () => {
  it('a one-hander swings every 1.5 s while the key is held', () => {
    const match = fighting(1.5);
    const held: [Inputs, Inputs] = [inputs({ attack: true }), inputs()];
    const starts: number[] = [];
    for (let f = 0; f < 400; f++) {
      tick(match, held);
      const p1 = match.fighters[0];
      if (p1.state === 'attack' && p1.move === 'swing' && p1.t < 25) starts.push(f);
    }
    expect(starts).toEqual([0, 90, 180, 270, 360]);
    expect(match.tables[0].weapon.speed).toBe(90);
    expect(match.fighters[1].hp).toBeLessThan(HP);
  });

  it('a two-hander swings every 3.4 s and hits harder', () => {
    const table = fakeTable([...FULL_SET, 'Attack2H', 'Ready2H'], 'twoHand');
    expect(table.weapon.speed).toBe(144);
    expect(table.weapon.damage).toBe(14);
    expect(table.moves.swing.animation).toBe('Attack2H');
  });

  it('a tap queues one swing and no more', () => {
    const match = fighting(1.5);
    swing(match, 0, 'hit');
    expect(match.fighters[1].hp).toBe(HP - 8);
    run(match, 300);
    expect(match.fighters[1].hp).toBe(HP - 8);
    expect(match.fighters[0].queued).toBe(false);
  });

  it('a queued swing waits for the target to come in reach', () => {
    const match = fighting(3.5);
    tick(match, [inputs({ attack: true }), inputs()]);
    run(match, 30);
    expect(match.fighters[0].state).not.toBe('attack');
    expect(match.fighters[0].queued).toBe(true);
    rig(match, 'hit');
    run(match, 60, [inputs(), inputs({ left: true })]);
    expect(match.fighters[0].move).toBe('swing');
  });

  it('a held attack follows the target into reach and keeps landing after the pushback', () => {
    const match = fighting(4);
    const held: [Inputs, Inputs] = [inputs({ attack: true }), inputs()];
    tick(match, held);
    expect(match.fighters[0].state).toBe('walk');
    expect(until(match, (m) => m.fighters[0].state === 'attack', 120, held)).toBeGreaterThan(0);
    let landed = 0;
    for (let f = 0; f < 600; f++) {
      rig(match, 'hit');
      tick(match, held);
      if (match.texts.some((t) => t.t === 1 && t.side === 1 && t.kind === 'damage')) landed++;
    }
    expect(landed).toBeGreaterThanOrEqual(4);
  });

  it('a tap out of reach says OUT OF RANGE once and does not follow', () => {
    const match = fighting(4);
    tick(match, [inputs({ attack: true }), inputs()]);
    run(match, 10);
    expect(match.fighters[0].state).toBe('idle');
    expect(texts(match, 0)).toEqual(['info:OUT OF RANGE']);
  });

  it('cycles the swing animation variations', () => {
    const match = fighting(1.5);
    const seen = new Set<number>();
    for (let f = 0; f < 400; f++) {
      rig(match, 'hit');
      tick(match, [inputs({ attack: true }), inputs()]);
      if (match.fighters[0].move === 'swing') seen.add(poseOf(match, 0).sequence);
    }
    expect(seen.size).toBe(3);
  });

  it("fighter 2's landed swing is posed with its attack sequence, for the keyboard and the CPU alike", () => {
    for (const cpu of [false, true]) {
      const match = fighting(1.5);
      const swingSeqs = new Set(match.tables[1].moves.swing.variations.map((v) => v.sequence));
      const idleSeq = match.tables[1].moves.idle.variations[0]!.sequence;
      let posedAttack = 0;
      let landedWhilePosed = false;
      for (let f = 0; f < 200; f++) {
        rig(match, 'hit');
        const p2 = cpu ? { ...cpuInputs(match, 1), left: false, right: false, jump: false } : inputs({ attack: true });
        tick(match, [inputs(), p2]);
        const posed = poseOf(match, 1).sequence;
        if (match.fighters[1].state === 'attack') {
          expect(swingSeqs.has(posed)).toBe(true);
          expect(posed).not.toBe(idleSeq);
          posedAttack++;
          if (match.texts.some((t) => t.t === 1 && t.side === 0 && t.kind === 'damage')) landedWhilePosed = true;
        }
      }
      expect(posedAttack).toBeGreaterThan(10);
      expect(landedWhilePosed).toBe(true);
      expect(match.fighters[0].hp).toBeLessThan(HP);
    }
  });

  it('a bow shoots instead: the shot flies and lands for 9', () => {
    const table = fakeTable([...FULL_SET, 'AttackBow', 'ReadyBow'], 'bow', {}, HUNTER);
    const match = newMatch([table, fakeTable()], 1);
    skipIntro(match);
    place(match, 5);
    rig(match, 'hit');
    tick(match, [inputs({ attack: true }), inputs()]);
    const fired = until(match, (m) => m.projectiles.length > 0, 60);
    expect(fired).toBeGreaterThan(0);
    expect(match.projectiles[0]!.ability).toBe(-1);
    expect(until(match, (m) => m.fighters[1].hp < HP, 120)).toBeGreaterThan(0);
    expect(match.fighters[1].hp).toBe(HP - 9);
  });
});

describe('the hit table', () => {
  it('a text names who caused it: a blow from the other side, a buff from one\'s own', () => {
    const match = fighting(1.5, 1, [PRIEST, WARRIOR]);
    press(match, 0, 2);
    expect(match.texts.find((t) => t.text === 'SHIELDED')).toMatchObject({ side: 0, from: 0 });
    swing(match, 1, 'hit');
    expect(match.texts.find((t) => t.text === 'ABSORB 8')).toMatchObject({ side: 0, from: 1 });
  });

  it('a fear on a stunned target is IMMUNE', () => {
    const match = fighting(3, 1, [WARLOCK, WARRIOR]);
    const target = match.fighters[1];
    target.state = 'stun';
    target.move = 'dazed';
    target.stunT = 300;
    press(match, 0, 2); // Fear, a 1 s cast
    rig(match, 'hit');
    run(match, 61);
    expect(texts(match, 1)).toContain('immune:IMMUNE');
    expect(match.texts.find((t) => t.text === 'IMMUNE')).toMatchObject({ side: 1, from: 0 });
    expect(target.state).toBe('stun');
  });

  it('a plain hit deals the weapon damage, flinches and floats the number', () => {
    const match = fighting(1.5);
    rig(match, 'hit');
    tick(match, [inputs({ attack: true }), inputs()]);
    const landed = until(match, (m) => m.fighters[1].hp < HP, 60);
    expect(landed).toBeGreaterThan(0);
    expect(match.fighters[1].hp).toBe(92);
    expect(match.fighters[1].move).toBe('hit');
    expect(match.fighters[1].hitstop).toBeGreaterThan(0);
    expect(match.fighters[1].vx).toBeGreaterThan(0);
    expect(match.sparks[0]?.kind).toBe('hit');
    expect(texts(match, 1)).toEqual(['damage:8']);
    expect(match.fighters[1].tookDamage).toBe(true);
  });

  it('a crit doubles the damage with its own animation and a big yellow number', () => {
    const match = fighting(1.5);
    swing(match, 0, 'crit');
    expect(match.fighters[1].hp).toBe(HP - 16);
    expect(match.sparks.length === 0 || match.sparks[0]?.kind === 'crit').toBe(true);
    expect(texts(match, 1)).toEqual(['crit:16']);
  });

  it('a miss does nothing but say so', () => {
    const match = fighting(1.5);
    swing(match, 0, 'miss');
    expect(match.fighters[1].hp).toBe(HP);
    expect(texts(match, 1)).toEqual(['miss:MISS']);
    expect(match.fighters[1].tookDamage).toBe(false);
  });

  it('a dodge plays Dodge', () => {
    const match = fighting(1.5);
    rig(match, 'dodge');
    tick(match, [inputs({ attack: true }), inputs()]);
    until(match, (m) => m.texts.length > 0, 60);
    expect(match.fighters[1].move).toBe('dodge');
    expect(match.fighters[1].hp).toBe(HP);
    expect(texts(match, 1)).toEqual(['dodge:DODGE']);
  });

  it('a parry plays the weapon parry and opens a riposte', () => {
    const match = fighting(1.5);
    rig(match, 'parry');
    tick(match, [inputs({ attack: true }), inputs()]);
    until(match, (m) => m.texts.length > 0, 60);
    expect(match.fighters[1].move).toBe('parry');
    expect(match.tables[1].moves.parry.animation).toBe('Parry1H');
    expect(match.fighters[1].riposteT).toBeGreaterThan(0);
    expect(match.sparks[0]?.kind).toBe('parry');
    // The riposte: the parrier's next melee ability is a sure crit.
    match.fighters[1].resource = 30;
    run(match, 30);
    place(match, 1.5);
    press(match, 1, 1, 'miss');
    until(match, (m) => m.fighters[0].hp < HP, 60);
    expect(match.fighters[0].hp).toBe(HP - 36);
    expect(texts(match, 0)).toContain('crit:36');
  });

  it('only a shield blocks, from the front, for 60 % damage', () => {
    const match = fighting(1.5, 1, [WARRIOR, WARRIOR], [false, true]);
    expect(match.tables[1].moves.parry.animation).toBe('ShieldBlock');
    swing(match, 0, 'block');
    expect(match.fighters[1].hp).toBe(HP - 5);
    expect(texts(match, 1)).toEqual(['block:BLOCK 5']);
    const bare = fighting(1.5);
    swing(bare, 0, 'block');
    // Without a shield the same roll falls in the crit band.
    expect(bare.fighters[1].hp).toBe(HP - 16);
  });

  it('a stunned target can neither dodge nor parry', () => {
    const match = fighting(1.5, 1, [ROGUE, WARRIOR]);
    press(match, 0, 1, 'hit'); // Kidney Shot
    until(match, (m) => m.fighters[1].state === 'stun', 60);
    swing(match, 0, 'dodge');
    expect(match.fighters[1].hp).toBeLessThan(HP - 6);
  });

  it('is the same for the same seed', () => {
    const roll = (seed: number) => {
      const match = fighting(1.5, seed);
      const out: string[] = [];
      for (let f = 0; f < 1200; f++) {
        tick(match, [inputs({ attack: true }), inputs({ attack: true })]);
        for (const t of match.texts) if (t.t === 1) out.push(`${t.side}:${t.text}`);
      }
      return out;
    };
    expect(roll(5)).toEqual(roll(5));
    expect(roll(5)).not.toEqual(roll(6));
    expect(new Set(roll(5)).size).toBeGreaterThan(2);
  });
});

describe('resources', () => {
  it('rage starts empty, builds on a landed swing and on taking a blow', () => {
    const match = fighting(1.5);
    expect(match.fighters[0].resource).toBe(0);
    swing(match, 0, 'hit');
    expect(match.fighters[0].resource).toBe(10);
    expect(match.fighters[1].resource).toBe(5);
    swing(match, 0, 'miss');
    expect(match.fighters[0].resource).toBe(10);
  });

  it('an ability is refused without the rage for it, and spends it when it goes', () => {
    const match = fighting(1.5);
    press(match, 0, 1);
    expect(match.fighters[0].state).not.toBe('ability');
    expect(texts(match, 0)).toEqual(['info:NOT ENOUGH RAGE']);
    match.fighters[0].resource = 45;
    press(match, 0, 1, 'hit');
    expect(match.fighters[0].state).toBe('ability');
    expect(match.fighters[0].move).toBe('ability1');
    expect(match.fighters[0].resource).toBe(15);
    until(match, (m) => m.fighters[1].hp < HP, 60);
    expect(match.fighters[1].hp).toBe(HP - 18);
  });

  it('energy regenerates at 10 a second up to 100', () => {
    const match = fighting(1.5, 1, [ROGUE, WARRIOR]);
    expect(match.fighters[0].resource).toBe(100);
    match.fighters[0].resource = 50;
    run(match, 60);
    expect(match.fighters[0].resource).toBeCloseTo(60, 5);
    run(match, 600);
    expect(match.fighters[0].resource).toBe(100);
  });
});

describe('cooldowns', () => {
  it('the global cooldown holds the next ability for 1.0 s', () => {
    const match = fighting(1.5, 1, [ROGUE, WARRIOR]);
    press(match, 0, 0, 'hit');
    expect(match.fighters[0].gcd).toBe(GCD_FRAMES);
    run(match, 40);
    const energy = match.fighters[0].resource;
    press(match, 0, 0, 'hit');
    expect(match.fighters[0].resource).toBeGreaterThan(energy); // not spent again
    run(match, GCD_FRAMES);
    expect(match.fighters[0].gcd).toBe(0);
    press(match, 0, 0, 'hit');
    expect(match.fighters[0].t).toBeLessThan(25);
    expect(match.fighters[0].resource).toBeLessThan(energy);
  });

  it('an ability on cooldown says NOT READY until it is back', () => {
    const match = fighting(1.5);
    match.fighters[0].resource = 100;
    press(match, 0, 1, 'hit');
    expect(match.fighters[0].cooldowns[1]).toBe(360);
    run(match, 200);
    press(match, 0, 1);
    expect(texts(match, 0)).toContain('info:NOT READY');
    run(match, 160);
    expect(match.fighters[0].cooldowns[1]).toBe(0);
    match.texts.length = 0;
    press(match, 0, 1, 'hit');
    expect(match.fighters[0].move).toBe('ability1');
  });

  it('an ability pressed during hitstop is kept and goes when the fighter is free', () => {
    const match = fighting(1.5, 1, [ROGUE, WARRIOR]);
    match.fighters[0].hitstop = 6;
    press(match, 0, 0, 'hit');
    expect(match.fighters[0].state).toBe('idle');
    expect(match.fighters[0].buffered).toBe(0);
    run(match, 6);
    expect(match.fighters[0].move).toBe('ability0');
    expect(match.fighters[0].buffered).toBe(-1);
  });

  it('Evasion skips the global cooldown', () => {
    const match = fighting(1.5, 1, [ROGUE, WARRIOR]);
    press(match, 0, 2);
    expect(match.fighters[0].gcd).toBe(0);
    expect(match.fighters[0].evasionT).toBe(480);
    press(match, 0, 0, 'hit');
    expect(match.fighters[0].move).toBe('ability0');
  });
});

describe('abilities', () => {
  it('Execute only works under 20 % health', () => {
    const match = fighting(1.5);
    match.fighters[0].resource = 100;
    press(match, 0, 2);
    expect(match.fighters[0].state).not.toBe('ability');
    expect(texts(match, 0)).toEqual(['info:NEEDS 20% HEALTH']);
    match.fighters[1].hp = 19;
    run(match, 1);
    press(match, 0, 2, 'hit');
    expect(match.fighters[0].move).toBe('ability2');
    expect(match.tables[0].kit.abilities[2].move.animation).toBe('CombatExecute');
    until(match, (m) => m.fighters[1].hp < 19, 60);
    expect(match.fighters[1].hp).toBe(0);
    expect(match.phase).toBe('finish');
  });

  it('Blade Dance hits behind as well', () => {
    const match = fighting(1.5, 1, [12, WARRIOR]);
    match.fighters[0].resource = 100;
    place(match, 1.5);
    match.fighters[0].facing = -1; // turned away for the test's one tick
    expect(match.tables[0].kit.abilities[2].both).toBe(true);
    press(match, 0, 2, 'hit');
    expect(match.fighters[0].move).toBe('ability2');
    until(match, (m) => m.fighters[1].hp < HP, 60);
    expect(match.fighters[1].hp).toBe(HP - 16);
  });

  it('Charge runs at a far target, lands a stun and earns rage', () => {
    const match = fighting(5);
    press(match, 0, 0);
    expect(match.fighters[0].state).toBe('dash');
    expect(match.fighters[0].move).toBe('cast0');
    const arrived = until(match, (m) => m.fighters[0].state !== 'dash', 90);
    expect(arrived).toBeGreaterThan(5);
    expect(Math.abs(match.fighters[1].x - match.fighters[0].x)).toBeLessThan(2.2);
    expect(match.fighters[0].move).toBe('ability0');
    expect(match.fighters[1].state).toBe('stun');
    expect(match.fighters[1].stunT).toBeGreaterThan(0);
    expect(match.fighters[0].resource).toBe(20);
    expect(texts(match, 1)).toContain('status:STUNNED');
  });

  it('Charge needs room: too close is refused', () => {
    const match = fighting(1.5);
    press(match, 0, 0);
    expect(match.fighters[0].state).not.toBe('dash');
    expect(texts(match, 0)).toEqual(['info:TOO CLOSE']);
  });

  it('a stun ends, and the stunned cannot act', () => {
    const match = fighting(1.5, 1, [ROGUE, WARRIOR]);
    press(match, 0, 1, 'hit'); // Kidney Shot
    until(match, (m) => m.fighters[1].state === 'stun', 60);
    expect(match.fighters[1].stunT).toBe(120);
    expect(match.fighters[1].move).toBe('dazed');
    run(match, 40); // the nudge settles
    const x = match.fighters[1].x;
    run(match, 30, [inputs(), inputs({ right: true, attack: true, ability: 1 })]);
    expect(match.fighters[1].x).toBeCloseTo(x, 2);
    expect(match.fighters[1].state).toBe('stun');
    run(match, 60);
    expect(match.fighters[1].stunT).toBe(0);
    expect(match.fighters[1].state).not.toBe('stun');
    // Free again: the queued swing goes first, then the walk.
    tick(match, [inputs(), inputs({ left: true })]);
    expect(match.fighters[1].state).toBe('attack');
    run(match, 70, [inputs(), inputs({ left: true })]);
    expect(match.fighters[1].state).toBe('walk');
  });

  it('a dot ticks every 3 s until its ticks are spent', () => {
    const match = fighting(4, 1, [PRIEST, WARRIOR]);
    press(match, 0, 1, 'hit'); // Shadow Word: Pain
    expect(match.fighters[1].dots.length).toBe(1);
    expect(match.fighters[1].hp).toBe(HP);
    run(match, DOT_TICK_FRAMES);
    expect(match.fighters[1].hp).toBe(HP - 5);
    expect(texts(match, 1)).toContain('dot:5');
    expect(match.sparks.some((s) => s.kind === 'dot')).toBe(true);
    run(match, DOT_TICK_FRAMES * 4);
    expect(match.fighters[1].hp).toBe(HP - 25);
    expect(match.fighters[1].dots.length).toBe(0);
    run(match, DOT_TICK_FRAMES);
    expect(match.fighters[1].hp).toBe(HP - 25);
  });

  it('a cast fills its bar, then the bolt flies and slows', () => {
    const match = fighting(4, 1, [MAGE, WARRIOR]);
    press(match, 0, 0); // Frostbolt, 1.5 s
    expect(match.fighters[0].state).toBe('cast');
    expect(match.fighters[0].cast).toMatchObject({ ability: 0, total: 90 });
    expect(match.fighters[0].resource).toBe(100);
    run(match, 89);
    expect(match.fighters[0].state).toBe('cast');
    rig(match, 'hit');
    run(match, 1);
    expect(match.fighters[0].state).toBe('ability');
    expect(match.fighters[0].cast).toBeUndefined();
    expect(match.fighters[0].resource).toBe(80);
    expect(until(match, (m) => m.projectiles.length > 0, 60)).toBeGreaterThan(0);
    expect(until(match, (m) => m.fighters[1].hp < HP, 120)).toBeGreaterThan(0);
    expect(match.fighters[1].hp).toBe(HP - 14);
    expect(match.fighters[1].slowT).toBeGreaterThan(0);
    expect(texts(match, 1)).toContain('status:SLOWED');
  });

  it('a bolt tells the visuals when it leaves the hand and where it lands', () => {
    const match = fighting(4, 1, [MAGE, WARRIOR]);
    press(match, 0, 0); // Frostbolt
    expect(match.spellEvents).toEqual([]);
    rig(match, 'hit');
    expect(until(match, (m) => m.projectiles.length > 0, 200)).toBeGreaterThan(0);
    expect(match.spellEvents.map((e) => `${e.owner}:${e.spell}:${e.kind}`)).toEqual(['0:frostbolt:release']);
    expect(until(match, (m) => m.fighters[1].hp < HP, 120)).toBeGreaterThan(0);
    const impact = match.spellEvents.find((e) => e.kind === 'impact');
    expect(impact).toMatchObject({ owner: 0, spell: 'frostbolt' });
    expect(Math.abs(impact!.x - match.fighters[1].x)).toBeLessThan(1);
    run(match, 90);
    expect(match.spellEvents).toEqual([]);
  });

  it('a damage-over-time spell lands as an impact though it deals nothing yet', () => {
    const match = fighting(4, 1, [PRIEST, WARRIOR]);
    press(match, 0, 1, 'hit'); // Shadow Word: Pain
    expect(match.spellEvents.map((e) => `${e.spell}:${e.kind}`)).toEqual(['shadowWordPain:release', 'shadowWordPain:impact']);
  });

  it('damage interrupts a cast', () => {
    const match = fighting(1.5, 1, [MAGE, WARRIOR]);
    press(match, 0, 0);
    expect(match.fighters[0].state).toBe('cast');
    rig(match, 'hit');
    tick(match, [inputs(), inputs({ attack: true })]);
    until(match, (m) => m.fighters[0].hp < HP, 60);
    expect(match.fighters[0].cast).toBeUndefined();
    expect(match.fighters[0].state).not.toBe('cast');
    run(match, 120);
    expect(match.projectiles.length).toBe(0);
    expect(match.fighters[0].resource).toBe(100);
  });

  it('moving cancels a cast', () => {
    const match = fighting(4, 1, [MAGE, WARRIOR]);
    press(match, 0, 0);
    run(match, 20);
    tick(match, [inputs({ left: true }), inputs()]);
    expect(match.fighters[0].cast).toBeUndefined();
    expect(match.fighters[0].state).toBe('back');
  });

  it('Earth Shock interrupts and locks the caster out', () => {
    const match = fighting(4, 1, [MAGE, SHAMAN]);
    press(match, 0, 0);
    expect(match.fighters[0].state).toBe('cast');
    press(match, 1, 1, 'hit');
    expect(match.fighters[0].cast).toBeUndefined();
    expect(match.fighters[0].lockoutT).toBe(120);
    expect(texts(match, 0)).toContain('status:INTERRUPTED');
    run(match, GCD_FRAMES);
    press(match, 0, 0);
    expect(texts(match, 0)).toContain('info:LOCKED OUT');
    expect(match.fighters[0].state).not.toBe('cast');
  });

  it('Holy Light heals the caster after its cast', () => {
    const match = fighting(4, 1, [PALADIN, WARRIOR]);
    match.fighters[0].hp = 50;
    press(match, 0, 2);
    run(match, 121);
    expect(match.fighters[0].hp).toBe(85);
    expect(texts(match, 0)).toContain('heal:+35');
    expect(match.fighters[0].resource).toBeCloseTo(70, 0);
  });

  it('Power Word: Shield absorbs before health is touched', () => {
    const match = fighting(1.5, 1, [PRIEST, WARRIOR]);
    press(match, 0, 2);
    expect(match.fighters[0].absorb).toBe(25);
    swing(match, 1, 'hit');
    expect(match.fighters[0].hp).toBe(HP);
    expect(match.fighters[0].absorb).toBe(17);
    expect(texts(match, 0)).toContain('absorb:ABSORB 8');
    expect(match.fighters[0].tookDamage).toBe(false);
  });

  it('Evasion turns a crit roll into a dodge', () => {
    const match = fighting(1.5, 1, [ROGUE, WARRIOR]);
    press(match, 0, 2);
    expect(texts(match, 0)).toEqual(['status:EVASION']);
    swing(match, 1, 'crit');
    expect(match.fighters[0].hp).toBe(HP);
    expect(texts(match, 0)).toContain('dodge:DODGE');
  });

  it('Blink puts the mage 3.5 away from the target', () => {
    const match = fighting(1.5, 1, [MAGE, WARRIOR]);
    const x = match.fighters[0].x;
    press(match, 0, 2);
    expect(match.fighters[0].x).toBeCloseTo(x - 3.5, 5);
    expect(match.fighters[0].resource).toBe(85);
  });

  it('Disengage leaps away', () => {
    const match = fighting(1.5, 1, [HUNTER, WARRIOR]);
    const x = match.fighters[0].x;
    press(match, 0, 1);
    expect(match.fighters[0].airborne).toBe(true);
    expect(match.fighters[0].gcd).toBe(0);
    until(match, (m) => !m.fighters[0].airborne, 120);
    expect(match.fighters[0].x).toBeLessThan(x - 2);
  });

  it('Fear sends the target running until a blow breaks it', () => {
    const match = fighting(3, 1, [WARLOCK, WARRIOR]);
    press(match, 0, 2);
    rig(match, 'hit');
    run(match, 61);
    expect(match.fighters[1].state).toBe('fear');
    expect(match.fighters[1].facing).toBe(1);
    const x = match.fighters[1].x;
    run(match, 30, [inputs(), inputs({ attack: true, left: true })]);
    expect(match.fighters[1].x).toBeGreaterThan(x + 0.5);
    expect(match.fighters[1].state).toBe('fear');
    press(match, 0, 1, 'hit'); // Corruption: no damage up front, the fear holds
    expect(match.fighters[1].state).toBe('fear');
    run(match, 20);
    expect(match.fighters[1].state).toBe('fear');
    // A blow breaks it.
    run(match, 12); // the warlock's Corruption animation lets go
    place(match, 1.5);
    rig(match, 'hit');
    tick(match, [inputs({ attack: true }), inputs()]);
    expect(until(match, (m) => m.fighters[1].hp < HP, 30)).toBeGreaterThan(0);
    expect(match.fighters[1].state).not.toBe('fear');
    expect(match.fighters[1].fearT).toBe(0);
  });

  it('a fear runs out on its own', () => {
    const match = fighting(3, 1, [WARLOCK, WARRIOR]);
    press(match, 0, 2);
    rig(match, 'hit');
    run(match, 61);
    expect(match.fighters[1].state).toBe('fear');
    run(match, 150);
    expect(match.fighters[1].state).not.toBe('fear');
  });

  it('a jumping target clears a bolt', () => {
    const match = fighting(4, 1, [MAGE, WARRIOR]);
    press(match, 0, 0);
    rig(match, 'hit');
    run(match, 90);
    until(match, (m) => m.projectiles.length > 0, 60);
    const p = match.projectiles[0]!;
    const framesToArrive = Math.round((match.fighters[1].x - p.x) / p.vx);
    run(match, framesToArrive - 16);
    tick(match, [inputs(), inputs({ jump: true })]);
    run(match, 40);
    expect(match.fighters[1].hp).toBe(HP);
  });
});

/** Drives P1 to a KO: P2 is left at `hp` and P1 lands a swing. */
function toFinish(gap = 1.5): Match {
  const match = fighting(gap);
  match.fighters[1].hp = 7;
  rig(match, 'hit');
  tick(match, [inputs({ attack: true }), inputs()]);
  const at = until(match, (m) => m.phase === 'finish', 60);
  expect(at).toBeGreaterThan(0);
  return match;
}

describe('the finish', () => {
  it('hp 0 dazes the loser and asks for the finish', () => {
    const match = toFinish();
    expect(match.fighters[1].hp).toBe(0);
    expect(match.fighters[1].state).toBe('dazed');
    expect(match.banner?.text).toBe(BRAND.finish);
    expect(match.roundWinner).toBe(0);
  });

  it('a landed ability is DISHONOR! and the winner plays the finisher in slow motion', () => {
    const match = toFinish();
    run(match, 60);
    place(match, 1.5);
    match.fighters[0].resource = 100;
    press(match, 0, 1);
    const at = until(match, (m) => m.phase === 'ko', 90);
    expect(at).toBeGreaterThan(0);
    expect(match.banner?.text).toBe(BRAND.fatality);
    expect(match.fighters[0].move).toBe('finisher');
    expect(match.fighters[0].state).toBe('finisher');
    expect(match.fighters[1].move).toBe('death');
    expect(match.slowmo).toBe(KO_SLOWMO.rate);
    expect(match.fighters[0].wins).toBe(1);
  });

  it('Execute is allowed on the dazed loser', () => {
    const match = toFinish();
    run(match, 60);
    place(match, 1.5);
    match.fighters[0].resource = 100;
    press(match, 0, 2);
    expect(match.fighters[0].move).toBe('ability2');
    expect(until(match, (m) => m.phase === 'ko', 90)).toBeGreaterThan(0);
    expect(match.banner?.text).toBe(BRAND.fatality);
  });

  it('a plain swing just drops them: K.O.', () => {
    const match = toFinish();
    run(match, 60);
    place(match, 1.5);
    tick(match, [inputs({ attack: true }), inputs()]);
    const at = until(match, (m) => m.phase === 'ko', 90);
    expect(at).toBeGreaterThan(0);
    expect(match.banner?.text).toBe(BRAND.ko);
    expect(match.fighters[0].move).not.toBe('finisher');
    expect(match.fighters[1].move).toBe('death');
  });

  it('times out to K.O.', () => {
    const match = toFinish();
    run(match, FINISH_FRAMES + 1);
    expect(match.phase).toBe('ko');
    expect(match.banner?.text).toBe(BRAND.ko);
    expect(match.fighters[1].move).toBe('death');
    expect(match.fighters[0].wins).toBe(1);
  });

  it('the dazed loser cannot act', () => {
    const match = toFinish();
    run(match, 60); // the pushback settles
    const x = match.fighters[1].x;
    run(match, 10, [inputs(), inputs({ left: true, attack: true, ability: 0 })]);
    expect(match.fighters[1].x).toBe(x);
    expect(match.fighters[1].state).toBe('dazed');
  });

  it('death holds on its last frame', () => {
    const match = toFinish();
    run(match, FINISH_FRAMES + 1);
    run(match, 150); // through the slow motion, before the next round resets them
    const loser = match.fighters[1];
    expect(loser.move).toBe('death');
    expect(loser.t).toBe(1000);
    expect(poseOf(match, 1).time).toBe(1000);
  });
});

describe('rounds', () => {
  function winRound(match: Match): void {
    match.fighters[1].hp = 7;
    place(match, 1.5);
    rig(match, 'hit');
    tick(match, [inputs({ attack: true }), inputs()]);
    expect(until(match, (m) => m.phase === 'finish', 60)).toBeGreaterThan(0);
    run(match, FINISH_FRAMES + 1);
    expect(match.phase).toBe('ko');
  }

  it('resets for round 2 with wins[0] === 1', () => {
    const match = fighting();
    winRound(match);
    run(match, KO_SLOWMO.frames);
    expect(match.phase).toBe('roundEnd');
    expect(match.slowmo).toBe(1);
    expect(match.fighters[0].move).toBe('win');
    expect(match.banner?.text).toBe(BRAND.roundWin('P1'));
    run(match, ROUND_END_FRAMES);
    expect(match.phase).toBe('intro');
    expect(match.round).toBe(2);
    expect(match.fighters[0].wins).toBe(1);
    expect(match.fighters[1].wins).toBe(0);
    expect(match.fighters[1].hp).toBe(HP);
    expect(match.fighters[0].resource).toBe(0);
    expect(match.fighters[0].x).toBe(-START_X);
    expect(match.fighters[1].x).toBe(START_X);
    expect(match.fighters[1].state).toBe('intro');
    expect(match.banner?.text).toBe(BRAND.round(2));
    expect(match.texts.length).toBe(0);
  });

  it('two KOs end the match', () => {
    const match = fighting();
    winRound(match);
    run(match, KO_SLOWMO.frames + ROUND_END_FRAMES);
    skipIntro(match);
    winRound(match);
    run(match, KO_SLOWMO.frames + ROUND_END_FRAMES);
    expect(match.phase).toBe('matchEnd');
    expect(match.winner).toBe(0);
    expect(match.fighters[0].wins).toBe(2);
    expect(match.banner?.text).toBe(BRAND.matchWin('P1'));
    run(match, 100);
    expect(match.phase).toBe('matchEnd');
  });

  it('the timer gives the round to the higher hp', () => {
    const match = fighting(1.5);
    swing(match, 0, 'hit');
    expect(match.fighters[1].hp).toBe(92);
    match.timer = 1;
    tick(match, NONE);
    expect(match.phase).toBe('ko');
    expect(match.roundWinner).toBe(0);
    expect(match.fighters[1].move).toBe('death');
    expect(match.fighters[0].wins).toBe(1);
  });

  it('a flawless round says HONOR RESTORED', () => {
    const match = fighting();
    winRound(match);
    run(match, KO_SLOWMO.frames);
    expect(match.banner?.sub).toBe(BRAND.flawless);
  });

  it('a round where the winner was hit does not', () => {
    const match = fighting(1.5);
    swing(match, 1, 'hit');
    expect(match.fighters[0].hp).toBe(92);
    run(match, 60); // P1 recovers from the hit
    winRound(match);
    run(match, KO_SLOWMO.frames);
    expect(match.banner?.text).toBe(BRAND.roundWin('P1'));
    expect(match.banner?.sub).toBeUndefined();
  });

  it('uses the names it was given', () => {
    const match = newMatch([fakeTable(), fakeTable()], 3, ['NIGHT ELF', 'ORC']);
    skipIntro(match);
    winRound(match);
    run(match, KO_SLOWMO.frames);
    expect(match.banner?.text).toBe(BRAND.roundWin('NIGHT ELF'));
  });
});

describe('determinism', () => {
  function scripted(frame: number): [Inputs, Inputs] {
    const a = inputs({
      right: frame % 7 < 4,
      left: frame % 11 === 0,
      attack: frame % 23 < 12,
      jump: frame % 53 === 0,
      abilities: [frame % 61 === 0, frame % 97 === 0, frame % 37 === 0],
    });
    const b = inputs({
      left: frame % 5 < 3,
      attack: frame % 19 < 15,
      jump: frame % 71 === 0,
      abilities: [frame % 47 === 0, frame % 89 === 0, frame % 41 === 0],
    });
    return [a, b];
  }

  it('the same seed and inputs give the same match after 2000 ticks', () => {
    const a = fakeMatch(42, [MAGE, WARRIOR]);
    const b = fakeMatch(42, [MAGE, WARRIOR]);
    for (let f = 0; f < 2000; f++) {
      tick(a, scripted(f));
      tick(b, scripted(f));
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Blood was drawn: a round was won, or someone is hurt.
    expect(a.round > 1 || a.fighters[0].hp + a.fighters[1].hp < 2 * HP).toBe(true);
  });
});

describe('the finish window', () => {
  it('a cast the winner had in flight does not land as the plain finisher', () => {
    const match = fighting(1.5, 1, [PRIEST, WARRIOR]);
    const [priest, warrior] = match.fighters;
    press(match, 0, 0); // Mind Blast, a 1 s cast
    expect(priest.cast).toBeDefined();
    run(match, 20);
    warrior.hp = 0; // a damage-over-time tick ends the round mid-cast
    tick(match, NONE);
    expect(match.phase).toBe('finish');
    expect(priest.cast).toBeUndefined();
    run(match, 90);
    expect(match.phase).toBe('finish');
    expect(warrior.state).toBe('dazed');
  });

  it('a swing the winner had started does not land either', () => {
    const match = fighting(1.0, 1);
    const [a, b] = match.fighters;
    tick(match, [inputs({ attack: true }), inputs()]);
    expect(a.state).toBe('attack');
    b.hp = 0;
    tick(match, NONE);
    expect(match.phase).toBe('finish');
    run(match, 90);
    expect(match.phase).toBe('finish');
  });
});
