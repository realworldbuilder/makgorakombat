/*
 * The add-on's other half, outside the game: a WoW add-on cannot reach the internet, so this
 * watches the game's own queue on the relay and puts a banner on the screen, over WoW, when
 * somebody starts waiting there for a fight.
 *
 *   node addon/watch.ts [--name <your name on the site>] [--relay <url>] [--every <seconds>]
 *   node addon/watch.ts --test      one banner to see what it looks like, and stop
 *
 * It asks GET /lobby/stats (relay/README.md) every 15 seconds and is not in the lobby itself, so
 * nobody sees it there. With --name it says nothing of you. A banner is macOS's notification, or
 * notify-send's on Linux; anywhere else it is the line it prints.
 */
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const RELAY = 'https://makgora-relay.nethead-web.workers.dev';
const SITE = 'https://realworldbuilder.github.io/makgorakombat/play/';
const TITLE = "MAK'GORA KOMBAT";

/** What the relay answers at /lobby/stats, as far as the watcher reads it. */
export interface Stats {
  waiting: number;
  /** The names of those waiting, longest first; a relay older than the add-on gives only `waiting`. */
  queue?: string[];
}

/**
 * Who to tell of, going from `before` to `now`: the names newly waiting but `me`'s, or for an
 * older relay that gives no names, "somebody" as often as the count went up.
 */
export function fresh(before: Stats | undefined, now: Stats, me?: string): string[] {
  const self = me?.trim().toLowerCase();
  if (now.queue) {
    const had = new Set(before?.queue ?? []);
    return now.queue.filter((name) => !had.has(name) && name.toLowerCase() !== self);
  }
  return Array.from({ length: Math.max(0, now.waiting - (before?.waiting ?? 0)) }, () => 'Somebody');
}

/** The banner's words for those names. */
export function words(names: string[]): string {
  if (names.length === 1) return `${names[0]} is waiting for a fight.`;
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are waiting for a fight.`;
}

function banner(text: string): void {
  console.log(`${new Date().toLocaleTimeString()}  ${text}`);
  if (process.platform === 'darwin') {
    const script = ['on run argv', `display notification (item 1 of argv) with title "${TITLE}" sound name "Glass"`, 'end run'];
    execFile('osascript', [...script.flatMap((line) => ['-e', line]), text], () => undefined);
  } else if (process.platform === 'linux') {
    execFile('notify-send', [TITLE, text], () => undefined);
  }
}

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
}

async function main(): Promise<void> {
  if (process.argv.includes('--test')) {
    banner(`${words(['Testgrom'])} ${SITE}`);
    return;
  }
  const relay = (option('relay') ?? RELAY).replace(/\/$/, '');
  const me = option('name');
  const every = Number(option('every') ?? 15) * 1000;
  let last: Stats | undefined;
  let down = false;
  console.log(`Watching ${relay}'s queue every ${every / 1000} s${me ? `, all but ${me}` : ''}.`);
  for (;;) {
    try {
      const answer = await fetch(`${relay}/lobby/stats`, { signal: AbortSignal.timeout(10_000) });
      if (!answer.ok) throw new Error(`the relay answered ${answer.status}`);
      const now = (await answer.json()) as Stats;
      const names = fresh(last, now, me);
      if (names.length > 0) banner(words(names));
      last = now;
      if (down) console.log(`${new Date().toLocaleTimeString()}  The relay answers again.`);
      down = false;
    } catch (error) {
      // Said once, not every 15 seconds the network is down; it keeps asking.
      if (!down) console.log(`${new Date().toLocaleTimeString()}  No answer from the relay: ${(error as Error).message}`);
      down = true;
    }
    await new Promise((resolve) => setTimeout(resolve, every));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
