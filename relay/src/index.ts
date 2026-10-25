import { DurableObject } from 'cloudflare:workers';
import { isCode, newCode } from './code';
import { LOBBY, type Lobby } from './lobby';

export { Lobby } from './lobby';

/*
 * The relay for MAK'GORA KOMBAT's online play. A room is a six-letter code and one Durable
 * Object; it holds at most a host and a guest, hands every message one of them sends to the
 * other as it came, and tells each when the other comes or goes. It never reads, keeps or
 * judges what the players send: the fight runs on both machines in lockstep, and the relay is
 * only the wire between them. A player whose socket drops (a train, a Wi-Fi blip) keeps their seat
 * for RECONNECT_MS: the other hears they are away, what is sent to them meanwhile is held, and if
 * the same page comes back for the seat it is let in and handed what it missed. A page that comes
 * back names itself by the id it joined with (`&id=`); a page without one, as before ids, leaves
 * the moment its socket does. A room nobody has been in for ten minutes is forgotten. The lobby
 * (lobby.ts) is where two players find each other and are handed a room; every room tells it how
 * many are in whenever that changes, so the lobby can say how many are fighting.
 */

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  LOBBY: DurableObjectNamespace<Lobby>;
}

export type Role = 'host' | 'guest';

/** A room with nobody in it closes after this long. */
const IDLE_MS = 10 * 60 * 1000;
/** A player whose socket dropped keeps their seat this long. */
export const RECONNECT_MS = 20_000;
/** At most this many messages are held for a player who is away; the oldest frames go first. */
export const HELD_MAX = 600;
/** Close codes that mean the page left on purpose (BACK TO THE ROSTER, a closed tab): no seat is kept for it. */
const LEAVING = new Set([1000, 1001]);

const ROLES: readonly Role[] = ['host', 'guest'];
const other = (role: Role): Role => (role === 'host' ? 'guest' : 'host');

/** Pages allowed to use the relay: the game's own, and any served from this machine while it is worked on. */
export function allowedOrigin(origin: string | null): boolean {
  if (origin === null) return true;
  if (origin === 'https://realworldbuilder.github.io' || origin === 'https://makgora.clawdioslave.com') return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (origin === null || !allowedOrigin(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** Makes a room under a fresh code and answers it; undefined when no free code turned up. The room tells `lobby` who is in it. */
export async function openRoom(env: Env, lobby = LOBBY): Promise<string | undefined> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newCode();
    if (await env.ROOMS.getByName(code).open(code, lobby)) return code;
  }
  return undefined;
}

const peer = (joined: boolean) => JSON.stringify({ t: 'peer', joined });
// Away and back say joined: true as well, so a page from before them only sees the other still in, and waits.
const AWAY = JSON.stringify({ t: 'peer', joined: true, away: true });
const BACK = JSON.stringify({ t: 'peer', joined: true, back: true });

/** A seat whose socket dropped: who may take it back, and until when. */
interface Away {
  id: string;
  until: number;
}

/** What a socket carries through hibernation: the id its page joined with, if it gave one. */
interface Seat {
  id?: string;
}

export class Room extends DurableObject<Env> {
  /** The seats kept for players who dropped, as stored; read once on waking. */
  private away: Partial<Record<Role, Away>> = {};
  /** What came for an away player, in order, to hand them when they are back. Kept in memory only: the fight's frames are sent again anyway. */
  private readonly held: Record<Role, (string | ArrayBuffer)[]> = { host: [], guest: [] };
  /** Sockets already seen to close: a close and an error for one socket are one departure. */
  private readonly gone = new WeakSet<WebSocket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // A keep-alive the room answers without waking: the page sends "ping" now and then, and to time the wire.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      this.away = (await ctx.storage.get<Partial<Record<Role, Away>>>('away')) ?? {};
    });
  }

  /** Opens the room under its code, to report to the lobby named; false when the code is taken. */
  async open(code: string, lobby = LOBBY): Promise<boolean> {
    if ((await this.ctx.storage.get<number>('opened')) !== undefined) return false;
    await this.ctx.storage.put({ opened: Date.now(), code, lobby });
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    return true;
  }

  async fetch(request: Request): Promise<Response> {
    if ((await this.ctx.storage.get<number>('opened')) === undefined) return new Response('There is no room with that code.', { status: 404 });
    const params = new URL(request.url).searchParams;
    const role = params.get('role') as Role | null;
    const id = params.get('id') || undefined;
    if (role === null || !ROLES.includes(role)) return new Response('role must be host or guest', { status: 400 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const seated = this.live(role);
    const kept = this.away[role];
    // The same page again while its old socket still looks open here (it dropped without a word): the new one takes over.
    const again = id !== undefined && seated.length > 0 && seated.every((ws) => this.seatOf(ws).id === id);
    if (seated.length > 0 && !again) return new Response(`The room already has a ${role}.`, { status: 409 });
    if (kept && kept.id !== id) return new Response(`The room is keeping the ${role}'s seat for them.`, { status: 409 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ id } satisfies Seat);
    for (const ws of seated) {
      try {
        ws.close(4001, 'replaced');
      } catch {
        // Already gone.
      }
    }
    const others = this.live(other(role));
    if (kept || again) {
      // Back in the seat: both hear it, and the returning page gets what came for it meanwhile, in order.
      if (kept) await this.keep(role, undefined);
      if (others.length > 0) server.send(BACK);
      else if (this.away[other(role)]) server.send(AWAY);
      for (const ws of others) ws.send(BACK);
      for (const message of this.held[role].splice(0)) server.send(message);
    } else if (others.length > 0) {
      server.send(peer(true));
      for (const ws of others) ws.send(peer(true));
    } else if (this.away[other(role)]) server.send(AWAY);
    // Somebody is in: the room stays open for as long as they are.
    await this.schedule();
    await this.report(this.heads());
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const role = this.roleOf(ws);
    if (role) this.tell(other(role), message);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed on this side.
    }
    await this.left(ws, LEAVING.has(code));
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.left(ws, false);
  }

  /** A kept seat's time is up (its player is gone for good), or the room has been empty for ten minutes. */
  async alarm(): Promise<void> {
    let ended = false;
    for (const role of ROLES) {
      const kept = this.away[role];
      if (!kept || kept.until > Date.now()) continue;
      await this.keep(role, undefined);
      this.held[role] = [];
      this.tell(other(role), peer(false));
      ended = true;
    }
    if (!ended && this.heads() === 0) {
      await this.ctx.storage.deleteAll();
      this.away = {};
      return;
    }
    await this.schedule();
    if (ended) await this.report(this.heads());
  }

  /**
   * A socket closed. A page that left on purpose, or never said who it was, is gone at once and
   * the other hears so; one that dropped keeps its seat for RECONNECT_MS and the other hears it is
   * away. A socket another has already taken over from is nobody's news.
   */
  private async left(ws: WebSocket, leaving: boolean): Promise<void> {
    const role = this.roleOf(ws);
    if (!role || this.gone.has(ws) || this.live(role).some((s) => s !== ws)) return;
    this.gone.add(ws);
    const { id } = this.seatOf(ws);
    if (leaving || id === undefined) {
      this.tell(other(role), peer(false), ws);
    } else if (!this.away[role]) {
      await this.keep(role, { id, until: Date.now() + RECONNECT_MS });
      this.tell(other(role), AWAY, ws);
    }
    await this.schedule(ws);
    await this.report(this.heads(ws));
  }

  /** Sends to a role's socket, or holds it for them while they are away. `gone` is a socket closing now. */
  private tell(role: Role, message: string | ArrayBuffer, gone?: WebSocket): void {
    const to = this.live(role).filter((s) => s !== gone);
    for (const ws of to) ws.send(message);
    if (to.length > 0 || !this.away[role]) return;
    const held = this.held[role];
    held.push(message);
    if (held.length > HELD_MAX) {
      // Over the cap a frame goes, the oldest, before any of the screens' messages, which nothing sends again.
      const frame = held.findIndex((m) => typeof m !== 'string');
      held.splice(frame === -1 ? 0 : frame, 1);
    }
  }

  /** Keeps a seat for its player, or stops keeping it; stored first, so a room that sleeps and wakes still knows. */
  private async keep(role: Role, away: Away | undefined): Promise<void> {
    const next = { ...this.away };
    if (away) next[role] = away;
    else delete next[role];
    await this.ctx.storage.put('away', next);
    this.away = next;
  }

  /** The one alarm: the soonest kept seat's end; else, with nobody in, the ten minutes; else none. `gone` is a socket closing now. */
  private async schedule(gone?: WebSocket): Promise<void> {
    const ends = ROLES.flatMap((role) => (this.away[role] ? [this.away[role]!.until] : []));
    if (ends.length > 0) {
      await this.ctx.storage.setAlarm(Math.min(...ends));
    } else if (this.heads(gone) === 0) {
      await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  /** Players in the room: the open sockets, but `gone`, and the seats kept for those who dropped. */
  private heads(gone?: WebSocket): number {
    return this.live().filter((s) => s !== gone).length + ROLES.filter((role) => this.away[role]).length;
  }

  /** Tells the lobby how many are in; a lobby that cannot be reached just has an old count, and the room goes on. */
  private async report(n: number): Promise<void> {
    const [code, lobby] = await Promise.all([this.ctx.storage.get<string>('code'), this.ctx.storage.get<string>('lobby')]);
    if (!code) return;
    try {
      await this.env.LOBBY.getByName(lobby ?? LOBBY).roomHeads(code, n);
    } catch (cause) {
      console.warn('The lobby did not take the room\'s count:', cause);
    }
  }

  private seatOf(ws: WebSocket): Seat {
    return (ws.deserializeAttachment() as Seat | null) ?? {};
  }

  private roleOf(ws: WebSocket): Role | undefined {
    const tag = this.ctx.getTags(ws)[0];
    return tag === 'host' || tag === 'guest' ? tag : undefined;
  }

  /** The sockets still open, for a role or for both. */
  private live(role?: Role): WebSocket[] {
    return this.ctx.getWebSockets(role).filter((ws) => ws.readyState === WebSocket.OPEN);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!allowedOrigin(origin)) return new Response('This page may not use the relay.', { status: 403 });

    if (url.pathname === '/rooms' && request.method === 'POST') {
      const code = await openRoom(env);
      if (code) return Response.json({ code }, { headers: cors });
      return new Response('No free room code; try again.', { status: 503, headers: cors });
    }

    const ws = /^\/rooms\/([A-Za-z]+)\/ws$/.exec(url.pathname);
    if (ws && request.method === 'GET') {
      const code = ws[1]!.toUpperCase();
      if (!isCode(code)) return new Response('That is not a room code.', { status: 404, headers: cors });
      return env.ROOMS.getByName(code).fetch(request);
    }

    if (url.pathname === '/lobby/ws' && request.method === 'GET') return env.LOBBY.getByName(LOBBY).fetch(request);
    // The lobby's numbers, for a page that is not in it (the title) or a bot.
    if (url.pathname === '/lobby/stats' && request.method === 'GET') {
      const counts = await env.LOBBY.getByName(LOBBY).stats();
      return Response.json(counts, { headers: { ...cors, 'Cache-Control': 'no-store' } });
    }

    if (url.pathname === '/') return new Response('makgora-relay: GET /lobby/ws?name=&id=[&busy=1|&requeue=1], GET /lobby/stats; or POST /rooms, then GET /rooms/:code/ws?role=host|guest[&id=]', { headers: cors });
    return new Response('Not found', { status: 404, headers: cors });
  },
} satisfies ExportedHandler<Env>;
