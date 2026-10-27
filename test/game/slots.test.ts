import { describe, expect, it } from 'vitest';
import type { ItemSummary, Slot } from '@mogshot/character/equipment';
import { DOLL_SLOTS, equip } from '../../src/game/slots';

const item = (id: number, inventoryType: number): ItemSummary => ({ id, name: `Item ${id}`, quality: 4, inventoryType, iconFileId: 0 });

describe('the paper doll', () => {
  it('has each slot that shows on the model once', () => {
    expect(new Set(DOLL_SLOTS).size).toBe(13);
  });

  it('puts an item on in its slot, in place of what was there', () => {
    const helm = item(1, 1);
    const crown = item(2, 1);
    const robe = item(3, 20);
    const first = equip([], [], 'head', helm);
    const second = equip([...first.gear, ['chest', 3]], [...first.worn, ['chest', robe]], 'head', crown);
    expect(second.gear).toEqual([['chest', 3], ['head', 2]]);
    expect(second.worn.map(([slot, i]) => [slot, i.id])).toEqual([['chest', 3], ['head', 2]]);
  });

  it('empties a slot', () => {
    const { gear, worn } = equip([['head', 1], ['feet', 5]], [['head', item(1, 1)]], 'head', undefined);
    expect(gear).toEqual([['feet', 5]]);
    expect(worn).toEqual([]);
  });

  it('takes the off hand off for a two-handed weapon, and the two-hander off for an off-hand item', () => {
    const sword = item(10, 13);
    const shield = item(11, 14);
    const staff = item(12, 17);
    const bow = item(13, 15);
    let gear: [Slot, number][] = [['mainHand', 10], ['offHand', 11]];
    let worn: [Slot, ItemSummary][] = [['mainHand', sword], ['offHand', shield]];
    ({ gear, worn } = equip(gear, worn, 'mainHand', staff));
    expect(gear).toEqual([['mainHand', 12]]);
    ({ gear, worn } = equip(gear, worn, 'offHand', shield));
    expect(gear).toEqual([['offHand', 11]]);
    ({ gear, worn } = equip(gear, worn, 'mainHand', sword));
    expect(gear).toEqual([['offHand', 11], ['mainHand', 10]]);
    ({ gear } = equip(gear, worn, 'mainHand', bow));
    expect(gear).toEqual([['mainHand', 13]]);
  });
});
