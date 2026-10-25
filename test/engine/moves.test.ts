import { animationId } from '@mogshot/model/animation-names';
import { describe, expect, it } from 'vitest';
import { ALL_MOVE_NAMES, MOVE_NAMES, resolveMoves, variationOf } from '../../src/engine/moves';
import { fakeAnimations, fakeTable, FULL_SET } from './fake';

describe('resolveMoves', () => {
  it('oneHand picks Attack1H with all its variations for the swing', () => {
    const table = fakeTable(['Stand', 'Attack1H', 'Attack1H', 'Attack1H', 'AttackUnarmed'], 'oneHand');
    expect(table.moves.swing.animation).toBe('Attack1H');
    expect(table.moves.swing.variations.map((v) => v.sequence)).toEqual([1, 2, 3]);
    expect(variationOf(table.moves.swing, 4).sequence).toBe(2);
  });

  it('falls back to AttackUnarmed', () => {
    const table = fakeTable(['Stand', 'AttackUnarmed', 'AttackUnarmed'], 'oneHand');
    expect(table.moves.swing.animation).toBe('AttackUnarmed');
    expect(table.moves.swing.variations.length).toBe(2);
  });

  it('two-handers and bows pick their own attack and ready', () => {
    const names = ['Stand', 'Attack1H', 'Attack2H', 'AttackBow', 'Ready1H', 'Ready2H', 'ReadyBow'];
    expect(fakeTable(names, 'twoHand').moves.swing.animation).toBe('Attack2H');
    expect(fakeTable(names, 'bow').moves.swing.animation).toBe('AttackBow');
    expect(fakeTable(names, 'bow').moves.idle.animation).toBe('ReadyBow');
    expect(fakeTable(names, 'long').moves.swing.animation).toBe('Attack2H');
  });

  it('the weapon sets the swing timer, the damage and whether it shoots', () => {
    expect(fakeTable(FULL_SET, 'oneHand').weapon).toMatchObject({ speed: 90, damage: 8, ranged: false, range: 2.6 });
    expect(fakeTable(FULL_SET, 'unarmed').weapon).toMatchObject({ speed: 90, damage: 7 });
    expect(fakeTable(FULL_SET, 'twoHand').weapon).toMatchObject({ speed: 144, damage: 14 });
    expect(fakeTable(FULL_SET, 'rifle').weapon).toMatchObject({ speed: 120, damage: 9, ranged: true, range: 8 });
  });

  it('a shield parries with ShieldBlock; a weapon with its own parry', () => {
    expect(fakeTable(FULL_SET, 'oneHand', {}, 1, true).moves.parry.animation).toBe('ShieldBlock');
    expect(fakeTable(FULL_SET, 'oneHand', {}, 1, true).weapon.shield).toBe(true);
    expect(fakeTable(FULL_SET, 'oneHand').moves.parry.animation).toBe('Parry1H');
    expect(fakeTable(['Stand', 'Dodge'], 'twoHand').moves.parry.animation).toBe('Dodge');
    expect(fakeTable(FULL_SET).moves.dodge.animation).toBe('Dodge');
  });

  it('idle is Ready1H, else Stand', () => {
    expect(fakeTable(['Stand', 'Ready1H'], 'oneHand').moves.idle.animation).toBe('Ready1H');
    expect(fakeTable(['Stand'], 'oneHand').moves.idle.animation).toBe('Stand');
    expect(fakeTable(['Stand'], 'oneHand').moves.idle.loop).toBe(true);
  });

  it('Death does not loop; dazed, cast and walk do', () => {
    const table = fakeTable();
    expect(table.moves.death.animation).toBe('Death');
    expect(table.moves.death.loop).toBe(false);
    expect(table.moves.dazed.loop).toBe(true);
    expect(table.moves.walk.loop).toBe(true);
    expect(table.moves.cast.loop).toBe(true);
    expect(table.moves.cast.animation).toBe('ReadySpellDirected'); // the fake set has no ChannelCastDirected
    expect(table.moves.parry.loop).toBe(false);
  });

  it('no Knockdown falls back to CombatCritical', () => {
    const table = fakeTable(['Stand', 'CombatCritical']);
    expect(table.moves.knockdown.animation).toBe('CombatCritical');
    expect(fakeTable().moves.knockdown.animation).toBe('Knockdown');
  });

  it('no CombatExecute falls back to Special2H', () => {
    const table = fakeTable(['Stand', 'Special2H', 'Special1H']);
    expect(table.moves.finisher.animation).toBe('Special2H');
    expect(fakeTable().moves.finisher.animation).toBe('CombatExecute');
  });

  it('a missing jump sets hasJump false and borrows idle', () => {
    const table = fakeTable(['Stand', 'Attack1H']);
    expect(table.hasJump).toBe(false);
    expect(table.moves.jump.animation).toBe('');
    expect(table.moves.jump.variations[0]?.sequence).toBe(0);
    expect(fakeTable().hasJump).toBe(true);
  });

  it('takes durations from the animations', () => {
    const table = fakeTable(FULL_SET, 'oneHand', { Attack1H: 733, Death: 2100 });
    expect(table.moves.swing.variations.every((v) => v.duration === 733)).toBe(true);
    expect(table.moves.death.variations[0]?.duration).toBe(2100);
  });

  it('only the swing has a hit window', () => {
    const table = fakeTable();
    expect(table.moves.swing.hit).toMatchObject({ from: 0.2, to: 0.5, recover: 0.45 });
    expect(table.moves.parry.hit).toBeUndefined();
  });

  it('fills every move even from an empty list', () => {
    const table = resolveMoves(fakeAnimations([]), 'unarmed');
    for (const name of MOVE_NAMES) {
      expect(table.moves[name].variations.length).toBeGreaterThan(0);
      expect(table.moves[name].variations[0]?.duration).toBeGreaterThan(0);
    }
  });
});

describe('ALL_MOVE_NAMES', () => {
  it('is deduped and every name is a real animation', () => {
    expect(new Set(ALL_MOVE_NAMES).size).toBe(ALL_MOVE_NAMES.length);
    for (const name of ALL_MOVE_NAMES) expect(animationId(name), name).toBeGreaterThanOrEqual(0);
  });

  it('covers what every weapon, move and ability can ask for', () => {
    for (const name of ['Ready1H', 'Ready2H', 'ReadyUnarmed', 'ReadyBow', 'Stand', 'Attack2HL', 'AttackRifle', 'Special1H', 'Kick', 'SpellCastDirected',
      'ShieldBlock', 'Dodge', 'CombatWound', 'Knockdown', 'Stun', 'Death', 'CombatExecute', 'BattleRoar', 'EmoteCheer', 'JumpLandRun',
      'CombatChargeLoop', 'CombatChargeEnd', 'CombatAbility2HBig01', 'MagSpellCastBothFront', 'Stormstrike', 'FelRushLoop', 'DHBladeDance1', 'DeathStrike', 'RisingSunKick']) {
      expect(ALL_MOVE_NAMES, name).toContain(name);
    }
  });
});

describe('resolveKit', () => {
  it('gives each class its own four abilities and resource', () => {
    const warrior = fakeTable(FULL_SET, 'twoHand', {}, 1).kit;
    expect(warrior.classKey).toBe('warrior');
    expect(warrior.resource).toBe('rage');
    expect(warrior.abilities.map((a) => a.id)).toEqual(['charge', 'mortalStrike', 'execute']);
    expect(warrior.abilities[0].hold.animation).toBe('CombatChargeLoop');
    expect(warrior.abilities[0].move.animation).toBe('CombatChargeEnd');
    expect(warrior.abilities[1].move.animation).toBe('CombatAbility2H02'); // not Big01, a leap
    const mage = fakeTable(FULL_SET, 'oneHand', {}, 8).kit;
    expect(mage.resource).toBe('mana');
    expect(mage.abilities[0].cast).toBe(90);
    expect(mage.abilities[0].move.animation).toBe('MagSpellCastBothFront');
    expect(mage.abilities[0].hold.animation).toBe('ReadySpellDirected'); // ChannelCastDirected first when the model has it
    expect(mage.abilities[0].hold.loop).toBe(true);
    for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
      const kit = fakeTable(FULL_SET, 'oneHand', {}, id).kit;
      expect(kit.abilities.length).toBe(3);
      for (const a of kit.abilities) expect(a.move.variations[0]?.duration).toBeGreaterThan(0);
    }
  });

  it('a fighter without a class is a champion with a warrior kit, or a hunter behind a bow', () => {
    const legend = resolveMoves(fakeAnimations(FULL_SET), 'oneHand').kit;
    expect(legend.classKey).toBe('champion');
    expect(legend.abilities[0].id).toBe('charge');
    const archer = resolveMoves(fakeAnimations([...FULL_SET, 'AttackBow']), 'bow').kit;
    expect(archer.classKey).toBe('champion');
    expect(archer.abilities[0].id).toBe('aimedShot');
    expect(archer.abilities[0].move.animation).toBe('AttackBow');
  });

  it('falls back to a plain strike when the model lacks the ability animation', () => {
    const kit = fakeTable(['Stand', 'Attack1H', 'CombatAbility1H01'], 'oneHand', {}, 1).kit;
    expect(kit.abilities[1].move.animation).toBe('CombatAbility1H01');
    expect(kit.abilities[0].hold.animation).toBe('');
    expect(kit.abilities[0].hold.variations[0]?.sequence).toBe(0);
  });
});
