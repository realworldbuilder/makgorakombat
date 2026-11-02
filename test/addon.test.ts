import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { fresh, words } from '../addon/watch';

/** The first Lua on this machine new enough for the add-on's tests (5.3 or later), if any. */
const lua = ['lua', 'lua5.4', 'lua5.3'].find((name) => {
  const run = spawnSync(name, ['-e', 'assert(utf8)']);
  return run.status === 0;
});

describe('the WoW add-on', () => {
  it.skipIf(!lua)('tells everyone with it who is looking, in a few WoW clients stood in for (addon/test/world.lua)', () => {
    const out = execFileSync(lua!, ['addon/test/world.lua'], { encoding: 'utf8' });
    expect(out).toContain('All passed.');
  });
});

describe("the add-on's watcher", () => {
  it('tells of those newly in the queue, never of you', () => {
    expect(fresh(undefined, { waiting: 1, queue: ['Thrall'] })).toEqual(['Thrall']);
    expect(fresh({ waiting: 1, queue: ['Thrall'] }, { waiting: 2, queue: ['Thrall', 'Jaina'] })).toEqual(['Jaina']);
    expect(fresh({ waiting: 1, queue: ['Thrall'] }, { waiting: 0, queue: [] })).toEqual([]);
    expect(fresh(undefined, { waiting: 2, queue: ['Hermajesty', 'Jaina'] }, 'hermajesty ')).toEqual(['Jaina']);
  });

  it('counts somebody for every one more waiting on a relay that gives no names', () => {
    expect(fresh(undefined, { waiting: 1 })).toEqual(['Somebody']);
    expect(fresh({ waiting: 1 }, { waiting: 1 })).toEqual([]);
    expect(fresh({ waiting: 2 }, { waiting: 1 })).toEqual([]);
  });

  it('puts the names in a sentence', () => {
    expect(words(['Thrall'])).toBe('Thrall is waiting for a fight.');
    expect(words(['Thrall', 'Jaina', 'Anduin'])).toBe('Thrall, Jaina and Anduin are waiting for a fight.');
  });
});
