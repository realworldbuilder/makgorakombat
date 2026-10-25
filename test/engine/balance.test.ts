import { describe, expect, it } from 'vitest';
import { report, standings } from './sim';

/*
 * Parity: every class against every other, the computer playing both sides. The kits differ (a
 * mage's slow bolts, a rogue's quick strikes, a priest's damage over time) but over many rounds
 * none should win much more than half. BALANCE=1 pnpm test prints the whole table with more rounds.
 */

const FULL = process.env.BALANCE === '1';

describe('class balance', () => {
  const rows = standings(FULL ? 24 : 4);
  // Straight to the terminal: vitest keeps a passing test's console to itself.
  if (FULL) process.stderr.write(`\n${report(rows)}\n\n`);

  it('no class wins more than 62 % or fewer than 38 % of its rounds', () => {
    for (const r of rows) {
      const share = r.wins / r.rounds;
      expect.soft(share, r.key).toBeGreaterThan(0.38);
      expect.soft(share, r.key).toBeLessThan(0.62);
    }
  });
});
