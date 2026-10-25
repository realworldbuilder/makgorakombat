import { cpuInputs } from './cpu';
import { type Inputs, type Match, noInputs } from './engine';

export type InputAction = 'left' | 'right' | 'jump' | 'attack' | 'ability1' | 'ability2' | 'ability3';
export type InputSource = 'keyboard' | 'gamepad' | 'cpu';

export type KeyMap = Record<InputAction, readonly string[]>;

/** Which keys the two players hold: the fighting-game set, or the game's own keys for player 1. */
export type KeyLayout = 'classic' | 'wow';

const WASD: KeyMap = {
  left: ['KeyA'],
  right: ['KeyD'],
  jump: ['KeyW'],
  attack: ['KeyJ'],
  ability1: ['KeyK'],
  ability2: ['KeyL'],
  ability3: ['KeyU'],
};

const ARROWS_NUMPAD: KeyMap = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  jump: ['ArrowUp'],
  attack: ['Comma', 'Numpad0'],
  ability1: ['Period', 'Numpad1'],
  ability2: ['Slash', 'Numpad2'],
  ability3: ['ShiftRight', 'Numpad3'],
};

/** The keys World of Warcraft itself is played with: the arrows move and jump, 1 is the attack, 2 3 4 the action bar. */
const ARROWS_DIGITS: KeyMap = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  jump: ['ArrowUp'],
  attack: ['Digit1'],
  ability1: ['Digit2'],
  ability2: ['Digit3'],
  ability3: ['Digit4'],
};

/** The two players' keys under each layout: on 'wow' player 1 takes the arrows and the digits, and player 2 the WASD set. */
export const KEY_LAYOUTS: Readonly<Record<KeyLayout, readonly [KeyMap, KeyMap]>> = {
  classic: [WASD, ARROWS_NUMPAD],
  wow: [ARROWS_DIGITS, WASD],
};

/**
 * KeyboardEvent.code values per player and action, for the layout in force. Exported so the UI
 * can show the controls; read it when needed rather than copying it, since `setKeyLayout` swaps
 * both entries. Blocking is passive, as in the game: a shield blocks and a weapon parries on the
 * hit table.
 */
export const KEYS: [KeyMap, KeyMap] = [WASD, ARROWS_NUMPAD];

const LAYOUT_STORAGE = 'makgora.keys';
let layout: KeyLayout = 'classic';

/** The layout in force. */
export function keyLayout(): KeyLayout {
  return layout;
}

/** Switch both players' keys, and remember the choice in this browser. */
export function setKeyLayout(next: KeyLayout): void {
  layout = next;
  [KEYS[0], KEYS[1]] = KEY_LAYOUTS[next];
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LAYOUT_STORAGE, next);
  } catch {
    // Storage may be blocked; the choice then lasts for this visit.
  }
}

/** A word for each layout, for the screens. */
export const LAYOUT_WORDS: Readonly<Record<KeyLayout, string>> = { classic: 'WASD + J K L U', wow: 'arrows + 1 2 3 4' };

try {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(LAYOUT_STORAGE) === 'wow') setKeyLayout('wow');
} catch {
  // No storage: the fighting-game keys.
}

/** Keys the screens handle themselves. N on the roster opens CREATE YOUR CHAMPION. */
export const MENU_KEYS = { rematch: 'Enter', back: 'Escape', debug: 'F3', layout: 'KeyC', create: 'KeyN' } as const;

/** What a key does on the menus that both players steer: the roster, and the creator. */
export type RosterAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'sex' | 'classPrev' | 'classNext';
export type RosterKeys = Readonly<Record<string, RosterAction>>;

const WASD_ROSTER: RosterKeys = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right', KeyJ: 'confirm', KeyH: 'back', KeyU: 'sex', KeyK: 'classPrev', KeyL: 'classNext' };
const ARROWS_ROSTER: RosterKeys = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Numpad1: 'confirm', Comma: 'confirm', Numpad4: 'back', KeyM: 'back',
  Numpad0: 'sex', ShiftRight: 'sex', Numpad2: 'classPrev', Period: 'classPrev', Numpad3: 'classNext', Slash: 'classNext',
};
/** The game's own keys on the roster: the arrows move, 1 or Enter chooses, Backspace goes back, 4 switches sex, 2 and 3 cycle the class. */
const DIGITS_ROSTER: RosterKeys = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Digit1: 'confirm', Enter: 'confirm', Backspace: 'back', Digit4: 'sex', Digit2: 'classPrev', Digit3: 'classNext',
};

/** The roster keys per player under each layout, matching the fight's. */
export const ROSTER_KEYS: Readonly<Record<KeyLayout, readonly [RosterKeys, RosterKeys]>> = {
  classic: [WASD_ROSTER, ARROWS_ROSTER],
  wow: [DIGITS_ROSTER, WASD_ROSTER],
};

/** Short labels for the HUD's controls hint and action bar. */
export const KEY_LABELS: Readonly<Record<string, string>> = {
  KeyA: 'A', KeyD: 'D', KeyW: 'W', KeyU: 'U', KeyJ: 'J', KeyK: 'K', KeyL: 'L',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Enter: 'ENTER', Backspace: 'BACKSPACE',
  ShiftRight: 'R SHIFT', Numpad0: 'NUM 0', Numpad1: 'NUM 1', Numpad2: 'NUM 2', Numpad3: 'NUM 3',
  Comma: ',', Period: '.', Slash: '/',
};

/** The label of a player's first key for an action. */
export function keyLabel(player: 0 | 1, action: InputAction): string {
  const code = KEYS[player][action][0] ?? '';
  return KEY_LABELS[code] ?? code;
}

/** Short labels for a standard gamepad's buttons per action. */
export const GAMEPAD_LABELS: Readonly<Record<InputAction, string>> = {
  left: '←', right: '→', jump: 'Y', attack: 'RT', ability1: 'A', ability2: 'B', ability3: 'X',
};

/** The label of a player's key or button for an action, by what they play with; the CPU is shown player 2's keys. */
export function actionLabel(player: 0 | 1, source: InputSource, action: InputAction): string {
  return source === 'gamepad' ? GAMEPAD_LABELS[action] : keyLabel(player, action);
}

/** Standard-mapping gamepad buttons per action: abilities on A B X, auto-attack on the right trigger, jump on Y, the bumpers or up. */
export const GAMEPAD_BUTTONS: Record<InputAction, readonly number[]> = {
  left: [14],
  right: [15],
  jump: [3, 4, 5, 12],
  attack: [7, 6],
  ability1: [0],
  ability2: [1],
  ability3: [2],
};

const ACTIONS: readonly InputAction[] = ['left', 'right', 'jump', 'attack', 'ability1', 'ability2', 'ability3'];
const EDGE: readonly InputAction[] = ['jump', 'ability1', 'ability2', 'ability3'];
const ABILITIES: readonly InputAction[] = ['ability1', 'ability2', 'ability3'];
const PREVENT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Tab', 'Slash']);

type Listener = (event: KeyboardEvent) => void;

interface Target {
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
}

/** The raw button state of one player, before edge detection. */
type Held = Record<InputAction, boolean>;

function heldNone(): Held {
  return { left: false, right: false, jump: false, attack: false, ability1: false, ability2: false, ability3: false };
}

/**
 * Turns the keyboard and gamepads into per-tick inputs for two players. Attach it to the stage
 * element (give it `tabIndex=0` and focus it) and call `read()` once per engine tick: jump and
 * the abilities are true only on the tick after the button went down; attack is held, and a tap
 * shorter than a tick still shows as one tick held. A player whose source is 'cpu' gets
 * `cpuInputs` when `read` is given the match. Safe to import where there is no window.
 */
export class InputReader {
  private readonly down = new Set<string>();
  private readonly previous: [Held, Held] = [heldNone(), heldNone()];
  private readonly sources: [InputSource, InputSource] = ['keyboard', 'keyboard'];
  private readonly gamepadIndex: [number | undefined, number | undefined] = [undefined, undefined];
  private target: Target | undefined;
  /** Keys that went down since the last read, so a tap shorter than a tick still counts. */
  private readonly tapped = new Set<string>();
  private readonly onKeyDown: Listener = (event) => {
    if (PREVENT.has(event.code)) event.preventDefault();
    if (this.mapped(event.code)) event.preventDefault();
    if (!event.repeat && !this.down.has(event.code)) this.tapped.add(event.code);
    this.down.add(event.code);
  };
  private readonly onKeyUp: Listener = (event) => {
    this.down.delete(event.code);
  };
  private readonly onBlur = (): void => {
    this.down.clear();
  };

  attach(element: Target): void {
    this.detach();
    this.target = element;
    element.addEventListener('keydown', this.onKeyDown);
    element.addEventListener('keyup', this.onKeyUp);
    element.addEventListener('blur', this.onBlur as unknown as Listener);
  }

  detach(): void {
    if (!this.target) return;
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur as unknown as Listener);
    this.target = undefined;
    this.down.clear();
  }

  setSource(player: 0 | 1, source: InputSource, gamepadIndex?: number): void {
    this.sources[player] = source;
    this.gamepadIndex[player] = gamepadIndex;
    this.previous[player] = heldNone();
  }

  source(player: 0 | 1): InputSource {
    return this.sources[player];
  }

  /** Is this key down right now? For the screens' own keys. */
  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** Feed a key by hand, for tests or on-screen buttons. */
  press(code: string): void {
    if (!this.down.has(code)) this.tapped.add(code);
    this.down.add(code);
  }

  release(code: string): void {
    this.down.delete(code);
  }

  read(match?: Match): [Inputs, Inputs] {
    const out: [Inputs, Inputs] = [this.readPlayer(0, match), this.readPlayer(1, match)];
    this.tapped.clear();
    return out;
  }

  private mapped(code: string): boolean {
    for (const map of KEYS) for (const action of ACTIONS) if (map[action].includes(code)) return true;
    return false;
  }

  private readPlayer(player: 0 | 1, match: Match | undefined): Inputs {
    const source = this.sources[player];
    if (source === 'cpu') {
      return match ? cpuInputs(match, player) : noInputs();
    }
    const held = source === 'gamepad' ? this.gamepadHeld(player) : this.keyboardHeld(player);
    const previous = this.previous[player];
    const edges = heldNone();
    for (const action of ACTIONS) {
      edges[action] = EDGE.includes(action) ? held[action] && !previous[action] : held[action];
    }
    // A key pressed and released between two reads is an edge too: it was never seen held.
    if (source !== 'gamepad') {
      const map = KEYS[player];
      for (const action of [...EDGE, 'attack'] as InputAction[]) {
        if (!edges[action] && map[action].some((code) => this.tapped.has(code))) edges[action] = true;
      }
    }
    this.previous[player] = held;
    const out = noInputs();
    out.left = edges.left;
    out.right = edges.right;
    out.jump = edges.jump;
    out.attack = edges.attack;
    ABILITIES.forEach((action, n) => {
      out.abilities[n] = edges[action];
    });
    return out;
  }

  private keyboardHeld(player: 0 | 1): Held {
    const map = KEYS[player];
    const held = heldNone();
    for (const action of ACTIONS) held[action] = map[action].some((code) => this.down.has(code));
    return held;
  }

  private gamepadHeld(player: 0 | 1): Held {
    const held = heldNone();
    const pad = this.gamepad(player);
    if (!pad) return held;
    for (const action of ACTIONS) {
      held[action] = GAMEPAD_BUTTONS[action].some((b) => pad.buttons[b]?.pressed === true);
    }
    const stick = pad.axes[0] ?? 0;
    if (stick < -0.5) held.left = true;
    if (stick > 0.5) held.right = true;
    return held;
  }

  private gamepad(player: 0 | 1): Gamepad | undefined {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return undefined;
    const pads = navigator.getGamepads();
    const wanted = this.gamepadIndex[player];
    if (wanted !== undefined) return pads[wanted] ?? undefined;
    // No index given: the first pad goes to the first player using one, the second to the other.
    const connected = Array.from(pads).filter((p): p is Gamepad => p !== null && p !== undefined);
    const nth = this.sources[0] === 'gamepad' && this.sources[1] === 'gamepad' ? player : 0;
    return connected[nth];
  }
}

/** Is there a window to read keys from? False in node tests. */
export const HAS_WINDOW = typeof window !== 'undefined';
