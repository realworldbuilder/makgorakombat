import { useEffect, useRef, useState } from 'preact/hooks';
import { type FeedbackFight, feedbackKey, feedbackOf, MAX_FEEDBACK, sendFeedback } from '../feedback';
import { savedName } from '../net/lobby';
import { useModalKeys } from './modal';

/*
 * SEND FEEDBACK on the match-end screen: one quiet line under the rematch hint, F or a click to
 * open a small box, a few lines and five stars to give or not, SEND and CANCEL. While the box is
 * open it has the keyboard (modal.ts, typing), so Enter, N, Escape and the fighters' keys reach
 * neither the fight nor the game, and the fight goes on as it was: online the lockstep runs and
 * the other player can rematch whenever they like. The box closes the moment the match-end screen
 * goes, a rematch the other called included, keeping what was written for the next one. SEND
 * closes it at once and the line says THANKS when the relay has it, or that it could not be sent.
 */

/** How long THANKS, or the word that it failed, stays before the line offers the box again. */
const SAID_MS = 3500;

type Said = 'sending' | 'thanks' | 'failed';

interface FeedbackBoxProps {
  /** The match-end screen is up: the line shows, and the box may open. */
  ended: boolean;
  /** The fight the message follows. */
  fight: FeedbackFight;
}

export function FeedbackBox({ ended, fight }: FeedbackBoxProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [rating, setRating] = useState<number>();
  const [said, setSaid] = useState<Said>();
  const box = useRef<HTMLTextAreaElement>(null);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  // The box never outlasts the match-end screen.
  useEffect(() => {
    if (!ended) setOpen(false);
  }, [ended]);
  useEffect(() => {
    if (open) box.current?.focus();
  }, [open]);

  const send = () => {
    const message = feedbackOf(text, rating, fight, { name: savedName() });
    if (!message) return;
    setOpen(false);
    setText('');
    setRating(undefined);
    setSaid('sending');
    void sendFeedback(message).then((ok) => {
      if (!live.current) return;
      setSaid(ok ? 'thanks' : 'failed');
      setTimeout(() => live.current && setSaid(undefined), SAID_MS);
    });
  };

  // Closed, a plain F on the match-end screen opens the box; the screen's own keys are left alone.
  const keys = useRef({ ended, open });
  keys.current = { ended, open };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!keys.current.ended || keys.current.open || feedbackKey(event, false) !== 'open') return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]')) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Open, it has every key: Escape closes it, Enter sends, the rest type.
  useModalKeys(
    open,
    (event) => {
      const does = feedbackKey(event, true);
      if (does === 'close') setOpen(false);
      else if (does === 'send') {
        event.preventDefault();
        send();
      }
    },
    true,
  );

  if (!ended) return null;
  if (!open) {
    if (said) return <div class="feedback-line said">{said === 'sending' ? 'SENDING…' : said === 'thanks' ? 'THANKS' : 'COULD NOT SEND YOUR FEEDBACK'}</div>;
    return (
      <button type="button" class="feedback-line" tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen(true)}>
        SEND FEEDBACK · <b>F</b>
      </button>
    );
  }
  return (
    <form
      class="feedback-box"
      aria-label="Send feedback"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <div class="feedback-head">
        <span>FEEDBACK</span>
        <span class="stars" role="radiogroup" aria-label="Rating, if you like">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              type="button"
              key={n}
              class={rating !== undefined && n <= rating ? 'on' : ''}
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} of 5`}
              onClick={() => setRating(rating === n ? undefined : n)}
            >
              ★
            </button>
          ))}
        </span>
      </div>
      <textarea
        ref={box}
        rows={3}
        maxLength={MAX_FEEDBACK}
        placeholder="Anything you want to tell us: the fight, a champion, a bug, an idea."
        value={text}
        onInput={(event) => setText(event.currentTarget.value)}
      />
      <div class="feedback-foot">
        <span class="count">
          {text.length} / {MAX_FEEDBACK} · <b>Enter</b> sends · <b>Esc</b> closes
        </span>
        <button type="button" class="feedback-button" onClick={() => setOpen(false)}>
          CANCEL
        </button>
        <button type="submit" class="feedback-button send" disabled={text.trim() === ''}>
          SEND
        </button>
      </div>
    </form>
  );
}
