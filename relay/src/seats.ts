/*
 * How long a room keeps a dropped player's seat and what it holds for them meanwhile; apart from
 * index.ts because the Worker's main module may export only its handlers and classes.
 */

/** A player whose socket dropped keeps their seat this long. */
export const RECONNECT_MS = 20_000;
/** At most this many messages are held for a player who is away; the oldest frames go first. */
export const HELD_MAX = 600;
/**
 * A page with an id pings every two seconds and sends the fight's frames every frame; one that has
 * sent nothing for this long while the other is talking has dropped without a word (Wi-Fi pulled:
 * no close ever comes), and is taken for away.
 */
export const SILENT_MS = 6000;
