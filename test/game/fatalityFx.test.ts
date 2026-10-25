import { describe, expect, it } from 'vitest';
import { type Inputs, type Match, tick } from '../../src/engine/engine';
import { ALL_FATALITIES, directionOf, fatalityFrames, isBlow, type SequenceToken } from '../../src/engine/fatalities';
import { KO_SLOWMO } from '../../src/engine/stage';
import { beatAt, FatalityFx, type Rig, stepScene } from '../../src/game/fatalityFx';
import { Pool } from '../../src/game/particles';
import { fakeMatch, inputs, place, rig, run, skipIntro, until, WARRIOR } from '../engine/fake';

const RIG: Rig = { chest: 1.3, top: 2.15, winnerChest: 1.3 };

describe('the fatalities\' particles', () => {
  for (const [, spec] of ALL_FATALITIES) {
    const total = fatalityFrames(spec);
    it(`${spec.name}: a replay from any tick matches a continuous run`, () => {
      const start = 4321;
      const continuous = new FatalityFx();
      const seen: number[][] = [];
      for (let T = 0; T <= total + KO_SLOWMO.frames; T++) {
        continuous.advance(spec, start, RIG, T);
        seen[T] = continuous.pool.snapshot();
      }
      const busiest = seen.reduce((n, s) => Math.max(n, s[1]!), 0);
      expect(busiest, spec.id).toBeGreaterThan(150);
      // Into the middle of each beat at once, as after a stall; back to its start, as after a rewind; and past the end.
      let T0 = 0;
      for (const beat of spec.beats) {
        for (const T of [T0, T0 + Math.floor(beat.frames / 2), T0 + beat.frames - 1]) {
          const jump = new FatalityFx();
          jump.advance(spec, start, RIG, T);
          expect(jump.pool.snapshot(), `${spec.id} at ${T}`).toEqual(seen[T]);
          const rewound = new FatalityFx();
          rewound.advance(spec, start, RIG, T + 37);
          rewound.advance(spec, start, RIG, T);
          expect(rewound.pool.snapshot(), `${spec.id} back to ${T}`).toEqual(seen[T]);
        }
        T0 += beat.frames;
      }
      const late = new FatalityFx();
      late.advance(spec, start, RIG, total + 40);
      expect(late.pool.snapshot()).toEqual(seen[total + 40]);
    });
  }

  it('throws something else for another fatality, and starts over for it', () => {
    const spec = ALL_FATALITIES.get(WARRIOR)!;
    const a = new FatalityFx();
    const b = new FatalityFx();
    a.advance(spec, 100, RIG, 60);
    b.advance(spec, 200, RIG, 60);
    expect(a.pool.snapshot()).not.toEqual(b.pool.snapshot());
    b.advance(spec, 100, RIG, 60);
    expect(b.pool.snapshot()).toEqual(a.pool.snapshot());
  });

  it('steps one beat at its own time scale, seeded from the beat', () => {
    const spec = ALL_FATALITIES.get(WARRIOR)!;
    const pool = new Pool();
    const fx = new FatalityFx();
    for (let T = 0; T < 90; T++) stepScene(pool, spec, 7, RIG, T);
    fx.advance(spec, 7, RIG, 90);
    expect(pool.snapshot()).toEqual(fx.pool.snapshot());
    expect(beatAt(spec, 45)).toEqual({ k: 1, t: 5 });
    expect(beatAt(spec, 10_000)).toBeUndefined();
  });
});

/** A match in the finish, `winner` 0 over the dazed other. */
function finish(classId: number): Match {
  const match = fakeMatch(3, [classId, WARRIOR]);
  skipIntro(match);
  place(match, 2.0);
  match.fighters[1].hp = 7;
  rig(match, 'hit');
  tick(match, [inputs({ attack: true }), inputs()]);
  until(match, (m) => m.phase === 'finish', 60);
  run(match, 30);
  return match;
}

function press(match: Match, token: SequenceToken): void {
  const key = directionOf(token, match.fighters[0].facing);
  const mine: Inputs = key ? inputs({ [key]: true }) : token === 'attack' ? inputs({ attack: true }) : inputs({ ability: Number(token.slice(7)) - 1 });
  tick(match, [mine, inputs()]);
  run(match, 4);
}

describe('the HUD\'s clock for the scene', () => {
  it('lands the blows where the engine does, and keeps the scene\'s first frame through the knockout', () => {
    for (const id of ALL_FATALITIES.keys()) {
      const match = finish(id);
      const spec = match.tables[0].fatality.spec;
      for (const token of spec.sequence) press(match, token);
      expect(match.phase, spec.id).toBe('fatality');
      const start = match.frame - match.fatality!.total;
      let hits = match.fatality!.hits;
      while (match.phase === 'fatality' || match.phase === 'ko') {
        const scene = match.fatality!;
        const T = match.phase === 'fatality' ? scene.total : scene.total + match.phaseT - 1;
        expect(match.frame - T, spec.id).toBe(start);
        if (match.phase === 'fatality') {
          const at = beatAt(spec, T)!;
          tick(match, [inputs(), inputs()]);
          expect(match.fatality!.hits - hits, `${spec.id} beat ${at.k} t ${at.t}`).toBe(isBlow(spec.beats[at.k]!, at.t) ? 1 : 0);
          hits = match.fatality!.hits;
        } else tick(match, [inputs(), inputs()]);
      }
    }
  });
});
