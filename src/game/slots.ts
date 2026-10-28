import type { ItemSummary, Slot } from '@mogshot/character/equipment';
import type { Line, Quality } from './ui/WowTooltip';

/*
 * The character sheet round the champion on CREATE YOUR CHAMPION, laid out as the game's own
 * paper doll has it: head, neck, shoulders, back, chest, shirt, tabard and wrists down the left;
 * hands, waist, legs, feet, two rings and two trinkets down the right; the weapons beneath. An
 * empty slot shows the game's own outline of what goes there. Neck, rings and trinkets draw
 * nothing on a model, so they stand empty, as on the sheet, with nothing to choose.
 *
 * An item's tooltip is written as the game writes it: the name in its quality's colour, the item
 * level, the slot with the armour or weapon type beside it, and the classes that may use it; a
 * type the champion's class could not wear, or a class list without it, in red. Nothing stops
 * a mage in plate: the red only says what the game would say.
 *
 * And the one rule the game keeps when an item goes on: a two-handed weapon (a staff, a bow, a
 * gun) fills both hands, so it and an off-hand item take each other off.
 */

/**
 * An item as Mogshot lists it, with the details a tooltip needs where this Mogshot reads them:
 * item level, type ("Plate", "Staff"), item class and subclass, the classes it is kept to, and its
 * sound group. Without them the tooltip is the name and the slot, and nothing is judged red.
 */
export type ItemInfo = ItemSummary & { level?: number; kind?: string; itemClass?: number; subclass?: number; classes?: number; soundGroup?: number };

/** The slots on the sheet that nothing can be chosen for, since nothing worn there shows. */
export type Bare = 'neck' | 'finger1' | 'finger2' | 'trinket1' | 'trinket2';
export type Place = Slot | Bare;

export const LEFT_PLACES: readonly Place[] = ['head', 'neck', 'shoulder', 'back', 'chest', 'shirt', 'tabard', 'wrist'];
export const RIGHT_PLACES: readonly Place[] = ['hands', 'waist', 'legs', 'feet', 'finger1', 'finger2', 'trinket1', 'trinket2'];
export const WEAPON_SLOTS: readonly Slot[] = ['mainHand', 'offHand'];

export const isBare = (place: Place): place is Bare => place === 'neck' || place.startsWith('finger') || place.startsWith('trinket');

/** The slots that can be chosen, in the order the keys step through them: down the left, down the right, then the weapons. */
export const DOLL_SLOTS: readonly Slot[] = [...LEFT_PLACES, ...RIGHT_PLACES, ...WEAPON_SLOTS].filter((place): place is Slot => !isBare(place));

/** The slot names as the game's tooltips write them. */
export const SLOT_NAMES: Record<Place, string> = {
  head: 'Head', neck: 'Neck', shoulder: 'Shoulder', back: 'Back', chest: 'Chest', shirt: 'Shirt', tabard: 'Tabard', wrist: 'Wrist',
  hands: 'Hands', waist: 'Waist', legs: 'Legs', feet: 'Feet', finger1: 'Finger', finger2: 'Finger', trinket1: 'Trinket', trinket2: 'Trinket',
  mainHand: 'Main Hand', offHand: 'Off Hand',
};

/**
 * The game's empty-slot pictures (Interface/PaperDoll/UI-PaperDoll-Slot-*), by file id, read on
 * the classic beta on 26 Oct 2026; the back has the chest's, as on the game's own sheet.
 */
export const EMPTY_ICONS: Record<Place, number> = {
  head: 136516, neck: 136519, shoulder: 136526, back: 136512, chest: 136512, shirt: 136525, tabard: 136527, wrist: 136530,
  hands: 136515, waist: 136529, legs: 136517, feet: 136513, finger1: 136514, finger2: 136514, trinket1: 136528, trinket2: 136528,
  mainHand: 136518, offHand: 136524,
};

/** What an item's tooltip says on the left of its slot line, by inventory type, where that is not the slot itself. */
const HELD: Record<number, string> = {
  13: 'One-Hand', 14: 'Off Hand', 15: 'Ranged', 17: 'Two-Hand', 21: 'Main Hand', 22: 'Off Hand', 23: 'Held In Off-hand', 25: 'Thrown', 26: 'Ranged',
};

export const heldAs = (item: ItemSummary, slot: Slot): string => HELD[item.inventoryType] ?? SLOT_NAMES[slot];

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

/** The game's class colours (RAID_CLASS_COLORS), by class id. */
export const CLASS_COLOURS: Record<number, string> = {
  1: '#c69b6d', 2: '#f48cba', 3: '#aad372', 4: '#fff468', 5: '#ffffff', 6: '#c41e3a', 7: '#0070dd',
  8: '#3fc7eb', 9: '#8788ee', 10: '#00ff98', 11: '#ff7c0a', 12: '#a330c9', 13: '#33937f',
};

/** The heaviest armour each class wears at the top of the game: 1 cloth, 2 leather, 3 mail, 4 plate. */
const ARMOUR: Record<number, number> = { 1: 4, 2: 4, 3: 3, 4: 2, 5: 1, 6: 4, 7: 3, 8: 1, 9: 1, 10: 2, 11: 2, 12: 2, 13: 3 };
/** The classes that carry a shield: warrior, paladin, shaman. */
const SHIELDS = new Set([1, 2, 7]);

/** Whether a class can wear an item's armour type; weapons and anything not armour are not judged. */
export function canWear(item: ItemInfo, classId: number | undefined): boolean {
  if (classId === undefined || item.itemClass !== 4) return true;
  if (item.subclass === 6) return SHIELDS.has(classId);
  if (item.subclass !== undefined && item.subclass >= 1 && item.subclass <= 4) return item.subclass <= (ARMOUR[classId] ?? 4);
  return true;
}

const QUALITIES: readonly Quality[] = ['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary'];
export const qualityOf = (item: ItemSummary): Quality => QUALITIES[Math.min(Math.max(item.quality, 0), 5)] ?? 'common';

/** The classes an item is kept to, by name, when it is kept to fewer than every class this game has; undefined when any may use it. */
export function classesOf(item: ItemInfo, classes: readonly { id: number; name: string }[]): { id: number; name: string }[] | undefined {
  if (item.classes === undefined) return undefined;
  const mask = item.classes;
  const allowed = classes.filter((c) => (mask & (1 << (c.id - 1))) !== 0);
  return allowed.length === classes.length ? undefined : allowed;
}

/** An item's tooltip, as the game writes it, for a champion of `classId`. */
export function itemLines(item: ItemInfo, slot: Slot, classId: number | undefined, classes: readonly { id: number; name: string }[]): Line[] {
  const lines: Line[] = [{ left: item.name, kind: 'name', hue: qualityOf(item) }];
  if (item.level) lines.push({ left: `Item Level ${item.level}`, hue: 'gold' });
  const held = heldAs(item, slot);
  const kind = item.kind && item.kind !== held ? item.kind : undefined;
  lines.push({ left: held, ...(kind && { right: kind, rightHue: canWear(item, classId) ? 'white' : 'red' }) });
  const kept = classesOf(item, classes);
  if (kept) lines.push({ left: `Classes: ${kept.map((c) => c.name).join(', ')}`, hue: kept.some((c) => c.id === classId) ? 'white' : 'red' });
  return lines;
}

/** The champion's item level, as the sheet shows it: the average of what is worn. */
export function averageLevel(worn: readonly [Slot, ItemInfo][]): number | undefined {
  const levels = worn.map(([, item]) => item.level ?? 0).filter((level) => level > 0);
  return levels.length > 0 ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : undefined;
}
