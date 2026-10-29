import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CHAT_GAP_MS, CHAT_MAX, type ChatLine, type Watching } from './net/watch';

/*
 * The watchers' chat, in the bottom corner of a watched fight, out of the way of the frames and
 * the bars: each line comes up under the last and fades after a while, as a stream's chat does.
 * Enter opens a line to type, Enter again says it and Escape lets it go. While it is open the
 * lines stay up. The field is always there, out of sight while shut, and open is simply having it
 * focused: Enter focuses it at once, so a line typed straight after loses no letters. The keys
 * typed are the field's alone, so M, F3 and Escape in it do not reach the fight. It goes over the watcher's own socket (net/watch.ts), which the players never hear.
 */

/** Lines shown at once. */
const SHOWN = 8;
/** How long a line stays up, the fade included. */
const LINE_MS = 20_000;

interface Shown extends ChatLine {
  key: number;
  /** When this page got it, by its own clock. */
  came: number;
}

interface WatchChatProps {
  watching: Watching;
  /** The field is focused: a line is being typed. */
  open: boolean;
  onOpen: (open: boolean) => void;
  /** The field, for the screen around it to focus. */
  field: RefObject<HTMLInputElement | null>;
  /** Over CHOOSE YOUR LEGEND, where the corner is player 1's: under the grid instead. */
  onPick?: boolean;
}

export function WatchChat({ watching, open, onOpen, field, onPick = false }: WatchChatProps) {
  const [lines, setLines] = useState<Shown[]>([]);
  const [typed, setTyped] = useState('');
  const [hush, setHush] = useState(false);
  const count = useRef(0);
  const said = useRef(-Infinity);

  useEffect(
    () => watching.onChat((line) => setLines((now) => [...now, { ...line, key: count.current++, came: performance.now() }].slice(-SHOWN))),
    [watching],
  );

  // Lines past their time go, so the corner is empty when nobody is talking.
  useEffect(() => {
    const timer = setInterval(() => setLines((now) => (now.some((l) => performance.now() - l.came > LINE_MS) ? now.filter((l) => performance.now() - l.came <= LINE_MS) : now)), 1000);
    return () => clearInterval(timer);
  }, []);

  // Enter opens the line, on the fight screen and the waiting one alike.
  useEffect(() => {
    if (open) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.code !== 'Enter' && event.code !== 'NumpadEnter') || event.repeat || event.target instanceof HTMLInputElement) return;
      event.preventDefault();
      field.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, field]);

  const shut = () => field.current?.blur();
  const say = () => {
    const text = typed.trim();
    if (text === '') return shut();
    // The relay drops a line said too soon after the last; say so rather than lose it.
    if (performance.now() - said.current < CHAT_GAP_MS) {
      setHush(true);
      return;
    }
    said.current = performance.now();
    watching.say(text);
    setTyped('');
    setHush(false);
    shut();
  };

  return (
    <div class={`watch-chat ${open ? 'open' : ''} ${onPick ? 'on-pick' : ''}`}>
      <ul aria-live="polite" aria-label="Watchers' chat">
        {lines.map((line) => (
          <li key={line.key}>
            <b>{line.name}</b> {line.text}
          </li>
        ))}
      </ul>
      <input
          ref={field}
          class={open ? '' : 'shut'}
          tabIndex={open ? 0 : -1}
          value={typed}
          maxLength={CHAT_MAX}
          spellcheck={false}
          autocomplete="off"
          placeholder={hush ? 'A moment between lines…' : 'Say something to the other watchers'}
          aria-label="Chat"
          onInput={(event) => {
            setTyped(event.currentTarget.value);
            setHush(false);
          }}
          onKeyDown={(event) => {
            // The field's keys are its own: none reach the fight or the screens under it.
            event.stopPropagation();
            if (event.key === 'Enter') {
              event.preventDefault();
              say();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              shut();
            }
          }}
          onFocus={() => onOpen(true)}
          onBlur={() => onOpen(false)}
        />
      {!open && <p class="hint">ENTER · chat</p>}
    </div>
  );
}
