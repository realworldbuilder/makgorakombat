import { DurableObject } from 'cloudflare:workers';
import { LOBBY, type Lobby } from './lobby';

export { Lobby } from './lobby';

/*
 * The relay for MAK'GORA KOMBAT's online play. A room is a six-letter code and one Durable
 * Object; it holds at most a host and a guest, hands every message one of them sends to the
 * other as it came, and tells each when the other comes or goes. It never reads, keeps or
 * judges what the players send: the fight runs on both machines in lockstep, and the relay is
 * only the wire between them. A room nobody has been in for ten minutes is forgotten. The lobby
 * (lobby.ts) is where two players find each other and are handed a room.
 */

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  LOBBY: DurableObjectNamespace<Lobby>;
}

export type Role = 'host' | 'guest';

/** Consonants only, so no code spells a word, and none of the ones that pass for a digit or each other (L, Y). */
export const ALPHABET = 'BCDFGHJKMNPQRSTVWXZ';
export const CODE_LENGTH = 6;
/** A room with nobody in it closes after this long. */
export const IDLE_MS = 10 * 60 * 1000;

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

export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function isCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c));
}

/** Makes a room under a fresh code and answers it; undefined when no free code turned up. */
export async function openRoom(env: Env): Promise<string | undefined> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newCode();
    if (await env.ROOMS.getByName(code).open()) return code;
  }
  return undefined;
}

const peer = (joined: boolean) => JSON.stringify({ t: 'peer', joined });

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // A keep-alive the room answers without waking: the page sends "ping" now and then, and to time the wire.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /** Opens the room under its code; false when the code is taken. */
  async open(): Promise<boolean> {
    if ((await this.ctx.storage.get<number>('opened')) !== undefined) return false;
    await this.ctx.storage.put('opened', Date.now());
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
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const role = this.roleOf(ws);
    if (!role) return;
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
    if (this.live().filter((s) => s !== ws).length === 0) await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
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

    if (url.pathname === '/') return new Response('makgora-relay: GET /lobby/ws?name=&id=; or POST /rooms, then GET /rooms/:code/ws?role=host|guest', { headers: cors });
    return new Response('Not found', { status: 404, headers: cors });
  },
} satisfies ExportedHandler<Env>;
