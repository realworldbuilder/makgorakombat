import { describe, expect, it } from 'vitest';
import type { ItemSummary, Slot } from '@mogshot/character/equipment';
import { averageLevel, canWear, DOLL_SLOTS, equip, type ItemInfo, itemLines, LEFT_PLACES, RIGHT_PLACES } from '../../src/game/slots';

const item = (id: number, inventoryType: number): ItemSummary => ({ id, name: `Item ${id}`, quality: 4, inventoryType, iconFileId: 0 });

describe('the paper doll', () => {
  it('has each slot that shows on the model once, and eight a side, as the sheet in the game does', () => {
    expect(new Set(DOLL_SLOTS).size).toBe(13);
    expect(LEFT_PLACES).toHaveLength(8);
    expect(RIGHT_PLACES).toHaveLength(8);
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

const CLASSES = [
  { id: 1, name: 'Warrior' }, { id: 2, name: 'Paladin' }, { id: 4, name: 'Rogue' }, { id: 5, name: 'Priest' }, { id: 8, name: 'Mage' },
];

describe('an item tooltip', () => {
  const plate: ItemInfo = { ...item(20, 1), name: 'Dreadnaught Helmet', level: 88, kind: 'Plate', itemClass: 4, subclass: 4 };
  const staff: ItemInfo = { ...item(21, 17), name: 'Staff of the Magi', level: 70, kind: 'Staff', itemClass: 2, subclass: 10 };
  const robe: ItemInfo = { ...item(22, 20), name: 'Robe of Faith', kind: 'Cloth', itemClass: 4, subclass: 1, classes: (1 << 4) | (1 << 7) };

  it('names the slot and the armour type, red for a class that cannot wear it', () => {
    expect(itemLines(plate, 'head', 1, CLASSES)).toEqual([
      { left: 'Dreadnaught Helmet', kind: 'name', hue: 'epic' },
      { left: 'Item Level 88', hue: 'gold' },
      { left: 'Head', right: 'Plate', rightHue: 'white' },
    ]);
    expect(itemLines(plate, 'head', 8, CLASSES)[2]).toEqual({ left: 'Head', right: 'Plate', rightHue: 'red' });
    expect(canWear(plate, 2)).toBe(true);
    expect(canWear(plate, 4)).toBe(false);
  });

  it('says how a weapon is held and what it is', () => {
    expect(itemLines(staff, 'mainHand', 8, CLASSES)[2]).toEqual({ left: 'Two-Hand', right: 'Staff', rightHue: 'white' });
  });

  it('lists the classes an item is kept to, red when the champion is not one', () => {
    expect(itemLines(robe, 'chest', 5, CLASSES).at(-1)).toEqual({ left: 'Classes: Priest, Mage', hue: 'white' });
    expect(itemLines(robe, 'chest', 1, CLASSES).at(-1)).toEqual({ left: 'Classes: Priest, Mage', hue: 'red' });
    const anyone = { ...robe, classes: (1 << 0) | (1 << 1) | (1 << 3) | (1 << 4) | (1 << 7) };
    expect(itemLines(anyone, 'chest', 1, CLASSES).some((line) => String(line.left).startsWith('Classes'))).toBe(false);
  });

  it('averages the item level of what is worn', () => {
    expect(averageLevel([['head', plate], ['mainHand', staff], ['chest', robe]])).toBe(79);
    expect(averageLevel([])).toBeUndefined();
  });
});
