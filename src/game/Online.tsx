import { useEffect, useRef, useState } from 'preact/hooks';
import { meet, mismatch } from './net/handshake';
import { cleanName, type Lobby, type LobbyState, EMPTY, typingName } from './net/lobby';
import { cleanCode, createRoom, Link, relayUrl, type Role } from './net/relay';
import { useModalKeys } from './ui/modal';

/*
 * PLAY ONLINE: two players, two machines, and the lobby between them. The panel asks once what
 * to call you, then shows WHO'S HERE, everyone else with the game open: FIGHT challenges one of
 * them, QUICK MATCH waits for anybody who asks for one too. When the lobby pairs two players it
 * hands them a room, and from there it is as it always was: both pages meet in the room and agree
 * on the game's version, and the roster opens with the host as player 1 and the guest as player 2.
 * A challenge that comes in shows over whatever screen is up. Two players on different relays
 * can still use a room code, behind the small link at the bottom. The same panel as the guide.
 */

/** Two pages that have met in a room and can fight. */
export interface Session {
  link: Link;
  role: Role;
  /** The host plays player 1, the guest player 2. */
  me: 0 | 1;
  code: string;
  /** The other install: 'wow', 'wow_classic' ... */
  theirProduct: string;
}

/** Waits for the other page in the room and the handshake's first step: both say their version, and a different one is refused. */
function meetPeer(link: Link, product: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let said = false;
    const say = () => {
      if (said || !link.peer) return;
      said = true;
      link.send(meet(product));
    };
    const off = link.listen((message) => {
      if (message.t === 'peer') say();
      else if (message.t === 'meet') {
        say();
        off();
        offClose();
        const wrong = mismatch(message);
        if (wrong) reject(new Error(wrong));
        else resolve(message.product);
      }
    });
    const offClose = link.onClose(() => {
      off();
      reject(new Error('The room closed before your opponent came in.'));
    });
    say();
  });
}

/** Into a room as host or guest, and the meeting there; `opened` hears of the socket first, so it can be closed if the wait is given up. */
export async function enterRoom(code: string, role: Role, product: string, opened?: (link: Link) => void): Promise<Session> {
  const link = await Link.open(code, role);
  opened?.(link);
  try {
    const theirProduct = await meetPeer(link, product);
    return { link, role, me: role === 'host' ? 0 : 1, code, theirProduct };
  } catch (cause) {
    link.close();
    throw cause;
  }
}

/** The lobby's state, kept current. */
export function useLobby(lobby: Lobby | undefined): LobbyState {
  const [state, setState] = useState<LobbyState>(lobby?.state ?? EMPTY);
  useEffect(() => (lobby ? lobby.watch(setState) : setState(EMPTY)), [lobby]);
  return state;
}

/** The fraction of a challenge's thirty seconds left, ticking. */
function useLeft(until: number | undefined, ttl = 30_000): number {
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    if (until === undefined) return;
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, [until]);
  return until === undefined ? 0 : Math.max(0, Math.min(1, (until - now) / ttl));
}

/** The thirty seconds as a ring that empties, with the seconds in it. */
function Ring({ until, size = 64 }: { until: number; size?: number }) {
  const left = useLeft(until);
  const r = 26;
  const round = 2 * Math.PI * r;
  return (
    <svg class="countdown" width={size} height={size} viewBox="0 0 64 64" aria-label={`${Math.ceil(left * 30)} seconds`}>
      <circle cx="32" cy="32" r={r} class="track" />
      <circle cx="32" cy="32" r={r} class="left" stroke-dasharray={round} stroke-dashoffset={round * (1 - left)} transform="rotate(-90 32 32)" />
      <text x="32" y="38" text-anchor="middle">{Math.ceil(left * 30)}</text>
    </svg>
  );
}

const relayName = () => relayUrl().replace(/^https?:\/\//, '');

/** The link to this page, to send a friend. */
const pageLink = () => (typeof location === 'undefined' ? '' : location.origin + location.pathname);

interface OnlineProps {
  lobby: Lobby | undefined;
  /** The name this browser gave, if it has. */
  name: string | undefined;
  onName: (name: string) => void;
  /** This install's product, told to the other page. */
  product: string;
  /** A room joined with a code has met; matches the lobby makes go to the game itself. */
  onReady: (session: Session) => void;
  onClose: () => void;
}

type View = 'name' | 'here' | 'code';

export function Online({ lobby, name, onName, product, onReady, onClose }: OnlineProps) {
  const [view, setView] = useState<View>(name ? 'here' : 'name');
  const state = useLobby(lobby);
  const others = state.players.filter((p) => p.id !== lobby?.id);
  const [chosen, setChosen] = useState(0);
  const at = Math.min(chosen, Math.max(0, others.length - 1));
  const [copied, setCopied] = useState<string>();

  const fight = (id: string) => {
    if (!lobby || state.outgoing) return;
    lobby.challenge(id);
  };
  const quick = () => lobby?.quick(!state.queued);
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(undefined), 1500);
    });
  };

  useEffect(() => {
    if (view !== 'here') return;
    const onKey = (event: KeyboardEvent) => {
      const key = event.code;
      if (!['Escape', 'ArrowUp', 'ArrowDown', 'Enter', 'NumpadEnter', 'KeyQ', 'KeyN'].includes(key)) return;
      event.stopPropagation();
      event.preventDefault();
      if (key === 'Escape') {
        // Escape takes back what is waiting first, then closes.
        if (state.outgoing) lobby?.cancel();
        else if (state.queued) lobby?.quick(false);
        else onClose();
      } else if (key === 'ArrowUp') setChosen(Math.max(0, at - 1));
      else if (key === 'ArrowDown') setChosen(Math.min(others.length - 1, at + 1));
      else if (key === 'KeyQ') quick();
      else if (key === 'KeyN') setView('name');
      else {
        const them = others[at];
        if (them && them.status === 'free') fight(them.id);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return (
    <div class="guide-backdrop" onClick={onClose}>
      <div class="guide online" onClick={(event) => event.stopPropagation()}>
        <nav class="tabs">
          <button class={view !== 'code' ? 'here' : ''} type="button" onClick={() => setView(name ? 'here' : 'name')}>
            {view === 'name' ? 'YOUR NAME' : "WHO'S HERE"}
          </button>
          {view === 'code' && <button class="here" type="button">WITH A CODE</button>}
          <button class="close" onClick={onClose} aria-label="Close" type="button">✕</button>
        </nav>
        {view === 'name' ? (
          <NameView
            name={name}
            onName={(given) => {
              onName(given);
              setView('here');
            }}
            onBack={() => (name ? setView('here') : onClose())}
          />
        ) : view === 'code' ? (
          <CodeView product={product} onReady={onReady} onBack={() => setView(name ? 'here' : 'name')} />
        ) : (
          <div class="body online-here">
            <p class="me">
              You are <b>{name}</b>
              {' · '}
              {!state.connected ? (
                <span class="waiting">reaching the lobby…</span>
              ) : state.queued ? (
                <span class="waiting">waiting for anyone who wants a fight</span>
              ) : state.outgoing ? (
                <span class="waiting">challenging {state.outgoing.name}</span>
              ) : (
                'free to fight'
              )}
              <button type="button" class="link" onClick={() => setView('name')}>change · N</button>
            </p>
            {others.length === 0 ? (
              <div class="nobody">
                <p class="dim">{state.connected ? 'Nobody else is here yet.' : ' '}</p>
                <p class="dim small">Send your opponent the link; they drop their folder, give a name, and appear here.</p>
                <button type="button" class="button" onClick={() => copy(pageLink())}>
                  {copied === pageLink() ? 'COPIED' : 'COPY THE LINK'}
                </button>
              </div>
            ) : (
              <ul class="players" role="listbox" aria-label="Who's here">
                {others.map((player, k) => {
                  const waiting = state.outgoing?.id === player.id;
                  return (
                    <li key={player.id} class={`${k === at ? 'chosen' : ''} ${player.status}`} role="option" aria-selected={k === at} onMouseEnter={() => setChosen(k)}>
                      <span class="name">{player.name}</span>
                      {player.status === 'busy' ? (
                        <span class="dim small">in a match</span>
                      ) : waiting ? (
                        <span class="asking">
                          <Ring until={state.outgoing!.until} size={30} />
                          <button type="button" class="button" onClick={() => lobby?.cancel()}>CANCEL · ESC</button>
                        </span>
                      ) : (
                        <button type="button" class="button" disabled={state.outgoing !== undefined} onClick={() => fight(player.id)}>
                          FIGHT{k === at ? ' · ENTER' : ''}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <button type="button" class={`button quick ${state.queued ? 'on' : ''}`} disabled={!state.connected} onClick={quick}>
              {state.queued ? 'STOP WAITING · Q' : 'QUICK MATCH · Q'}
            </button>
            {state.notice && <p class="bad">{state.notice}</p>}
            <p class="dim small">
              Each of you needs the game open with your own World of Warcraft folder. Whoever challenges is player 1 and picks the ground.{' '}
              <button type="button" class="link" onClick={() => setView('code')}>join with a code</button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function NameView({ name, onName, onBack }: { name: string | undefined; onName: (name: string) => void; onBack: () => void }) {
  const [typed, setTyped] = useState(name ?? '');
  const field = useRef<HTMLInputElement>(null);
  const clean = cleanName(typed);
  useEffect(() => field.current?.focus(), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The letters are the field's (the screen under the panel is paused); only Escape is the panel's.
      if (event.code !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      onBack();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onBack]);
  return (
    <div class="body online-name">
      <p class="dim">What should your opponent see you as?</p>
      <input
        ref={field}
        class="name"
        value={typed}
        maxLength={16}
        spellcheck={false}
        autocomplete="nickname"
        placeholder="Your name"
        onInput={(event) => setTyped(typingName(event.currentTarget.value))}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && clean) {
            event.preventDefault();
            onName(clean);
          }
        }}
      />
      <button type="button" class="button" disabled={!clean} onClick={() => clean && onName(clean)}>
        ENTER THE LOBBY · ENTER
      </button>
      <p class="dim small">2 to 16 letters, digits and spaces. Remembered in this browser; everyone with the game open sees it.</p>
    </div>
  );
}

/** The old way, for two players on different relays: one makes a code, the other types it. */
function CodeView({ product, onReady, onBack }: { product: string; onReady: (session: Session) => void; onBack: () => void }) {
  const [hosting, setHosting] = useState(false);
  const [code, setCode] = useState<string>();
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const link = useRef<Link>(null);
  const done = useRef(false);

  /** Leaves whatever room this view was in, unless the fight has it now. */
  const drop = () => {
    if (!done.current) link.current?.close();
    link.current = null;
  };
  const failed = (cause: unknown) => {
    drop();
    setError(cause instanceof Error ? cause.message : String(cause));
    setStatus(undefined);
  };
  const ready = (session: Session) => {
    done.current = true;
    onReady(session);
  };

  // MAKE A CODE makes a room and waits in it.
  useEffect(() => {
    if (!hosting) return;
    let stale = false;
    setError(undefined);
    setStatus('Making a room…');
    void (async () => {
      try {
        const room = await createRoom();
        if (stale) return;
        setCode(room);
        setStatus('Waiting for your opponent…');
        const session = await enterRoom(room, 'host', product, (opened) => {
          if (stale) opened.close();
          else link.current = opened;
        });
        if (!stale) ready(session);
      } catch (cause) {
        if (!stale) failed(cause);
      }
    })();
    return () => {
      stale = true;
      drop();
      setCode(undefined);
      setStatus(undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosting]);

  useEffect(() => () => drop(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The letters are the code field's (the screen under the panel is paused); only Escape is the panel's.
      if (event.code !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      onBack();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onBack]);

  const join = async () => {
    const room = cleanCode(typed);
    if (room.length !== 6) {
      setError('A room code is six letters.');
      return;
    }
    setHosting(false);
    drop();
    setError(undefined);
    setStatus('Joining…');
    try {
      ready(await enterRoom(room, 'guest', product, (opened) => (link.current = opened)));
    } catch (cause) {
      failed(cause);
    }
  };

  return (
    <div class="body online-code">
      <p class="dim">For two of you on different relays: one makes a code, the other types it.</p>
      {hosting ? (
        <>
          <div class="code" aria-live="polite">{code ?? '······'}</div>
          <button
            type="button"
            class="button"
            disabled={!code}
            onClick={() =>
              code &&
              void navigator.clipboard?.writeText(code).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? 'COPIED' : 'COPY THE CODE'}
          </button>
        </>
      ) : (
        <button type="button" class="button" onClick={() => setHosting(true)}>MAKE A CODE</button>
      )}
      <div class="join-row">
        <input
          class="code small"
          value={typed}
          maxLength={6}
          spellcheck={false}
          autocomplete="off"
          placeholder="BCDFGH"
          aria-label="Their code"
          onInput={(event) => setTyped(cleanCode(event.currentTarget.value))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void join();
            }
          }}
        />
        <button type="button" class="button" onClick={() => void join()} disabled={typed.length !== 6}>
          JOIN · ENTER
        </button>
      </div>
      {status && <p class="waiting">{status}</p>}
      {error && <p class="bad">{error}</p>}
      <p class="dim small">
        Whoever makes the code is player 1. Through {relayName()}; SETTINGS can name another relay.{' '}
        <button type="button" class="link" onClick={onBack}>back · Esc</button>
      </p>
    </div>
  );
}

/** A challenge from the lobby, over whatever screen is up: Enter accepts, Escape declines, and the ring is the thirty seconds. */
export function Challenge({ from, until, onAccept, onDecline }: { from: string; until: number; onAccept: () => void; onDecline: () => void }) {
  useModalKeys(true, (event) => {
    if (event.code === 'Enter' || event.code === 'NumpadEnter') onAccept();
    else if (event.code === 'Escape') onDecline();
  });
  return (
    <div class="guide-backdrop challenge-backdrop">
      <div class="guide online challenge" role="alertdialog" aria-label={`${from} challenges you`}>
        <div class="body online-challenge">
          <Ring until={until} />
          <p class="big">{from}</p>
          <p class="dim">challenges you to Mak'gora.</p>
          <div class="choices">
            <button type="button" class="button" onClick={onAccept}>ACCEPT · ENTER</button>
            <button type="button" class="button" onClick={onDecline}>DECLINE · ESC</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Between the lobby's match and the roster: both pages finding each other in the room. */
export function Matching({ name, error, onCancel }: { name: string; error?: string; onCancel: () => void }) {
  useModalKeys(true, (event) => {
    if (event.code === 'Escape' || (error && (event.code === 'Enter' || event.code === 'NumpadEnter'))) onCancel();
  });
  return (
    <div class="guide-backdrop">
      <div class="guide online">
        <div class="body online-challenge">
          {error ? (
            <>
              <p class="big">No fight with {name}</p>
              <p class="bad">{error}</p>
              <button type="button" class="button" onClick={onCancel}>BACK · ENTER</button>
            </>
          ) : (
            <>
              <p class="big">{name}</p>
              <p class="waiting">Meeting your opponent in the room…</p>
              <button type="button" class="button" onClick={onCancel}>GIVE UP · ESC</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
