/*
 * The players' cursors on CHOOSE YOUR CHAMPION, for the watchers, so they see the pick as the
 * players do: each player's {t:'roster'} goes to the watchers as it was sent, inside one that says
 * whose it is ({t:'pick', by, roster}), and the last of each is kept for a watcher who comes in
 * while they pick. The host's hello (or either going back to the roster, or leaving) lets them go:
 * a watcher who comes in mid-fight has no use for the cursors that led to it. Nothing of the
 * players' own traffic changes for it.
 */

type Role = 'host' | 'guest';

/** A roster longer than this is not passed on: a champion's spec is well under it. */
const PICK_READ = 16 * 1024;

/** A player's roster as the watchers are sent it, or undefined for one that is not a roster. */
export function pickOf(by: Role, text: string): string | undefined {
  if (text.length > PICK_READ) return undefined;
  let roster: unknown;
  try {
    roster = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof roster !== 'object' || roster === null || (roster as { t?: unknown }).t !== 'roster') return undefined;
  return JSON.stringify({ t: 'pick', by, roster });
}

/** Each player's last cursor while they pick. In memory only, as the game's record is. */
export class Picks {
  private last: Partial<Record<Role, string>> = {};

  /** A player's roster: what the watchers are sent of it, kept as theirs. */
  take(by: Role, text: string): string | undefined {
    const pick = pickOf(by, text);
    if (pick !== undefined) this.last[by] = pick;
    return pick;
  }

  /** One player's cursor gone (they left), or both (the fight began). */
  clear(by?: Role): void {
    if (by) delete this.last[by];
    else this.last = {};
  }

  /** The cursors kept, for a watcher who comes in. */
  replay(): string[] {
    return [this.last.host, this.last.guest].filter((pick): pick is string => pick !== undefined);
  }
}
