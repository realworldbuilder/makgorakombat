import type { Slot } from '@mogshot/character/equipment';
import type { MoveTable } from '../../engine/moves';
import type { Champion } from '../fighters';
import { VERSION } from './version';

/*
 * What two machines agree on before they fight. Each player's install has its own models, so
 * the same champion can animate differently on a retail and a classic folder: a swing a few
 * frames longer, a cast held in another pose. The engine's timing comes from the move tables,
 * so the host sends its two tables and both engines run on them; each machine still draws its
 * fighters with its own animations, stretched to the host's timing. The champions go as specs
 * each machine builds from its own files, and the stage as a key each finds in its own list.
 *
 * Messages are JSON text; the fight's frames are bytes (lockstep.ts).
 */

/** What Fighters.build needs to rebuild a champion on the other machine, and the name it is shown by. */
export interface FighterSpec {
  key: string;
  name: string;
  title: string;
  raceId: number;
  sex: number;
  classId: number | undefined;
  choices: [number, number][];
  gear: [Slot, number][];
  /** A legend: its creature display on the sender's install. */
  npc?: number;
}

/** The ground: a stage by its slug, a loading screen by its id, or none. */
export type StageKey = { kind: 'stage'; slug: string } | { kind: 'screen'; id: number } | { kind: 'none' };

/** Both sides say who they are on meeting: a different VERSION cannot fight. */
export interface Meet {
  t: 'meet';
  version: string;
  /** 'wow', 'wow_classic' ...: told, not checked; the host's tables keep two installs in step. */
  product: string;
}

/** The host starts a fight. */
export interface Hello {
  t: 'hello';
  version: string;
  product: string;
  /** For when the engine has rule sets; passed through untouched until then. */
  rules?: string;
  seed: number;
  /** The match number, starting at 1; each rematch is the next. */
  game: number;
  stage: StageKey;
  /** The host drew the stage at random (stages.ts drawGround): both show the NEXT STAGE card, not the VS screen. */
  drawn?: boolean;
  fighters: [FighterSpec, FighterSpec];
  tables: [MoveTable, MoveTable];
}

/** Where a player's cursor rests on CHOOSE YOUR CHAMPION, sent each time it changes. */
export interface RosterMessage {
  t: 'roster';
  /** The tile's id ('legend:thrall', 'race:2' ...); one this machine lacks, such as the other's own champion, shows no cursor. */
  tile: string | undefined;
  sex: number;
  classId: number | undefined;
  locked: boolean;
  /** The champion under the cursor once it is resolved. */
  champion: FighterSpec | undefined;
}

/** The host's cursor on the VS screen. */
export interface StageMessage {
  t: 'stage';
  stage: StageKey;
}

export interface Rematch {
  t: 'rematch';
  game: number;
  seed: number;
}

/** Back to CHOOSE YOUR CHAMPION, from the VS screen or the fight. */
export interface Back {
  t: 'back';
}

/**
 * This page's word to the relay that a match is over, for the board: the match number, the
 * winner's part, and the rounds and ticks it took, which both pages count alike. The room passes
 * it to the lobby once the other page says the same, and not to the other page. `me` names this
 * player, for a room the lobby did not make.
 */
export interface Result {
  t: 'result';
  game: number;
  winner: 'host' | 'guest';
  rounds: number;
  ticks: number;
  me?: { id: string; name: string };
}

/** The relay's word that the other player came or went. */
export interface Peer {
  t: 'peer';
  joined: boolean;
}

export type Message = Meet | Hello | RosterMessage | StageMessage | Rematch | Back | Peer | Result;

export function specOf(champion: Champion): FighterSpec {
  const spec: FighterSpec = {
    key: champion.key,
    name: champion.name,
    title: champion.title,
    raceId: champion.raceId,
    sex: champion.sex,
    classId: champion.classId,
    choices: champion.choices.map(([a, b]) => [a, b]),
    gear: champion.gear.map(([slot, id]) => [slot, id]),
  };
  if (champion.npc !== undefined) spec.npc = champion.npc;
  return spec;
}

export function championOf(spec: FighterSpec): Champion {
  const champion: Champion = {
    key: spec.key,
    name: spec.name,
    title: spec.title,
    raceId: spec.raceId,
    sex: spec.sex,
    classId: spec.classId ?? undefined,
    choices: spec.choices.map(([a, b]) => [a, b]),
    gear: spec.gear.map(([slot, id]) => [slot, id]),
  };
  if (spec.npc !== undefined) champion.npc = spec.npc;
  return champion;
}

/**
 * A move table as it came over the wire. JSON has no undefined, so the beats of a fatality that
 * leave the loser alone come back as null; they go back to undefined, as the engine checks. The
 * loser's part is kept for every class's fatality, by fatality id.
 */
export function reviveTable(table: MoveTable): MoveTable {
  const victim: Record<string, (MoveTable['fatality']['winner'][number] | undefined)[]> = {};
  for (const [id, moves] of Object.entries(table.fatality.victim)) victim[id] = moves.map((move) => move ?? undefined);
  table.fatality.victim = victim;
  return table;
}

/** Text for the wire. */
export function encode(message: Message): string {
  return JSON.stringify(message);
}

/** A message from the wire, or undefined for text that is not one. */
export function decode(text: string): Message | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || typeof (value as { t?: unknown }).t !== 'string') return undefined;
  const message = value as Message;
  if (message.t === 'hello' && Array.isArray(message.tables)) message.tables = [reviveTable(message.tables[0]), reviveTable(message.tables[1])];
  return message;
}

/** The result to report for a match the fight screen shows, or undefined while it is not over. Host is player 1. */
export function resultOf(
  match: { phase: string; winner: 0 | 1 | undefined; round: number; frame: number; phaseT: number },
  game: number,
  me?: { id: string; name: string },
): Result | undefined {
  if (match.phase !== 'matchEnd' || match.winner === undefined) return undefined;
  // The tick the match ended on: the frame count goes on under the winner's banner, at its own pace on each machine.
  const result: Result = { t: 'result', game, winner: match.winner === 0 ? 'host' : 'guest', rounds: match.round, ticks: match.frame - match.phaseT };
  if (me) result.me = me;
  return result;
}

export function meet(product: string): Meet {
  return { t: 'meet', version: VERSION, product };
}

/** Why two pages cannot fight, or undefined when they can. */
export function mismatch(theirs: { version: string | number }): string | undefined {
  if (theirs.version === VERSION) return undefined;
  return `Your opponent's game is a different version (${theirs.version}, this page is ${VERSION}). Both of you reload the page so it is the same one, then try again.`;
}

/** The ground as a key the other machine can look up. */
export function stageKeyOf(ground: { stage?: { slug: string }; screen?: { id: number } }): StageKey {
  if (ground.stage) return { kind: 'stage', slug: ground.stage.slug };
  if (ground.screen) return { kind: 'screen', id: ground.screen.id };
  return { kind: 'none' };
}

export function sameStage(a: StageKey, b: StageKey): boolean {
  if (a.kind === 'stage' && b.kind === 'stage') return a.slug === b.slug;
  if (a.kind === 'screen' && b.kind === 'screen') return a.id === b.id;
  return a.kind === b.kind;
}

/**
 * A spec made on the other machine, fitted to this one: a legend is drawn by this install's
 * own display of it when the two differ (a classic folder numbers Thrall's display apart from
 * a retail one). `displayOf` gives this install's display for a legend's slug, if it has one.
 */
export function localize(spec: FighterSpec, displayOf: (slug: string) => number | undefined): FighterSpec {
  const legend = /^legend:([^:]+):\d+$/.exec(spec.key);
  if (!legend || spec.npc === undefined) return spec;
  const ours = displayOf(legend[1]!);
  if (ours === undefined || ours === spec.npc) return spec;
  return { ...spec, npc: ours, key: `legend:${legend[1]}:${ours}` };
}

/** The same champion as a plain member of its race, for an install that cannot draw the legend at all. */
export function plainSpec(spec: FighterSpec): FighterSpec {
  const { npc: _npc, ...rest } = spec;
  return { ...rest, key: `race:${spec.raceId}:${spec.sex}:${spec.classId ?? 0}:plain`, choices: [] };
}
