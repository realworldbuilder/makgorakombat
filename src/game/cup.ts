import type { LobbyPlayer } from './net/lobby';

/*
 * A tournament run from one page: whoever hosts the night picks the players, the page draws a
 * single-elimination bracket (byes to the top seeds when the count is not a power of two), and
 * each pairing fights an ordinary online match, one challenging the other by name. The relay knows
 * nothing of it. Results are read off the lobby where it can: everyone here carries tonight's
 * record, so when A's wins and B's losses have both gone up since the pairing was called, A won
 * that match. Where the relay keeps no records, or a match did not count (somebody left early),
 * the host gives the win by hand. The bracket lives in this browser's storage, so a reload, or the
 * host's own fight, loses nothing.
 */

const STORAGE = 'makgora.cup';

/** Biggest bracket the page draws. */
export const MAX_ENTRANTS = 32;

export interface Entrant {
  name: string;
  /** The lobby id, once the player has been seen here; a name typed in for someone not here yet has none until they come. */
  id?: string;
}

export interface Bout {
  /** Entrant indexes. Null in the first round is a bye; after it, a side not decided yet. */
  sides: [number | null, number | null];
  /** Matches won by each side. */
  score: [number, number];
  winner?: 0 | 1;
  /** Decided without a fight: the other side was a bye. */
  bye?: boolean;
}

export interface Cup {
  entrants: Entrant[];
  /** The first round first; each round half the last, down to the final. */
  rounds: Bout[][];
  /** Match wins that take a pairing. */
  firstTo: number;
  /** Each entrant's tonight [wins, losses] that the results so far have accounted for; new wins and losses past it are read as the current pairing's. */
  marks: Record<number, [number, number]>;
  began: number;
}

/** The seeds in bracket order, so that seed 1 meets seed 2 only in the final: 0 1 → 0 3 1 2 → 0 7 3 4 1 6 2 5. */
export function seedOrder(size: number): number[] {
  let order = [0];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((seed) => [seed, n - 1 - seed]);
  }
  return order;
}

/** A Fisher–Yates shuffle, for drawing the seeds at random. */
export function shuffled<T>(items: readonly T[], random = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A tonight's record as the lobby gives it: [wins, losses], 0-0 for a player here who has not fought tonight; undefined for one not here. */
function recordOf(entrant: Entrant, players: readonly LobbyPlayer[]): [number, number] | undefined {
  const player = entrant.id ? players.find((p) => p.id === entrant.id) : undefined;
  return player ? (player.night ?? [0, 0]) : undefined;
}

/** A bracket for these entrants, seeded in the order given. */
export function makeCup(entrants: readonly Entrant[], firstTo = 1, players: readonly LobbyPlayer[] = [], now = Date.now()): Cup {
  if (entrants.length < 2) throw new Error('A tournament needs two players at least.');
  if (entrants.length > MAX_ENTRANTS) throw new Error(`A tournament takes ${MAX_ENTRANTS} players at most.`);
  let size = 2;
  while (size < entrants.length) size *= 2;
  const order = seedOrder(size).map((seed) => (seed < entrants.length ? seed : null));
  const rounds: Bout[][] = [];
  for (let bouts = size / 2; bouts >= 1; bouts /= 2) {
    rounds.push(Array.from({ length: bouts }, (_, i) => ({ sides: rounds.length === 0 ? [order[2 * i]!, order[2 * i + 1]!] : [null, null], score: [0, 0] })));
  }
  const marks: Record<number, [number, number]> = {};
  entrants.forEach((entrant, k) => {
    const record = recordOf(entrant, players);
    if (record) marks[k] = record;
  });
  return settle({ entrants: entrants.map((e) => ({ ...e })), rounds, firstTo: Math.max(1, Math.floor(firstTo)), marks, began: now });
}

const sameSides = (a: Bout['sides'], b: Bout['sides']) => a[0] === b[0] && a[1] === b[1];

/**
 * The bracket made consistent: a first-round bout against a bye is won, each winner goes on into
 * the next round, and a later bout whose sides have changed (a result taken back) starts again.
 */
export function settle(cup: Cup): Cup {
  const rounds = cup.rounds.map((round) => round.map((bout) => ({ ...bout, sides: [...bout.sides] as Bout['sides'], score: [...bout.score] as Bout['score'] })));
  rounds[0]!.forEach((bout) => {
    const [a, b] = bout.sides;
    if ((a === null) !== (b === null)) {
      bout.winner = a === null ? 1 : 0;
      bout.bye = true;
      bout.score = [0, 0];
    }
  });
  for (let r = 1; r < rounds.length; r++) {
    rounds[r]!.forEach((bout, i) => {
      const feed = (k: number) => {
        const from = rounds[r - 1]![k]!;
        return from.winner === undefined ? null : from.sides[from.winner];
      };
      const sides: Bout['sides'] = [feed(2 * i), feed(2 * i + 1)];
      if (!sameSides(sides, bout.sides)) {
        bout.sides = sides;
        bout.score = [0, 0];
        delete bout.winner;
      }
    });
  }
  return { ...cup, rounds };
}

/** Both sides known and no winner yet: a pairing to be fought now. */
export const isReady = (bout: Bout) => bout.sides[0] !== null && bout.sides[1] !== null && bout.winner === undefined;

/** Every pairing to be fought now, with where it is in the bracket. */
export function readyBouts(cup: Cup): { round: number; index: number; bout: Bout }[] {
  return cup.rounds.flatMap((round, r) => round.flatMap((bout, i) => (isReady(bout) ? [{ round: r, index: i, bout }] : [])));
}

/** The winner of the final, once there is one. */
export function champion(cup: Cup): Entrant | undefined {
  const final = cup.rounds[cup.rounds.length - 1]![0]!;
  return final.winner === undefined ? undefined : cup.entrants[final.sides[final.winner]!];
}

function withBout(cup: Cup, round: number, index: number, change: (bout: Bout) => Bout): Cup {
  const rounds = cup.rounds.map((r, k) => (k === round ? r.map((b, i) => (i === index ? change(b) : b)) : r));
  return settle({ ...cup, rounds });
}

/** One match won by a side, given by hand; the pairing goes to it at `firstTo`. */
export function point(cup: Cup, round: number, index: number, side: 0 | 1): Cup {
  return withBout(cup, round, index, (bout) => {
    if (!isReady(bout)) return bout;
    const score: Bout['score'] = [...bout.score];
    score[side]++;
    return score[side] >= cup.firstTo ? { ...bout, score, winner: side } : { ...bout, score };
  });
}

/** A pairing back to nothing: its score, its winner and whatever the winner went on to in later rounds. */
export function reset(cup: Cup, round: number, index: number): Cup {
  return withBout(cup, round, index, (bout) => {
    if (bout.bye) return bout;
    const { winner: _, ...rest } = bout;
    return { ...rest, score: [0, 0] };
  });
}

const key = (name: string) => name.trim().toLowerCase();

/**
 * What the lobby says folded in: entrants typed by name get the id of the player here under that
 * name, a player first seen gets their record marked, and each pairing on now is scored from the
 * new wins of one side that are also new losses of the other since the marks.
 */
export function readLobby(cup: Cup, players: readonly LobbyPlayer[]): Cup {
  let changed = false;
  const taken = new Set(cup.entrants.flatMap((e) => (e.id ? [e.id] : [])));
  const entrants = cup.entrants.map((entrant) => {
    if (entrant.id) {
      const now = players.find((p) => p.id === entrant.id);
      if (now && now.name !== entrant.name) {
        changed = true;
        return { ...entrant, name: now.name };
      }
      return entrant;
    }
    const found = players.find((p) => !taken.has(p.id) && key(p.name) === key(entrant.name));
    if (!found) return entrant;
    taken.add(found.id);
    changed = true;
    return { ...entrant, id: found.id, name: found.name };
  });
  const marks = { ...cup.marks };
  entrants.forEach((entrant, k) => {
    const record = recordOf(entrant, players);
    if (!record) return;
    const mark = marks[k];
    // Unmarked, or a record that went down (the night turned at four): it counts from here.
    if (!mark || record[0] < mark[0] || record[1] < mark[1]) {
      marks[k] = record;
      changed = true;
    }
  });
  let next: Cup = { ...cup, entrants, marks };
  for (const { round, index, bout } of readyBouts(next)) {
    const [a, b] = bout.sides as [number, number];
    const ra = recordOf(entrants[a]!, players);
    const rb = recordOf(entrants[b]!, players);
    const ma = marks[a];
    const mb = marks[b];
    if (!ra || !rb || !ma || !mb) continue;
    const winsA = Math.min(ra[0] - ma[0], rb[1] - mb[1]);
    const winsB = Math.min(rb[0] - mb[0], ra[1] - ma[1]);
    if (winsA <= 0 && winsB <= 0) continue;
    // What was read is accounted for: the marks move past it, so the next pairing reads only what comes after.
    marks[a] = [ma[0] + Math.max(0, winsA), ma[1] + Math.max(0, winsB)];
    marks[b] = [mb[0] + Math.max(0, winsB), mb[1] + Math.max(0, winsA)];
    const score: Bout['score'] = [bout.score[0] + Math.max(0, winsA), bout.score[1] + Math.max(0, winsB)];
    const winner = score[0] >= next.firstTo ? 0 : score[1] >= next.firstTo ? 1 : undefined;
    next = withBout({ ...next, marks }, round, index, (b) => (winner === undefined ? { ...b, score } : { ...b, score, winner }));
    changed = true;
  }
  return changed ? next : cup;
}

/** What each round is called: the last FINAL, then SEMIFINALS, QUARTERFINALS, and ROUND 1, 2 before them. */
export function roundName(round: number, rounds: number): string {
  const fromEnd = rounds - 1 - round;
  return fromEnd === 0 ? 'FINAL' : fromEnd === 1 ? 'SEMIFINALS' : fromEnd === 2 ? 'QUARTERFINALS' : `ROUND ${round + 1}`;
}

/** The bracket as plain text, to paste where the players talk. */
export function cupText(cup: Cup): string {
  const name = (side: number | null, round: number) => (side === null ? (round === 0 ? 'bye' : '?') : cup.entrants[side]!.name);
  const lines = ["MAK'GORA TOURNAMENT", cup.firstTo > 1 ? `first to ${cup.firstTo} match wins` : 'one match a pairing', ''];
  cup.rounds.forEach((round, r) => {
    lines.push(roundName(r, cup.rounds.length));
    for (const bout of round) {
      if (bout.bye) continue;
      const [a, b] = bout.sides;
      const score = bout.winner !== undefined || bout.score[0] + bout.score[1] > 0 ? `  ${bout.score[0]}-${bout.score[1]}` : '';
      const mark = (side: 0 | 1) => (bout.winner === side ? ' ✓' : '');
      lines.push(`  ${name(a, r)}${mark(0)} vs ${name(b, r)}${mark(1)}${score}`);
    }
    lines.push('');
  });
  const won = champion(cup);
  if (won) lines.push(`CHAMPION: ${won.name}`);
  return lines.join('\n').trim();
}

/** The bracket this browser keeps, if it is one. */
export function savedCup(): Cup | undefined {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return undefined;
    const cup = JSON.parse(raw) as Cup;
    return Array.isArray(cup.entrants) && Array.isArray(cup.rounds) && cup.rounds.length > 0 ? cup : undefined;
  } catch {
    return undefined;
  }
}

export function saveCup(cup: Cup | undefined): void {
  try {
    if (cup) localStorage.setItem(STORAGE, JSON.stringify(cup));
    else localStorage.removeItem(STORAGE);
  } catch {
    // Storage blocked: the bracket lasts for this visit.
  }
}
