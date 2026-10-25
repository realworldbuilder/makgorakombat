import { useEffect, useRef, useState } from 'preact/hooks';
import { BoardTable } from './Board';
import { notifyOn, setNotify } from './call';
import { meet, mismatch } from './net/handshake';
import { cleanName, type Lobby, type LobbyFight, type LobbyState, EMPTY, recordText, typingName } from './net/lobby';
import { cleanCode, createRoom, Link, relayUrl, type Role } from './net/relay';
import { useModalKeys } from './ui/modal';

/*
 * PLAY ONLINE: two players, two machines, and the lobby between them. The panel asks once what
 * to call you, then opens on how many are online, waiting and fighting, and FIND A FIGHT: the
 * queue, where a stranger sits with the seconds counting up until the next one to come is paired
 * with them. Under it WHO'S HERE, everyone else with the game open, to challenge one by name. When
 * the lobby pairs two players it hands them a room, and from there it is as it always was: both
 * pages meet in the room and agree on the game's version, and the roster opens with the host as
 * player 1 and the guest as player 2. A challenge that comes in shows over whatever screen is up.
 * Under WHO'S HERE, FIGHTS NOW lists the fights on that the lobby made, and WATCH on one (or on
 * a player in a match) watches it from here, as a third seat in its room that only listens.
 * Two players on different relays can still use a room code, behind the small link at the bottom.
 * Beside WHO'S HERE is TOP TEN, the relay's board, and each name here carries its record tonight.
 * A small switch asks the browser to notify the player when a fight comes while they look away.
 * The same panel as the guide, and all of it from the keyboard.
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

/** The time since `from` (this page's clock) as m:ss, ticking while there is one. */
function useSince(from: number | undefined): string {
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    if (from === undefined) return;
    setNow(performance.now());
    const timer = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(timer);
  }, [from]);
  const seconds = from === undefined ? 0 : Math.max(0, Math.floor((now - from) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The lobby's numbers in a line. */
export function countsLine({ online, waiting, fighting }: LobbyState['counts']): string {
  return `${online} online · ${waiting} waiting · ${fighting} fighting`;
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
  /** WATCH: somebody else's fight, from here. */
  onWatch?: (fight: LobbyFight) => void;
}

/** How long a fight has been on, as m:ss by the relay's clock, ticking. */
function OnFor({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return <span class="dim small">{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</span>;
}

type View = 'name' | 'here' | 'board' | 'code';

export function Online({ lobby, name, onName, product, onReady, onClose, onWatch }: OnlineProps) {
  const [view, setView] = useState<View>(name ? 'here' : 'name');
  const state = useLobby(lobby);
  const others = state.players.filter((p) => p.id !== lobby?.id);
  // What Enter does: -1 is FIND A FIGHT, the panel's first thing; 0 on are the players by name.
  const [chosen, setChosen] = useState(-1);
  const at = Math.min(chosen, others.length - 1);
  const [copied, setCopied] = useState<string>();
  const waited = useSince(state.queued ? state.queuedAt : undefined);
  const [notify, setNotifyState] = useState(notifyOn);
  /** Shut, the panel takes this page out of the queue: nobody waits there unseen. */
  const close = () => {
    // Even while the wire is down and the page shows nothing queued: it would ask again as it came back.
    lobby?.leaveQueue();
    onClose();
  };

  const fight = (id: string) => {
    if (!lobby || state.outgoing) return;
    lobby.challenge(id);
  };
  const quick = () => lobby?.quick(!state.queued);
  /** The fight a player in a match is in, when the lobby lists it. */
  const fightOf = (id: string) => (onWatch ? state.fights.find((f) => f.ids.includes(id)) : undefined);
  const watch = (fight: LobbyFight | undefined) => {
    if (!fight || !onWatch) return;
    if (state.queued) lobby?.quick(false);
    if (state.outgoing) lobby?.cancel();
    onWatch(fight);
  };
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(undefined), 1500);
    });
  };

  // TOP TEN: Escape or B back to WHO'S HERE; the table turns its spans itself.
  useEffect(() => {
    if (view !== 'board') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' && event.code !== 'KeyB') return;
      event.stopPropagation();
      event.preventDefault();
      setView('here');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [view]);

  useEffect(() => {
    if (view !== 'here') return;
    const onKey = (event: KeyboardEvent) => {
      const key = event.code;
      if (!['Escape', 'ArrowUp', 'ArrowDown', 'Enter', 'NumpadEnter', 'KeyQ', 'KeyN', 'KeyB', 'KeyW'].includes(key)) return;
      event.stopPropagation();
      event.preventDefault();
      if (key === 'Escape') {
        // Escape takes back what is waiting first, then closes.
        if (state.outgoing) lobby?.cancel();
        else if (state.queued) lobby?.quick(false);
        else close();
      } else if (key === 'ArrowUp') setChosen(Math.max(-1, at - 1));
      else if (key === 'ArrowDown') setChosen(Math.min(others.length - 1, at + 1));
      else if (key === 'KeyQ') quick();
      else if (key === 'KeyN') setView('name');
      else if (key === 'KeyB') setView('board');
      // W watches the fight the chosen player is in, or else the one that has been on longest.
      else if (key === 'KeyW') watch((at >= 0 ? fightOf(others[at]!.id) : undefined) ?? state.fights[0]);
      else if (at < 0) {
        // Enter on FIND A FIGHT goes into the queue; leaving it is Escape's.
        if (!state.queued && state.connected) quick();
      } else {
        const them = others[at];
        if (them && them.status === 'free') fight(them.id);
        else if (them) watch(fightOf(them.id));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return (
    <div class="guide-backdrop" onClick={close}>
      <div class="guide online" onClick={(event) => event.stopPropagation()}>
        <nav class="tabs">
          <button class={view === 'here' || view === 'name' ? 'here' : ''} type="button" onClick={() => setView(name ? 'here' : 'name')}>
            {view === 'name' ? 'YOUR NAME' : "WHO'S HERE"}
          </button>
          {view === 'code' ? (
            <button class="here" type="button">WITH A CODE</button>
          ) : (
            view !== 'name' && (
              <button class={view === 'board' ? 'here' : ''} type="button" onClick={() => setView('board')}>
                TOP TEN · B
              </button>
            )
          )}
          <button class="close" onClick={close} aria-label="Close" type="button">✕</button>
        </nav>
        {view === 'name' ? (
          <NameView
            name={name}
            onName={(given) => {
              onName(given);
              setView('here');
            }}
            onBack={() => (name ? setView('here') : close())}
          />
        ) : view === 'board' ? (
          <div class="body online-board">
            <BoardTable />
          </div>
        ) : view === 'code' ? (
          <CodeView product={product} onReady={onReady} onBack={() => setView(name ? 'here' : 'name')} />
        ) : (
          <div class="body online-here">
            <p class="counts" aria-live="polite">{state.connected ? countsLine(state.counts) : 'reaching the lobby…'}</p>
            <p class="me">
              You are <b>{name}</b>
              {' · '}
              {!state.connected ? (
                <span class="waiting">not in the lobby yet</span>
              ) : state.queued ? (
                <span class="waiting">in the queue</span>
              ) : state.outgoing ? (
                <span class="waiting">challenging {state.outgoing.name}</span>
              ) : (
                'free to fight'
              )}
              <button type="button" class="link" onClick={() => setView('name')}>change · N</button>
            </p>
            {state.queued ? (
              <div class={`find on ${at < 0 ? 'chosen' : ''}`} role="status" onMouseEnter={() => setChosen(-1)}>
                <span class="clock">{waited}</span>
                <span class="words">waiting for an opponent</span>
                <button type="button" class="button" onClick={quick}>LEAVE THE QUEUE · ESC</button>
              </div>
            ) : (
              <button
                type="button"
                class={`find ${at < 0 ? 'chosen' : ''}`}
                disabled={!state.connected || state.outgoing !== undefined}
                onClick={quick}
                onMouseEnter={() => setChosen(-1)}
              >
                <span class="big">FIND A FIGHT</span>
                <span class="keys">{at < 0 ? 'ENTER · ' : ''}Q</span>
              </button>
            )}
            <p class="dim small">The next player to come into the queue fights you, whoever they are. The one who waited longer is player 1.</p>
            <h3 class="who">WHO'S HERE</h3>
            {others.length === 0 ? (
              <div class="nobody">
                <p class="dim">{state.connected ? 'Nobody else is here yet.' : ' '}</p>
                <p class="dim small">Send a friend the link; they drop their folder, give a name, and appear here.</p>
                <button type="button" class="button" onClick={() => copy(pageLink())}>
                  {copied === pageLink() ? 'COPIED' : 'COPY THE LINK'}
                </button>
              </div>
            ) : (
              <ul class="players" role="listbox" aria-label="Who's here">
                {others.map((player, k) => {
                  const waiting = state.outgoing?.id === player.id;
                  const theirs = player.status === 'busy' ? fightOf(player.id) : undefined;
                  return (
                    <li key={player.id} class={`${k === at ? 'chosen' : ''} ${player.status}`} role="option" aria-selected={k === at} onMouseEnter={() => setChosen(k)}>
                      <span class="name">
                        {player.name}
                        {player.night && <span class="record" title="Won and lost tonight">{recordText(player.night)}</span>}
                      </span>
                      {theirs ? (
                        <button type="button" class="button" onClick={() => watch(theirs)}>
                          WATCH{k === at ? ' · W' : ''}
                        </button>
                      ) : player.status === 'busy' ? (
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
            {onWatch && state.fights.length > 0 && (
              <>
                <h3 class="who">FIGHTS NOW</h3>
                <ul class="players fights" aria-label="Fights now">
                  {state.fights.map((fight, k) => (
                    <li key={fight.code}>
                      <span class="name">
                        {fight.names[0]} <span class="dim">vs</span> {fight.names[1]}
                      </span>
                      <span class="asking">
                        <OnFor since={fight.since} />
                        <button type="button" class="button" onClick={() => watch(fight)}>
                          WATCH{k === 0 && (at < 0 || !fightOf(others[at]?.id ?? '')) ? ' · W' : ''}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {state.notice && <p class="bad">{state.notice}</p>}
            {typeof Notification !== 'undefined' && (
              <label class="notify dim small">
                <input type="checkbox" checked={notify} onChange={(event) => void setNotify(event.currentTarget.checked).then(setNotifyState, () => setNotifyState(false))} />
                notify me when a fight comes while I look away
              </label>
            )}
            <p class="dim small">
              ↑ ↓ choose · Enter fight{onWatch ? ' · W watch' : ''} · B the board · Esc {state.queued || state.outgoing ? 'take it back' : 'close'}. Each of you needs the game open with your own World of Warcraft
              folder. Whoever challenges is player 1 and picks the ground.{' '}
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

/**
 * Between the lobby's match and the roster: both pages finding each other in the room. A match
 * from the queue says FOUND over the opponent's name, and stays up at least two seconds, so a
 * stranger knows who they got before the roster opens.
 */
export function Matching({ name, found, error, onCancel }: { name: string; found?: boolean; error?: string; onCancel: () => void }) {
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
              <button type="button" class="button" onClick={onCancel}>{found ? 'BACK TO THE QUEUE · ENTER' : 'BACK · ENTER'}</button>
            </>
          ) : (
            <>
              {found && <p class="found">FOUND</p>}
              <p class="big">{name}</p>
              <p class="waiting">{found ? 'Your opponent. Meeting them in the room…' : 'Meeting your opponent in the room…'}</p>
              <button type="button" class="button" onClick={onCancel}>GIVE UP · ESC</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
