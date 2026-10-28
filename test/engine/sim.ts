import { cpuInputs } from '../../src/engine/cpu';
import { type Match, newMatch, tick } from '../../src/engine/engine';
import type { Wielding } from '../../src/engine/moves';
import { fakeTable, FULL_SET } from './fake';

/*
 * The computer against the computer, class against class, for the balance checks: every round a
 * fight to the end with both sides played by cpu.ts, the same seeds every run.
 */

/** Each class with the weapon it most often fights with. */
export const CLASSES: readonly { id: number; key: string; wielding: Wielding; shield: boolean }[] = [
  { id: 1, key: 'warrior', wielding: 'twoHand', shield: false },
  { id: 2, key: 'paladin', wielding: 'oneHand', shield: true },
  { id: 3, key: 'hunter', wielding: 'bow', shield: false },
  { id: 4, key: 'rogue', wielding: 'oneHand', shield: false },
  { id: 5, key: 'priest', wielding: 'long', shield: false },
  { id: 6, key: 'deathknight', wielding: 'twoHand', shield: false },
  { id: 7, key: 'shaman', wielding: 'oneHand', shield: true },
  { id: 8, key: 'mage', wielding: 'long', shield: false },
  { id: 9, key: 'warlock', wielding: 'long', shield: false },
  { id: 10, key: 'monk', wielding: 'oneHand', shield: false },
  { id: 11, key: 'druid', wielding: 'long', shield: false },
  { id: 12, key: 'demonhunter', wielding: 'oneHand', shield: false },
  { id: 13, key: 'evoker', wielding: 'oneHand', shield: false },
];

export interface RoundResult {
  /** 0 or 1, or undefined for a draw. */
  winner: 0 | 1 | undefined;
  /** Frames the round was fought. */
  frames: number;
  /** Damage each side dealt. */
  dealt: [number, number];
}

function matchOf(a: (typeof CLASSES)[number], b: (typeof CLASSES)[number], seed: number): Match {
  return newMatch([fakeTable(FULL_SET, a.wielding, {}, a.id, a.shield, false), fakeTable(FULL_SET, b.wielding, {}, b.id, b.shield, false)], seed);
}

/** One round, both sides the computer, until it is decided or the clock runs out. */
export function fightRound(a: (typeof CLASSES)[number], b: (typeof CLASSES)[number], seed: number): RoundResult {
  const match = matchOf(a, b, seed);
  const dealt: [number, number] = [0, 0];
  let frames = 0;
  for (let n = 0; n < 4200; n++) {
    const before = [match.fighters[0].hp, match.fighters[1].hp];
    tick(match, [cpuInputs(match, 0), cpuInputs(match, 1)]);
    if (match.phase === 'fight') frames++;
    // Heals put health back; only what came off counts.
    dealt[0] += Math.max(0, before[1]! - match.fighters[1].hp);
    dealt[1] += Math.max(0, before[0]! - match.fighters[0].hp);
    if (match.phase === 'finish' || match.phase === 'ko' || match.phase === 'roundEnd') break;
  }
  const [p, q] = match.fighters;
  const winner = match.roundWinner ?? (p.hp > q.hp ? 0 : q.hp > p.hp ? 1 : undefined);
  return { winner, frames, dealt };
}

export interface Standing {
  key: string;
  wins: number;
  rounds: number;
  /** Damage dealt per second of fighting, over every round. */
  dps: number;
  /** How long its rounds last, on average, in seconds. */
  seconds: number;
  /** Each opponent's key and this class's win share against it. */
  against: Record<string, number>;
}

/** Every class against every other, from both sides, `seeds` rounds each way. */
export function standings(seeds: number, only: readonly string[] = CLASSES.map((c) => c.key)): Standing[] {
  const picked = CLASSES.filter((c) => only.includes(c.key));
  const table = new Map(picked.map((c) => [c.key, { key: c.key, wins: 0, rounds: 0, dealt: 0, frames: 0, against: {} as Record<string, [number, number]> }]));
  for (const a of picked) {
    for (const b of picked) {
      if (a === b) continue;
      for (let s = 0; s < seeds; s++) {
        const r = fightRound(a, b, 1000 + s * 7919 + a.id * 131 + b.id);
        const ra = table.get(a.key)!;
        const rb = table.get(b.key)!;
        ra.rounds++;
        rb.rounds++;
        ra.frames += r.frames;
        rb.frames += r.frames;
        ra.dealt += r.dealt[0];
        rb.dealt += r.dealt[1];
        const va = (ra.against[b.key] ??= [0, 0]);
        const vb = (rb.against[a.key] ??= [0, 0]);
        va[1]++;
        vb[1]++;
        // A draw is half a win each.
        const share = r.winner === 0 ? 1 : r.winner === 1 ? 0 : 0.5;
        ra.wins += share;
        rb.wins += 1 - share;
        va[0] += share;
        vb[0] += 1 - share;
      }
    }
  }
  return [...table.values()].map((r) => ({
    key: r.key,
    wins: r.wins,
    rounds: r.rounds,
    dps: r.dealt / (r.frames / 60),
    seconds: r.frames / 60 / r.rounds,
    against: Object.fromEntries(Object.entries(r.against).map(([k, [w, n]]) => [k, w / n])),
  }));
}

/** The standings as a text table: overall win share and damage per second, then the matchups. */
export function report(rows: readonly Standing[]): string {
  const keys = rows.map((r) => r.key);
  const short = (k: string) => k.slice(0, 5).padStart(6);
  const lines = [`${'class'.padEnd(12)} win%   dps  secs ${keys.map(short).join('')}`];
  for (const r of [...rows].sort((x, y) => y.wins / y.rounds - x.wins / x.rounds)) {
    const cells = keys.map((k) => (k === r.key ? '     -' : `${Math.round((r.against[k] ?? 0) * 100)}`.padStart(6))).join('');
    lines.push(`${r.key.padEnd(12)} ${`${Math.round((r.wins / r.rounds) * 100)}`.padStart(4)} ${r.dps.toFixed(1).padStart(5)} ${r.seconds.toFixed(0).padStart(5)} ${cells}`);
  }
  return lines.join('\n');
}
