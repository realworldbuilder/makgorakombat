import { describe, expect, it } from 'vitest';
import { kitSpec } from '../../src/engine/abilities';
import { describeAbility, describeWeapon } from '../../src/game/ui/describe';

describe('describeAbility', () => {
  const warrior = kitSpec(1, 'twoHand');
  const mage = kitSpec(8);
  const priest = kitSpec(5);
  const find = (kit: ReturnType<typeof kitSpec>, id: string) => kit.abilities.find((a) => a.id === id)!;

  it('puts the cost, range, cast and cooldown where the game does', () => {
    expect(describeAbility(find(warrior, 'mortalStrike'), warrior.resource)).toEqual({
      name: 'Mortal Strike',
      cost: '30 Rage',
      range: 'Melee Range',
      cast: 'Instant',
      cooldown: '6 sec cooldown',
      description: 'Strikes the target for 14 to 19 damage.',
    });
    expect(describeAbility(find(mage, 'frostbolt'), mage.resource)).toMatchObject({
      cost: '20 Mana',
      range: '8 yd range',
      cast: '1.5 sec cast',
      cooldown: '',
      description: 'Hurls a bolt that deals 22 to 26 damage; it can be jumped over and slows the target for 4 sec.',
    });
  });

  it('says what a charge, a shield and an execute do', () => {
    expect(describeAbility(find(warrior, 'charge'), 'rage')).toMatchObject({
      range: '2.5 – 9 yd range',
      cooldown: '15 sec cooldown',
      description: 'Charges the target, dealing 4 to 5 damage and stuns the target for 1 sec and generates 20 Rage.',
    });
    expect(describeAbility(find(priest, 'powerWordShield'), 'mana').description).toBe('Shields you, absorbing 25 damage.');
    expect(describeAbility(find(warrior, 'execute'), 'rage').description).toBe('Strikes the target for 23 to 31 damage. Only usable on a target below 20% health.');
  });

  it('describes the auto-attack from the weapon', () => {
    const tip = describeWeapon({ wielding: 'oneHand', speed: 120, damage: 8, spread: 0.25, ranged: false, range: 2.6, shield: true, close: undefined });
    expect(tip.name).toBe('Attack');
    expect(tip.cast).toBe('Every 2 sec');
    expect(tip.description).toContain('Swings at the target for 6 to 10 damage');
    expect(tip.description).toContain('shield');
  });

  it('tells a bow that it strikes by hand up close', () => {
    const tip = describeWeapon({ wielding: 'bow', speed: 120, damage: 9, spread: 0.2, ranged: true, range: 8, shield: false, close: { damage: 7, spread: 0.2 } });
    expect(tip.name).toBe('Auto Shot');
    expect(tip.description).toContain('Inside melee range it strikes by hand instead, for 6 to 8.');
  });
});
