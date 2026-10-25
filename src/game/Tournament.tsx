import { useEffect, useState } from 'preact/hooks';
import { cleanName, type Lobby, type LobbyFight, type LobbyPlayer, type LobbyState, typingName } from './net/lobby';
import {
  type Bout,
  champion,
  type Cup,
  cupText,
  type Entrant,
  isReady,
  makeCup,
  MAX_ENTRANTS,
  point,
  readLobby,
  readyBouts,
  reset,
  roundName,
  saveCup,
  savedCup,
  shuffled,
} from './cup';

/*
 * TOURNAMENT, a tab of PLAY ONLINE for whoever runs the night. Before it starts: everyone here
 * to tick in, names typed for those still coming, the order (the seeds) and SHUFFLE, and how many
 * match wins take a pairing. Then the bracket, and over it UP NEXT, the pairings to be fought now,
 * each saying who is here, who should challenge whom, and when they are at it, WATCH. Each pairing
 * is an ordinary online match from WHO'S HERE. A result is read off the lobby's records tonight
 * where the relay keeps them; a name clicked in a pairing gives that side the match by hand, and
 * UNDO takes a result back. The bracket is kept in this browser (see cup.ts).
 */

interface CupProps {
  lobby: Lobby | undefined;
  state: LobbyState;
  onWatch?: (fight: LobbyFight) => void;
}

/** The kept bracket, read again from the lobby each time it speaks, and saved whenever it changes. */
function useCup(players: readonly LobbyPlayer[]): [Cup | undefined, (cup: Cup | undefined) => void] {
  const [cup, setCupState] = useState<Cup | undefined>(savedCup);
  const setCup = (next: Cup | undefined) => {
    saveCup(next);
    setCupState(next);
  };
  useEffect(() => {
    if (!cup || players.length === 0) return;
    const read = readLobby(cup, players);
    if (read !== cup) setCup(read);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, cup]);
  return [cup, setCup];
}

export function CupView({ lobby, state, onWatch }: CupProps) {
  const [cup, setCup] = useCup(state.players);
  return cup ? (
    <Bracket cup={cup} setCup={setCup} lobby={lobby} state={state} onWatch={onWatch} />
  ) : (
    <Setup players={state.players} onStart={setCup} />
  );
}

function Setup({ players, onStart }: { players: readonly LobbyPlayer[]; onStart: (cup: Cup) => void }) {
  const [entrants, setEntrants] = useState<Entrant[]>([]);
  const [typed, setTyped] = useState('');
  const [firstTo, setFirstTo] = useState(1);
  const [error, setError] = useState<string>();
  const isIn = (player: LobbyPlayer) => entrants.some((e) => e.id === player.id);
  const nameTaken = (name: string) => entrants.some((e) => e.name.toLowerCase() === name.toLowerCase());
  const add = (entrant: Entrant) => {
    if (entrants.length >= MAX_ENTRANTS) return setError(`${MAX_ENTRANTS} players at most.`);
    setError(undefined);
    setEntrants([...entrants, entrant]);
  };
  const toggle = (player: LobbyPlayer) =>
    isIn(player) ? setEntrants(entrants.filter((e) => e.id !== player.id)) : add({ name: player.name, id: player.id });
  const addTyped = () => {
    const name = cleanName(typed);
    if (!name) return;
    if (nameTaken(name)) return setError(`${name} is in already.`);
    add({ name });
    setTyped('');
  };
  const move = (k: number, by: number) => {
    const to = k + by;
    if (to < 0 || to >= entrants.length) return;
    const next = [...entrants];
    [next[k], next[to]] = [next[to]!, next[k]!];
    setEntrants(next);
  };
  const start = () => {
    try {
      onStart(makeCup(entrants, firstTo, players));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div class="body online-cup setup">
      <p class="dim">
        Run a bracket from here. Tick everyone who is in; each pairing then fights an ordinary online match, one challenging the other under WHO'S HERE. Results are
        read off the lobby when the relay keeps tonight's records, and you can always give a win by hand.
      </p>
      <h3 class="who">WHO'S HERE</h3>
      {players.length === 0 ? (
        <p class="dim small">Nobody in the lobby yet. You can still type names in below; they are linked when those players come.</p>
      ) : (
        <ul class="players">
          {players.map((player) => (
            <li key={player.id} class={isIn(player) ? 'chosen' : ''}>
              <span class="name">{player.name}</span>
              <button type="button" class="button" onClick={() => toggle(player)}>
                {isIn(player) ? 'IN ✓' : 'ADD'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div class="join-row">
        <input
          class="name"
          value={typed}
          maxLength={16}
          spellcheck={false}
          placeholder="Someone not here yet"
          onInput={(event) => setTyped(typingName(event.currentTarget.value))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addTyped();
            }
          }}
        />
        <button type="button" class="button" disabled={!cleanName(typed)} onClick={addTyped}>
          ADD
        </button>
      </div>
      <h3 class="who">THE SEEDS · {entrants.length}</h3>
      {entrants.length === 0 ? (
        <p class="dim small">Nobody in yet.</p>
      ) : (
        <ol class="seeds">
          {entrants.map((entrant, k) => (
            <li key={entrant.id ?? entrant.name}>
              <span class="name">
                {entrant.name}
                {!entrant.id && <span class="dim small"> · not here yet</span>}
              </span>
              <span class="asking">
                <button type="button" class="link" disabled={k === 0} onClick={() => move(k, -1)} aria-label="Up">↑</button>
                <button type="button" class="link" disabled={k === entrants.length - 1} onClick={() => move(k, 1)} aria-label="Down">↓</button>
                <button type="button" class="link" onClick={() => setEntrants(entrants.filter((_, i) => i !== k))} aria-label="Take out">✕</button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div class="choices small-choices">
        <span class="dim">A pairing goes to the first to</span>
        {[1, 2, 3].map((n) => (
          <button key={n} type="button" class={`button ${firstTo === n ? 'on' : ''}`} onClick={() => setFirstTo(n)}>
            {n} {n === 1 ? 'WIN' : 'WINS'}
          </button>
        ))}
      </div>
      <div class="choices">
        <button type="button" class="button" disabled={entrants.length < 2} onClick={() => setEntrants(shuffled(entrants))}>
          SHUFFLE
        </button>
        <button type="button" class="button" disabled={entrants.length < 2} onClick={start}>
          START THE BRACKET
        </button>
      </div>
      {error && <p class="bad">{error}</p>}
      <p class="dim small">Seed 1 meets seed 2 only in the final. With a count that is not 4, 8, 16 or 32, the top seeds get byes.</p>
    </div>
  );
}

interface BracketProps {
  cup: Cup;
  setCup: (cup: Cup | undefined) => void;
  lobby: Lobby | undefined;
  state: LobbyState;
  onWatch?: (fight: LobbyFight) => void;
}

function Bracket({ cup, setCup, lobby, state, onWatch }: BracketProps) {
  const [ending, setEnding] = useState(false);
  const [copied, setCopied] = useState(false);
  const won = champion(cup);
  const ready = readyBouts(cup);
  const entrant = (side: number | null) => (side === null ? undefined : cup.entrants[side]);
  const player = (e: Entrant | undefined) => (e?.id ? state.players.find((p) => p.id === e.id) : undefined);
  const copy = () =>
    void navigator.clipboard?.writeText(cupText(cup)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  useEffect(() => {
    if (!ending) return;
    const timer = setTimeout(() => setEnding(false), 4000);
    return () => clearTimeout(timer);
  }, [ending]);

  /** Where a pairing to be fought stands, and what may be done about it from here. */
  const status = (bout: Bout) => {
    const a = entrant(bout.sides[0])!;
    const b = entrant(bout.sides[1])!;
    const pa = player(a);
    const pb = player(b);
    const fight = a.id && b.id ? state.fights.find((f) => f.ids.includes(a.id!) && f.ids.includes(b.id!)) : undefined;
    if (fight)
      return (
        <span class="asking">
          <span class="waiting">fighting</span>
          {onWatch && <button type="button" class="button" onClick={() => onWatch(fight)}>WATCH</button>}
        </span>
      );
    const away = [pa ? undefined : a.name, pb ? undefined : b.name].filter(Boolean);
    if (!state.connected) return <span class="dim small">not in the lobby</span>;
    if (away.length) return <span class="dim small">waiting for {away.join(' and ')}</span>;
    if (pa!.status === 'busy' && pb!.status === 'busy') return <span class="waiting">in a match</span>;
    if (pa!.status === 'busy' || pb!.status === 'busy') return <span class="dim small">{(pa!.status === 'busy' ? a : b).name} is in another match</span>;
    // Both free: the higher seed challenges, as player 1. If that is this page, the button does it.
    const me = lobby?.id;
    if (me && (a.id === me || b.id === me)) {
      const them = a.id === me ? pb! : pa!;
      const asking = state.outgoing?.id === them.id;
      return (
        <button type="button" class="button" disabled={state.outgoing !== undefined} onClick={() => lobby!.challenge(them.id)}>
          {asking ? 'CHALLENGING…' : `FIGHT ${them.name}`}
        </button>
      );
    }
    return (
      <span class="dim small">
        both here · <b>{a.name}</b> challenges {b.name}
      </span>
    );
  };

  const side = (bout: Bout, k: 0 | 1, round: number, index: number) => {
    const e = entrant(bout.sides[k]);
    const live = isReady(bout);
    const cls = `slot ${bout.winner === k ? 'won' : bout.winner !== undefined ? 'lost' : ''} ${e && !player(e) ? 'away' : ''}`;
    const label = e ? e.name : round === 0 ? 'bye' : '—';
    const score = live || bout.winner !== undefined ? <span class="score">{bout.bye ? '' : bout.score[k]}</span> : null;
    return live ? (
      <button type="button" class={cls} title={`Give ${label} the match`} onClick={() => setCup(point(cup, round, index, k))}>
        <span class="who-name">{label}</span>
        {score}
      </button>
    ) : (
      <div class={cls}>
        <span class="who-name">{label}</span>
        {score}
      </div>
    );
  };

  return (
    <div class="body online-cup">
      {won ? (
        <div class="champion">
          <span class="dim">CHAMPION</span>
          <span class="big">{won.name}</span>
        </div>
      ) : (
        <>
          <h3 class="who">UP NEXT{cup.firstTo > 1 ? ` · FIRST TO ${cup.firstTo}` : ''}</h3>
          <ul class="players next">
            {ready.map(({ round, index, bout }) => (
              <li key={`${round}-${index}`}>
                <span class="name">
                  {entrant(bout.sides[0])!.name} <span class="dim">vs</span> {entrant(bout.sides[1])!.name}
                  {cup.firstTo > 1 && <span class="record">{`${bout.score[0]}-${bout.score[1]}`}</span>}
                  <span class="record">{roundName(round, cup.rounds.length).toLowerCase()}</span>
                </span>
                {status(bout)}
              </li>
            ))}
          </ul>
        </>
      )}
      <div class="bracket">
        {cup.rounds.map((round, r) => (
          <div class="round" key={r}>
            <h4>{roundName(r, cup.rounds.length)}</h4>
            <div class="bouts">
              {round.map((bout, i) => (
                <div key={i} class={`bout ${isReady(bout) ? 'ready' : ''} ${bout.bye ? 'bye' : ''}`}>
                  {side(bout, 0, r, i)}
                  {side(bout, 1, r, i)}
                  {!bout.bye && (bout.winner !== undefined || bout.score[0] + bout.score[1] > 0) && (
                    <button type="button" class="link undo" onClick={() => setCup(reset(cup, r, i))}>
                      undo
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p class="dim small">Click a name in a pairing on now to give them a match won. Results also come in by themselves from tonight's records, when the relay keeps them.</p>
      <div class="choices">
        <button type="button" class="button" onClick={copy}>
          {copied ? 'COPIED' : 'COPY THE BRACKET'}
        </button>
        <button
          type="button"
          class="button"
          onClick={() => {
            if (!ending) return setEnding(true);
            setCup(undefined);
          }}
        >
          {ending ? 'SURE? CLICK AGAIN' : won ? 'NEW TOURNAMENT' : 'END THE TOURNAMENT'}
        </button>
      </div>
    </div>
  );
}
