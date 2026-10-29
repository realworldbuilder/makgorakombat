import type { ItemSummary, Slot } from '@mogshot/character/equipment';
import { decodeRecord, type ImportedRecord } from '@mogshot/import/record';
import type { ImportResult } from '@mogshot/import/resolve';
import { cleanName } from './saved';

/*
 * A player's own character brought into CREATE YOUR CHAMPION exactly as they are in the game:
 * from the code `/mogshot` shows in the game (pasted), or from what the Mogshot addon wrote into
 * the folder that was dropped. The worker resolves the record against the open folder; what
 * comes back fills the creator, and the player saves it as a champion of their own.
 */

/** The armour's name for gear brought in from the game, as it is saved. */
export const AS_WORN = 'As worn';

/** The address of the addon, for the one line that says where a code comes from. */
export const ADDON_URL = 'https://github.com/realworldbuilder/mogshot/tree/main/addon/Mogshot';

/**
 * The record in a pasted text: the code alone, or the code inside whatever came with it (a chat
 * line, a note, quotes). Undefined when there is no code in it.
 */
export function readCode(text: string): ImportedRecord | undefined {
  const found = text.match(/MOG[12];[^\s"'`]+/);
  return found ? decodeRecord(found[0]) : undefined;
}

/** What the creator fills in from a resolved record. */
export interface Imported {
  name: string;
  raceId: number;
  sex: number;
  classId: number | undefined;
  choices: [number, number][];
  gear: [Slot, number][];
  worn: [Slot, ItemSummary][];
}

/** The creator's fields from a record the worker resolved: the character's own name, look and gear. */
export function importedFrom(record: ImportedRecord, result: ImportResult): Imported {
  return {
    name: cleanName(record.name),
    raceId: result.raceId,
    sex: result.sex,
    classId: result.classId,
    choices: [...result.choices].sort((a, b) => a[0] - b[0]),
    gear: result.gear.map(([slot, item]) => [slot, item.id]),
    worn: result.gear,
  };
}

/** One line on how the import went, and the things that did not come across, for the creator to show. */
export function importReport(record: ImportedRecord, result: ImportResult): { line: string; warnings: string[] } {
  const { found, of } = result.itemsFound;
  const parts = [`${of === 0 ? 'no items' : found === of ? `all ${of} items` : `${found} of ${of} items`}`];
  if (result.choicesApplied) {
    const { applied, of: looks } = result.choicesApplied;
    parts.push(applied === looks ? `the face and hair (${looks} choices)` : `${applied} of ${looks} face and hair choices`);
  }
  const warnings = [...result.problems];
  // The addon reads the look only while the barber's chair is open; a code without it is gear alone.
  if (record.choices.length === 0) warnings.push('No face or hair came with it: sit in a barber\'s chair in the game, then /mogshot again for a new code.');
  return { line: `${cleanName(record.name) || record.name}: ${parts.join(' and ')}.`, warnings };
}
