import { playCall } from './sound';

/*
 * The lobby's call to fight, for a player who has looked away while they wait: a challenge comes
 * in, the queue finds them an opponent, NEXT OPPONENT pairs them again. The round gong sounds
 * (sound.ts), the tab's title flashes FIGHT! until the page has the focus, and, if the player
 * switched it on in the PLAY ONLINE panel, the browser shows a notification with the name.
 */

const NOTIFY = 'makgora.notify';
/** The flashing title changes this often. */
const FLASH_MS = 900;
export const FIGHT_TITLE = 'FIGHT!';

/** Whether this player asked to be notified, as the panel's switch was left. */
export function notifyWanted(): boolean {
  try {
    return localStorage.getItem(NOTIFY) === '1';
  } catch {
    return false;
  }
}

/** Notifications the browser can show here: asked for, and allowed. */
export function notifyOn(): boolean {
  return notifyWanted() && typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

/** The switch: on asks the browser's leave once (it must come from the click), and stays off if it is refused. Answers whether it is on. */
export async function setNotify(on: boolean): Promise<boolean> {
  let allowed = on && typeof Notification !== 'undefined';
  if (allowed && Notification.permission !== 'granted') allowed = (await Notification.requestPermission()) === 'granted';
  try {
    if (allowed) localStorage.setItem(NOTIFY, '1');
    else localStorage.removeItem(NOTIFY);
  } catch {
    // Storage blocked: the switch lasts for this visit.
  }
  return allowed;
}

/** What the page shows as it calls: its title, whether it has the focus, a clock. Made for the tests to stand in. */
export interface Page {
  title: string;
  focused(): boolean;
  every(ms: number, tick: () => void): () => void;
}

/** The flash going now, as its stop. */
let flashing: (() => void) | undefined;

/**
 * Flashes FIGHT! in the title, turn about with the page's own, until the page has the focus, then
 * puts the title back. A second call while flashing changes nothing; a page with the focus already
 * does not flash. Answers a stop.
 */
export function flashTitle(page: Page): () => void {
  if (page.focused() || flashing) return () => undefined;
  const own = page.title;
  let stop = () => undefined as void;
  const end = () => {
    stop();
    flashing = undefined;
    page.title = own;
  };
  flashing = end;
  stop = page.every(FLASH_MS, () => {
    if (page.focused()) end();
    else page.title = page.title === FIGHT_TITLE ? own : FIGHT_TITLE;
  });
  page.title = FIGHT_TITLE;
  return end;
}

/** This browser's page, for flashTitle. */
const thisPage = (): Page => ({
  get title() {
    return document.title;
  },
  set title(text: string) {
    document.title = text;
  },
  focused: () => document.visibilityState === 'visible' && document.hasFocus(),
  every: (ms, tick) => {
    const timer = setInterval(tick, ms);
    return () => clearInterval(timer);
  },
});

/** The call: the gong, the title, and the notification for a player who asked for it and is looking elsewhere. */
export function callToFight(words: string): void {
  playCall();
  if (typeof document === 'undefined') return;
  const page = thisPage();
  const away = !page.focused();
  flashTitle(page);
  if (!away || !notifyOn()) return;
  try {
    const shown = new Notification("MAK'GORA", { body: words, tag: 'makgora-call' });
    shown.onclick = () => {
      window.focus();
      shown.close();
    };
  } catch {
    // A browser that only notifies from a service worker (Chrome on Android): the gong and the title will do.
  }
}
