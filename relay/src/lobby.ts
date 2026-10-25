import { DurableObject } from 'cloudflare:workers';
import { type Env, openRoom } from './index';

/*
 * The lobby: one Durable Object for everyone, so two friends with the game open find each other
 * by name instead of reading a code across the room. Each open socket is a player here, with the
 * name they gave and the id their browser keeps. Everyone hears who is here whenever that changes
 * and every twenty seconds. A player challenges another, who accepts or declines within thirty
 * seconds; or asks for a quick match and is paired with the next one who asks. A match is a room
 * made just as POST /rooms makes one, and both players are told its code and their part in it;
 * the fight itself then goes through the room as before, and the lobby only marks the two busy
 * until their sockets here come back.
 *
 * Nothing is kept in memory: the players are the sockets and what is attached to them, and the
 * open challenges and the quick-match queue are in storage, so the lobby can sleep between messages.
 */

/** How long a challenge waits for its answer. */
export const CHALLENGE_MS = 30 * 1000;
/** Everyone is told who is here at least this often. */
export const BEAT_MS = 20 * 1000;
/** The one lobby's name. */
export const LOBBY = 'lobby';

export type Status = 'free' | 'busy';
export interface Player {
  id: string;
  name: string;
  status: Status;
}
/** What a socket here carries. */
interface Seat {
  id: string;
  name: string;
  busy: boolean;
  /** When it came, to list players in the order they arrived. */
  at: number;
}
interface Challenge {
  from: string;
  to: string;
  at: number;
}

/** A display name as the lobby shows it: letters, digits and single spaces, 2 to 16 of them; undefined when it is not one. */
export function cleanName(raw: string | null): string | undefined {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ');
  return /^[\p{L}\p{N} ]{2,16}$/u.test(name) ? name : undefined;
}

/** A browser's id: the page makes a random UUID once and keeps it. */
export function isPlayerId(id: string | null): id is string {
  return id !== null && /^[A-Za-z0-9-]{8,40}$/.test(id);
}

type Incoming =
  | { t: 'challenge'; to: string }
  | { t: 'cancel'; to: string }
  | { t: 'accept'; from: string }
  | { t: 'decline'; from: string }
  | { t: 'quick' }
  | { t: 'unquick' };

function parse(message: string | ArrayBuffer): Incoming | undefined {
  if (typeof message !== 'string') return undefined;
  try {
    const value = JSON.parse(message) as { t?: unknown };
    return typeof value === 'object' && value !== null && typeof value.t === 'string' ? (value as Incoming) : undefined;
  } catch {
    return undefined;
  }
}

export class Lobby extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const name = cleanName(url.searchParams.get('name'));
    const id = url.searchParams.get('id');
    if (!name) return new Response('A name is 2 to 16 letters, digits and spaces.', { status: 400 });
    if (!isPlayerId(id)) return new Response('id must be the browser\'s own random id.', { status: 400 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });

    // The same browser again (a reload, a second tab, the way back from a fight): the new socket takes its place.
    for (const old of this.socketsOf(id)) {
      try {
        old.close(4000, 'replaced');
      } catch {
        // Already closing.
      }
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // A page in an online match that comes back between fights says so, and stays busy.
    const seat: Seat = { id, name, busy: url.searchParams.get('busy') === '1', at: Date.now() };
    this.ctx.acceptWebSocket(server, [id]);
    server.serializeAttachment(seat);
    await this.beat();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const me = this.seatOf(ws);
    const said = parse(message);
    if (!me || !said) return;
    switch (said.t) {
      case 'challenge':
        return this.challenge(ws, me, String(said.to));
      case 'cancel':
        return this.withdraw((c) => c.from === me.id && c.to === String(said.to), 'cancelled');
      case 'accept':
        return this.accept(ws, me, String(said.from));
      case 'decline':
        return this.withdraw((c) => c.from === String(said.from) && c.to === me.id, 'declined');
      case 'quick':
        return this.quick(ws, me);
      case 'unquick':
        await this.setQueue((await this.queue()).filter((id) => id !== me.id));
        ws.send(JSON.stringify({ t: 'unqueued' }));
        return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed on this side.
    }
    await this.left(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.left(ws);
  }

  /** Challenges that have waited too long lapse, and everyone hears who is here. */
  async alarm(): Promise<void> {
    const now = Date.now();
    await this.withdraw((c) => now - c.at >= CHALLENGE_MS, 'timeout');
    if (now >= ((await this.ctx.storage.get<number>('beat')) ?? 0) - 50) await this.beat();
    else await this.schedule();
  }

  private async challenge(ws: WebSocket, me: Seat, to: string): Promise<void> {
    const them = this.seatById(to);
    const open = await this.challenges();
    const fail = (message: string) => ws.send(JSON.stringify({ t: 'error', message }));
    if (to === me.id) return fail('You cannot challenge yourself.');
    if (me.busy) return fail('You are in a match.');
    if (!them) return fail('They are not here any more.');
    if (them.busy) return fail(`${them.name} is in a match.`);
    if (open.some((c) => c.from === me.id)) return fail('You are already waiting on a challenge.');
    if (open.some((c) => c.from === them.id || c.to === them.id)) return fail(`${them.name} is answering another challenge.`);
    if (open.some((c) => c.to === me.id)) return fail('Answer the challenge you have first.');
    // A challenge takes the challenger out of the quick-match queue.
    await this.setQueue((await this.queue()).filter((id) => id !== me.id));
    await this.setChallenges([...open, { from: me.id, to, at: Date.now() }]);
    this.tell(to, { t: 'challenged', from: { id: me.id, name: me.name }, ttl: CHALLENGE_MS });
    ws.send(JSON.stringify({ t: 'challenging', to: { id: them.id, name: them.name }, ttl: CHALLENGE_MS }));
    await this.schedule();
  }

  private async accept(ws: WebSocket, me: Seat, from: string): Promise<void> {
    const open = await this.challenges();
    const challenge = open.find((c) => c.from === from && c.to === me.id);
    if (!challenge) {
      ws.send(JSON.stringify({ t: 'error', message: 'That challenge is over.' }));
      return;
    }
    await this.setChallenges(open.filter((c) => c !== challenge));
    if (!this.seatById(from)) {
      ws.send(JSON.stringify({ t: 'error', message: 'They are not here any more.' }));
      return;
    }
    // The challenger hosts.
    await this.match(from, me.id);
  }

  /** Pairs the sender with the first player already waiting, or puts them in line. */
  private async quick(ws: WebSocket, me: Seat): Promise<void> {
    if (me.busy) {
      ws.send(JSON.stringify({ t: 'error', message: 'You are in a match.' }));
      return;
    }
    await this.withdraw((c) => c.from === me.id, 'cancelled');
    const waiting = (await this.queue()).filter((id) => id !== me.id && this.seatById(id)?.busy === false);
    const first = waiting[0];
    if (first === undefined) {
      await this.setQueue([...waiting, me.id]);
      ws.send(JSON.stringify({ t: 'queued' }));
      return;
    }
    await this.setQueue(waiting.slice(1));
    // The one who waited longer hosts.
    await this.match(first, me.id);
  }

  /** A room for two, both told, both busy, and anything else either had open called off. */
  private async match(host: string, guest: string): Promise<void> {
    const pair = [host, guest];
    const code = await openRoom(this.env);
    if (!code) {
      for (const id of pair) this.tell(id, { t: 'error', message: 'The relay has no free room; try again.' });
      return;
    }
    await this.withdraw((c) => pair.includes(c.from) || pair.includes(c.to), 'busy');
    await this.setQueue((await this.queue()).filter((id) => !pair.includes(id)));
    const seats = pair.map((id) => this.seatById(id)!);
    for (const ws of pair.flatMap((id) => this.socketsOf(id))) {
      const seat = ws.deserializeAttachment() as Seat;
      ws.serializeAttachment({ ...seat, busy: true });
    }
    this.tell(host, { t: 'fight', code, role: 'host', with: { id: seats[1]!.id, name: seats[1]!.name } });
    this.tell(guest, { t: 'fight', code, role: 'guest', with: { id: seats[0]!.id, name: seats[0]!.name } });
    await this.beat();
  }

  /**
   * Ends the challenges that match, telling both ends: the challenger hears why (declined, timeout,
   * left, busy), the one challenged that it was withdrawn.
   */
  private async withdraw(which: (c: Challenge) => boolean, reason: 'declined' | 'cancelled' | 'timeout' | 'left' | 'busy'): Promise<void> {
    const open = await this.challenges();
    const ending = open.filter(which);
    if (ending.length === 0) return;
    await this.setChallenges(open.filter((c) => !which(c)));
    for (const c of ending) {
      if (reason !== 'cancelled') this.tell(c.from, { t: 'declined', by: c.to, reason });
      if (reason !== 'declined') this.tell(c.to, { t: 'withdrawn', from: c.from, reason });
    }
    await this.schedule();
  }

  /** A socket went: unless the same browser is still here on another, its challenges and its place in line go with it. */
  private async left(ws: WebSocket): Promise<void> {
    const seat = this.seatOf(ws);
    if (seat && !this.socketsOf(seat.id).some((s) => s !== ws)) {
      await this.withdraw((c) => c.from === seat.id || c.to === seat.id, 'left');
      await this.setQueue((await this.queue()).filter((id) => id !== seat.id));
    }
    await this.beat(ws);
  }

  /** Tells everyone who is here, and sets the next beat. */
  private async beat(gone?: WebSocket): Promise<void> {
    const sockets = this.live().filter((ws) => ws !== gone);
    const seen = new Map<string, Seat>();
    for (const ws of sockets) {
      const seat = ws.deserializeAttachment() as Seat;
      const prior = seen.get(seat.id);
      if (!prior || seat.at > prior.at) seen.set(seat.id, seat);
    }
    const players: Player[] = [...seen.values()]
      .sort((a, b) => a.at - b.at)
      .map((seat) => ({ id: seat.id, name: seat.name, status: seat.busy ? 'busy' : 'free' }));
    const here = JSON.stringify({ t: 'here', players });
    for (const ws of sockets) ws.send(here);
    await this.ctx.storage.put('beat', Date.now() + BEAT_MS);
    await this.schedule(sockets.length);
  }

  /** One alarm for the next beat or the first challenge to lapse, whichever is sooner; none for an empty lobby. */
  private async schedule(present = this.live().length): Promise<void> {
    const times = (await this.challenges()).map((c) => c.at + CHALLENGE_MS);
    if (present > 0) times.push((await this.ctx.storage.get<number>('beat')) ?? Date.now() + BEAT_MS);
    if (times.length === 0) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.min(...times));
  }

  private tell(id: string, message: object): void {
    const text = JSON.stringify(message);
    for (const ws of this.socketsOf(id)) ws.send(text);
  }

  private async challenges(): Promise<Challenge[]> {
    return (await this.ctx.storage.get<Challenge[]>('challenges')) ?? [];
  }

  private async setChallenges(list: Challenge[]): Promise<void> {
    await this.ctx.storage.put('challenges', list);
  }

  private async queue(): Promise<string[]> {
    return (await this.ctx.storage.get<string[]>('quick')) ?? [];
  }

  private async setQueue(list: string[]): Promise<void> {
    await this.ctx.storage.put('quick', list);
  }

  private seatOf(ws: WebSocket): Seat | undefined {
    return (ws.deserializeAttachment() as Seat | null) ?? undefined;
  }

  /** The player as their newest open socket has them. */
  private seatById(id: string): Seat | undefined {
    const sockets = this.socketsOf(id);
    return sockets.length > 0 ? this.seatOf(sockets[sockets.length - 1]!) : undefined;
  }

  private socketsOf(id: string): WebSocket[] {
    return this.ctx.getWebSockets(id).filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  private live(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }
}
