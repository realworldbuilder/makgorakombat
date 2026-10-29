import { useEffect, useRef, useState } from 'preact/hooks';
import { cleanSay, SAY_MAX } from './net/handshake';
import type { Link } from './net/relay';
import { useModalKeys } from './ui/modal';

/*
 * The players' chat: the two in an online match talk to each other on CHOOSE YOUR CHAMPION, the VS
 * screen, the next-stage card and the match-end screen. T (or a click on the line) opens a field,
 * Enter says it and Escape lets it go; while it is open it has the keyboard (modal.ts, typing), so
 * no letter moves a fighter or picks a champion. In a fight the lines still come up but nothing
 * can be typed: the keys are the fight's. Lines go over the match's own link as {t:'say'}, which
 * the relay passes to the other player like any word and the lockstep never reads; watchers have
 * their own chat (WatchChat.tsx).
 */

/** The key that opens the field; no screen of an online match uses it. */
export const CHAT_KEY = 'KeyT';
/** Lines shown at once. */
const SHOWN = 8;
/** How long a line stays up while the field is shut, the fade included. */
const LINE_MS = 30_000;
/** One line this often at most, so a held Enter cannot flood the other player. */
const GAP_MS = 600;

interface Line {
  key: number;
  mine: boolean;
  text: string;
  came: number;
}

interface PlayerChatProps {
  link: Link;
  /** The other player's name, when the lobby gave it. */
  them?: string;
  /** Whether a line may be typed now: not while a round is being fought. Asked as the screens change. */
  canType: () => boolean;
  /** Over CHOOSE YOUR CHAMPION, where the corner is player 1's plate: under the grid instead. */
  onPick?: boolean;
}

export function PlayerChat({ link, them, canType, onPick = false }: PlayerChatProps) {
  const [lines, setLines] = useState<Line[]>([]);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [can, setCan] = useState(canType);
  const field = useRef<HTMLInputElement>(null);
  const count = useRef(0);
  const said = useRef(-Infinity);
  const ask = useRef(canType);
  ask.current = canType;

  const add = (text: string, mine: boolean) => setLines((now) => [...now, { key: count.current++, mine, text, came: performance.now() }].slice(-SHOWN));

  useEffect(
    () =>
      link.listen((message) => {
        if (message.t !== 'say') return;
        const text = cleanSay(message.text);
        if (text) add(text, false);
      }),
    [link],
  );

  // Whether a line can be typed follows the screens (a round starting shuts the field); old lines go.
  useEffect(() => {
    const timer = setInterval(() => {
      const now = ask.current();
      setCan(now);
      if (!now) setOpen(false);
      setLines((all) => (all.some((l) => performance.now() - l.came > LINE_MS) ? all.filter((l) => performance.now() - l.came <= LINE_MS) : all));
    }, 400);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (open) field.current?.focus();
    else field.current?.blur();
  }, [open]);

  // Shut, T opens it, unless a box elsewhere is being typed in.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== CHAT_KEY || event.repeat || event.ctrlKey || event.metaKey || event.altKey || !ask.current()) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]')) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const say = () => {
    const text = cleanSay(typed);
    if (!text) return setOpen(false);
    if (performance.now() - said.current < GAP_MS) return;
    said.current = performance.now();
    link.send({ t: 'say', text });
    add(text, true);
    setTyped('');
    setOpen(false);
  };

  // Open, every key is the field's: Enter says it, Escape lets it go, the rest type.
  useModalKeys(
    open,
    (event) => {
      if (event.code === 'Escape') {
        event.preventDefault();
        setOpen(false);
      } else if (event.code === 'Enter' || event.code === 'NumpadEnter') {
        event.preventDefault();
        if (!event.isComposing) say();
      }
    },
    true,
  );

  const other = them ?? 'your opponent';
  return (
    <div class={`watch-chat player-chat ${open ? 'open' : ''} ${onPick ? 'on-pick' : ''}`}>
      <ul aria-live="polite" aria-label="Chat with your opponent">
        {lines.map((line) => (
          <li key={line.key} class={line.mine ? 'mine' : ''}>
            <b>{line.mine ? 'You' : other}</b> {line.text}
          </li>
        ))}
      </ul>
      {open ? (
        <input
          ref={field}
          value={typed}
          maxLength={SAY_MAX}
          spellcheck={false}
          autocomplete="off"
          placeholder={`Say something to ${other}`}
          aria-label="Chat"
          onInput={(event) => setTyped(event.currentTarget.value)}
          onBlur={() => setOpen(false)}
        />
      ) : (
        can && (
          <button type="button" class="chat-open" tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen(true)}>
            <b>T</b> · CHAT WITH {other.toUpperCase()}
          </button>
        )
      )}
    </div>
  );
}
