import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ClassEntry, Race } from '@mogshot/character/appearance';
import type { ItemSetInfo, ItemSummary, Slot } from '@mogshot/character/equipment';
import { capturedAgo, type ImportedRecord } from '@mogshot/import/record';
import { BRAND } from '../engine/brand';
import { keyLayout, MENU_KEYS, ROSTER_KEYS } from '../engine/input';
import type { BuiltFighter, Champion, Fighters } from './fighters';
import { headshotOf } from './headshot';
import { ADDON_URL, AS_WORN, importedFrom, importReport, readCode } from './importing';
import { usePadMode } from './pads';
import { averageLevel, CLASS_COLOURS, DOLL_SLOTS, equip, type ItemInfo, SLOT_NAMES } from './slots';
import { ItemPicker, PaperDoll } from './PaperDoll';
import { Preview } from './Preview';
import { classesOf, rosterTiles, sexFor } from './roster';
import { cleanName, defaultName, fullName, isBuiltin, madeKey, NAME_LENGTH, newSavedId, type SavedChampion } from './saved';
import { iconsFor } from './ui/icons';
import { BAG_CLOSE, BAG_OPEN, pickUpFile, playFile, putDownFile, SHEET_CLOSE, SHEET_OPEN } from './uiSound';
import { type Line, type Quality, WowTooltip } from './ui/WowTooltip';

/*
 * CREATE YOUR CHAMPION, over the roster: the champion drawn full size on one side and a short
 * column of drop-downs on the other, as the game's own character creation screen has them:
 * race, sex, class, every appearance option the model offers for that race and sex, the armour
 * (the class's sets by name, or a random outfit), and a name. Round the champion are the slots of
 * the game's character sheet (PaperDoll.tsx): a click on one, or J on the Gear row, chooses
 * what goes there from every item the folder has for it. Each change rebuilds the champion
 * after a moment; the builds go through the fighter cache under a key of the look, so the tile
 * on the roster afterwards is the same build. Opened on a champion built into the game, it shows
 * that champion and says so, with nothing to change and only CANCEL to press. A character of the
 * player's own comes in exactly as they are in the game (importing.ts): picked from those the
 * folder's Mogshot file lists, or from the code `/mogshot` shows, pasted into the Code row.
 */

interface CreateProps {
  races: Race[];
  classes: ClassEntry[];
  /** Race portraits by `${race.key}:${sex}` and class icons by class key, as data URLs. */
  portraits: { races: Map<string, string>; classes: Map<string, string> };
  fighters: Fighters;
  /** The champions made before, for the list at the top. */
  saved: SavedChampion[];
  /** The player's characters the Mogshot addon wrote into the folder, to bring in as they are. */
  records: ImportedRecord[];
  /** The one opened on, when it is an edit. */
  editing: SavedChampion | undefined;
  onSave: (champion: SavedChampion) => void;
  onDelete: (id: string) => void;
  onCancel: () => void;
}

/** Where the armour comes from: a set of the class (the best one until the sets are read), a random outfit, nothing, pieces chosen slot by slot, or what a saved champion wore. */
type Armour = { kind: 'set'; id?: number } | { kind: 'random' } | { kind: 'none' } | { kind: 'own' } | { kind: 'kept'; label: string };

/** The armour's name for gear chosen slot by slot, as it is saved. */
const OWN = 'Hand-picked';

interface Draft {
  /** Set when editing a saved champion. */
  id: string | undefined;
  raceId: number;
  sex: number;
  classId: number | undefined;
  /** The options the player changed, by option id; the rest are the model's defaults. */
  choices: [number, number][];
  gear: [Slot, number][];
  /** What the gear is, for the armour's tooltip; empty for a saved champion's until it is changed. */
  worn: [Slot, ItemSummary][];
  armour: Armour;
  name: string;
  /** The player typed the name, so a change of race keeps it. */
  named: boolean;
}

interface Choice {
  value: string;
  label: string;
  group?: string;
}

type Row =
  | { kind: 'select'; key: string; label: string; value: string; choices: Choice[]; change: (value: string) => void; icon?: string; swatch?: string }
  | { kind: 'wait'; key: string; label: string }
  | { kind: 'gear'; key: 'gear' }
  | { kind: 'name'; key: 'name' }
  | { kind: 'code'; key: 'code' }
  | { kind: 'actions'; key: 'actions' };

type Button = 'save' | 'cancel' | 'delete';

const BUILD_MS = 300;
/** Epic and better, as Mogshot's own random outfit. */
const RANDOM_QUALITY = 4;
const QUALITIES: readonly Quality[] = ['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary'];
const FACTION_WORDS = { alliance: 'Alliance', neutral: 'Neutral', unknown: 'Neutral', horde: 'Horde' } as const;

const setGear = (set: ItemSetInfo): [Slot, ItemSummary][] => [...set.pieces, ...set.weapons];
const ids = (worn: readonly [Slot, ItemSummary][]): [Slot, number][] => worn.map(([slot, item]) => [slot, item.id]);

/** A new champion: the first race on the creation screen, its first class, the class's best set. */
function freshDraft(race: Race, classes: readonly ClassEntry[]): Draft {
  return {
    id: undefined,
    raceId: race.id,
    sex: sexFor(race, 0),
    classId: classesOf(race, classes)[0]?.id,
    choices: [],
    gear: [],
    worn: [],
    armour: { kind: 'set' },
    name: defaultName(race),
    named: false,
  };
}

function savedDraft(saved: SavedChampion): Draft {
  return {
    id: saved.id,
    raceId: saved.raceId,
    sex: saved.sex,
    classId: saved.classId,
    choices: saved.choices,
    gear: saved.gear,
    worn: [],
    armour:
      saved.armour === 'Random' ? { kind: 'random' }
      : saved.armour === 'None' ? { kind: 'none' }
      : saved.armour === OWN ? { kind: 'own' }
      : { kind: 'kept', label: saved.armour ?? 'Their own' },
    name: saved.name,
    named: true,
  };
}

/** The armour a class change leaves: a set follows the class (its best set); a random outfit, none, or pieces chosen by hand stay. */
const armourFor = (armour: Armour): Armour => (armour.kind === 'random' || armour.kind === 'none' || armour.kind === 'own' ? armour : { kind: 'set' });

export function Create({ races, classes, portraits, fighters, saved, records, editing, onSave, onDelete, onCancel }: CreateProps) {
  usePadMode('roster');
  const order = useMemo(() => rosterTiles(races).flatMap((tile) => (tile.kind === 'race' ? [tile.race] : [])), [races]);
  const [draft, setDraft] = useState<Draft>(() => (editing ? savedDraft(editing) : freshDraft(order[0]!, classes)));
  const [sets, setSets] = useState<{ classId: number; list: ItemSetInfo[] }>();
  const [built, setBuilt] = useState<BuiltFighter>();
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string>();
  const [row, setRow] = useState(0);
  // A champion that comes with the game is shown, not changed: no rows to step through, CANCEL alone.
  const builtin = editing !== undefined && isBuiltin(editing.id);
  const [button, setButton] = useState<Button>(builtin ? 'cancel' : 'save');
  const [deleting, setDeleting] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  // A character brought in from the game: which of the folder's, the pasted code, and how it went.
  const [fromGame, setFromGame] = useState('');
  const [code, setCode] = useState('');
  const [report, setReport] = useState<{ line: string; warnings: string[] }>();
  const [importing, setImporting] = useState(false);
  const request = useRef(0);
  // The slot whose picker is open, and the slot the Gear row's arrows are on.
  const [picking, setPicking] = useState<Slot>();
  const [dollAt, setDollAt] = useState(0);
  const pickerKeys = useRef<((event: KeyboardEvent) => void) | undefined>(undefined);
  const icons = useMemo(() => iconsFor({ client: fighters.client, races, portraits }), [fighters, races, portraits]);
  const sound = (fileId: number | undefined) => playFile(fighters.client, fileId);

  // The sheet opens and closes with the game's own sounds, and the picker with a bag's.
  useEffect(() => {
    sound(SHEET_OPEN);
    return () => sound(SHEET_CLOSE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const wasPicking = useRef(false);
  useEffect(() => {
    if (picking && !wasPicking.current) sound(BAG_OPEN);
    wasPicking.current = picking !== undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking]);
  const closePicker = () => {
    sound(BAG_CLOSE);
    setPicking(undefined);
  };

  const race = races.find((r) => r.id === draft.raceId) ?? order[0]!;
  const classEntry = classes.find((c) => c.id === draft.classId);

  // The class's sets, best first; then a set waiting on them is resolved to one (or to nothing, for a class with none).
  useEffect(() => {
    const classId = draft.classId;
    if (classId === undefined) return;
    let stale = false;
    fighters.setsOf(classId).then(
      (list) => !stale && setSets({ classId, list: [...list].sort((a, b) => b.level - a.level) }),
      (cause: unknown) => {
        console.warn('The sets could not be read:', cause);
        if (!stale) setSets({ classId, list: [] });
      },
    );
    return () => {
      stale = true;
    };
  }, [draft.classId, fighters]);

  const classSets = sets && sets.classId === draft.classId ? sets.list : undefined;
  useEffect(() => {
    if (!classSets) return;
    const { armour } = draft;
    if (armour.kind === 'set' && armour.id === undefined) {
      const best = classSets[0];
      setDraft((d) => (best ? { ...d, armour: { kind: 'set', id: best.id }, gear: ids(setGear(best)), worn: setGear(best) } : { ...d, armour: { kind: 'none' }, gear: [], worn: [] }));
    } else if (armour.kind === 'kept') {
      // A saved champion in a set it still has reads as that set, with its pieces for the tooltip.
      const set = classSets.find((s) => s.name === armour.label);
      if (set) setDraft((d) => ({ ...d, armour: { kind: 'set', id: set.id }, worn: setGear(set) }));
    }
  }, [classSets, draft.armour]);

  // Gear known only by id (a saved champion's) is read for the slots' icons and names.
  const unread = draft.gear.filter(([slot, id]) => !draft.worn.some(([s, item]) => s === slot && item.id === id));
  const unreadKey = unread.map(([slot, id]) => `${slot}=${id}`).join(',');
  useEffect(() => {
    if (unread.length === 0) return;
    let stale = false;
    void fighters.itemsOf(unread).then((found) => {
      if (stale || found.length === 0) return;
      setDraft((d) => ({
        ...d,
        worn: [...d.worn.filter(([slot]) => !found.some(([s]) => s === slot)), ...found.filter(([slot, item]) => d.gear.some(([s, id]) => s === slot && id === item.id))],
      }));
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadKey, fighters]);

  // The class has no sets read yet, or no class: the armour cannot wait for them.
  const gearReady = !(draft.armour.kind === 'set' && draft.armour.id === undefined) || draft.classId === undefined;

  const champion: Champion = {
    key: madeKey(draft.raceId, draft.sex, draft.classId, draft.choices, draft.gear),
    name: (builtin && editing ? fullName(editing) : cleanName(draft.name) || defaultName(race)).toUpperCase(),
    title: `${race.name.toUpperCase()} ${classEntry?.name.toUpperCase() ?? ''}`.trim(),
    raceId: draft.raceId,
    sex: draft.sex,
    classId: draft.classId,
    choices: draft.choices,
    gear: draft.gear,
  };

  // Rebuilt a moment after the last change; the older build stays in view until the new one is ready.
  useEffect(() => {
    if (!gearReady) return;
    const id = ++request.current;
    setBuilding(true);
    const timer = setTimeout(() => {
      fighters
        .get({ ...champion, choices: [...champion.choices], gear: [...champion.gear] })
        .then((fighter) => {
          if (request.current !== id) return;
          setBuilt(fighter);
          setError(undefined);
        })
        .catch((cause: unknown) => {
          if (request.current === id) setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (request.current === id) setBuilding(false);
        });
    }, BUILD_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [champion.key, gearReady]);

  // ---- the changes ----

  const chooseRace = (raceId: number) =>
    setDraft((d) => {
      const next = races.find((r) => r.id === raceId);
      if (!next || next.id === d.raceId) return d;
      const allowed = classesOf(next, classes);
      const classId = allowed.some((c) => c.id === d.classId) ? d.classId : allowed[0]?.id;
      return {
        ...d,
        raceId: next.id,
        sex: sexFor(next, d.sex),
        classId,
        // Another model: its options are others, so the look starts from its defaults.
        choices: [],
        ...(classId !== d.classId && { armour: armourFor(d.armour) }),
        name: d.named ? d.name : defaultName(next),
      };
    });
  const chooseSex = (sex: number) => setDraft((d) => (builtin || d.sex === sex || !race.sexes.includes(sex) ? d : { ...d, sex, choices: [] }));
  const chooseClass = (classId: number) => setDraft((d) => (d.classId === classId ? d : { ...d, classId, armour: armourFor(d.armour) }));
  const chooseOption = (option: number, choice: number) => setDraft((d) => ({ ...d, choices: [...d.choices.filter(([o]) => o !== option), [option, choice]] }));
  const roll = () => {
    void fighters.randomOutfit(RANDOM_QUALITY).then(
      (outfit) => setDraft((d) => ({ ...d, armour: { kind: 'random' }, gear: ids(outfit), worn: outfit })),
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  };
  const chooseArmour = (value: string) => {
    if (value === 'random') roll();
    else if (value === 'none') setDraft((d) => ({ ...d, armour: { kind: 'none' }, gear: [], worn: [] }));
    else if (value.startsWith('set:')) {
      const set = classSets?.find((s) => s.id === Number(value.slice(4)));
      if (set) setDraft((d) => ({ ...d, armour: { kind: 'set', id: set.id }, gear: ids(setGear(set)), worn: setGear(set) }));
    }
  };
  // One slot changed by hand: the outfit is the player's own from then on. It goes on with its own put-down sound, or comes off with its pick-up.
  const wear = (slot: Slot, item: ItemSummary | undefined) => {
    const off: ItemInfo | undefined = draft.worn.find(([s]) => s === slot)?.[1];
    sound(item ? putDownFile((item as ItemInfo).soundGroup) : pickUpFile(off?.soundGroup));
    setDraft((d) => ({ ...d, armour: { kind: 'own' }, ...equip(d.gear, d.worn, slot, item) }));
  };
  /** The character as they are in the game: everything the creator has, filled from the record the worker resolves against this folder. */
  const bringIn = (record: ImportedRecord) => {
    setImporting(true);
    setPicking(undefined);
    fighters.client
      .resolveImport(record)
      .then((result) => {
        const got = importedFrom(record, result);
        setDraft((d) => ({ ...d, ...got, name: got.name || d.name, named: true, armour: { kind: 'kept', label: AS_WORN } }));
        setReport(importReport(record, result));
      })
      .catch((cause: unknown) => setReport({ line: '', warnings: [cause instanceof Error ? cause.message : String(cause)] }))
      .finally(() => setImporting(false));
  };
  const chooseFromGame = (value: string) => {
    setFromGame(value);
    const record = records[Number(value)];
    if (value !== '' && record) bringIn(record);
  };
  const readPasted = (text: string, saying: boolean) => {
    const record = readCode(text);
    if (record) bringIn(record);
    else if (saying) setReport({ line: '', warnings: [text.trim() ? 'That is not a code from /mogshot: it starts MOG2;' : 'Paste the code /mogshot shows in the game.'] });
  };
  const open = (value: string) => {
    const entry = saved.find((s) => s.id === value);
    setDraft(entry ? savedDraft(entry) : freshDraft(order[0]!, classes));
    setDeleting(false);
    setPicking(undefined);
  };

  const armourLabel = (): string => {
    const { armour } = draft;
    if (armour.kind === 'random') return 'Random';
    if (armour.kind === 'none') return 'None';
    if (armour.kind === 'own') return OWN;
    if (armour.kind === 'kept') return armour.label;
    return classSets?.find((s) => s.id === armour.id)?.name ?? 'None';
  };

  const save = () => {
    if (builtin) return;
    const entry: SavedChampion = {
      id: draft.id ?? newSavedId(),
      name: cleanName(draft.name) || defaultName(race),
      raceId: draft.raceId,
      sex: draft.sex,
      classId: draft.classId,
      choices: [...draft.choices].sort((a, b) => a[0] - b[0]),
      gear: draft.gear,
      armour: armourLabel(),
    };
    // The face for the roster, drawn now from the build in view when it is this champion's.
    if (built?.champion.key === champion.key) headshotOf(built);
    onSave(entry);
  };
  const remove = () => {
    if (!draft.id) return;
    if (!deleting) {
      setDeleting(true);
      return;
    }
    onDelete(draft.id);
  };
  const press = (which: Button) => (which === 'save' ? save() : which === 'cancel' ? onCancel() : remove());
  const buttons: Button[] = builtin ? ['cancel'] : draft.id ? ['save', 'cancel', 'delete'] : ['save', 'cancel'];

  // ---- the rows ----

  const shown = built && built.result.raceId === draft.raceId && built.result.sex === draft.sex ? built : undefined;
  const sceneChoices = new Map(shown?.result.scene.choices ?? []);
  const changed = new Map(draft.choices);

  const rows: Row[] = [];
  if (saved.length > 0) {
    rows.push({
      kind: 'select',
      key: 'champion',
      label: 'Champion',
      value: draft.id ?? 'new',
      choices: [{ value: 'new', label: 'New champion' }, ...[...saved].reverse().map((s) => ({ value: s.id, label: s.name }))],
      change: open,
    });
  }
  if (records.length > 0) {
    rows.push({
      kind: 'select',
      key: 'import',
      label: 'Import',
      value: fromGame,
      choices: [{ value: '', label: 'Your characters…' }, ...records.map((r, i) => ({ value: String(i), label: `${r.name} · ${capturedAgo(r.captured)}` }))],
      change: chooseFromGame,
    });
  }
  rows.push({ kind: 'code', key: 'code' });
  rows.push({
    kind: 'select',
    key: 'race',
    label: 'Race',
    value: String(draft.raceId),
    choices: order.map((r) => ({ value: String(r.id), label: r.name, group: FACTION_WORDS[r.faction] })),
    change: (value) => chooseRace(Number(value)),
    icon: portraits.races.get(`${race.key}:${draft.sex}`),
  });
  rows.push({
    kind: 'select',
    key: 'sex',
    label: 'Sex',
    value: String(draft.sex),
    choices: race.sexes.map((sex) => ({ value: String(sex), label: sex === 1 ? 'Female' : 'Male' })),
    change: (value) => chooseSex(Number(value)),
  });
  const allowed = classesOf(race, classes);
  if (allowed.length > 0) {
    rows.push({
      kind: 'select',
      key: 'class',
      label: 'Class',
      value: String(draft.classId ?? ''),
      choices: allowed.map((c) => ({ value: String(c.id), label: c.name })),
      change: (value) => chooseClass(Number(value)),
      icon: classEntry && portraits.classes.get(classEntry.key),
    });
  }
  if (shown) {
    for (const option of shown.result.scene.options) {
      if (option.hidden) continue;
      const current = changed.get(option.id) ?? sceneChoices.get(option.id);
      // Choices only non-player characters or special classes can use are left out, as on Mogshot's page.
      const offered = option.choices.filter((choice) => choice.available || choice.id === current);
      if (offered.length < 2) continue;
      const colours = offered.every((choice) => choice.swatches.length > 0);
      const now = offered.find((choice) => choice.id === current);
      rows.push({
        kind: 'select',
        key: `option:${option.id}`,
        label: option.name,
        value: String(current ?? offered[0]!.id),
        choices: offered.map((choice, i) => ({ value: String(choice.id), label: choice.name || `${i + 1}` })),
        change: (value) => chooseOption(option.id, Number(value)),
        ...(colours && now && {
          swatch: now.swatches.length > 1 ? `linear-gradient(135deg, ${now.swatches[0]} 50%, ${now.swatches[1]} 50%)` : now.swatches[0],
        }),
      });
    }
  } else {
    rows.push({ kind: 'wait', key: 'appearance', label: 'Appearance' });
  }
  rows.push({
    kind: 'select',
    key: 'armour',
    label: 'Armour',
    value: draft.armour.kind === 'set' ? `set:${draft.armour.id ?? ''}` : draft.armour.kind,
    choices: [
      ...(draft.armour.kind === 'kept' ? [{ value: 'kept', label: draft.armour.label }] : []),
      ...(draft.armour.kind === 'own' ? [{ value: 'own', label: OWN }] : []),
      ...(draft.armour.kind === 'set' && draft.armour.id === undefined ? [{ value: 'set:', label: '…' }] : []),
      ...(classSets ?? []).map((set) => ({ value: `set:${set.id}`, label: set.name })),
      { value: 'random', label: 'Random' },
      { value: 'none', label: 'None' },
    ],
    change: chooseArmour,
  });
  rows.push({ kind: 'gear', key: 'gear' }, { kind: 'name', key: 'name' }, { kind: 'actions', key: 'actions' });
  // A built-in champion: the preview shows the look, and CANCEL is the one thing to press.
  if (builtin) rows.splice(0, rows.length, { kind: 'actions', key: 'actions' });

  const at = Math.min(row, rows.length - 1);
  const here = rows[at]!;

  // The name row takes the keyboard while the cursor is on it.
  useEffect(() => {
    if (here.kind === 'name') nameInput.current?.focus();
    else if (here.kind === 'code') codeInput.current?.focus();
    else if (document.activeElement === nameInput.current || document.activeElement === codeInput.current) (document.activeElement as HTMLElement).blur();
  }, [here.kind]);

  const step = (target: Row, by: 1 | -1) => {
    if (target.kind === 'actions') {
      const i = buttons.indexOf(button);
      setButton(buttons[(i + by + buttons.length) % buttons.length] ?? 'save');
      return;
    }
    if (target.kind === 'gear') {
      setDollAt((i) => (i + by + DOLL_SLOTS.length) % DOLL_SLOTS.length);
      return;
    }
    if (target.kind !== 'select') return;
    // A saved champion's own armour, pieces chosen by hand and the set still being read are shown, but stepped past.
    // So is the Import row's prompt.
    const list = target.choices.filter((choice) => choice.value === target.value || (choice.value !== 'kept' && choice.value !== 'own' && choice.value !== 'set:' && !(target.key === 'import' && choice.value === '')));
    if (list.length < 2) return;
    const i = list.findIndex((choice) => choice.value === target.value);
    // Stepping onto the random entry rolls an outfit.
    target.change(list[(i + by + list.length) % list.length]!.value);
  };

  const pickHere = () => setPicking(DOLL_SLOTS[dollAt]);
  const pasteHere = () => readPasted(codeInput.current?.value ?? '', true);
  const stateRef = useRef({ rows, at, button, step, press, save, roll, onCancel, chooseSex, draft, pickHere, pasteHere });
  stateRef.current = { rows, at, button, step, press, save, roll, onCancel, chooseSex, draft, pickHere, pasteHere };

  // Keys, before the roster's: up and down choose a row, left and right change it, Enter saves, Esc cancels.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const s = stateRef.current;
      const typing = event.target instanceof HTMLInputElement;
      event.stopPropagation();
      // The item picker, while it is open, has the keys: its search, its list, Enter and Esc.
      if (pickerKeys.current) {
        pickerKeys.current(event);
        return;
      }
      // A key held down from the roster (Enter chooses there on the game's keys) must not save or cancel the moment the creator opens.
      if (event.repeat && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        if (!typing) event.preventDefault();
        return;
      }
      if (event.code === MENU_KEYS.back) {
        event.preventDefault();
        s.onCancel();
        return;
      }
      if (event.code === 'Enter' || event.code === 'NumpadEnter') {
        event.preventDefault();
        const current = s.rows[s.at];
        if (current?.kind === 'actions') s.press(s.button);
        else if (current?.kind === 'gear') s.pickHere();
        else if (current?.kind === 'code') s.pasteHere();
        else s.save();
        return;
      }
      if (typing && event.code !== 'ArrowUp' && event.code !== 'ArrowDown') return;
      const [one, two] = ROSTER_KEYS[keyLayout()];
      const action = one[event.code] ?? two[event.code];
      if (!action) return;
      event.preventDefault();
      const current = s.rows[s.at]!;
      switch (action) {
        case 'up': setRow((s.at - 1 + s.rows.length) % s.rows.length); break;
        case 'down': setRow((s.at + 1) % s.rows.length); break;
        case 'left': s.step(current, -1); break;
        case 'right': s.step(current, 1); break;
        case 'confirm':
          if (current.kind === 'actions') s.press(s.button);
          else if (current.kind === 'gear') s.pickHere();
          else if (current.key === 'armour' && s.draft.armour.kind === 'random') s.roll();
          else setRow((s.at + 1) % s.rows.length);
          break;
        case 'sex': s.chooseSex(s.draft.sex === 0 ? 1 : 0); break;
        case 'classPrev':
        case 'classNext': {
          const classRow = s.rows.find((r) => r.key === 'class');
          if (classRow) s.step(classRow, action === 'classNext' ? 1 : -1);
          break;
        }
        case 'back': break;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // ---- the view ----

  const armourTip = (): Line[] => {
    const worn = draft.worn;
    const best = worn.reduce((top, [, item]) => Math.max(top, item.quality), 1);
    const set = draft.armour.kind === 'set' ? classSets?.find((s) => s.id === (draft.armour as { id?: number }).id) : undefined;
    const lines: Line[] = [{ left: armourLabel(), kind: 'name', hue: QUALITIES[Math.min(best, 5)] ?? 'common' }];
    if (set) lines.push({ left: `Item Level ${set.level}`, hue: 'gold' });
    for (const [slot, item] of worn) lines.push({ left: SLOT_NAMES[slot], right: item.name, hue: 'white', rightHue: QUALITIES[Math.min(item.quality, 5)] ?? 'common' });
    if (worn.length === 0 && draft.gear.length > 0) lines.push({ left: `${draft.gear.length} pieces`, hue: 'grey' });
    if (draft.armour.kind === 'random') lines.push({ kind: 'gap' }, { left: 'Use: Roll another outfit (J, or ROLL).', hue: 'green' });
    return lines;
  };

  const rowView = (r: Row, i: number) => {
    const focus = () => setRow(i);
    const cls = `row ${i === at ? 'here' : ''}`;
    if (r.kind === 'name') {
      return (
        <label class={cls} key={r.key} onMouseDown={focus}>
          <span class="label">Name</span>
          <input
            ref={nameInput}
            type="text"
            value={draft.name}
            maxLength={NAME_LENGTH}
            spellcheck={false}
            autoComplete="off"
            onFocus={focus}
            onInput={(event) => {
              const name = cleanName(event.currentTarget.value);
              event.currentTarget.value = name;
              setDraft((d) => ({ ...d, name, named: true }));
            }}
          />
        </label>
      );
    }
    if (r.kind === 'code') {
      return (
        <label class={`${cls} code`} key={r.key} onMouseDown={focus}>
          <span class="label">Code</span>
          <input
            ref={codeInput}
            type="text"
            value={code}
            placeholder="Paste the code /mogshot shows"
            spellcheck={false}
            autoComplete="off"
            onFocus={focus}
            onInput={(event) => {
              setCode(event.currentTarget.value);
              // A code pasted or dropped in comes in at once; one typed by hand waits for Enter, since half a code already reads as one.
              const how = (event as unknown as InputEvent).inputType;
              if (how === 'insertFromPaste' || how === 'insertFromDrop') readPasted(event.currentTarget.value, true);
            }}
          />
        </label>
      );
    }
    if (r.kind === 'gear') {
      const slot = DOLL_SLOTS[dollAt]!;
      const item = draft.worn.find(([s]) => s === slot)?.[1];
      return (
        <div class={cls} key={r.key} onMouseDown={focus}>
          <span class="label">Gear</span>
          <button type="button" class="arrow" aria-label="Previous slot" tabIndex={-1} onClick={() => step(r, -1)}>‹</button>
          <button type="button" class="gear-pick" tabIndex={-1} onClick={() => setPicking(slot)}>
            <span class="gear-slot">{SLOT_NAMES[slot]}</span>
            <span class={`gear-item ${item ? `h-${QUALITIES[Math.min(item.quality, 5)] ?? 'common'}` : 'dim'}`}>{item?.name ?? (draft.gear.some(([s]) => s === slot) ? '…' : 'Empty')}</span>
          </button>
          <button type="button" class="arrow" aria-label="Next slot" tabIndex={-1} onClick={() => step(r, 1)}>›</button>
        </div>
      );
    }
    if (r.kind === 'actions') {
      return (
        <div class={`${cls} actions`} key={r.key}>
          {buttons.map((which) => (
            <button
              key={which}
              type="button"
              class={`button ${which} ${i === at && button === which ? 'on' : ''}`}
              onMouseDown={() => {
                focus();
                setButton(which);
              }}
              onClick={() => press(which)}
            >
              {which === 'save' ? 'SAVE' : which === 'cancel' ? 'CANCEL' : deleting ? 'SURE?' : 'DELETE'}
            </button>
          ))}
        </div>
      );
    }
    if (r.kind === 'wait') {
      return (
        <div class={`${cls} wait`} key={r.key} onMouseDown={focus}>
          <span class="label">{r.label}</span>
          <span class="dim">{error ? 'Not drawn' : BRAND.summoning}</span>
        </div>
      );
    }
    const groups: { group: string | undefined; choices: Choice[] }[] = [];
    for (const choice of r.choices) {
      const last = groups[groups.length - 1];
      if (last && last.group === choice.group) last.choices.push(choice);
      else groups.push({ group: choice.group, choices: [choice] });
    }
    const options = (list: Choice[]) => list.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>);
    return (
      <div class={cls} key={r.key} onMouseDown={focus}>
        <span class="label">{r.label}</span>
        <button type="button" class="arrow" aria-label={`Previous ${r.label}`} tabIndex={-1} onClick={() => step(r, -1)}>‹</button>
        <span class="pick">
          {r.icon && <img class="icon" src={r.icon} alt="" />}
          {r.swatch && <span class="swatch" style={{ background: r.swatch }} />}
          <select
            value={r.value}
            onFocus={focus}
            onChange={(event) => {
              r.change(event.currentTarget.value);
              event.currentTarget.blur();
            }}
          >
            {groups.map(({ group, choices }) => (group ? <optgroup key={group} label={group}>{options(choices)}</optgroup> : options(choices)))}
          </select>
        </span>
        <button type="button" class="arrow" aria-label={`Next ${r.label}`} tabIndex={-1} onClick={() => step(r, 1)}>›</button>
        {r.key === 'armour' && draft.armour.kind === 'random' && (
          <button type="button" class="button roll" tabIndex={-1} onClick={roll}>ROLL</button>
        )}
      </div>
    );
  };

  const wearer = { classId: draft.classId, classes };
  const itemLevel = averageLevel(draft.worn);
  const missing = built ? built.result.scene.problems.filter((problem) => /is not installed|is not part of this build/.test(problem)) : [];

  return (
    <div class="creator-backdrop">
      <div class="creator">
        <div class="stage">
          <div class="plate-name">
            <div class="name">{champion.name}</div>
            <div class="title">
              {classEntry && portraits.classes.get(classEntry.key) && <img class="class" src={portraits.classes.get(classEntry.key)} alt="" />}
              <span>{race.name.toUpperCase()}</span>
              {classEntry && <span style={{ color: CLASS_COLOURS[classEntry.id] }}>{classEntry.name.toUpperCase()}</span>}
            </div>
            {itemLevel !== undefined && (
              <div class="item-level">
                Item Level <b>{itemLevel}</b>
              </div>
            )}
            {building && <div class="status">{BRAND.summoning}</div>}
            {error && <div class="status bad">{error}</div>}
            {!error && missing.length > 0 && <div class="status bad">{missing.length} piece(s) not in this install: {missing[0]}</div>}
          </div>
          <PaperDoll
            icons={icons}
            worn={draft.worn}
            gear={draft.gear}
            wearer={wearer}
            cursor={picking ?? (here.kind === 'gear' ? DOLL_SLOTS[dollAt] : undefined)}
            picking={picking !== undefined}
            readOnly={builtin}
            onPick={(slot) => {
              setPicking(slot);
              setDollAt(DOLL_SLOTS.indexOf(slot));
            }}
          >
            <Preview fighter={built} locked={false} side="middle" />
          </PaperDoll>
        </div>
        <div class="column">
          <h1>{builtin ? 'BUILT-IN CHAMPION' : draft.id ? 'EDIT YOUR CHAMPION' : 'CREATE YOUR CHAMPION'}</h1>
          {builtin && editing && (
            <p class="built-in">
              {fullName(editing)} comes with the game, so there is nothing here to change or delete. Make a champion of your own with the question mark beside {editing.name}.
            </p>
          )}
          <div class="rows">{rows.map(rowView)}</div>
          {(importing || report || here.kind === 'code' || here.key === 'import') && !builtin && (
            <div class="import-note">
              {importing && <p class="dim">Bringing your character in…</p>}
              {!importing && report?.line && <p class="ok">{report.line}</p>}
              {!importing && report?.warnings.map((warning) => <p class="bad" key={warning}>{warning}</p>)}
              {!report && !importing && (
                <p class="dim">
                  Your character exactly as they are in the game: with the <a href={ADDON_URL} target="_blank" rel="noreferrer">Mogshot addon</a>, sit in a
                  barber's chair once, then type <code>/mogshot</code> and paste the code it shows here.
                </p>
              )}
            </div>
          )}
          {here.key === 'armour' && !picking && <WowTooltip class="armour-tip" lines={armourTip()} />}
          {picking && (
            <ItemPicker
              slot={picking}
              fighters={fighters}
              icons={icons}
              wearer={wearer}
              current={draft.gear.find(([s]) => s === picking)?.[1]}
              keys={pickerKeys}
              onChoose={(item) => {
                wear(picking, item);
                setPicking(undefined);
              }}
              onClose={closePicker}
            />
          )}
          <p class="dim small hint">{builtin ? 'Enter or Esc back to the roster' : '↑ ↓ or W S a row · ← → or A D change it · J on Gear picks an item · Enter save (on Code, brings it in) · Esc cancel'}</p>
        </div>
      </div>
    </div>
  );
}
