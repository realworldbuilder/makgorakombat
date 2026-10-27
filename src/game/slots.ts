import type { ItemSummary, Slot } from '@mogshot/character/equipment';

/*
 * The character sheet's slots around the champion on CREATE YOUR CHAMPION, laid out as the
 * game's own paper doll has them: head to wrist down the left, hands to feet down the right, the
 * weapons beneath. Only the slots that show on the model are here; neck, rings and trinkets
 * draw nothing, so there is nothing to choose for them. And the one rule the game keeps when
 * an item goes on: a two-handed weapon (a staff, a bow, a gun) fills both hands, so it and an
 * off-hand item take each other off.
 */

export const LEFT_SLOTS: readonly Slot[] = ['head', 'shoulder', 'back', 'chest', 'shirt', 'tabard', 'wrist'];
export const RIGHT_SLOTS: readonly Slot[] = ['hands', 'waist', 'legs', 'feet'];
export const WEAPON_SLOTS: readonly Slot[] = ['mainHand', 'offHand'];
/** Every slot in the order the keys step through them: down the left, down the right, then the weapons. */
export const DOLL_SLOTS: readonly Slot[] = [...LEFT_SLOTS, ...RIGHT_SLOTS, ...WEAPON_SLOTS];

/** The slot names as the game's tooltips write them. */
export const SLOT_NAMES: Record<Slot, string> = {
  head: 'Head', shoulder: 'Shoulder', back: 'Back', chest: 'Chest', shirt: 'Shirt', tabard: 'Tabard', wrist: 'Wrist',
  hands: 'Hands', waist: 'Waist', legs: 'Legs', feet: 'Feet', mainHand: 'Main Hand', offHand: 'Off Hand',
};

/** What an item is, by its inventory type, as the second line of its tooltip has it. */
const KINDS: Record<number, string> = {
  13: 'One-Hand', 14: 'Shield', 15: 'Ranged', 17: 'Two-Hand', 20: 'Robe', 21: 'Main Hand', 22: 'Off Hand', 23: 'Held In Off-hand', 25: 'Thrown', 26: 'Ranged',
};

export const kindOf = (item: ItemSummary, slot: Slot): string => KINDS[item.inventoryType] ?? SLOT_NAMES[slot];

/** Two-hand weapons, bows, and guns, crossbows and wands: held in both hands. */
const BOTH_HANDS = new Set([17, 15, 26]);

export const bothHands = (item: ItemSummary | undefined): boolean => item !== undefined && BOTH_HANDS.has(item.inventoryType);

/**
 * The gear with `item` put on in `slot`, or the slot emptied when it is undefined, as item ids
 * and as the items themselves. A two-handed weapon takes the off hand off; an off-hand item
 * takes a two-handed weapon off. An id whose item is not known yet is left where it is.
 */
export function equip(
  gear: readonly [Slot, number][],
  worn: readonly [Slot, ItemSummary][],
  slot: Slot,
  item: ItemSummary | undefined,
): { gear: [Slot, number][]; worn: [Slot, ItemSummary][] } {
  const off = new Set<Slot>([slot]);
  if (item && slot === 'mainHand' && bothHands(item)) off.add('offHand');
  if (item && slot === 'offHand' && bothHands(worn.find(([s]) => s === 'mainHand')?.[1])) off.add('mainHand');
  const nextGear = gear.filter(([s]) => !off.has(s));
  const nextWorn = worn.filter(([s]) => !off.has(s));
  if (item) {
    nextGear.push([slot, item.id]);
    nextWorn.push([slot, item]);
  }
  return { gear: nextGear, worn: nextWorn };
}
