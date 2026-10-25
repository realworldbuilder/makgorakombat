import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, RECONNECT_MS, type Wire } from '../../src/game/net/relay';

/** A socket the test plays the room for: it opens, talks, drops or fails when told. */
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static made: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  binaryType = 'blob';
  readonly sent: (string | Uint8Array)[] = [];
  closedWith: number | undefined;
  private readonly handlers = new Map<string, Set<{ fn: (event: unknown) => void; once: boolean }>>();

  constructor(readonly url: string) {
    FakeSocket.made.push(this);
  }

  addEventListener(type: string, fn: (event: unknown) => void, options?: { once?: boolean }): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add({ fn, once: options?.once ?? false });
  }

  removeEventListener(type: string, fn: (event: unknown) => void): void {
    for (const h of this.handlers.get(type) ?? []) if (h.fn === fn) this.handlers.get(type)!.delete(h);
  }

  send(data: string | Uint8Array): void {
    if (this.readyState !== FakeSocket.OPEN) throw new Error('send on a socket that is not open');
    this.sent.push(data);
  }

  close(code?: number): void {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.closedWith = code;
    this.readyState = FakeSocket.CLOSED;
    this.emit('close', {});
  }

  // The room's side.
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.emit('open', {});
  }

  say(data: string | object): void {
    this.emit('message', { data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  bytes(data: number[]): void {
    this.emit('message', { data: new Uint8Array(data).buffer });
  }

  /** The wire went: a close nobody here asked for. */
  drop(): void {
    this.readyState = FakeSocket.CLOSED;
    this.emit('close', {});
  }

  /** The room would not have it (409, 410) or could not be reached. */
  fail(): void {
    this.readyState = FakeSocket.CLOSED;
    this.emit('error', {});
    this.emit('close', {});
  }

  private emit(type: string, event: unknown): void {
    for (const h of [...(this.handlers.get(type) ?? [])]) {
      if (h.once) this.handlers.get(type)!.delete(h);
      h.fn(event);
    }
  }
}

const last = () => FakeSocket.made.at(-1)!;

async function opened(id = 'me'): Promise<Link> {
  const pending = Link.open('BCDFGH', 'guest', 'http://relay.test', id);
  last().open();
  return pending;
}

describe('the link to the room', () => {
  beforeEach(() => {
    FakeSocket.made = [];
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('joins with its seat id, and after a drop tries the same room as the same seat at 1, 2, 4 and 5 seconds', async () => {
    const link = await opened('seat-1');
    expect(last().url).toBe('ws://relay.test/rooms/BCDFGH/ws?role=guest&id=seat-1');
    const wires: Wire[] = [];
    link.onWire((wire) => wires.push(wire));
    let closes = 0;
    link.onClose(() => closes++);
    const bytes: number[][] = [];
    link.channel().onMessage((data) => bytes.push([...(data as Uint8Array)]));

    const first = last();
    const droppedAt = performance.now();
    first.drop();
    expect(wires.at(-1)).toEqual({ away: false, reconnecting: true, until: droppedAt + RECONNECT_MS });
    // A screen's message while the socket is down waits for it; the fight's frames are just lost.
    link.send({ t: 'back' });
    link.channel().send(new Uint8Array([1]));

    const gaps = [1000, 2000, 4000, 5000];
    for (const [k, gap] of gaps.entries()) {
      vi.advanceTimersByTime(gap - 1);
      expect(FakeSocket.made.length).toBe(1 + k);
      vi.advanceTimersByTime(1);
      expect(FakeSocket.made.length).toBe(2 + k);
      expect(last().url).toBe(first.url);
      if (k < gaps.length - 1) last().fail();
    }
    last().open();
    expect(wires.at(-1)).toEqual({ away: false, reconnecting: false, until: undefined });
    expect(last().sent).toContain('{"t":"back"}');
    expect(closes).toBe(0);
    expect(link.closed).toBe(false);
    // The new socket is the link's now: its bytes reach the fight, the old one's do not.
    last().bytes([7, 7]);
    first.bytes([9]);
    expect(bytes).toEqual([[7, 7]]);
    link.channel().send(new Uint8Array([2]));
    expect(last().sent.at(-1)).toEqual(new Uint8Array([2]));
    link.close();
  });

  it('tells its listeners when the other player is away and back', async () => {
    const link = await opened();
    const wires: Wire[] = [];
    link.onWire((wire) => wires.push(wire));
    last().say({ t: 'peer', joined: true });
    expect(link.peer).toBe(true);
    const at = performance.now();
    last().say({ t: 'peer', joined: true, away: true });
    expect(wires.at(-1)).toEqual({ away: true, reconnecting: false, until: at + RECONNECT_MS });
    expect(link.peer).toBe(true);
    vi.advanceTimersByTime(3000);
    // Pongs keep our own socket for live meanwhile.
    last().say('pong');
    last().say({ t: 'peer', joined: true, back: true });
    expect(wires.at(-1)).toEqual({ away: false, reconnecting: false, until: undefined });
    last().say({ t: 'peer', joined: true, away: true });
    last().say({ t: 'peer', joined: false });
    expect(link.peer).toBe(false);
    expect(wires.at(-1)!.away).toBe(false);
    link.close();
  });

  it('gives up once the room has given the seat up, and only then says it closed', async () => {
    const link = await opened();
    let closes = 0;
    link.onClose(() => closes++);
    last().drop();
    let made = FakeSocket.made.length;
    for (let t = 0; t < RECONNECT_MS + 10_000; t += 100) {
      vi.advanceTimersByTime(100);
      if (FakeSocket.made.length > made) {
        made = FakeSocket.made.length;
        last().fail();
      }
      if (t < RECONNECT_MS - 200) expect(closes).toBe(0);
    }
    expect(closes).toBe(1);
    expect(link.closed).toBe(true);
    expect(link.wire()).toEqual({ away: false, reconnecting: false, until: undefined });
    // Tries at 1, 3, 7, 12 and 17 seconds, then none.
    expect(FakeSocket.made.length).toBe(1 + 5);
  });

  it('takes a socket whose pings go unanswered for dead, though it never closed', async () => {
    const link = await opened();
    const socket = last();
    expect(socket.sent).toEqual(['ping']);
    // Answered, it lives on.
    for (let k = 0; k < 10; k++) {
      vi.advanceTimersByTime(1000);
      if (socket.sent.at(-1) === 'ping') socket.say('pong');
    }
    expect(link.wire().reconnecting).toBe(false);
    expect(socket.sent.filter((m) => m === 'ping').length).toBeGreaterThanOrEqual(5);
    // Then the Wi-Fi goes: nothing answers, and no close comes. The next ping goes within two seconds, and four after it the socket is given up.
    vi.advanceTimersByTime(3900);
    expect(link.wire().reconnecting).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(link.wire().reconnecting).toBe(true);
    expect(socket.closedWith).toBe(4000);
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.made.length).toBe(2);
    link.close();
  });

  it('makes no try after it is closed here, and the room hears a goodbye', async () => {
    const link = await opened();
    let closes = 0;
    link.onClose(() => closes++);
    const socket = last();
    link.close();
    expect(socket.closedWith).toBe(1000);
    vi.advanceTimersByTime(30_000);
    expect(FakeSocket.made.length).toBe(1);
    expect(closes).toBe(1);
  });

  it('lets a try that hangs go after four seconds for the next', async () => {
    const link = await opened();
    last().drop();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.made.length).toBe(2);
    // This one neither opens nor fails.
    vi.advanceTimersByTime(4000);
    expect(last().closedWith).toBeUndefined();
    expect(last().readyState).toBe(FakeSocket.CLOSED);
    vi.advanceTimersByTime(2000);
    expect(FakeSocket.made.length).toBe(3);
    last().open();
    expect(link.wire().reconnecting).toBe(false);
    link.close();
  });
});
