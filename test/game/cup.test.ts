import { describe, expect, it } from 'vitest';
import type { LobbyPlayer } from '../../src/game/net/lobby';
import { champion, cupText, type Entrant, makeCup, point, readLobby, readyBouts, reset, roundName, seedOrder, shuffled } from '../../src/game/cup';

const named = (...names: string[]): Entrant[] => names.map((name) => ({ name, id: `id-${name}` }));
const here = (name: string, night?: [number, number]): LobbyPlayer => ({ id: `id-${name}`, name, status: 'free', ...(night ? { night } : {}) });
const names = (cup: ReturnType<typeof makeCup>, round: number) =>
  cup.rounds[round]!.map((bout) => bout.sides.map((side) => (side === null ? '-' : cup.entrants[side]!.name)).join(' v '));

describe('the tournament bracket', () => {
  it('seeds so the top two meet only in the final', () => {
    expect(seedOrder(2)).toEqual([0, 1]);
    expect(seedOrder(4)).toEqual([0, 3, 1, 2]);
    expect(seedOrder(8)).toEqual([0, 7, 3, 4, 1, 6, 2, 5]);
    const cup = makeCup(named('A', 'B', 'C', 'D'));
    expect(names(cup, 0)).toEqual(['A v D', 'B v C']);
    expect(cup.rounds.map((round) => round.length)).toEqual([2, 1]);
    expect(roundName(0, 2)).toBe('SEMIFINALS');
    expect(roundName(1, 2)).toBe('FINAL');
    expect(roundName(0, 4)).toBe('ROUND 1');
    expect(roundName(1, 4)).toBe('QUARTERFINALS');
  });

  it('gives the byes to the top seeds and sends them straight on', () => {
    const cup = makeCup(named('A', 'B', 'C', 'D', 'E'));
    expect(names(cup, 0)).toEqual(['A v -', 'D v E', 'B v -', 'C v -']);
    expect(names(cup, 1)).toEqual(['A v -', 'B v C']);
    expect(readyBouts(cup).map(({ round, index }) => [round, index])).toEqual([
      [0, 1],
      [1, 1],
    ]);
    expect(cupText(cup)).not.toContain('bye');
  });

  it('plays down to a champion by hand, and a result taken back clears what followed', () => {
    let cup = makeCup(named('A', 'B', 'C'));
    // A has the bye; B meets C.
    cup = point(cup, 0, 1, 1);
    expect(names(cup, 1)).toEqual(['A v C']);
    cup = point(cup, 1, 0, 0);
    expect(champion(cup)?.name).toBe('A');
    expect(cupText(cup)).toContain('CHAMPION: A');
    cup = reset(cup, 0, 1);
    expect(names(cup, 1)).toEqual(['A v -']);
    expect(champion(cup)).toBe(undefined);
    // A bye cannot be taken back.
    expect(reset(cup, 0, 0).rounds[0]![0]!.winner).toBe(0);
  });

  it('takes a pairing at first-to-two only on the second match won', () => {
    let cup = makeCup(named('A', 'B'), 2);
    cup = point(cup, 0, 0, 0);
    expect(cup.rounds[0]![0]!.winner).toBe(undefined);
    cup = point(cup, 0, 0, 1);
    cup = point(cup, 0, 0, 1);
    expect(champion(cup)?.name).toBe('B');
    expect(cup.rounds[0]![0]!.score).toEqual([1, 2]);
  });

  it('reads a result off the night records: one side\'s new win that is the other\'s new loss', () => {
    const lobby = [here('A', [2, 1]), here('B'), here('C', [0, 3]), here('D', [5, 0])];
    let cup = makeCup(named('A', 'B', 'C', 'D'), 1, lobby);
    expect(readLobby(cup, lobby)).toBe(cup);
    // B beats C; A wins a match against somebody outside the bracket, which D did not lose.
    cup = readLobby(cup, [here('A', [3, 1]), here('B', [1, 0]), here('C', [0, 4]), here('D', [5, 0])]);
    expect(cup.rounds[0]![1]!.winner).toBe(0);
    expect(cup.rounds[0]![0]!.winner).toBe(undefined);
    // D beats A: the final is B against D, and B's win over C is not read again in it.
    cup = readLobby(cup, [here('A', [3, 2]), here('B', [1, 0]), here('C', [0, 4]), here('D', [6, 0])]);
    expect(names(cup, 1)).toEqual(['D v B']);
    expect(cup.rounds[1]![0]!.winner).toBe(undefined);
    cup = readLobby(cup, [here('B', [1, 1]), here('D', [7, 0])]);
    expect(champion(cup)?.name).toBe('D');
  });

  it('never reads a result where the relay keeps no records, nor for someone not here', () => {
    const lobby = [here('A'), here('B')];
    const cup = makeCup(named('A', 'B'), 1, lobby);
    expect(readLobby(cup, lobby)).toBe(cup);
    expect(readLobby(cup, [here('A', [1, 0])])).toBe(cup);
  });

  it('links a name typed in to the player when they come, and marks their record from then', () => {
    let cup = makeCup([{ name: 'Thrallfan' }, { name: 'B', id: 'id-B' }], 1, [here('B', [0, 0])]);
    expect(cup.entrants[0]!.id).toBe(undefined);
    cup = readLobby(cup, [{ id: 'x1', name: 'thrallfan', status: 'free', night: [4, 4] }, here('B', [0, 0])]);
    expect(cup.entrants[0]).toEqual({ name: 'thrallfan', id: 'x1' });
    expect(cup.marks[0]).toEqual([4, 4]);
    cup = readLobby(cup, [{ id: 'x1', name: 'thrallfan', status: 'free', night: [4, 5] }, here('B', [1, 0])]);
    expect(champion(cup)?.name).toBe('B');
  });

  it('starts the count again when the night turns over', () => {
    let cup = makeCup(named('A', 'B'), 1, [here('A', [9, 9]), here('B', [9, 9])]);
    cup = readLobby(cup, [here('A'), here('B')]);
    expect(cup.marks).toEqual({ 0: [0, 0], 1: [0, 0] });
    cup = readLobby(cup, [here('A', [0, 1]), here('B', [1, 0])]);
    expect(champion(cup)?.name).toBe('B');
  });

  it('refuses a bracket of one, shuffles without losing anybody', () => {
    expect(() => makeCup(named('A'))).toThrow();
    const order = shuffled(['A', 'B', 'C', 'D', 'E'], () => 0.3);
    expect([...order].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});
