import { DurableObject } from 'cloudflare:workers';
import type { Fighter, Span } from './board';
import { CHAT_GAP_MS, type ChatLine, ChatLog, chatOf } from './chat';
import { isCode, newCode } from './code';
import type { Ending, Fight, ReportSpan } from './fights';
import { cleanName, isPlayerId, LOBBY, type Lobby } from './lobby';
import { Picks } from './picks';
import { GameRecord, kindOf, WATCH_CAP } from './record';
import { HELD_MAX, RECONNECT_MS, SILENT_MS } from './seats';
import { readHit, SITE, type Site, type SiteSpan } from './site';
import { channelName, closeVoice, openVoice, type Voice, type VoiceEnv, sweepVoice, voiceOn } from './voice';

export { Lobby } from './lobby';
export { Site } from './site';

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
 *
 * The one message a room reads is a page's word that a match is over: {t:'result'}, with the match
 * number, the winner's part (host or guest), the rounds and the ticks. Both pages say it, each from
 * its own run of the same lockstep fight, and only when the two agree does the room pass the result
 * to the lobby's board, under the ids and names the lobby matched (or, in a room made by code, the
 * ones each page gives for itself). A match one of them left before the end is never said by both,
 * and counts for nothing.
 *
 * Anyone may also come in to watch (role=watch), up to WATCH_CAP at once. A watcher is a third
 * seat that is sent everything that makes the fight and says nothing to the players: all it may
 * send is a line of chat (chat.ts, ?name= for the name it goes under), which only the watchers get.
 * It hears which players are in ({t:'seats'}), each player's cursor while they pick their champions
 * (picks.ts), the host's hello and rematch and either's back as they were sent, and every frame of either player with one byte in front saying whose it was (0
 * the host, 1 the guest). The players hand each other an input only until it is acknowledged, so
 * the room keeps the current game's inputs (record.ts) and a watcher who comes in late is sent the
 * hello and those first, and can catch up. The players' own traffic is as it was. A player's
 * {t:'result'} is the room's alone: it goes to neither the other player nor the watchers. A player
 * whose seat is kept still reads as in to the watchers, who see the other's frames meanwhile and the
 * returning page's when it is back; the game so far is kept through the drop.
 *
 * For the night's report (fights.ts) a room also notes each match it sees, from the host's hello or
 * rematch to its end, and tells the lobby one short record of it: finished (the two results
 * agree), desync (the two players' hashes in their frames differ, the tick they first do, or
 * their results differ), left (back to the roster or a closed tab before the end), dropped (a
 * socket gone and not back in time), with the reconnects along the way; and a room that closes
 * with no match ever started in it is a record of its own. Nothing the pages send changes for it.
 *
 * Either player may ask the room for voice (voice.ts): the first ask has the relay's Discord bot
 * make a channel for the two and an invite to it, every ask after hands back the same, and the
 * other player hears {t:'voice'} with the invite. The channel goes when the room closes.
 */

export interface Env extends VoiceEnv {
  ROOMS: DurableObjectNamespace<Room>;
  LOBBY: DurableObjectNamespace<Lobby>;
  SITE: DurableObjectNamespace<Site>;
  /** More pages allowed to use the relay, comma separated (`https://makgora.gg,https://www.makgora.gg`): a domain of the game's own. Set at deploy, `--var ORIGINS:...`. */
  ORIGINS?: string;
}

export type Role = 'host' | 'guest';
/** A seat in the room: one of the two players, or one of those watching. */
type Seat = Role | 'watch';

/** A room with nobody in it closes after this long. */
const IDLE_MS = 10 * 60 * 1000;
/** Close codes that mean the page left on purpose (BACK TO THE ROSTER, a closed tab): no seat is kept for it. */
const LEAVING = new Set([1000, 1001]);

const ROLES: readonly Role[] = ['host', 'guest'];
const SEATS: readonly Seat[] = [...ROLES, 'watch'];
const other = (role: Role): Role => (role === 'host' ? 'guest' : 'host');

/** Pages allowed to use the relay: the game's own, those named in ORIGINS, and any served from this machine while it is worked on. */
export function allowedOrigin(origin: string | null, extra = ''): boolean {
  if (origin === null) return true;
  if (origin === 'https://realworldbuilder.github.io') return true;
  if (extra.split(',').some((allowed) => allowed.trim() !== '' && allowed.trim().replace(/\/$/, '') === origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin: string | null, extra?: string): Record<string, string> {
  if (origin === null || !allowedOrigin(origin, extra)) return {};
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

/** Seconds each of the two (host, guest) waited in the queue before the lobby matched them; null for one who did not queue. */
export type Waits = [number | null, number | null];

/**
 * Makes a room under a fresh code and answers it; undefined when no free code turned up. The room
 * tells `lobby` who is in it and how its matches end, `players` being who the lobby matched and
 * `waits` how long they waited for it.
 */
export async function openRoom(env: Env, lobby = LOBBY, players?: Pair, waits?: Waits): Promise<string | undefined> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newCode();
    if (await env.ROOMS.getByName(code).open(code, lobby, players, waits)) return code;
  }
  return undefined;
}

/** The match a room has on now, for the night's report (fights.ts). */
interface Open {
  game: number;
  start: number;
  stage?: string;
  reconnects: number;
}

/** The ground a hello names, as the night's report gives it. */
function stageOf(stage: unknown): string | undefined {
  const key = stage as { kind?: unknown; slug?: unknown; id?: unknown } | null;
  if (typeof key !== 'object' || key === null) return undefined;
  if (key.kind === 'stage' && typeof key.slug === 'string') return key.slug.slice(0, 64);
  if (key.kind === 'screen' && typeof key.id === 'number') return `screen:${key.id}`;
  return key.kind === 'none' ? 'none' : undefined;
}

/** The match number and the ground in a hello or a rematch. */
function startOf(text: string): { game: number; stage?: string } {
  try {
    const value = JSON.parse(text) as { game?: unknown; stage?: unknown };
    const game = typeof value.game === 'number' && Number.isInteger(value.game) && value.game >= 0 ? value.game : 0;
    const stage = stageOf(value.stage);
    return stage === undefined ? { game } : { game, stage };
  } catch {
    return { game: 0 };
  }
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

/** What a player's socket carries through hibernation: the id its page joined with, if it gave one. */
interface Attachment {
  id?: string;
}
/** What a watcher's socket carries: the name its lines go under, and when it last said one. */
interface Watcher {
  name: string;
  said: number;
}

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
  /**
   * The current game as the players have played it so far, for watchers. In memory only: while a
   * fight is on the frames keep the room awake, and a room that slept has nothing worth replaying.
   */
  private readonly record = new GameRecord();
  /** The watchers' last lines (chat.ts). */
  private readonly chat = new ChatLog();
  /** Each player's last cursor on the roster, for watchers who come in while they pick (picks.ts). */
  private readonly picks = new Picks();
  /** The seats kept for players who dropped, as stored; read once on waking. */
  private away: Partial<Record<Role, Away>> = {};
  /** What came for an away player, in order, to hand them when they are back. Kept in memory only: the fight's frames are sent again anyway. */
  private readonly held: Record<Role, (string | ArrayBuffer)[]> = { host: [], guest: [] };
  /** Sockets already seen to close: a close and an error for one socket are one departure. */
  private readonly gone = new WeakSet<WebSocket>();
  /** When each socket last sent a message; its pings the runtime keeps for us. */
  private readonly heard = new WeakMap<WebSocket, number>();
  private checkedAt = 0;
  /** The channel being made for a first ask for voice, so two asks at once make one. */
  private voicing: Promise<Voice> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // A keep-alive the room answers without waking: the page sends "ping" now and then, and to time the wire.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      this.away = (await ctx.storage.get<Partial<Record<Role, Away>>>('away')) ?? {};
    });
  }

  /** Opens the room under its code, to report to the lobby named, for the players it matched; false when the code is taken. */
  async open(code: string, lobby = LOBBY, players?: Pair, waits?: Waits): Promise<boolean> {
    if ((await this.ctx.storage.get<number>('opened')) !== undefined) return false;
    await this.ctx.storage.put({ opened: Date.now(), code, lobby, ...(players ? { players } : {}), ...(waits ? { waits } : {}) });
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    return true;
  }

  async fetch(request: Request): Promise<Response> {
    if ((await this.ctx.storage.get<number>('opened')) === undefined) return new Response('There is no room with that code.', { status: 404 });
    const url = new URL(request.url);
    const params = url.searchParams;
    const role = params.get('role') as Seat | null;
    if (url.pathname.endsWith('/voice')) return this.voice(role, params.get('id') || undefined);
    if (role === null || !SEATS.includes(role)) return new Response('role must be host, guest or watch', { status: 400 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    if (role === 'watch') return this.watch(params.get('name'));
    const id = params.get('id') || undefined;
    const seated = this.live(role);
    const kept = this.away[role];
    // The same page again while its old socket still looks open here (it dropped without a word): the new one takes over.
    const again = id !== undefined && seated.length > 0 && seated.every((ws) => this.idOf(ws) === id);
    if (seated.length > 0 && !again) return new Response(`The room already has a ${role}.`, { status: 409 });
    if (kept && kept.id !== id) return new Response(`The room is keeping the ${role}'s seat for them.`, { status: 409 });
    // A page back too late: the other has been told it left, so it may not walk back in as if it had not.
    if (id !== undefined && !kept && !again && (await this.ctx.storage.get<string[]>('lost'))?.includes(id)) return new Response('That seat was given up.', { status: 410 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ id } satisfies Attachment);
    this.heard.set(server, Date.now());
    for (const ws of seated) {
      try {
        ws.close(4001, 'replaced');
      } catch {
        // Already gone.
      }
    }
    const others = this.live(other(role));
    await this.ctx.storage.put('joined', true);
    if (kept || again) {
      // Back in the seat: both hear it, and the returning page gets what came for it meanwhile, in order.
      if (kept) await this.keep(role, undefined);
      await this.reconnected();
      if (others.length > 0) server.send(BACK);
      else if (this.away[other(role)]) server.send(AWAY);
      for (const ws of others) ws.send(BACK);
      for (const message of this.held[role].splice(0)) server.send(message);
    } else if (others.length > 0) {
      server.send(peer(true));
      for (const ws of others) ws.send(peer(true));
    } else if (this.away[other(role)]) server.send(AWAY);
    this.tellWatchers(this.seats());
    // Somebody is in: the room stays open for as long as they are.
    await this.schedule();
    await this.report(this.heads());
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * A player asks for voice: the match's Discord channel, made on the first ask, as its invite. Only
   * a page in one of the two seats (by the id it joined with) may ask, not a watcher or a stranger
   * with the code. The other player is told, so their page can offer to join.
   */
  private async voice(role: Seat | null, id: string | undefined): Promise<Response> {
    if (!voiceOn(this.env)) return new Response('This relay has no voice.', { status: 404 });
    if (role !== 'host' && role !== 'guest') return new Response('role must be host or guest', { status: 400 });
    const seated = id !== undefined && (this.live(role).some((ws) => this.idOf(ws) === id) || this.away[role]?.id === id);
    if (!seated) return new Response('Only the two players in the room may open its voice.', { status: 403 });
    let voice = await this.ctx.storage.get<Voice>('voice');
    if (!voice) {
      this.voicing ??= this.openVoice().finally(() => (this.voicing = undefined));
      try {
        voice = await this.voicing;
      } catch (cause) {
        console.warn('Discord did not make the voice channel:', cause);
        return new Response('Discord would not make the voice channel; try again.', { status: 502 });
      }
    }
    this.tell(other(role), JSON.stringify({ t: 'voice', url: voice.url, by: role }));
    return Response.json({ url: voice.url });
  }

  /** The match's channel, under the two names the lobby matched (or the room's code), kept for the room's life. */
  private async openVoice(): Promise<Voice> {
    const [code, players] = await Promise.all([this.ctx.storage.get<string>('code'), this.ctx.storage.get<Pair>('players')]);
    const voice = await openVoice(this.env, channelName(players ? [players.host.name, players.guest.name] : undefined, code ?? ''));
    await this.ctx.storage.put('voice', voice);
    return voice;
  }

  /**
   * A watcher comes in, under the name it gives for the chat: told who is playing, where their
   * cursors are if they are picking, then the game so far and the last lines said, and from then on everything as it comes.
   */
  private watch(name: string | null): Response {
    if (this.live('watch').length >= WATCH_CAP) return new Response('The room has as many watching as it takes.', { status: 409 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, ['watch']);
    server.serializeAttachment({ name: cleanName(name) ?? 'Watcher', said: 0 } satisfies Watcher);
    server.send(this.seats());
    for (const pick of this.picks.replay()) server.send(pick);
    for (const message of this.record.replay()) server.send(message);
    for (const line of this.chat.recent()) server.send(JSON.stringify(line));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** A watcher's line, to every watcher and to neither player; anything else a watcher sends goes nowhere. */
  private said(ws: WebSocket, message: string | ArrayBuffer): void {
    const text = chatOf(message);
    const watcher = ws.deserializeAttachment() as Watcher | null;
    if (text === undefined || !watcher) return;
    const now = Date.now();
    if (now - watcher.said < CHAT_GAP_MS) return;
    ws.serializeAttachment({ ...watcher, said: now } satisfies Watcher);
    const line: ChatLine = { t: 'chat', name: watcher.name, text, at: now };
    this.chat.add(line);
    const out = JSON.stringify(line);
    for (const to of this.live('watch')) to.send(out);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const role = this.roleOf(ws);
    if (!role) return this.said(ws, message);
    const now = Date.now();
    this.heard.set(ws, now);
    // Before passing it on, a look (once a second) at whether the other has gone quiet: then this is held for them.
    if (now - this.checkedAt >= 1000) {
      this.checkedAt = now;
      await this.silence(other(role), now);
    }
    const report = typeof message === 'string' ? readReport(message) : undefined;
    if (report) return this.reported(role, report);
    this.tell(other(role), message);
    const watchers = this.live('watch');
    if (typeof message === 'string') {
      const kind = kindOf(message);
      if (kind === 'roster') {
        const pick = this.picks.take(role, message);
        if (pick !== undefined) for (const to of watchers) to.send(pick);
        return;
      }
      if ((kind === 'hello' && role === 'host') || kind === 'back') this.picks.clear();
      if (kind === 'hello' && role === 'host') this.record.start(message);
      else if (kind === 'rematch' && role === 'host') this.record.rematch(message);
      else if (kind === 'back') this.record.clear();
      else return;
      for (const to of watchers) to.send(message);
      // Then the night's log: a match begins, or one going back to the roster ends it.
      if (kind === 'back') await this.end('left', { by: role });
      else await this.begin(message, kind === 'rematch');
      return;
    }
    const seat = role === 'host' ? 0 : 1;
    const desync = this.record.take(seat, new Uint8Array(message));
    if (watchers.length > 0) {
      const tagged = new Uint8Array(message.byteLength + 1);
      tagged[0] = seat;
      tagged.set(new Uint8Array(message), 1);
      for (const to of watchers) to.send(tagged);
    }
    if (desync !== undefined) await this.end('desync', { desyncAt: desync });
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
    const dropped: Role[] = [];
    for (const role of ROLES) {
      const kept = this.away[role];
      if (!kept || kept.until > Date.now()) continue;
      await this.keep(role, undefined);
      await this.ctx.storage.put('lost', [...((await this.ctx.storage.get<string[]>('lost')) ?? []), kept.id]);
      this.held[role] = [];
      this.tell(other(role), peer(false));
      ended = true;
      dropped.push(role);
    }
    if (!ended && this.heads() === 0) {
      // The night's log has the match still open, or the room that never had one, before the room forgets it all.
      const last = (await this.close('left')) ?? (await this.never());
      const [lobby, voice] = await Promise.all([this.ctx.storage.get<string>('lobby'), this.ctx.storage.get<Voice>('voice')]);
      // The match's voice channel goes with the room; one left behind is the hourly sweep's.
      if (voice) await closeVoice(this.env, voice.channel).catch((cause) => console.warn('Discord did not delete the voice channel:', cause));
      await this.ctx.storage.deleteAll();
      this.away = {};
      this.record.clear();
      this.picks.clear();
      // Anyone still watching an empty room is let go with it.
      for (const ws of this.live('watch')) {
        try {
          ws.close(1000, 'the room closed');
        } catch {
          // Already closing.
        }
      }
      if (last) await this.logged(last, lobby);
      return;
    }
    if (ended) this.tellWatchers(this.seats());
    await this.schedule();
    if (ended) await this.report(this.heads());
    // The match the player dropped out of is over.
    for (const role of dropped) await this.end('dropped', { by: role });
  }

  /**
   * A socket closed. A page that left on purpose, or never said who it was, is gone at once and
   * the other hears so; one that dropped keeps its seat for RECONNECT_MS and the other hears it is
   * away. A socket another has already taken over from is nobody's news. A watcher going changes
   * nothing; the watchers hear of a player gone, but a seat kept for one who dropped still reads as in.
   */
  private async left(ws: WebSocket, leaving: boolean): Promise<void> {
    const role = this.roleOf(ws);
    if (!role || this.gone.has(ws) || this.live(role).some((s) => s !== ws)) return;
    this.gone.add(ws);
    const id = this.idOf(ws);
    const gone = leaving || id === undefined;
    if (gone) {
      this.picks.clear(role);
      this.tell(other(role), peer(false), ws);
    } else if (!this.away[role]) {
      await this.keep(role, { id, until: Date.now() + RECONNECT_MS });
      this.tell(other(role), AWAY, ws);
    }
    this.tellWatchers(this.seats(ws));
    await this.schedule(ws);
    await this.report(this.heads(ws));
    // A match the player was in is over: they left it, or dropped without a seat kept.
    if (gone) await this.end(leaving ? 'left' : 'dropped', { by: role });
  }

  /** Takes a seat whose socket has been silent SILENT_MS for dropped, and shuts that socket. Pages without an id ping only every five seconds, and are let be. */
  private async silence(role: Role, now: number): Promise<void> {
    for (const ws of this.live(role)) {
      if (this.idOf(ws) === undefined) continue;
      const heard = this.heard.get(ws);
      // A room just woken has forgotten: the socket gets the whole time from now.
      if (heard === undefined) {
        this.heard.set(ws, now);
        continue;
      }
      const last = Math.max(heard, this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0);
      if (now - last < SILENT_MS) continue;
      try {
        ws.close(4002, 'silent');
      } catch {
        // Already gone.
      }
      await this.left(ws, false);
    }
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

  /**
   * One page's word on a match. Kept until the other page's comes; when it does and the two agree, the
   * result goes to the lobby. Two that disagree are both dropped; a word on another match number
   * replaces the one kept, which the other page never matched.
   */
  private async reported(role: Role, report: Report): Promise<void> {
    // Who a page in a room made by code says it is, for the night's log.
    if (report.me) {
      const mes = (await this.ctx.storage.get<Partial<Pair>>('mes')) ?? {};
      if (mes[role]?.id !== report.me.id || mes[role]?.name !== report.me.name) await this.ctx.storage.put('mes', { ...mes, [role]: report.me });
    }
    const reports = (await this.ctx.storage.get<Partial<Record<Role, Report>>>('reports')) ?? {};
    const theirs = reports[other(role)];
    if (!theirs || theirs.game !== report.game) {
      await this.ctx.storage.put('reports', { [role]: report });
      return;
    }
    await this.ctx.storage.delete('reports');
    if (!same(theirs, report)) {
      console.warn('The two pages told different ends of one match:', theirs, report);
      // Two runs of one lockstep fight that end differently were out of step.
      await this.end('desync', {}, report.game);
      return;
    }
    await this.end('finished', { winner: report.winner, rounds: report.rounds, ticks: report.ticks }, report.game);
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

  /**
   * The host's hello or rematch: a match begins, for the night's log. One still open then ended
   * without anybody saying how, and is logged as left; a rematch is fought on the last hello's ground.
   */
  private async begin(text: string, rematch: boolean): Promise<void> {
    const { game, stage: named } = startOf(text);
    const stage = rematch ? await this.ctx.storage.get<string>('stage') : named;
    const old = await this.close('left');
    const open: Open = { game, start: Date.now(), reconnects: 0, ...(stage !== undefined ? { stage } : {}) };
    await this.ctx.storage.put({ match: open, played: true, ...(!rematch && stage !== undefined ? { stage } : {}) });
    if (!rematch && stage === undefined) await this.ctx.storage.delete('stage');
    if (old) await this.logged(old);
  }

  /** The match on now is over, `how`; with `game`, only if it is that match. Its record goes to the lobby. */
  private async end(how: Ending, extra: Partial<Fight> = {}, game?: number): Promise<void> {
    const fight = await this.close(how, extra, game);
    if (fight) await this.logged(fight);
  }

  /** Takes the match on now off the room's storage and answers its record; undefined when there is none (or it is not `game`). */
  private async close(how: Ending, extra: Partial<Fight> = {}, game?: number): Promise<Fight | undefined> {
    const open = await this.ctx.storage.get<Open>('match');
    if (!open || (game !== undefined && open.game !== game)) return undefined;
    await this.ctx.storage.delete('match');
    const fight = await this.fight({ ...extra, game: open.game, start: open.start, ended: how, reconnects: open.reconnects, ...(open.stage !== undefined ? { stage: open.stage } : {}) });
    return fight;
  }

  /** The record of a room that closes without a match ever started in it, if the lobby matched two for it or anybody came in. */
  private async never(): Promise<Fight | undefined> {
    const [played, joined, players, opened] = await Promise.all([
      this.ctx.storage.get<boolean>('played'),
      this.ctx.storage.get<boolean>('joined'),
      this.ctx.storage.get<Pair>('players'),
      this.ctx.storage.get<number>('opened'),
    ]);
    if (played || opened === undefined || (!joined && !players)) return undefined;
    // The room closes IDLE_MS after the last one left it.
    return this.fight({ game: 0, start: opened, end: Math.max(opened, Date.now() - IDLE_MS), ended: 'never', reconnects: 0 });
  }

  /** A record with the room's own parts: its code, the players, and on its first record only, how long they queued. */
  private async fight(parts: Omit<Fight, 'code' | 'lobby' | 'end'> & { end?: number }): Promise<Fight> {
    const [code, players, mes, waits] = await Promise.all([
      this.ctx.storage.get<string>('code'),
      this.ctx.storage.get<Pair>('players'),
      this.ctx.storage.get<Partial<Pair>>('mes'),
      this.ctx.storage.get<Waits>('waits'),
    ]);
    if (waits) await this.ctx.storage.delete('waits');
    const host = players?.host ?? mes?.host;
    const guest = players?.guest ?? mes?.guest;
    return {
      code: code ?? '',
      lobby: players !== undefined,
      ...parts,
      end: parts.end ?? Date.now(),
      ...(host ? { host: { id: host.id, name: host.name } } : {}),
      ...(guest ? { guest: { id: guest.id, name: guest.name } } : {}),
      ...(waits ? { waits } : {}),
    };
  }

  /** A player dropped and came back in time: one more reconnect on the match on now. */
  private async reconnected(): Promise<void> {
    const open = await this.ctx.storage.get<Open>('match');
    if (open) await this.ctx.storage.put('match', { ...open, reconnects: open.reconnects + 1 });
  }

  /** Hands a match's record to the lobby; one that cannot be reached loses it, and the room goes on. */
  private async logged(fight: Fight, lobby?: string): Promise<void> {
    lobby ??= await this.ctx.storage.get<string>('lobby');
    try {
      await this.env.LOBBY.getByName(lobby ?? LOBBY).fight(fight);
    } catch (cause) {
      console.warn('The lobby did not take the match\'s record:', cause);
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

  /** The id a player's page joined with, if it gave one. */
  private idOf(ws: WebSocket): string | undefined {
    return (ws.deserializeAttachment() as Attachment | null)?.id;
  }

  private roleOf(ws: WebSocket): Role | undefined {
    const tag = this.ctx.getTags(ws)[0];
    return tag === 'host' || tag === 'guest' ? tag : undefined;
  }

  /** The sockets still open, for a seat or for both players. */
  private live(seat?: Seat): WebSocket[] {
    const sockets = seat ? this.ctx.getWebSockets(seat) : [...this.ctx.getWebSockets('host'), ...this.ctx.getWebSockets('guest')];
    return sockets.filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  /** Which players are in, for the watchers, a seat kept for one who dropped among them; `gone` is a socket closing that still reads as open. */
  private seats(gone?: WebSocket): string {
    const here = (role: Role) => this.away[role] !== undefined || this.live(role).some((ws) => ws !== gone);
    return JSON.stringify({ t: 'seats', host: here('host'), guest: here('guest') });
  }

  private tellWatchers(message: string): void {
    for (const ws of this.live('watch')) ws.send(message);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env.ORIGINS);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!allowedOrigin(origin, env.ORIGINS)) return new Response('This page may not use the relay.', { status: 403 });

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

    // A match's voice on Discord (voice.ts): whether this relay has it, and a player's ask for their room's channel.
    if (url.pathname === '/voice' && request.method === 'GET') return Response.json({ on: voiceOn(env) }, { headers: cors });
    const voice = /^\/rooms\/([A-Za-z]+)\/voice$/.exec(url.pathname);
    if (voice && request.method === 'POST') {
      const code = voice[1]!.toUpperCase();
      if (!isCode(code)) return new Response('That is not a room code.', { status: 404, headers: cors });
      const answer = await env.ROOMS.getByName(code).fetch(request);
      return new Response(answer.body, { status: answer.status, headers: { ...cors, 'Content-Type': answer.headers.get('Content-Type') ?? 'text/plain' } });
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

    // The night's report: who came, how long they waited, how the matches ended; the list of them for a night or a day.
    if (url.pathname === '/lobby/report' && request.method === 'GET') {
      const asked = url.searchParams.get('span');
      const span: ReportSpan = asked === 'day' || asked === 'week' || asked === 'all' ? asked : 'night';
      const report = await env.LOBBY.getByName(LOBBY).report(span);
      return Response.json(report, { headers: { ...cors, 'Cache-Control': 'no-store' } });
    }

    // The site's own numbers (site.ts): a page's hit, sent as plain text so the browser asks no leave first, and the report of them.
    if (url.pathname === '/site/hit' && request.method === 'POST') {
      const country = (request as { cf?: { country?: string } }).cf?.country;
      const hit = readHit(await request.text(), { country, ua: request.headers.get('User-Agent') ?? '' });
      if (hit) await env.SITE.getByName(SITE).hit(hit);
      return new Response(null, { status: 204, headers: cors });
    }
    if (url.pathname === '/site/report' && request.method === 'GET') {
      const asked = url.searchParams.get('span');
      const span: SiteSpan = asked === 'day' || asked === 'month' || asked === 'all' ? asked : 'week';
      const report = await env.SITE.getByName(SITE).report(span);
      return Response.json(report, { headers: { ...cors, 'Cache-Control': 'no-store' } });
    }

    if (url.pathname === '/') return new Response('makgora-relay: GET /lobby/ws?name=&id=[&busy=1|&requeue=1], GET /lobby/stats, GET /lobby/board?span=night|all[&id=], GET /lobby/report?span=night|day|week|all; GET /voice, POST /rooms/:code/voice?role=&id=; POST /site/hit, GET /site/report?span=day|week|month|all; or POST /rooms, then GET /rooms/:code/ws?role=host|guest|watch[&id=]', { headers: cors });
    return new Response('Not found', { status: 404, headers: cors });
  },

  /** Once an hour: any voice channel a closed room left on Discord goes. */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(sweepVoice(env).then((n) => n > 0 && console.log(`Deleted ${n} voice channels closed rooms left.`)));
  },
} satisfies ExportedHandler<Env>;
