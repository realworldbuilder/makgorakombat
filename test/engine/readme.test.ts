import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type Ability, damageRange, EXECUTE_BELOW, GCD_FRAMES, kitSpec, RESOURCE_NAMES, type ResourceKind } from '../../src/engine/abilities';
import { BLINK_DISTANCE } from '../../src/engine/engine';
import { STAGES, stagesFor } from '../../src/game/stages';

/*
 * The README's class table, written from the kits themselves, so the numbers on the page are the
 * numbers in the ring. When a kit changes, `README=1 pnpm vitest run test/engine/readme.test.ts`
 * prints the table to paste over the old one.
 */

const README = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const CLASS_IDS = Array.from({ length: 13 }, (_, i) => i + 1);
const COUNTS = ['none', 'once', 'twice', 'three times', 'four times', 'five times', 'six times'];
const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** Seconds from frames: "1.5", "6". */
const sec = (frames: number): string => {
  const s = frames / 60;
  return Number.isInteger(s) ? String(s) : s.toFixed(1);
};
const word = (resource: ResourceKind): string => RESOURCE_NAMES[resource].toLowerCase();
const title = (name: string): string => name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** One cell: the ability's name, then what it costs, how it reaches, what it does and how often. */
function abilityCell(a: Ability, resource: ResourceKind): string {
  const parts: string[] = [];
  if (a.cost > 0) parts.push(`${a.cost} ${word(resource)}`);
  if (a.kind === 'charge') parts.push('closes from afar');
  if (a.kind === 'rush') parts.push(`dashes ${a.range} yards`);
  if (a.kind === 'blink') parts.push(`${BLINK_DISTANCE} yards away`);
  if (a.kind === 'leap') parts.push('leaps back');
  if (a.cast > 0) parts.push(`${sec(a.cast)} s cast`);
  if (a.damage > 0) {
    const [lo, hi] = damageRange(a.damage, a.spread);
    parts.push(`${lo}–${hi} damage${a.both ? ' on both sides' : ''}`);
  }
  if (a.dot) parts.push(`${a.damage > 0 ? 'then ' : ''}${a.dot.damage} damage every 3 s, ${COUNTS[a.dot.ticks]}`);
  if (a.heal) parts.push(`heals ${a.heal}`);
  if (a.absorb) parts.push(`absorbs ${a.absorb}`);
  if (a.stun) parts.push(`stuns ${sec(a.stun)} s`);
  if (a.slow) parts.push(`slows ${sec(a.slow)} s`);
  if (a.fear) parts.push(`the target flees ${sec(a.fear)} s`);
  if (a.evasion) parts.push(`dodge up for ${sec(a.evasion)} s`);
  if (a.interrupt) parts.push('interrupts');
  if (a.gain) parts.push(`gives ${a.gain} ${word(resource)}`);
  if (a.execute) parts.push(`only under ${EXECUTE_BELOW * 100} % health`);
  if (a.cooldown > 0) parts.push(`${sec(a.cooldown)} s cooldown`);
  if (!a.gcd) parts.push('no global cooldown');
  return `${a.name}: ${parts.join(', ')}`;
}

/** The whole table, header and all, as the README has it. */
function abilityTable(): string[] {
  const rows = CLASS_IDS.map((id) => {
    const kit = kitSpec(id);
    return `| ${title(kit.className)} (${word(kit.resource)}) | ${kit.abilities.map((a) => abilityCell(a, kit.resource)).join(' | ')} |`;
  });
  return ['| Class | 1 | 2 | 3 |', '|---|---|---|---|', ...rows];
}

/** The README's table: from its header to the first line that is not a row. */
function readmeTable(): string[] {
  const lines = README.split('\n');
  const start = lines.indexOf('| Class | 1 | 2 | 3 |');
  if (start < 0) return [];
  const end = lines.findIndex((line, i) => i > start && !line.startsWith('|'));
  return lines.slice(start, end < 0 ? undefined : end);
}

describe('the README', () => {
  it('has the class table the kits make', () => {
    const table = abilityTable();
    if (process.env.README) console.log(table.join('\n'));
    expect(readmeTable()).toEqual(table);
  });

  it('names every class', () => {
    expect(CLASS_IDS.map((id) => kitSpec(id).classKey)).not.toContain('champion');
    expect(kitSpec(14).classKey).toBe('champion');
  });

  it('gives the global cooldown the engine uses', () => {
    expect(README).toContain(`on a ${(GCD_FRAMES / 60).toFixed(1)} s global cooldown`);
  });

  it('lists every stage and counts them right', () => {
    for (const stage of STAGES) expect(README.toLowerCase()).toContain(stage.name.toLowerCase().replace(/^the /, ''));
    const all = [0, 1, 530, 571];
    expect(README).toContain(`| the ${NUMBERS[stagesFor(all, 'retail').length]} on the rebuilt world |`);
    expect(README).toContain(`| all ${NUMBERS[stagesFor(all, 'classic').length]}, `);
  });
});
