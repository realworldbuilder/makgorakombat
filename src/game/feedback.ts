import { RELAY_URL } from './net/relay';

/*
 * A word from the player at the end of a fight, for the two of us. The match-end screen offers
 * SEND FEEDBACK (F); the box takes a few lines and, if they like, a rating out of five, and sends
 * them to the relay's POST /feedback (relay/src/feedback.ts) with the fight they followed: the two
 * champions, the ground, who won, how it was played, the game and the build, and the name given
 * the lobby if there is one. Nothing else of the player's goes. One try: if it does not reach the
 * relay in a few seconds, the box says so and the words are let go.
 */

/** The most a message may say; the relay refuses more. */
export const MAX_FEEDBACK = 1000;
/** How long a message is given to reach the relay before it is taken for lost. */
export const SEND_MS = 8000;

export type FeedbackMode = 'cpu' | 'local' | 'online';

/** The fight a message follows, as the screens know it. */
export interface FeedbackFight {
  mode: FeedbackMode;
  /** The two champions, player 1's first. */
  fighters: [string, string];
  stage?: string;
  /** The side that won the match; none when it has no winner. */
  winner?: 0 | 1;
  /** Online, the side this machine played. */
  me?: 0 | 1;
  /** The game the folder holds, as the edition names it. */
  game?: string;
}

/** What goes to the relay. */
export interface FeedbackMessage extends FeedbackFight {
  text: string;
  rating?: number;
  build: string;
  name?: string;
}

/** The build a message was sent from: the version on the roster and the commit. */
export function buildOf(version = import.meta.env.VITE_VERSION as string | undefined, commit = import.meta.env.VITE_BUILD as string | undefined): string {
  return [version, commit].filter(Boolean).join(' ') || 'dev';
}

/** The message for what the player wrote: trimmed, cut to size, a rating only when it is one to five; undefined when nothing is written. */
export function feedbackOf(text: string, rating: number | undefined, fight: FeedbackFight, extra: { build?: string; name?: string } = {}): FeedbackMessage | undefined {
  const words = text.trim().slice(0, MAX_FEEDBACK);
  if (words === '') return undefined;
  const message: FeedbackMessage = { text: words, ...fight, build: extra.build ?? buildOf() };
  if (rating !== undefined && Number.isInteger(rating) && rating >= 1 && rating <= 5) message.rating = rating;
  if (extra.name) message.name = extra.name;
  return message;
}

/**
 * Sends a message once, as plain text so the browser asks the relay no leave first; true when the
 * relay kept it. Anything else (refused, too many, no answer within SEND_MS) is false, and that is all.
 */
export async function sendFeedback(message: FeedbackMessage, options: { url?: string; fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<boolean> {
  const { url = `${RELAY_URL}/feedback`, fetch: send = globalThis.fetch, timeoutMs = SEND_MS } = options;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await send(url, { method: 'POST', body: JSON.stringify(message), mode: 'cors', signal: abort.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** The key that opens the box on the match-end screen. */
export const FEEDBACK_KEY = 'KeyF';

type Key = Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat' | 'isComposing'>;

/**
 * What a key press does to the box. Closed, only a plain F opens it (not Ctrl or Cmd+F, which find
 * on the page) and everything else is the screen's: Enter the rematch, Escape the roster. Open, it
 * has every key: Escape closes it, Enter sends (Shift+Enter is a new line, and an Enter that
 * finishes an accented letter or a word in another script is the letter's), and the rest type.
 */
export function feedbackKey(event: Key, open: boolean): 'open' | 'close' | 'send' | 'type' | 'pass' {
  if (!open) return event.code === FEEDBACK_KEY && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey ? 'open' : 'pass';
  if (event.code === 'Escape') return 'close';
  if ((event.code === 'Enter' || event.code === 'NumpadEnter') && !event.shiftKey && !event.isComposing) return 'send';
  return 'type';
}
