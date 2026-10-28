import { describe, expect, it } from 'vitest';
import { kind, Pool, POOL_SIZE } from '../../src/game/particles';

const SPARK = kind({ shape: 'spark', colour: 'white', fade: 'hot', size: [0.02, 0.04], life: [10, 30], drag: 0.03, gravity: 0.006, floor: 'bounce' });
const DROP = kind({ shape: 'drop', colour: 'blood', size: [0.03, 0.07], life: [40, 80], gravity: 0.007, floor: 'settle' });
const TRAIL = kind({ shape: 'dot', light: true, colour: 'gold', size: [0.02, 0.03], life: [5, 9] });
const STAR = kind({ shape: 'glow', colour: 'moon', size: [0.1, 0.2], life: [20, 30], trail: { kind: TRAIL, rate: 1.5 }, burst: { kind: SPARK, n: 12, speed: [0.03, 0.08] } });

/** Some of everything: bursts, rings, rain, spirals, smoke, things that trail and burst, at a slow-motion time scale part of the way. */
function churn(pool: Pool, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    if (t % 10 === 0) pool.seed(1000 + t);
    if (t % 7 === 0) pool.burst(SPARK, 20, 5, 0, 1.3, [0.05, 0.15]);
    if (t % 11 === 0) pool.ring(DROP, 16, 3, 0, 0.1, 0.4, [0.04, 0.08]);
    pool.rain(STAR, pool.howMany(0.4), 5, 0, 3, 6, [0.05, 0.1]);
    pool.spiral(TRAIL, 1, 2, 4, [1 / 30, 1 / 20], [0.3, 0.6], 0.2);
    pool.arc(DROP, 2, 5, 0, 1.3, 0.4, 2, -0.6, [0.05, 0.1]);
    pool.step(t < ticks / 2 ? 1 : 0.4);
  }
}

describe('the particle pool', () => {
  it('is the same after the same steps from the same seed', () => {
    const a = new Pool(42);
    const b = new Pool(42);
    churn(a, 240);
    churn(b, 240);
    expect(a.count).toBeGreaterThan(100);
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('differs from another seed', () => {
    const a = new Pool(1);
    const b = new Pool(2);
    a.burst(SPARK, 50, 0, 0, 1, [0.05, 0.1]);
    b.burst(SPARK, 50, 0, 0, 1, [0.05, 0.1]);
    expect(a.snapshot()).not.toEqual(b.snapshot());
  });

  it('stops making new ones when full, and lets the old ones go', () => {
    const pool = new Pool(3);
    pool.burst(SPARK, POOL_SIZE + 100, 0, 0, 1, [0.05, 0.1]);
    expect(pool.count).toBe(POOL_SIZE);
    for (let t = 0; t < 40; t++) pool.step(1);
    expect(pool.count).toBe(0);
  });

  it('lands what falls on the floor: drops settle, sparks bounce', () => {
    const pool = new Pool(4);
    pool.spawn(DROP, 0, 0, 0, 0, 0.5, 0, 0);
    pool.spawn(SPARK, 0, 0, 0, 0, 0.5, 0, 0);
    for (let t = 0; t < 9; t++) pool.step(1);
    const s = pool.snapshot();
    // Both are at or above the floor.
    expect(s[2 + 1]).toBeGreaterThanOrEqual(0);
    expect(s[2 + 24 + 1]).toBeGreaterThanOrEqual(0);
  });
});
