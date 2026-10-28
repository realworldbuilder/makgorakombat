import { useEffect, useRef } from 'preact/hooks';

/*
 * The keys for a panel that comes up over whatever screen is there, a challenge from the lobby
 * say, and must have them before that screen does. Every screen listens on the window in the
 * capture phase, so this listener is put there when the module loads, ahead of all of them; while
 * a panel holds the keys it has every key press and the screen under it none. A panel with a box
 * to type in holds them with `typing`: the screen still hears nothing, but the keys still type.
 */

type Handler = (event: KeyboardEvent) => void;
type Slot = { current: Handler | undefined; typing?: boolean };
const held: Slot[] = [];

if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (event) => {
      const top = held[held.length - 1];
      if (!top?.current) return;
      event.stopImmediatePropagation();
      if (!top.typing) event.preventDefault();
      top.current(event);
    },
    true,
  );
}

/** Holds the keys while `on`, for the newest panel that asks; the handler may change between renders. With `typing` the keys still type. */
export function useModalKeys(on: boolean, handler: Handler, typing = false): void {
  const slot = useRef<Slot>({ current: undefined });
  slot.current.current = handler;
  slot.current.typing = typing;
  useEffect(() => {
    if (!on) return;
    const mine = slot.current;
    held.push(mine);
    return () => {
      const at = held.indexOf(mine);
      if (at >= 0) held.splice(at, 1);
    };
  }, [on]);
}
