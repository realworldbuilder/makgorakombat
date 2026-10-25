import { DurableObject } from 'cloudflare:workers';
import type { Fighter, Span } from './board';
import { isCode, newCode } from './code';
import { cleanName, isPlayerId, LOBBY, type Lobby } from './lobby';

export { Lobby } from './lobby';

/*
 * The relay for MAK'GORA KOMBAT's online play. A room is a six-letter code and one Durable
 * Object; it holds at most a host and a guest, hands every message one of them sends to the
 * other as it came, and tells each when the other comes or goes. It never reads, keeps or
 * judges what the players send: the fight runs on both machines in lockstep, and the relay is
 * only the wire between them. A room nobody has been in for ten minutes is forgotten. The lobby
 * (lobby.ts) is where two players find each other and are handed a room; every room tells it how
 * many are in whenever that changes, so the lobby can say how many are fighting.
 *
 * The one message a room reads is a page's word that a match is over: {t:'result'}, with the match
 * number, the winner's part (host or guest), the rounds and the ticks. Both pages say it, each from
 * its own run of the same lockstep fight, and only when the two agree does the room pass the result
 * to the lobby's board, under the ids and names the lobby matched (or, in a room made by code, the
 * ones each page gives for itself). A match one of them left before the end is never said by both,
 * and counts for nothing.
 */

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  LOBBY: DurableObjectNamespace<Lobby>;
}

export type Role = 'host' | 'guest';

/** A room with nobody in it closes after this long. */
const IDLE_MS = 10 * 60 * 1000;

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

/** The two players the lobby put in a room. */
export type Pair = Record<Role, Fighter>;

/**
 * Makes a room under a fresh code and answers it; undefined when no free code turned up. The room
 * tells `lobby` who is in it and how its matches end, `players` being who the lobby matched.
 */
export async function openRoom(env: Env, lobby = LOBBY, players?: Pair): Promise<string | undefined> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newCode();
    if (await env.ROOMS.getByName(code).open(code, lobby, players)) return code;
  }
  return undefined;
}

const peer = (joined: boolean) => JSON.stringify({ t: 'peer', joined });

/** A page's word that a match is over. */
export interface Report {
  t: 'result';
  /** The match number in the room's run of rematches. */
  game: number;
  winner: Role;
  rounds: number;
  ticks: number;
  /** Who the page is, for a room the lobby did not make. */
  me?: Fighter;
}

/** A report from the wire, or undefined for text that is not one. Everything else a page sends goes through unread. */
export function readReport(text: string): Report | undefined {
  if (!text.startsWith('{') || !text.includes('"result"')) return undefined;
  let value: Partial<Report>;
  try {
    value = JSON.parse(text) as Partial<Report>;
  } catch {
    return undefined;
  }
  if (value.t !== 'result' || (value.winner !== 'host' && value.winner !== 'guest')) return undefined;
  const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
  if (!whole(value.game) || !whole(value.rounds) || !whole(value.ticks)) return undefined;
  const report: Report = { t: 'result', game: value.game, winner: value.winner, rounds: value.rounds, ticks: value.ticks };
  const name = cleanName(typeof value.me?.name === 'string' ? value.me.name : null);
  if (name && isPlayerId(typeof value.me?.id === 'string' ? value.me.id : null)) report.me = { id: value.me!.id, name };
  return report;
}

const same = (a: Report, b: Report) => a.game === b.game && a.winner === b.winner && a.rounds === b.rounds && a.ticks === b.ticks;

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // A keep-alive the room answers without waking: the page sends "ping" now and then, and to time the wire.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /** Opens the room under its code, to report to the lobby named, for the players it matched; false when the code is taken. */
  async open(code: string, lobby = LOBBY, players?: Pair): Promise<boolean> {
    if ((await this.ctx.storage.get<number>('opened')) !== undefined) return false;
    await this.ctx.storage.put({ opened: Date.now(), code, lobby, ...(players ? { players } : {}) });
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    return true;
  }

  async fetch(request: Request): Promise<Response> {
    if ((await this.ctx.storage.get<number>('opened')) === undefined) return new Response('There is no room with that code.', { status: 404 });
    const role = new URL(request.url).searchParams.get('role') as Role | null;
    if (role === null || !ROLES.includes(role)) return new Response('role must be host or guest', { status: 400 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    if (this.live(role).length > 0) return new Response(`The room already has a ${role}.`, { status: 409 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [role]);
    // Somebody is in: the room stays open for as long as they are.
    await this.ctx.storage.deleteAlarm();
    const others = this.live(other(role));
    if (others.length > 0) {
      server.send(peer(true));
      for (const ws of others) ws.send(peer(true));
    }
    await this.report(this.live().length);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const role = this.roleOf(ws);
    if (!role) return;
    const report = typeof message === 'string' ? readReport(message) : undefined;
    if (report) return this.reported(role, report);
    for (const to of this.live(other(role))) to.send(message);
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

  async alarm(): Promise<void> {
    if (this.live().length > 0) return;
    await this.ctx.storage.deleteAll();
  }

  /** A player went: the other hears of it, and an empty room starts its ten minutes. */
  private async left(ws: WebSocket): Promise<void> {
    const role = this.roleOf(ws);
    if (role) for (const to of this.live(other(role)).filter((s) => s !== ws)) to.send(peer(false));
    const still = this.live().filter((s) => s !== ws).length;
    if (still === 0) await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    await this.report(still);
  }

  /**
   * One page's word on a match. Kept until the other page's comes; when it does and the two agree, the
   * result goes to the lobby. Two that disagree are both dropped; a word on another match number
   * replaces the one kept, which the other page never matched.
   */
  private async reported(role: Role, report: Report): Promise<void> {
    const reports = (await this.ctx.storage.get<Partial<Record<Role, Report>>>('reports')) ?? {};
    const theirs = reports[other(role)];
    if (!theirs || theirs.game !== report.game) {
      await this.ctx.storage.put('reports', { [role]: report });
      return;
    }
    await this.ctx.storage.delete('reports');
    if (!same(theirs, report)) {
      console.warn('The two pages told different ends of one match:', theirs, report);
      return;
    }
    const [players, lobby] = await Promise.all([this.ctx.storage.get<Pair>('players'), this.ctx.storage.get<string>('lobby')]);
    const both: Record<Role, Report> = role === 'host' ? { host: report, guest: theirs } : { host: theirs, guest: report };
    const host = players?.host ?? both.host.me;
    const guest = players?.guest ?? both.guest.me;
    if (!host || !guest) return;
    const [winner, loser] = report.winner === 'host' ? [host, guest] : [guest, host];
    try {
      await this.env.LOBBY.getByName(lobby ?? LOBBY).result({ t: 'result', winner, loser, rounds: report.rounds, ticks: report.ticks });
    } catch (cause) {
      console.warn('The lobby did not take the result:', cause);
    }
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

    // The board: the top twenty tonight or of all time, and the asking player's own row when they give their id.
    if (url.pathname === '/lobby/board' && request.method === 'GET') {
      const span: Span = url.searchParams.get('span') === 'all' ? 'all' : 'night';
      const id = url.searchParams.get('id');
      const standings = await env.LOBBY.getByName(LOBBY).standings(span, isPlayerId(id) ? id : undefined);
      return Response.json(standings, { headers: { ...cors, 'Cache-Control': 'no-store' } });
    }

    if (url.pathname === '/') return new Response('makgora-relay: GET /lobby/ws?name=&id=[&busy=1|&requeue=1], GET /lobby/stats, GET /lobby/board?span=night|all[&id=]; or POST /rooms, then GET /rooms/:code/ws?role=host|guest', { headers: cors });
    return new Response('Not found', { status: 404, headers: cors });
  },
} satisfies ExportedHandler<Env>;
