import { describe, expect, it } from 'vitest';
import { resultOf } from '../../src/game/net/handshake';
import { type BoardRow, recordText, type Standings, topTen } from '../../src/game/net/lobby';

const row = (rank: number, me = false): BoardRow => ({ rank, name: `P${rank}`, wins: 30 - rank, losses: rank, best: 1, streak: 0, ...(me ? { me } : {}) });
const standings = (rows: BoardRow[], mine?: BoardRow): Standings => ({ span: 'night', night: '2026-10-24', rows, ...(mine ? { mine } : {}) });

describe('the board, on the page', () => {
  it('shows ten, and the player\'s own row under them when it is not among them', () => {
    const twenty = Array.from({ length: 20 }, (_, k) => row(k + 1, k === 14));
    const out = topTen(standings(twenty, twenty[14]));
    expect(out.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(out.pinned).toEqual(twenty[14]);
    // Further down than the twenty the relay sends: the row it gives alone.
    expect(topTen(standings(twenty.slice(0, 10), { ...row(31), me: true })).pinned?.rank).toBe(31);
    // In the ten, or with no record at all: nothing pinned.
    const third = [row(1), row(2), row(3, true)];
    expect(topTen(standings(third, third[2])).pinned).toBe(undefined);
    expect(topTen(standings(third.slice(0, 2))).pinned).toBe(undefined);
    expect(recordText([3, 1])).toBe('3-1');
  });

  it('reports a match only once it is over, host as player 1, on the tick it ended', () => {
    const fighting = { phase: 'fight', winner: undefined, round: 2, frame: 4000, phaseT: 30 };
    expect(resultOf(fighting, 1)).toBe(undefined);
    const over = { phase: 'matchEnd', winner: 1 as const, round: 3, frame: 9000, phaseT: 120 };
    expect(resultOf(over, 2)).toEqual({ t: 'result', game: 2, winner: 'guest', rounds: 3, ticks: 8880 });
    // A frame later on the other machine, the same tick.
    expect(resultOf({ ...over, frame: 9050, phaseT: 170 }, 2)?.ticks).toBe(8880);
    expect(resultOf({ ...over, winner: 0 }, 1, { id: 'will-00002', name: 'Will' })).toMatchObject({ winner: 'host', me: { id: 'will-00002', name: 'Will' } });
  });
});
