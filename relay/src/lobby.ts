import { DurableObject } from 'cloudflare:workers';
import { Board, type Fighter, type Result, type Span, type Standings } from './board';
import { type Env, openRoom } from './index';

/*
 * The lobby: one Durable Object for everyone, so two friends with the game open find each other
 * by name instead of reading a code across the room. Each open socket is a player here, with the
 * name they gave and the id their browser keeps. Everyone hears who is here whenever that changes
 * and every twenty seconds, and with it how many are online, waiting in the queue and fighting. A
 * player challenges another, who accepts or declines within thirty seconds; or sits in the queue
 * and is paired with the next one who comes into it, in the order they came. A match is a room
 * made just as POST /rooms makes one, and both players are told its code and their part in it;
 * the fight itself then goes through the room as before, and the lobby only marks the two busy
 * until their sockets here come back. A page back from a match that asks for the next opponent
 * (requeue=1) goes straight into the queue; one left in it ten minutes with nobody coming is let go.
 *
 * Nothing is kept in memory: the players are the sockets and what is attached to them, and the
 * open challenges, the queue and the rooms' head counts are in storage, so the lobby can sleep
 * between messages. The pages close their socket here for the fight itself, so who is fighting is
 * counted from the rooms, which tell the lobby whenever somebody comes in or goes. The rooms also
 * tell it how each match ended, for the board (board.ts), and everyone here is listed with what
 * they have won and lost tonight.
 *
 * The rooms the lobby made are listed while both players are in them, with the two names and
 * the code, so anyone here can pick one to watch (the room's role=watch). A room made with a code
 * between two friends is not the lobby's, and is not listed.
 */

/** How long a challenge waits for its answer. */
export const CHALLENGE_MS = 30 * 1000;
/** Everyone is told who is here at least this often. */
export const BEAT_MS = 20 * 1000;
/** The one lobby's name. */
export const LOBBY = 'lobby';
/** A player in the queue this long with nobody coming is taken out of it. */
export const QUEUE_MS = 10 * 60 * 1000;
/** A room that has said nothing for this long is no longer counted, whatever it last said. */
export const ROOM_STALE_MS = 6 * 60 * 60 * 1000;
/** A room the lobby made that nobody has come into this long is forgotten: the room itself has closed. */
export const ROOM_UNUSED_MS = 10 * 60 * 1000;

export type Status = 'free' | 'busy';
export interface Player {
  id: string;
  name: string;
  status: Status;
  /** Tonight's wins and losses, for a player who has fought tonight. */
  night?: [number, number];
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
/** A place in the queue: who, and since when. */
interface Waiting {
  id: string;
  at: number;
}
/** How many are in a room, as it last said, and when; and for a room the lobby made, who it was made for. */
interface Heads {
  n: number;
  at: number;
  /** The host's and the guest's names and ids, as they were when the lobby matched them. */
  names?: [string, string];
  ids?: [string, string];
  /** When both were first in. */
  since?: number;
}
/** A fight on now, for anyone who wants to watch it. */
export interface FightNow {
  code: string;
  /** The host's name, then the guest's. */
  names: [string, string];
  ids: [string, string];
  /** When both came in, by the relay's clock. */
  since: number;
}
/** The lobby's numbers, with every list of who is here and at GET /lobby/stats. */
export interface Counts {
  /** Players with the game open and a socket here. */
  online: number;
  /** In the queue, waiting for anybody. */
  waiting: number;
  /** In a room with their opponent: picking, on the VS screen or fighting. */
  fighting: number;
}
/** The numbers and the fights on now, as every list of who is here and GET /lobby/stats give them. */
export interface Stats extends Counts {
  /** The lobby's rooms with both players in, longest going first. */
  fights: FightNow[];
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
  private readonly board: Board;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.board = new Board(ctx.storage.sql);
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
    // Back from a match for the next opponent: straight into the queue, as if they had asked.
    if (url.searchParams.get('requeue') === '1' && !seat.busy) await this.quick(server, seat);
    else await this.beat();
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
        await this.setQueue((await this.queue()).filter((w) => w.id !== me.id));
        ws.send(JSON.stringify({ t: 'unqueued', queued: false }));
        return this.beat();
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

  /** Challenges that have waited too long lapse, so do places in the queue, and everyone hears who is here. */
  async alarm(): Promise<void> {
    const now = Date.now();
    await this.withdraw((c) => now - c.at >= CHALLENGE_MS, 'timeout');
    const queue = await this.queue();
    const idle = queue.filter((w) => now - w.at >= QUEUE_MS);
    if (idle.length > 0) {
      await this.setQueue(queue.filter((w) => !idle.includes(w)));
      for (const w of idle) this.tell(w.id, { t: 'unqueued', queued: false, reason: 'idle' });
    }
    if (idle.length > 0 || now >= ((await this.ctx.storage.get<number>('beat')) ?? 0) - 50) await this.beat();
    else await this.schedule();
  }

  /** The numbers alone, for GET /lobby/stats. */
  async stats(): Promise<Stats> {
    return this.counts(this.seats(this.live()));
  }

  /** A match fought to its end, as its room tells it: onto the board, and everyone here sees the new records. */
  async result(result: Result, now = Date.now()): Promise<void> {
    this.board.record(result, now);
    if (this.live().length > 0) await this.beat();
  }

  /** The board for GET /lobby/board. */
  async standings(span: Span, id?: string, now = Date.now()): Promise<Standings> {
    return this.board.standings(span, id, now);
  }

  /** A room's head count, which it sends whenever somebody comes in or goes; an empty room is forgotten. */
  async roomHeads(code: string, n: number): Promise<void> {
    const rooms = await this.rooms();
    const before = this.fighting(rooms);
    const now = Date.now();
    const prior = rooms[code];
    if (n > 0) rooms[code] = { ...prior, n, at: now, since: prior?.since ?? (n >= 2 ? now : undefined) };
    else delete rooms[code];
    for (const [other, room] of Object.entries(rooms)) {
      if (now - room.at >= ROOM_STALE_MS || (room.n === 0 && now - room.at >= ROOM_UNUSED_MS)) delete rooms[other];
    }
    await this.ctx.storage.put('rooms', rooms);
    if (this.fighting(rooms) !== before && this.live().length > 0) await this.beat();
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
    // A challenge takes the challenger out of the queue.
    const queue = await this.queue();
    if (queue.some((w) => w.id === me.id)) {
      await this.setQueue(queue.filter((w) => w.id !== me.id));
      ws.send(JSON.stringify({ t: 'unqueued', queued: false }));
    }
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

  /**
   * Pairs the sender with the one who has waited longest, or puts them at the back of the queue.
   * Asking again while in it keeps their place. A player waiting there can still be challenged, and
   * leaves the queue for the match if they accept.
   */
  private async quick(ws: WebSocket, me: Seat): Promise<void> {
    if (me.busy) {
      ws.send(JSON.stringify({ t: 'error', message: 'You are in a match.' }));
      return this.beat();
    }
    await this.withdraw((c) => c.from === me.id, 'cancelled');
    const queue = (await this.queue()).filter((w) => this.seatById(w.id)?.busy === false);
    const mine = queue.find((w) => w.id === me.id);
    const waiting = queue.filter((w) => w.id !== me.id);
    const first = waiting[0];
    if (first === undefined) {
      const place = mine ?? { id: me.id, at: Date.now() };
      await this.setQueue([place]);
      ws.send(JSON.stringify({ t: 'queued', queued: true, since: place.at }));
      return this.beat();
    }
    // The one who waited longer hosts. They stay in the queue until the room is made, so a room
    // that cannot be made does not lose them their place.
    await this.match(first.id, me.id, first.id);
  }

  /**
   * A room for two, both told, both busy, and anything else either had open called off. `waiting`
   * is the one the queue gave, who must still be in it.
   */
  private async match(host: string, guest: string, waiting?: string): Promise<void> {
    const pair = [host, guest];
    // The room is made with both names, as they are now; the seats are read again once it is back.
    const before = pair.map((id) => this.seatById(id));
    const fighter = (seat: Seat): Fighter => ({ id: seat.id, name: seat.name });
    // Making the room is a call to another object, and while it is out this one takes other
    // messages: either player may leave, take the queue back, or be matched with someone else.
    let code: string | undefined;
    try {
      code = before[0] && before[1] ? await openRoom(this.env, this.ctx.id.name ?? LOBBY, { host: fighter(before[0]), guest: fighter(before[1]) }) : undefined;
    } catch {
      code = undefined;
    }
    if (!code) {
      for (const id of pair) if (id !== waiting) this.tell(id, { t: 'error', message: 'The relay has no free room; try again.' });
      return;
    }
    const [hostSeat, guestSeat] = pair.map((id) => this.seatById(id));
    const stillWaiting = waiting === undefined || (await this.queue()).some((w) => w.id === waiting);
    if (!hostSeat || !guestSeat || hostSeat.busy || guestSeat.busy || !stillWaiting) {
      // The room stays empty and is let go as any unused one is; whoever is still here and free hears why.
      for (const [id, seat] of [[host, hostSeat], [guest, guestSeat]] as const) {
        if (seat && !seat.busy && id !== waiting) this.tell(id, { t: 'error', message: 'They went before the match was made; try again.' });
      }
      return;
    }
    // The room is listed under these two names once both are in it.
    const rooms = await this.rooms();
    rooms[code] = { ...rooms[code], n: rooms[code]?.n ?? 0, at: rooms[code]?.at ?? Date.now(), names: [hostSeat.name, guestSeat.name], ids: [host, guest] };
    await this.ctx.storage.put('rooms', rooms);
    // Busy before anything else can come in, so neither can be matched twice.
    for (const ws of pair.flatMap((id) => this.socketsOf(id))) {
      const seat = ws.deserializeAttachment() as Seat;
      ws.serializeAttachment({ ...seat, busy: true });
    }
    await this.withdraw((c) => pair.includes(c.from) || pair.includes(c.to), 'busy');
    await this.setQueue((await this.queue()).filter((w) => !pair.includes(w.id)));
    this.tell(host, { t: 'fight', code, role: 'host', with: { id: guestSeat.id, name: guestSeat.name } });
    this.tell(guest, { t: 'fight', code, role: 'guest', with: { id: hostSeat.id, name: hostSeat.name } });
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
      await this.setQueue((await this.queue()).filter((w) => w.id !== seat.id));
    }
    await this.beat(ws);
  }

  /** Tells everyone who is here and the numbers, and sets the next beat. */
  private async beat(gone?: WebSocket): Promise<void> {
    const sockets = this.live().filter((ws) => ws !== gone);
    const seats = this.seats(sockets);
    const records = this.board.tonight(seats.map((seat) => seat.id));
    const players: Player[] = seats.map((seat) => {
      const player: Player = { id: seat.id, name: seat.name, status: seat.busy ? 'busy' : 'free' };
      const night = records.get(seat.id);
      if (night) player.night = night;
      return player;
    });
    const here = JSON.stringify({ t: 'here', players, ...(await this.counts(seats)) });
    for (const ws of sockets) ws.send(here);
    await this.ctx.storage.put('beat', Date.now() + BEAT_MS);
    await this.schedule(sockets.length);
  }

  /** Each player once, as their newest socket has them, in the order they came. */
  private seats(sockets: WebSocket[]): Seat[] {
    const seen = new Map<string, Seat>();
    for (const ws of sockets) {
      const seat = ws.deserializeAttachment() as Seat;
      const prior = seen.get(seat.id);
      if (!prior || seat.at > prior.at) seen.set(seat.id, seat);
    }
    return [...seen.values()].sort((a, b) => a.at - b.at);
  }

  private async counts(seats: Seat[]): Promise<Stats> {
    const free = new Set(seats.filter((seat) => !seat.busy).map((seat) => seat.id));
    const waiting = (await this.queue()).filter((w) => free.has(w.id)).length;
    const rooms = await this.rooms();
    return { online: seats.length, waiting, fighting: this.fighting(rooms), fights: this.fights(rooms) };
  }

  /** The lobby's rooms with both players in, longest going first. */
  private fights(rooms: Record<string, Heads>): FightNow[] {
    const now = Date.now();
    const list: FightNow[] = [];
    for (const [code, room] of Object.entries(rooms)) {
      if (room.n < 2 || now - room.at >= ROOM_STALE_MS || !room.names || !room.ids) continue;
      list.push({ code, names: room.names, ids: room.ids, since: room.since ?? room.at });
    }
    return list.sort((a, b) => a.since - b.since);
  }

  /** Players in rooms with both in them; a room silent for hours has lost its word and is left out. */
  private fighting(rooms: Record<string, Heads>): number {
    const now = Date.now();
    return Object.values(rooms).reduce((sum, room) => sum + (room.n >= 2 && now - room.at < ROOM_STALE_MS ? room.n : 0), 0);
  }

  /** One alarm for the next beat, the first challenge to lapse or the first place in the queue to run out, whichever is soonest; none for an empty lobby. */
  private async schedule(present = this.live().length): Promise<void> {
    const times = (await this.challenges()).map((c) => c.at + CHALLENGE_MS);
    for (const w of await this.queue()) times.push(w.at + QUEUE_MS);
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

  /** The queue, oldest first; one kept as bare ids by the lobby before it timed anybody counts from now. */
  private async queue(): Promise<Waiting[]> {
    const list = (await this.ctx.storage.get<(Waiting | string)[]>('quick')) ?? [];
    return list.map((w) => (typeof w === 'string' ? { id: w, at: Date.now() } : w));
  }

  private async setQueue(list: Waiting[]): Promise<void> {
    await this.ctx.storage.put('quick', list);
  }

  private async rooms(): Promise<Record<string, Heads>> {
    return (await this.ctx.storage.get<Record<string, Heads>>('rooms')) ?? {};
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
