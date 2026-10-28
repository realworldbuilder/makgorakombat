import { describe, expect, it } from 'vitest';
import { BRAND } from '../../src/engine/brand';
import { cpuInputs } from '../../src/engine/cpu';
import { type Inputs, type Match, moveOf, poseOf, tick } from '../../src/engine/engine';
import { ALL_FATALITIES, type Beat, clipTime, directionOf, fatalityFor, fatalityFrames, impactFrame, PENALTY_FRAMES, type SequenceToken, STEP_FRAMES } from '../../src/engine/fatalities';
import { ALL_MOVE_NAMES } from '../../src/engine/moves';
import { FINISH_FRAMES, KO_SLOWMO, TICK_MS } from '../../src/engine/stage';
import { fakeMatch, fakeTable, FULL_SET, inputs, MAGE, place, rig, run, SHAMAN, skipIntro, until, WARLOCK, WARRIOR } from './fake';

/** A match in the finish with `winner` standing over the dazed other, `gap` apart. */
function finish(winner: 0 | 1 = 0, classes: [number, number] = [WARRIOR, WARRIOR], seed = 1, gap = 1.5): Match {
  const match = fakeMatch(seed, classes);
  skipIntro(match);
  place(match, gap);
  const loser = winner === 0 ? 1 : 0;
  match.fighters[loser].hp = 7;
  rig(match, 'hit');
  const both: [Inputs, Inputs] = [inputs(), inputs()];
  both[winner] = inputs({ attack: true });
  tick(match, both);
  expect(until(match, (m) => m.phase === 'finish', 60)).toBeGreaterThan(0);
  run(match, 30); // the pushback settles
  return match;
}

/** The inputs that press one token for `who`. */
function keyOf(match: Match, who: 0 | 1, token: SequenceToken): Inputs {
  const key = directionOf(token, match.fighters[who].facing);
  if (key) return inputs({ [key]: true });
  if (token === 'attack') return inputs({ attack: true });
  return inputs({ ability: Number(token.slice(7)) - 1 });
}

/** Presses one token for one tick, then lets go for `rest` ticks. */
function press(match: Match, who: 0 | 1, token: SequenceToken, rest = 4): void {
  const both: [Inputs, Inputs] = [inputs(), inputs()];
  both[who] = keyOf(match, who, token);
  tick(match, both);
  run(match, rest);
}

function enter(match: Match, who: 0 | 1, tokens: readonly SequenceToken[], rest = 4): void {
  for (const token of tokens) press(match, who, token, rest);
}

const WARRIOR_SEQUENCE = fatalityFor(WARRIOR, 'oneHand').sequence;

describe('every class has a fatality', () => {
  it('named in its own voice, three to five keys long, opening with a direction', () => {
    expect(ALL_FATALITIES.size).toBe(13);
    for (const [id, f] of ALL_FATALITIES) {
      expect(f.name.length, f.id).toBeGreaterThan(3);
      expect(f.sequence.length, f.id).toBeGreaterThanOrEqual(3);
      expect(f.sequence.length, f.id).toBeLessThanOrEqual(5);
      expect(['back', 'forward'], f.id).toContain(f.sequence[0]);
      expect(f.sequence.some((t) => t === 'attack' || t.startsWith('ability')), f.id).toBe(true);
      expect(f.beats.length, f.id).toBeGreaterThanOrEqual(3);
      expect(f.beats.at(-1)?.loser?.state, f.id).toBe('death');
      expect(fatalityFrames(f), f.id).toBeLessThanOrEqual(FINISH_FRAMES + 60);
      expect(id).toBeGreaterThan(0);
    }
  });

  it('resolves every beat on a fake table, with idle standing in for a missing animation', () => {
    for (const id of ALL_FATALITIES.keys()) {
      const table = fakeTable(FULL_SET, 'oneHand', {}, id);
      expect(table.fatality.spec.id).toBe(ALL_FATALITIES.get(id)!.id);
      table.fatality.winner.forEach((move, k) => {
        expect(move.variations.length, `${table.fatality.spec.id} beat ${k}`).toBeGreaterThan(0);
        expect(move.variations[0]!.duration).toBeGreaterThan(0);
      });
      for (const f of ALL_FATALITIES.values()) {
        table.fatality.victim[f.id]!.forEach((move, k) => {
          if (f.beats[k]!.loser) expect(move?.variations.length, `${f.id} victim ${k}`).toBeGreaterThan(0);
          else expect(move).toBeUndefined();
        });
      }
    }
    const warrior = fakeTable(FULL_SET, 'oneHand', {}, WARRIOR).fatality;
    expect(warrior.winner[1]!.animation).toBe('CombatWhirlwind');
    expect(warrior.winner[3]!.animation).toBe('CombatExecute');
    expect(warrior.victim.warrior![3]!.animation).toBe('Death');
    expect(warrior.winner[0]!.animation).toBe('CombatChargeLoop');
  });

  it('asks the worker for every animation a fatality may use', () => {
    for (const f of ALL_FATALITIES.values()) {
      for (const beat of f.beats) {
        for (const name of beat.winner) expect(ALL_MOVE_NAMES, name).toContain(name);
        for (const name of beat.loser?.anims ?? []) expect(ALL_MOVE_NAMES, name).toContain(name);
      }
    }
  });

  it('a legend without a class plays the warrior one, or the hunter one behind a bow', () => {
    expect(fatalityFor(undefined, 'twoHand').id).toBe('warrior');
    expect(fatalityFor(undefined, 'bow').id).toBe('hunter');
  });
});

describe('the sequence', () => {
  it('opens with the finish and lights each key in order', () => {
    const match = finish();
    expect(match.sequence).toBeDefined();
    expect(match.sequence!.progress).toBe(0);
    press(match, 0, WARRIOR_SEQUENCE[0]!);
    expect(match.sequence!.progress).toBe(1);
    expect(match.sequence!.windowT).toBe(STEP_FRAMES - 4);
    press(match, 0, WARRIOR_SEQUENCE[1]!);
    press(match, 0, WARRIOR_SEQUENCE[2]!);
    expect(match.sequence!.progress).toBe(3);
    expect(match.phase).toBe('finish');
    press(match, 0, WARRIOR_SEQUENCE[3]!);
    expect(match.phase).toBe('fatality');
    expect(match.sequence).toBeUndefined();
    expect(match.banner).toBeUndefined();
  });

  it('a key held through the knockdown is not a press, and a direction before the first key is just walking', () => {
    const match = fakeMatch(1);
    skipIntro(match);
    place(match, 1.5);
    match.fighters[1].hp = 7;
    rig(match, 'hit');
    // The attack key stays held into the finish.
    run(match, 1, [inputs({ attack: true }), inputs()]);
    expect(until(match, (m) => m.phase === 'finish', 60, [inputs({ attack: true }), inputs()])).toBeGreaterThan(0);
    run(match, 5, [inputs({ attack: true }), inputs()]);
    expect(match.sequence!.fails).toBe(0);
    expect(match.phase).toBe('finish');
    // Walking forward (the sequence starts with back) costs nothing.
    run(match, 10, [inputs({ right: true }), inputs()]);
    expect(match.sequence!.fails).toBe(0);
    expect(match.sequence!.penaltyT).toBe(0);
  });

  it('a wrong key starts over with a half-second penalty, and the keys are dead meanwhile', () => {
    const match = finish();
    press(match, 0, WARRIOR_SEQUENCE[0]!);
    press(match, 0, WARRIOR_SEQUENCE[1]!);
    expect(match.sequence!.progress).toBe(2);
    press(match, 0, 'ability3', 0);
    expect(match.sequence!.progress).toBe(0);
    expect(match.sequence!.fails).toBe(1);
    expect(match.sequence!.penaltyT).toBe(PENALTY_FRAMES);
    // The right first key during the penalty does nothing.
    press(match, 0, WARRIOR_SEQUENCE[0]!, 0);
    expect(match.sequence!.progress).toBe(0);
    run(match, PENALTY_FRAMES);
    expect(match.sequence!.penaltyT).toBe(0);
    enter(match, 0, WARRIOR_SEQUENCE);
    expect(match.phase).toBe('fatality');
  });

  it('a step later than the window starts over', () => {
    const match = finish();
    press(match, 0, WARRIOR_SEQUENCE[0]!);
    run(match, STEP_FRAMES);
    expect(match.sequence!.progress).toBe(0);
    expect(match.sequence!.fails).toBe(0);
  });

  it('takes a matched ability key, so it fires nothing; a wrong one fires as before', () => {
    const match = finish();
    match.fighters[0].resource = 100;
    // The warrior's last key is Mortal Strike; pressed first it is wrong, and lands the plain finisher.
    press(match, 0, 'ability2', 0);
    expect(match.fighters[0].move).toBe('ability1');
    expect(until(match, (m) => m.phase === 'ko', 90)).toBeGreaterThan(0);
    expect(match.banner?.text).toBe(BRAND.fatality);
    expect(match.banner?.sub).toBeUndefined();
    expect(match.fighters[0].move).toBe('finisher');

    const second = finish();
    second.fighters[0].resource = 100;
    enter(second, 0, WARRIOR_SEQUENCE.slice(0, 3));
    press(second, 0, 'ability2', 0);
    expect(second.phase).toBe('fatality');
    expect(second.fighters[0].move).toBe('fatality0');
  });

  it('a taken attack key swings nothing while held', () => {
    const match = fakeMatch(1, [2, WARRIOR]); // the paladin's sequence ends on the attack key
    skipIntro(match);
    place(match, 1.5);
    match.fighters[1].hp = 7;
    rig(match, 'hit');
    tick(match, [inputs({ attack: true }), inputs()]);
    expect(until(match, (m) => m.phase === 'finish', 60)).toBeGreaterThan(0);
    run(match, 30);
    const sequence = fatalityFor(2, 'oneHand').sequence;
    enter(match, 0, sequence.slice(0, -1));
    expect(sequence.at(-1)).toBe('attack');
    match.fighters[0].swingT = 0;
    run(match, 3, [inputs({ attack: true }), inputs()]);
    expect(match.phase).toBe('fatality');
    expect(match.fighters[0].state).toBe('finisher');
  });

  it('times out to K.O. without the sequence', () => {
    const match = finish();
    run(match, FINISH_FRAMES + 1);
    expect(match.phase).toBe('ko');
    expect(match.banner?.text).toBe(BRAND.ko);
    expect(match.fatality).toBeUndefined();
  });

  it('reads player 2 by their own facing', () => {
    const match = finish(1);
    expect(match.fighters[1].facing).toBe(-1);
    expect(directionOf('back', -1)).toBe('right');
    enter(match, 1, WARRIOR_SEQUENCE);
    expect(match.phase).toBe('fatality');
    expect(match.roundWinner).toBe(1);
  });
});

describe('the beats’ clips', () => {
  const blow: Beat = { frames: 100, winner: [], impact: 'crit', impactAt: 0.21, slowmo: 0.4 };
  const hit = impactFrame(blow);

  it('reaches its blow on the impact tick and its end with the beat, whatever its length', () => {
    expect(hit).toBe(21);
    for (const duration of [500, 866, 2000]) {
      expect(clipTime(blow, hit, duration, 0.4, 0.4)).toBeCloseTo(0.4 * duration, 6);
      expect(clipTime(blow, blow.frames, duration, 0.4, 0.4)).toBeCloseTo(duration, 6);
      let last = 0;
      for (let t = 1; t <= blow.frames; t++) {
        const time = clipTime(blow, t, duration, 0.4, 0.4);
        expect(time).toBeGreaterThanOrEqual(last);
        last = time;
      }
    }
    // The execute's blade comes down at 40%: the wind-up runs at its own pace and the follow-through at the beat's slow motion.
    expect(clipTime(blow, hit, 866, 0.4, 0.4) - clipTime(blow, hit - 1, 866, 0.4, 0.4)).toBeCloseTo(TICK_MS, 0);
    expect(clipTime(blow, hit + 1, 866, 0.4, 0.4) - clipTime(blow, hit, 866, 0.4, 0.4)).toBeCloseTo((0.6 * 866) / (blow.frames - hit), 6);
  });

  it('a wind-up shorter than the lead starts late at half pace rather than crawling', () => {
    expect(clipTime(blow, 16, 400, 0.1, 0.4)).toBe(0);
    expect(clipTime(blow, 17, 400, 0.1, 0.4)).toBeGreaterThan(0);
    expect(clipTime(blow, hit, 400, 0.1, 0.4) - clipTime(blow, hit - 1, 400, 0.1, 0.4)).toBeCloseTo(TICK_MS / 2, 6);
    expect(clipTime(blow, hit, 400, 0.1, 0.4)).toBeCloseTo(40, 6);
  });

  it('a clip with no blow fills the beat within reason; a looping one goes round at its own pace, or once per repeat when the beat cycles', () => {
    const plain: Beat = { frames: 50, winner: [] };
    expect(clipTime(plain, 25, 1000, 0.5, 1)).toBeCloseTo(500, 6);
    expect(clipTime(plain, 50, 1000, 0.5, 1)).toBeCloseTo(1000, 6);
    expect(clipTime(plain, 50, 5000, 0.5, 1)).toBeCloseTo(2.5 * TICK_MS * 50, 6);
    const loop: Beat = { frames: 80, winner: [], loop: true, impact: 'hit', repeat: 16, slowmo: 0.7 };
    expect(clipTime(loop, 10, 1000, 0.5, 0.7)).toBeCloseTo(10 * TICK_MS * 0.7, 6);
    expect(clipTime({ ...loop, cycle: true }, 8, 1000, 0.5, 0.7)).toBeCloseTo(500, 6);
    expect(clipTime({ ...loop, cycle: true }, 16, 1000, 0.5, 0.7)).toBeCloseTo(0, 6);
  });

  it('in the fight the dazed loser sways on through a beat that leaves them be, and a cower goes round', () => {
    const match = finish();
    enter(match, 0, WARRIOR_SEQUENCE.slice(0, -1));
    press(match, 0, WARRIOR_SEQUENCE.at(-1)!, 0);
    // The charge: nothing is done to the loser yet, who once froze mid-sway here.
    run(match, 3);
    const a = poseOf(match, 1).time;
    run(match, 3);
    expect(poseOf(match, 1).time).toBeGreaterThan(a);

    const lock = finish(0, [WARLOCK, WARRIOR]);
    const spec = lock.tables[0].fatality.spec;
    enter(lock, 0, spec.sequence.slice(0, -1));
    press(lock, 0, spec.sequence.at(-1)!, 0);
    expect(spec.beats[0]!.loser?.loop).toBe(true);
    run(lock, spec.beats[0]!.frames + spec.beats[1]!.frames);
    // Longer than the cower's clip by now, so it has come round rather than held its last frame.
    const time = poseOf(lock, 1).time;
    expect(time).toBeGreaterThan(0);
    expect(time).toBeLessThan(1000);
  });

  it('each blow of a volley jolts the flinch afresh; a cowering loser is left to cower', () => {
    const match = finish();
    enter(match, 0, WARRIOR_SEQUENCE.slice(0, -1));
    press(match, 0, WARRIOR_SEQUENCE.at(-1)!, 0);
    const beats = match.tables[0].fatality.spec.beats;
    const spin = beats[1]!;
    run(match, beats[0]!.frames + impactFrame(spin) + spin.repeat!);
    expect(match.fatality!.hits).toBe(1);
    expect(match.fighters[1].t).toBeGreaterThan(0);
    run(match, 1);
    expect(match.fatality!.hits).toBe(2);
    expect(match.fighters[1].state).toBe('hit');
    expect(match.fighters[1].t).toBe(0);

    const lock = finish(0, [WARLOCK, WARRIOR]);
    const spec = lock.tables[0].fatality.spec;
    enter(lock, 0, spec.sequence.slice(0, -1));
    press(lock, 0, spec.sequence.at(-1)!, 0);
    const drain = spec.beats[1]!;
    run(lock, spec.beats[0]!.frames + impactFrame(drain) + drain.repeat! + 1);
    expect(lock.fatality!.hits).toBe(2);
    expect(lock.fighters[1].state).toBe('dazed');
    expect(lock.fighters[1].t).toBeGreaterThan(0);
  });
});

describe('the fatality', () => {
  it('plays its beats off the tick clock and ends in death under DISHONOR! with its name', () => {
    const match = finish();
    enter(match, 0, WARRIOR_SEQUENCE.slice(0, -1));
    press(match, 0, WARRIOR_SEQUENCE.at(-1)!, 0);
    const spec = match.tables[0].fatality.spec;
    expect(match.phase).toBe('fatality');
    expect(match.fighters[0].state).toBe('finisher');
    expect(match.fighters[0].move).toBe('fatality0');
    expect(match.fatality).toMatchObject({ beat: 0, t: 0 });
    // Each beat lasts its frames.
    let elapsed = 0;
    spec.beats.forEach((beat, k) => {
      expect(match.fatality!.beat).toBe(k);
      expect(match.fighters[0].move).toBe(`fatality${k}`);
      expect(match.slowmo).toBe(beat.slowmo ?? 1);
      run(match, beat.frames);
      elapsed += beat.frames;
    });
    expect(match.phase).toBe('ko');
    expect(elapsed).toBe(fatalityFrames(spec));
    expect(match.banner?.text).toBe(BRAND.fatality);
    expect(match.banner?.sub).toBe('BLADESTORM');
    expect(match.fighters[1].state).toBe('death');
    expect(match.fighters[1].move).toBe('victim3');
    expect(match.fighters[1].hp).toBe(0);
    expect(match.fighters[0].wins).toBe(1);
    expect(match.slowmo).toBe(KO_SLOWMO.rate);
    expect(match.fatality!.hits).toBeGreaterThan(2);
    // The dead hold their last frame, the winner too, through the slow motion and into the celebration.
    run(match, KO_SLOWMO.frames);
    expect(match.phase).toBe('roundEnd');
    expect(match.fighters[1].state).toBe('death');
    expect(match.fighters[0].state).toBe('win');
    run(match, 40); // the death, slowed, finishes in the celebration and holds
    expect(match.fighters[1].move).toBe('victim3');
    expect(poseOf(match, 1).time).toBe(1000);
    expect(match.fatality).toBeDefined();
  });

  it('closes the distance with its dash, and the loser is dropped where the blow lands', () => {
    const match = finish();
    match.fighters[0].x = match.fighters[1].x - 4.2;
    enter(match, 0, WARRIOR_SEQUENCE.slice(0, -1));
    press(match, 0, WARRIOR_SEQUENCE.at(-1)!, 0);
    expect(Math.abs(match.fighters[1].x - match.fighters[0].x)).toBeGreaterThan(4);
    // Half way through the charge, half way there: the run covers the ground over the whole beat.
    run(match, 20);
    expect(Math.abs(match.fighters[1].x - match.fighters[0].x)).toBeCloseTo((4.2 + 1.25) / 2, 1);
    run(match, 20);
    expect(Math.abs(match.fighters[1].x - match.fighters[0].x)).toBeLessThan(1.4);
    expect(match.fighters[1].state).toBe('dazed');
    run(match, 20);
    expect(match.fighters[1].state).toBe('hit');
    expect(match.sparks.length).toBeGreaterThan(0);
  });

  it('the rogue steps behind the target, who keeps facing the other way', () => {
    const match = finish(0, [4, WARRIOR]);
    const facing = match.fighters[1].facing;
    enter(match, 0, fatalityFor(4, 'oneHand').sequence);
    run(match, 2);
    expect(match.fighters[0].x).toBeGreaterThan(match.fighters[1].x);
    expect(match.fighters[0].facing).toBe(-1);
    expect(match.fighters[1].facing).toBe(facing);
  });

  it('every class ends the same way: death, DISHONOR!, the fatality named', () => {
    for (const id of ALL_FATALITIES.keys()) {
      const match = finish(0, [id, WARRIOR], 3, 2.0);
      const spec = match.tables[0].fatality.spec;
      enter(match, 0, spec.sequence);
      expect(match.phase, spec.id).toBe('fatality');
      run(match, fatalityFrames(spec) + 1);
      expect(match.phase, spec.id).toBe('ko');
      expect(match.banner?.sub, spec.id).toBe(spec.name.toUpperCase());
      expect(match.fighters[1].state, spec.id).toBe('death');
      expect(match.fighters[0].state, spec.id).toBe('finisher');
      expect(match.fatality!.hits, spec.id).toBeGreaterThan(0);
      expect(Math.abs(match.fighters[0].x), spec.id).toBeLessThanOrEqual(5);
      expect(match.fighters[0].z, spec.id).toBe(0);
    }
  });

  it('the loser of another class plays the winner\'s fatality and stays dead through the round\'s end', () => {
    // A druid's own fatality has three beats; a warrior's death blow is the fourth. The loser's
    // part once came from their own class's fatality, so the druid stood up idle and cried again every second.
    for (const winner of ALL_FATALITIES.keys()) {
      for (const loser of ALL_FATALITIES.keys()) {
        const match = finish(0, [winner, loser], 3, 2.0);
        const spec = match.tables[0].fatality.spec;
        const label = `${spec.id} on ${match.tables[1].fatality.spec.id}`;
        enter(match, 0, spec.sequence);
        run(match, fatalityFrames(spec) + KO_SLOWMO.frames + 1);
        expect(match.phase, label).toBe('roundEnd');
        const l = match.fighters[1];
        expect(l.state, label).toBe('death');
        expect(moveOf(match, 1, l.move).animation, label).toBe('Death');
        // The fall plays on to its last frame and never starts over.
        let time = poseOf(match, 1).time;
        for (let n = 0; n < 150; n++) {
          tick(match, [inputs(), inputs()]);
          expect(poseOf(match, 1).time, label).toBeGreaterThanOrEqual(time);
          time = poseOf(match, 1).time;
        }
        expect(time, label).toBe(moveOf(match, 1, l.move).variations[0]!.duration);
      }
    }
  });

  it('resets with the round', () => {
    const match = finish();
    enter(match, 0, WARRIOR_SEQUENCE);
    run(match, fatalityFrames(match.tables[0].fatality.spec) + KO_SLOWMO.frames + 180 + 2);
    expect(match.phase).toBe('intro');
    expect(match.fatality).toBeUndefined();
    expect(match.sequence).toBeUndefined();
    expect(match.round).toBe(2);
  });

  it('the same keys give the same scene', () => {
    const a = finish(0, [SHAMAN, MAGE], 9);
    const b = finish(0, [SHAMAN, MAGE], 9);
    const sequence = a.tables[0].fatality.spec.sequence;
    enter(a, 0, sequence, 7);
    enter(b, 0, sequence, 7);
    run(a, 400);
    run(b, 400);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.phase).toBe('roundEnd');
  });
});

describe('the CPU', () => {
  function cpuFinish(seed: number, classes: [number, number] = [WARRIOR, WARRIOR]): Match {
    const match = fakeMatch(seed, classes);
    skipIntro(match);
    place(match, 1.5);
    match.fighters[0].hp = 7;
    rig(match, 'hit');
    tick(match, [inputs(), inputs({ attack: true })]);
    expect(until(match, (m) => m.phase === 'finish', 60)).toBeGreaterThan(0);
    return match;
  }

  it('enters its sequence and performs the fatality from a seed', () => {
    const match = cpuFinish(3);
    let frames = 0;
    while (frames < FINISH_FRAMES && match.phase === 'finish') {
      tick(match, [inputs(), cpuInputs(match, 1)]);
      frames++;
    }
    expect(match.phase).toBe('fatality');
    expect(match.fighters[1].state).toBe('finisher');
    run(match, 400);
    expect(match.phase).toBe('roundEnd');
    expect(match.banner?.text).toBe(BRAND.roundWin('P2'));
  });

  it('gets there from every seed, fumbling once now and then', () => {
    let fumbles = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const match = cpuFinish(seed, [MAGE, seed % 2 ? SHAMAN : 4]);
      // The rigged finishing blow left every match on the same dice; roll them apart, hashed so the
      // seeds land all over the range rather than in a row a constant step apart.
      let x = (match.rng ^ Math.imul(seed, 2654435761)) >>> 0;
      x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
      match.rng = (x ^ (x >>> 16)) >>> 0;
      let fails = 0;
      while (match.phase === 'finish') {
        tick(match, [inputs(), cpuInputs(match, 1)]);
        fails = Math.max(fails, match.sequence?.fails ?? 0);
      }
      expect(match.phase, `seed ${seed}`).toBe('fatality');
      expect(fails, `seed ${seed}`).toBeLessThanOrEqual(1);
      fumbles += fails;
    }
    expect(fumbles).toBeGreaterThan(0);
    expect(fumbles).toBeLessThan(16);
  });
});
