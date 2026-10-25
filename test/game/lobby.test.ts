import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanName, EMPTY, fold, Lobby, type LobbyState, typingName } from '../../src/game/net/lobby';

describe('the lobby, on the page', () => {
  it('takes the names the relay takes', () => {
    expect(cleanName(' Will  Hsu ')).toBe('Will Hsu');
    expect(cleanName('W')).toBe(undefined);
    expect(cleanName('Seventeen letters')).toBe(undefined);
    expect(typingName('Will<b>!  Hsu')).toBe('Willb Hsu');
    expect(typingName(' leading')).toBe('leading');
    expect(typingName('a'.repeat(20))).toHaveLength(16);
  });

  it('folds what the lobby says into what the panel draws', () => {
    const players = [
      { id: 'me-000001', name: 'Chris', status: 'free' as const },
      { id: 'will-0001', name: 'Will', status: 'free' as const },
    ];
    let state: LobbyState = fold(EMPTY, { t: 'here', players }, 0);
    expect(state.players).toHaveLength(2);

    state = fold(state, { t: 'challenging', to: { id: 'will-0001', name: 'Will' }, ttl: 30_000 }, 1000);
    expect(state.outgoing).toEqual({ id: 'will-0001', name: 'Will', until: 31_000 });
    state = fold(state, { t: 'declined', by: 'will-0001', reason: 'declined' }, 2000);
    expect(state.outgoing).toBe(undefined);
    expect(state.notice).toBe('Will declined.');

    state = fold(state, { t: 'challenging', to: { id: 'will-0001', name: 'Will' }, ttl: 30_000 }, 3000);
    expect(fold(state, { t: 'declined', by: 'will-0001', reason: 'timeout' }, 33_000).notice).toBe('Will did not answer.');
    // A decline for a challenge this page no longer waits on changes nothing.
    expect(fold(state, { t: 'declined', by: 'somebody', reason: 'declined' }, 4000)).toBe(state);

    state = fold(EMPTY, { t: 'challenged', from: { id: 'will-0001', name: 'Will' }, ttl: 30_000 }, 0);
    expect(state.incoming?.name).toBe('Will');
    expect(fold(state, { t: 'withdrawn', from: 'will-0001', reason: 'cancelled' }, 1).notice).toBe('Will took the challenge back.');
    // One that lapsed just goes; the ring said so.
    expect(fold(state, { t: 'withdrawn', from: 'will-0001', reason: 'timeout' }, 1)).toMatchObject({ incoming: undefined, notice: undefined });

    state = fold(fold(EMPTY, { t: 'queued' }, 0), { t: 'fight', code: 'BCDFGH', role: 'guest', with: { id: 'x-000001', name: 'X' } }, 0);
    expect(state.queued).toBe(false);
  });
});

/** Sockets the lobby opens, kept to look at and to answer as the relay would. */
class FakeSocket {
  static OPEN = 1;
  static made: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();
  constructor(readonly url: string) {
    FakeSocket.made.push(this);
  }
  addEventListener(kind: string, listener: (event: { data?: unknown }) => void) {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), listener]);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.emit('close');
  }
  open() {
    this.readyState = 1;
    this.emit('open');
  }
  say(message: object) {
    this.emit('message', { data: JSON.stringify(message) });
  }
  private emit(kind: string, event: { data?: unknown } = {}) {
    for (const listener of this.listeners.get(kind) ?? []) listener(event);
  }
}

describe('the lobby socket', () => {
  beforeEach(() => {
    FakeSocket.made = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens free, comes back busy for an online match, and free again after', () => {
    const lobby = new Lobby('Chris', 'chris-0001', 'https://relay.test');
    lobby.setMode('free');
    expect(FakeSocket.made).toHaveLength(1);
    expect(FakeSocket.made[0]!.url).toBe('wss://relay.test/lobby/ws?name=Chris&id=chris-0001');
    FakeSocket.made[0]!.open();
    expect(lobby.state.connected).toBe(true);

    // A match the lobby made: it has the page busy already, so the socket stays as it is.
    const matches: string[] = [];
    lobby.onMatch((match) => matches.push(`${match.code} ${match.role}`));
    FakeSocket.made[0]!.say({ t: 'fight', code: 'BCDFGH', role: 'host', with: { id: 'will-0001', name: 'Will' } });
    expect(matches).toEqual(['BCDFGH host']);
    lobby.setMode('busy');
    expect(FakeSocket.made).toHaveLength(1);

    // The fight closes it, and between fights it comes back busy.
    lobby.setMode('off');
    expect(FakeSocket.made[0]!.closed).toBe(true);
    lobby.setMode('busy');
    expect(FakeSocket.made[1]!.url).toContain('&busy=1');
    FakeSocket.made[1]!.open();
    // The match over: once more, free.
    lobby.setMode('free');
    expect(FakeSocket.made[1]!.closed).toBe(true);
    expect(FakeSocket.made[2]!.url).not.toContain('busy');
    lobby.close();
  });

  it('tries again when the wire drops, waiting longer each time', () => {
    const lobby = new Lobby('Chris', 'chris-0001', 'https://relay.test');
    lobby.setMode('free');
    FakeSocket.made[0]!.close();
    expect(FakeSocket.made).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.made).toHaveLength(2);
    FakeSocket.made[1]!.close();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.made).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.made).toHaveLength(3);
    // Opened, the waits start over; turned off, it stops trying.
    FakeSocket.made[2]!.open();
    lobby.setMode('off');
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.made).toHaveLength(3);
  });

  it('sends the challenge and its answers, and a name change comes in again under the new name', () => {
    const lobby = new Lobby('Chris', 'chris-0001', 'https://relay.test');
    lobby.setMode('free');
    const ws = FakeSocket.made[0]!;
    ws.open();
    lobby.challenge('will-0001');
    ws.say({ t: 'challenging', to: { id: 'will-0001', name: 'Will' }, ttl: 30_000 });
    lobby.cancel();
    ws.say({ t: 'challenged', from: { id: 'will-0001', name: 'Will' }, ttl: 30_000 });
    lobby.accept();
    lobby.quick(true);
    expect(ws.sent.map((m) => JSON.parse(m) as unknown)).toEqual([
      { t: 'challenge', to: 'will-0001' },
      { t: 'cancel', to: 'will-0001' },
      { t: 'accept', from: 'will-0001' },
      { t: 'quick' },
    ]);
    lobby.rename('Chris G');
    expect(ws.closed).toBe(true);
    expect(FakeSocket.made[1]!.url).toContain('name=Chris%20G');
    lobby.close();
  });
});
