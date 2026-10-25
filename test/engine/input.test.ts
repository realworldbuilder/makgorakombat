import { afterEach, describe, expect, it } from 'vitest';
import { InputReader, KEYS, keyLabel, keyLayout, setKeyLayout } from '../../src/engine/input';

afterEach(() => setKeyLayout('classic'));

describe('the key layouts', () => {
  it('starts on the fighting-game keys: WASD and J K L U against the arrows', () => {
    expect(keyLayout()).toBe('classic');
    expect(keyLabel(0, 'attack')).toBe('J');
    expect(keyLabel(1, 'left')).toBe('←');
  });

  it("the game's own keys: the arrows move player 1, 1 attacks, 2 3 4 are the action bar, and player 2 takes WASD", () => {
    setKeyLayout('wow');
    expect(KEYS[0].attack).toEqual(['Digit1']);
    expect(keyLabel(0, 'ability1')).toBe('2');
    expect(keyLabel(1, 'attack')).toBe('J');
    const reader = new InputReader();
    reader.press('ArrowLeft');
    reader.press('Digit1');
    reader.press('Digit3');
    reader.press('KeyD');
    const [p1, p2] = reader.read();
    expect(p1.left).toBe(true);
    expect(p1.attack).toBe(true);
    expect(p1.abilities).toEqual([false, true, false]);
    expect(p2.right).toBe(true);
    expect(p2.attack).toBe(false);
  });

  it('switching back restores the arrows to player 2', () => {
    setKeyLayout('wow');
    setKeyLayout('classic');
    const reader = new InputReader();
    reader.press('ArrowRight');
    const [p1, p2] = reader.read();
    expect(p1.right).toBe(false);
    expect(p2.right).toBe(true);
  });
});
