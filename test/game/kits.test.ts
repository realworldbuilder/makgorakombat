import { describe, expect, it } from 'vitest';
import { type Ability, kitSpec } from '../../src/engine/abilities';
import { describeAbility } from '../../src/game/ui/describe';
import { PINNED } from '../../src/game/ui/icons';

/*
 * The kits hold to the same rules, class by class: something for up close, so no class is only
 * ranged, and no ability, or its icon, shared with another class.
 */

const CLASS_IDS = Array.from({ length: 13 }, (_, i) => i + 1);
const kits = CLASS_IDS.map((id) => kitSpec(id, id === 3 ? 'bow' : 'oneHand'));

/** Works with the target at the fighter's elbow: a blow, a charge, a nova, or a breath no longer than a hammer's throw. */
const upClose = (a: Ability): boolean => a.kind === 'melee' || a.kind === 'charge' || a.kind === 'rush' || (a.kind === 'spell' && (a.both || a.range <= 3.5));

describe('the class kits', () => {
  it('give every class something for up close', () => {
    for (const kit of kits) expect(kit.abilities.some(upClose), kit.classKey).toBe(true);
  });

  it('give the hunter a melee strike beside its shots', () => {
    const hunter = kitSpec(3, 'bow');
    expect(hunter.abilities.map((a) => a.kind)).toContain('melee');
    expect(describeAbility(hunter.abilities.find((a) => a.id === 'raptorStrike')!, hunter.resource).range).toBe('Melee Range');
  });

  it('share no ability between classes', () => {
    const ids = kits.flatMap((kit) => kit.abilities.map((a) => a.id));
    const names = kits.flatMap((kit) => kit.abilities.map((a) => a.name));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('give every ability an icon of its own, and none the auto-attack or an effect uses', () => {
    const names = kits.flatMap((kit) => kit.abilities.map((a) => a.name));
    for (const name of names) expect(PINNED[name], name).toBeDefined();
    const files = Object.entries(PINNED).map(([name, ids]) => [name, ids[0]!] as const);
    const seen = new Map<number, string>();
    for (const [name, file] of files) {
      expect(seen.get(file), `${name} and ${seen.get(file)} share icon ${file}`).toBeUndefined();
      seen.set(file, name);
    }
  });
});
