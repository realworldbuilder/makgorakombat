import { describe, expect, it } from 'vitest';
import type { ItemSummary } from '@mogshot/character/equipment';
import { encodeRecord, type ImportedRecord } from '@mogshot/import/record';
import type { ImportResult } from '@mogshot/import/resolve';
import { importedFrom, importReport, readCode } from '../../src/game/importing';

const item = (id: number, name: string): ItemSummary => ({ id, name, quality: 4, inventoryType: 1, iconFileId: 0 });

const cassidy: ImportedRecord = {
  key: 'Cassidy-Darkstar',
  name: 'Cassidy',
  realm: 'Darkstar',
  race: '',
  raceId: 4,
  sex: 0,
  classId: 11,
  gear: { chest: 7063, shoulder: 11884, mainHand: 12182 },
  choices: [[40, 699], [41, 721]],
  captured: 0,
};

const resolved: ImportResult = {
  raceId: 4,
  sex: 0,
  classId: 11,
  choices: [[41, 721], [40, 699]],
  gear: [['chest', item(7063, 'Crimson Silk Robe')], ['shoulder', item(11884, 'Moonlit Amice')], ['mainHand', item(12182, 'Staff of Jordan')]],
  choicesApplied: { applied: 2, of: 2 },
  itemsFound: { found: 3, of: 3 },
  problems: [],
  notes: [],
};

describe('importing a character from the game', () => {
  it('reads the code /mogshot shows, alone or inside what was pasted with it', () => {
    const code = encodeRecord(cassidy);
    expect(code.startsWith('MOG2;Cassidy-Darkstar;4;0;11;')).toBe(true);
    for (const pasted of [code, `  ${code}\n`, `[Mogshot]: "${code}" copied`]) {
      const record = readCode(pasted);
      expect(record?.key).toBe('Cassidy-Darkstar');
      expect(record?.gear).toEqual({ shoulder: 11884, chest: 7063, mainHand: 12182 });
      // The short code carries the choice alone; the worker finds its option.
      expect(record?.choices).toEqual([[0, 699], [0, 721]]);
    }
    expect(readCode('Cassidy, night elf druid')).toBeUndefined();
    expect(readCode('MOG2;')).toBeUndefined();
  });

  it('fills the creator with the character as they are: name, race, sex, class, look and gear', () => {
    expect(importedFrom(cassidy, resolved)).toEqual({
      name: 'Cassidy',
      raceId: 4,
      sex: 0,
      classId: 11,
      choices: [[40, 699], [41, 721]],
      gear: [['chest', 7063], ['shoulder', 11884], ['mainHand', 12182]],
      worn: resolved.gear,
    });
    // A name the game allows but the ring does not (an accent is kept, anything not a letter goes).
    expect(importedFrom({ ...cassidy, name: "Zul'jîn" }, resolved).name).toBe('Zuljîn');
  });

  it('says what came across and what did not', () => {
    expect(importReport(cassidy, resolved)).toEqual({ line: 'Cassidy: all 3 items and the face and hair (2 choices).', warnings: [] });
    const partial: ImportResult = {
      ...resolved,
      itemsFound: { found: 2, of: 3 },
      choicesApplied: { applied: 1, of: 2 },
      problems: ['Item 270031 (legs) has no look in the game data'],
    };
    expect(importReport(cassidy, partial)).toEqual({
      line: 'Cassidy: 2 of 3 items and 1 of 2 face and hair choices.',
      warnings: ['Item 270031 (legs) has no look in the game data'],
    });
    const bare = importReport({ ...cassidy, choices: [] }, { ...resolved, choicesApplied: undefined });
    expect(bare.line).toBe('Cassidy: all 3 items.');
    expect(bare.warnings[0]).toMatch(/barber/);
  });
});
