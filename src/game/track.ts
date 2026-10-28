import { RELAY_URL } from './net/relay';

/*
 * The site's numbers, from the page's side (relay/src/site.ts keeps and adds them up, /stats/ shows
 * them): one short hit when the welcome page or the game opens, when a World of Warcraft folder is
 * read, a fight begins or one is watched, or an error gets loose; and a ping a minute while the
 * page is in front, so the report can say who is on the site now. The visitor is a random id this
 * browser keeps, nothing else. Nothing is sent from this machine's own dev server, from a browser
 * that asks not to be tracked, or from one that said so on /stats/ (the two of us, so our own
 * testing does not count).
 */

export type Page = 'welcome' | 'game';
type Kind = 'view' | 'folder' | 'fight' | 'watch' | 'error' | 'ping';

const VISITOR = 'makgora.visitor';
/** Set on /stats/ to leave this browser out. */
export const NO_TRACK = 'makgora.notrack';
const PING_MS = 60 * 1000;
/** Errors sent from one page load at most. */
const ERRORS_MAX = 3;

let page: Page | undefined;
let visitor: string | undefined;
let errorsSent = 0;

/** Whether this browser counts. */
export function counted(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.doNotTrack === '1' || nav.globalPrivacyControl === true) return false;
  try {
    return localStorage.getItem(NO_TRACK) !== '1';
  } catch {
    return true;
  }
}

/** This browser's id, made once and kept; one for the page load alone if storage is blocked. */
function visitorId(): string {
  if (visitor) return visitor;
  try {
    visitor = localStorage.getItem(VISITOR) ?? undefined;
    if (!visitor) {
      visitor = crypto.randomUUID();
      localStorage.setItem(VISITOR, visitor);
    }
  } catch {
    visitor = crypto.randomUUID();
  }
  return visitor;
}

function send(kind: Kind, detail?: string, extra?: string): void {
  if (!page || !counted()) return;
  const body: Record<string, unknown> = { v: visitorId(), p: page, k: kind };
  if (detail) body.d = detail;
  if (extra) body.x = extra;
  if (kind === 'view') {
    body.r = document.referrer && new URL(document.referrer).host !== location.host ? document.referrer : '';
    body.w = window.innerWidth;
  }
  const url = `${RELAY_URL}/site/hit`;
  const text = JSON.stringify(body);
  try {
    // Plain text, so it goes without the browser asking the relay first, and survives the tab closing.
    if (navigator.sendBeacon?.(url, text)) return;
    void fetch(url, { method: 'POST', body: text, keepalive: true, mode: 'cors' }).catch(() => {});
  } catch {
    // The numbers are not worth an error.
  }
}

/** The page opened: one view, a ping a minute while it is in front, and the loose errors from here on. */
export function trackPage(which: Page): void {
  if (page) return;
  page = which;
  send('view');
  setInterval(() => {
    if (document.visibilityState === 'visible') send('ping');
  }, PING_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') send('ping');
  });
  const error = (message: string) => {
    if (errorsSent >= ERRORS_MAX) return;
    errorsSent++;
    send('error', undefined, message);
  };
  window.addEventListener('error', (event) => error(String(event.error?.message ?? event.message ?? 'error')));
  window.addEventListener('unhandledrejection', (event) => error(String(event.reason?.message ?? event.reason ?? 'rejection')));
}

/** A World of Warcraft folder read, of this edition. */
export const trackFolder = (edition: string) => send('folder', edition);
/** A fight begun: against the computer, two on one machine, or online; with the champion this page plays. */
export const trackFight = (mode: 'cpu' | 'local' | 'online', champion: string) => send('fight', mode, champion);
/** Somebody else's fight, watched. */
export const trackWatch = () => send('watch');
