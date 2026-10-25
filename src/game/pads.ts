import { useEffect, useState } from 'preact/hooks';
import { GAMEPAD_BUTTONS, type InputAction, KEY_LAYOUTS, KEYS, keyLayout, type KeyLayout, ROSTER_KEYS, type RosterAction } from '../engine/input';

/*
 * Controllers. A pad plays as its player's keys: each frame the pads are read, and their buttons
 * become the key presses that player's keyboard would make, sent to the window where every screen
 * listens. So the roster, the creator, the VS screen, the fight and the panels all take a
 * controller with no code of their own, and online a pad plays as this keyboard does.
 *
 * What a button presses depends on the screen (`usePadMode`): on the menus the d-pad is the
 * arrows, A or Start is Enter and B or Back is Escape; on the roster and the creator each pad
 * steers its own player's cursor (A choose, B back, Y ♂/♀, LB/RB the class, X player 2's
 * opponent); in the fight A B X are the abilities, the triggers attack, Y, the bumpers or up jump,
 * Start is Enter (the rematch) and Back is Escape.
 *
 * The first pad plays player 1 and the second player 2, unless player 2 was set to PAD on the
 * roster and only one is plugged in: then that one is player 2's.
 */

export type PadMode = 'menu' | 'roster' | 'fight';

/** A pad's controls, by name, read off the standard mapping. */
export type Control = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'lt' | 'rt' | 'back' | 'start' | 'up' | 'down' | 'left' | 'right';

const BUTTONS: Readonly<Record<Exclude<Control, 'up' | 'down' | 'left' | 'right'>, number>> = {
  a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9,
};
const DPAD = { up: 12, down: 13, left: 14, right: 15 } as const;
/** The control each standard button number is. */
const BY_BUTTON: ReadonlyMap<number, Control> = new Map(Object.entries({ ...BUTTONS, ...DPAD }).map(([name, index]) => [index, name as Control]));

/** The stick counts as a direction past this, and lets go of it under the second, so it does not chatter at the edge. */
const STICK_ON = 0.5;
const STICK_OFF = 0.3;
/** A direction held on the menus steps again after this, and then every so often. */
const REPEAT_AFTER_MS = 380;
const REPEAT_EVERY_MS = 110;

/** The buttons and stick of one pad as plain data, so the mapping can be tested without a browser. */
export interface PadState {
  buttons: readonly boolean[];
  axes: readonly number[];
}

/** The controls a pad holds now; `before` is what it held last frame, for the stick's two thresholds. */
export function controlsOf(pad: PadState, before: ReadonlySet<Control> = new Set()): Set<Control> {
  const held = new Set<Control>();
  for (const [name, index] of Object.entries(BUTTONS) as [Control, number][]) if (pad.buttons[index]) held.add(name);
  for (const [name, index] of Object.entries(DPAD) as [Control, number][]) if (pad.buttons[index]) held.add(name);
  const [x = 0, y = 0] = pad.axes;
  const stick = (name: Control, value: number) => {
    if (value > (before.has(name) ? STICK_OFF : STICK_ON)) held.add(name);
  };
  stick('left', -x);
  stick('right', x);
  stick('up', -y);
  stick('down', y);
  return held;
}

/** The first key a player's roster map gives an action. */
function rosterKey(layout: KeyLayout, player: 0 | 1, action: RosterAction): string | undefined {
  const keys = ROSTER_KEYS[layout][player];
  return Object.keys(keys).find((code) => keys[code] === action);
}

const FIGHT_ACTIONS: readonly InputAction[] = ['left', 'right', 'jump', 'attack', 'ability1', 'ability2', 'ability3'];

/** The keys a pad's controls press for its player, on a screen of this kind, under this key layout. */
export function keysFor(mode: PadMode, player: 0 | 1, layout: KeyLayout, controls: ReadonlySet<Control>): Set<string> {
  const out = new Set<string>();
  const add = (code: string | undefined) => {
    if (code) out.add(code);
  };
  if (controls.has('start')) add('Enter');
  if (controls.has('back')) add('Escape');
  if (mode === 'fight') {
    const map = KEY_LAYOUTS[layout][player];
    for (const action of FIGHT_ACTIONS) {
      // The stick is the d-pad: left, right, and up to jump.
      if (GAMEPAD_BUTTONS[action].some((b) => controls.has(BY_BUTTON.get(b)!))) add(map[action][0]);
    }
  } else if (mode === 'roster') {
    const pairs: [Control, RosterAction][] = [
      ['up', 'up'], ['down', 'down'], ['left', 'left'], ['right', 'right'],
      ['a', 'confirm'], ['b', 'back'], ['y', 'sex'], ['lb', 'classPrev'], ['rb', 'classNext'],
    ];
    for (const [control, action] of pairs) if (controls.has(control)) add(rosterKey(layout, player, action));
    // Who player 2 is (a friend, the computer, a pad) is player 1's to change.
    if (controls.has('x') && player === 0) add('Tab');
  } else {
    const arrows: [Control, string][] = [['up', 'ArrowUp'], ['down', 'ArrowDown'], ['left', 'ArrowLeft'], ['right', 'ArrowRight']];
    for (const [control, code] of arrows) if (controls.has(control)) add(code);
    if (controls.has('a')) add('Enter');
    if (controls.has('b')) add('Escape');
  }
  return out;
}

/** Which pad (by its place among those plugged in) plays each player. */
export function seatsOf(count: number, p2HasPad: boolean): [number | undefined, number | undefined] {
  if (count === 0) return [undefined, undefined];
  if (count === 1) return p2HasPad ? [undefined, 0] : [0, undefined];
  return [0, 1];
}

/** The `key` a real key press would carry, for the few listeners that read it. */
function keyOf(code: string): string {
  if (code.startsWith('Key')) return code.slice(3).toLowerCase();
  if (code.startsWith('Digit')) return code.slice(5);
  return ({ Comma: ',', Period: '.', Slash: '/', Space: ' ' } as Record<string, string>)[code] ?? code;
}

const modes: PadMode[] = [];
const mode = (): PadMode => modes[modes.length - 1] ?? 'menu';
let p2HasPad = false;
/** Per pad (by its index in the browser's list): the controls held last frame, and those held through a change of screen, which wait to be let go. */
const before = new Map<number, Set<Control>>();
const stale = new Map<number, Set<Control>>();
/** The keys the pads hold down now, and when each went down or last repeated. */
const down = new Map<string, number>();
let frame = 0;
/** Whether each player last played with a pad or the keyboard, so the screens show the right buttons. */
const onPad: [boolean, boolean] = [false, false];
const watchers = new Set<() => void>();

function send(type: 'keydown' | 'keyup', code: string): void {
  window.dispatchEvent(new KeyboardEvent(type, { code, key: keyOf(code), bubbles: true, cancelable: true }));
}

function setOnPad(player: 0 | 1, value: boolean): void {
  if (onPad[player] === value) return;
  onPad[player] = value;
  for (const watcher of watchers) watcher();
}

/** Lets go of every key the pads hold, and makes every control now held wait to be released before it counts again. */
function reset(): void {
  for (const code of down.keys()) send('keyup', code);
  down.clear();
  for (const [index, held] of before) stale.set(index, new Set(held));
}

function poll(now: number): void {
  frame = 0;
  const pads = Array.from(navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => p !== null && p !== undefined && p.connected);
  const seats = seatsOf(pads.length, p2HasPad);
  const layout = keyLayout();
  const wanted = new Set<string>();
  const directions = new Set<string>();
  pads.forEach((pad, place) => {
    const controls = controlsOf({ buttons: pad.buttons.map((b) => b.pressed), axes: pad.axes }, before.get(pad.index));
    before.set(pad.index, controls);
    const waiting = stale.get(pad.index);
    for (const control of waiting ?? []) {
      if (controls.has(control)) controls.delete(control);
      else waiting!.delete(control);
    }
    const player = seats[0] === place ? 0 : seats[1] === place ? 1 : undefined;
    if (player === undefined) return;
    if (controls.size > 0) setOnPad(player, true);
    for (const code of keysFor(mode(), player, layout, controls)) wanted.add(code);
    if (mode() !== 'fight') for (const code of keysFor(mode(), player, layout, new Set(['up', 'down', 'left', 'right'] as const))) if (wanted.has(code)) directions.add(code);
  });
  for (const code of [...down.keys()]) {
    if (!wanted.has(code)) {
      down.delete(code);
      send('keyup', code);
    }
  }
  for (const code of wanted) {
    const since = down.get(code);
    if (since === undefined) {
      down.set(code, now);
      send('keydown', code);
    } else if (directions.has(code) && now - since >= REPEAT_AFTER_MS) {
      // Held on a menu, the cursor keeps stepping: a fresh press each time, as the screens step on presses.
      down.set(code, now - REPEAT_AFTER_MS + REPEAT_EVERY_MS);
      send('keyup', code);
      send('keydown', code);
    }
  }
  if (pads.length > 0) frame = requestAnimationFrame(poll);
  else {
    before.clear();
    stale.clear();
  }
}

function wake(): void {
  if (!frame) frame = requestAnimationFrame(poll);
}

if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
  // The browser shows a pad to the page once one of its buttons is pressed.
  window.addEventListener('gamepadconnected', wake);
  window.addEventListener('gamepaddisconnected', wake);
  // A real key press for a player's keys puts that player back on the keyboard.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!event.isTrusted) return;
      for (const player of [0, 1] as const) {
        const fight = Object.values(KEYS[player]).some((codes) => codes.includes(event.code));
        if (fight || ROSTER_KEYS[keyLayout()][player][event.code]) setOnPad(player, false);
      }
    },
    true,
  );
  wake();
}

/** What the pads press while this screen is up: the newest screen that asks has them. */
export function usePadMode(wanted: PadMode): void {
  useEffect(() => {
    modes.push(wanted);
    reset();
    return () => {
      const at = modes.lastIndexOf(wanted);
      if (at >= 0) modes.splice(at, 1);
      reset();
    };
  }, [wanted]);
}

/** Player 2 was set to PAD on the roster: a lone pad is theirs, and player 1 has the keyboard. */
export function setPadForPlayer2(on: boolean): void {
  if (p2HasPad === on) return;
  p2HasPad = on;
  reset();
}

/** Did this player last play with a pad? */
export function usingPad(player: 0 | 1): boolean {
  return onPad[player];
}

/** Whether each player is on a pad, kept current for a screen. */
export function usePadUse(): readonly [boolean, boolean] {
  const [use, setUse] = useState<readonly [boolean, boolean]>([onPad[0], onPad[1]]);
  useEffect(() => {
    const watcher = () => setUse([onPad[0], onPad[1]]);
    watchers.add(watcher);
    watcher();
    return () => {
      watchers.delete(watcher);
    };
  }, []);
  return use;
}
