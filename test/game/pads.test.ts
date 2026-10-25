import { describe, expect, it } from 'vitest';
import { type Control, controlsOf, keysFor, seatsOf } from '../../src/game/pads';

/** A pad with these standard buttons down and the stick here. */
const pad = (down: number[], axes: number[] = [0, 0]) => ({ buttons: Array.from({ length: 17 }, (_, n) => down.includes(n)), axes });
const held = (...controls: Control[]) => new Set(controls);

describe("a pad's controls", () => {
  it('names the face buttons, the shoulders, the triggers and the d-pad', () => {
    expect(controlsOf(pad([0, 3, 7, 14]))).toEqual(held('a', 'y', 'rt', 'left'));
  });

  it('takes the stick as the d-pad, and lets go of it only well back from the edge', () => {
    expect(controlsOf(pad([], [0.6, -0.7]))).toEqual(held('right', 'up'));
    expect(controlsOf(pad([], [0.4, 0]))).toEqual(held());
    expect(controlsOf(pad([], [0.4, 0]), held('right'))).toEqual(held('right'));
    expect(controlsOf(pad([], [0.2, 0]), held('right'))).toEqual(held());
  });
});

describe('the keys a pad presses', () => {
  it("fights on its player's own keys: A B X the abilities, the trigger attacks, up or Y jumps", () => {
    expect(keysFor('fight', 0, 'classic', held('a', 'rt', 'left'))).toEqual(new Set(['KeyK', 'KeyJ', 'KeyA']));
    expect(keysFor('fight', 1, 'classic', held('x', 'up'))).toEqual(new Set(['ShiftRight', 'ArrowUp']));
    expect(keysFor('fight', 0, 'wow', held('lt', 'y', 'b'))).toEqual(new Set(['Digit1', 'ArrowUp', 'Digit3']));
  });

  it('starts the rematch and leaves the fight on Start and Back', () => {
    expect(keysFor('fight', 0, 'classic', held('start'))).toEqual(new Set(['Enter']));
    expect(keysFor('fight', 1, 'classic', held('back'))).toEqual(new Set(['Escape']));
  });

  it("steers its own player's cursor on the roster", () => {
    expect(keysFor('roster', 0, 'classic', held('down', 'a'))).toEqual(new Set(['KeyS', 'KeyJ']));
    expect(keysFor('roster', 1, 'classic', held('left', 'b', 'rb'))).toEqual(new Set(['ArrowLeft', 'Numpad4', 'Numpad3']));
    expect(keysFor('roster', 0, 'wow', held('a', 'y'))).toEqual(new Set(['Digit1', 'Digit4']));
  });

  it("gives player 1's pad, and only theirs, the choice of player 2", () => {
    expect(keysFor('roster', 0, 'classic', held('x'))).toEqual(new Set(['Tab']));
    expect(keysFor('roster', 1, 'classic', held('x'))).toEqual(new Set());
  });

  it('is the arrows, Enter and Escape on every other screen', () => {
    expect(keysFor('menu', 1, 'classic', held('right', 'a'))).toEqual(new Set(['ArrowRight', 'Enter']));
    expect(keysFor('menu', 0, 'wow', held('b'))).toEqual(new Set(['Escape']));
  });
});

describe('who plays each pad', () => {
  it('the first pad plays player 1 and the second player 2', () => {
    expect(seatsOf(0, false)).toEqual([undefined, undefined]);
    expect(seatsOf(1, false)).toEqual([0, undefined]);
    expect(seatsOf(2, false)).toEqual([0, 1]);
  });

  it("a lone pad is player 2's when player 2 was set to PAD, and player 1 keeps the keyboard", () => {
    expect(seatsOf(1, true)).toEqual([undefined, 0]);
    expect(seatsOf(2, true)).toEqual([0, 1]);
  });
});
