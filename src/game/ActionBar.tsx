import type { ComponentChildren } from 'preact';
import { type Line, WowTooltip } from './ui/WowTooltip';

/*
 * A row of square slots with gold frames and a hotkey in the corner, as the game's action
 * bar lays its buttons out. Each slot is a button, or a label that wraps an input.
 */

export interface Slot {
  key: string;
  label: string;
  icon: ComponentChildren;
  onClick?: () => void;
  href?: string;
  /** Wraps the slot in a label so a hidden input can sit inside it (the folder picker). */
  input?: ComponentChildren;
  /** Drawn lit, as an ability off cooldown. */
  lit?: boolean;
  /** The game's tooltip, shown while the pointer is on the slot. */
  tip?: readonly Line[];
}

export function ActionBar({ slots }: { slots: Slot[] }) {
  return (
    <div class="actionbar">
      {slots.map((slot) => {
        const inner = (
          <>
            <span class="hotkey">{slot.key}</span>
            <span class="icon">{slot.icon}</span>
            <span class="label">{slot.label}</span>
            {slot.tip && <WowTooltip lines={slot.tip} class="hover-tip" />}
          </>
        );
        const cls = `slot ${slot.lit ? 'lit' : ''}`;
        if (slot.input) {
          return (
            <label class={cls} key={slot.key}>
              {inner}
              {slot.input}
            </label>
          );
        }
        if (slot.href) {
          return (
            <a class={cls} key={slot.key} href={slot.href} target="_blank" rel="noreferrer">
              {inner}
            </a>
          );
        }
        return (
          <button class={cls} key={slot.key} onClick={slot.onClick} type="button">
            {inner}
          </button>
        );
      })}
    </div>
  );
}

/** Simple glyphs for the slots, drawn so no icon file is needed before the folder is open. */
export const GLYPHS = {
  folder: (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4 9h9l3 3h12v13H4z" fill="currentColor" opacity="0.9" />
      <path d="M4 14h24v11H4z" fill="#fff" opacity="0.18" />
    </svg>
  ),
  swords: (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M6 4l6 1 12 12-3 3L9 8zM26 4l-6 1-12 12 3 3L23 8z" fill="currentColor" />
      <path d="M8 22l2 2-4 4-2-2zM24 22l-2 2 4 4 2-2z" fill="currentColor" opacity="0.8" />
    </svg>
  ),
  champion: (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="10" r="6" fill="currentColor" />
      <path d="M4 29c1-8 6-11 12-11s11 3 12 11z" fill="currentColor" opacity="0.9" />
      <path d="M12 2l4 4 4-4-1 6h-6z" fill="#ffd100" />
    </svg>
  ),
  legends: (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3l3.5 8 8.5.8-6.4 5.7 2 8.5L16 21.6 8.4 26l2-8.5L4 11.8l8.5-.8z" fill="currentColor" />
    </svg>
  ),
  // The editions: a crescent for Midnight's retail, the infinity of WoW Forever's crest, a shield for Classic.
  retail: (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M20 4a12 12 0 1 0 8 19A10 10 0 0 1 20 4z" fill="currentColor" />
      <circle cx="22" cy="10" r="1.6" fill="#b48cff" />
    </svg>
  ),
  forever: (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M9.5 10.5c-3 0-5.5 2.4-5.5 5.5s2.5 5.5 5.5 5.5c4.5 0 8.5-11 13-11 3 0 5.5 2.4 5.5 5.5s-2.5 5.5-5.5 5.5c-4.5 0-8.5-11-13-11z" fill="none" stroke="currentColor" stroke-width="3" />
    </svg>
  ),
  classic: (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3l11 4v8c0 7-5 12-11 14C10 27 5 22 5 15V7z" fill="currentColor" />
      <path d="M16 7v18c-4-2-7-5-7-10V9.5z" fill="#fff" opacity="0.2" />
    </svg>
  ),
  code: (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M12 8l-8 8 8 8 2.5-2.5L9 16l5.5-5.5zM20 8l8 8-8 8-2.5-2.5L23 16l-5.5-5.5z" fill="currentColor" />
    </svg>
  ),
  gear: (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M16 3l2.6 3.6 4.3-1.2 1.2 4.3L27.7 12 25 16l2.7 4-3.6 2.3-1.2 4.3-4.3-1.2L16 29l-2.6-3.6-4.3 1.2-1.2-4.3L4.3 20 7 16l-2.7-4 3.6-2.3 1.2-4.3 4.3 1.2z"
        fill="currentColor"
        opacity="0.9"
      />
      <circle cx="16" cy="16" r="4.5" fill="#0b0708" />
    </svg>
  ),
};
