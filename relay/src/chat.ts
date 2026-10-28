/*
 * The watchers' chat: a watcher says a line ({t:'chat', text}) and every watcher of the room is
 * sent it with the name it came in under ({t:'chat', name, text, at}). The players are sent none
 * of it, and their sockets carry nothing more: the fight goes on as if nobody were talking. One
 * line a watcher at most every CHAT_GAP_MS, of CHAT_MAX characters at most, so fifty watchers
 * cannot keep the room busy; a newcomer is sent the last few lines said.
 */

/** The most characters in a line. */
export const CHAT_MAX = 140;
/** A watcher may say one line this often; one said sooner is dropped. */
export const CHAT_GAP_MS = 1500;
/** Lines kept for a watcher who comes in: this many, said within CHAT_KEEP_MS. */
export const CHAT_KEEP = 20;
export const CHAT_KEEP_MS = 5 * 60 * 1000;
/** Text longer than this from a watcher is not read at all. */
const CHAT_READ = 1024;

/** A line as the watchers are sent it. */
export interface ChatLine {
  t: 'chat';
  name: string;
  text: string;
  at: number;
}

/** A watcher's line as it is said, or undefined for anything else (or nothing left once cleaned). */
export function chatOf(message: string | ArrayBuffer): string | undefined {
  if (typeof message !== 'string' || message.length > CHAT_READ || !message.startsWith('{"t":"chat"')) return undefined;
  let text: unknown;
  try {
    text = (JSON.parse(message) as { text?: unknown }).text;
  } catch {
    return undefined;
  }
  if (typeof text !== 'string') return undefined;
  // No control characters, no runs of spaces, nothing past the limit.
  const clean = text.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX).trim();
  return clean === '' ? undefined : clean;
}

/** The last lines said in a room, for whoever comes in to watch. In memory only, as the game's record is. */
export class ChatLog {
  private lines: ChatLine[] = [];

  add(line: ChatLine): void {
    this.lines.push(line);
    if (this.lines.length > CHAT_KEEP) this.lines.shift();
  }

  recent(now = Date.now()): ChatLine[] {
    return this.lines.filter((line) => now - line.at < CHAT_KEEP_MS);
  }
}
