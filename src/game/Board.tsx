import { useEffect, useState } from 'preact/hooks';
import { type BoardRow, lobbyBoard, playerId, type Span, type Standings, TOP, topTen } from './net/lobby';

/*
 * TOP TEN: the relay's board of who has won most, tonight (from four in the morning in New York)
 * or of all time, with the player's own row under the ten when they are not in it. The same table
 * on the title itself (its top five), in its own panel from the title (B) and as a tab of PLAY ONLINE
 * beside WHO'S HERE. The relay
 * keeps it from both pages' word on each match that ends; see relay/src/board.ts.
 */

/** The board is asked again this often while it is up. */
const BOARD_MS = 20_000;
const SPAN = 'makgora.board';

function keptSpan(): Span {
  try {
    return localStorage.getItem(SPAN) === 'all' ? 'all' : 'night';
  } catch {
    return 'night';
  }
}

function keepSpan(span: Span): void {
  try {
    localStorage.setItem(SPAN, span);
  } catch {
    // The choice lasts for this visit.
  }
}

function Line({ row }: { row: BoardRow }) {
  return (
    <tr class={row.me ? 'me' : ''}>
      <td class="rank">{row.rank}</td>
      <td class="name">{row.name}</td>
      <td class="record">
        {row.wins}-{row.losses}
      </td>
      <td class="streak">{row.streak >= 2 ? `${row.streak} in a row` : row.best >= 2 ? `best ${row.best}` : ''}</td>
    </tr>
  );
}

/**
 * The table and its two spans; ← → (or T) turn between them while `keys` is on. `top` rows are
 * shown, the player's own row pinned under them when it is lower; `brief` drops the small print.
 */
export function BoardTable({ keys = true, top = TOP, brief = false }: { keys?: boolean; top?: number; brief?: boolean }) {
  const [span, setSpanState] = useState<Span>(keptSpan);
  const [standings, setStandings] = useState<Standings>();
  const [error, setError] = useState<string>();
  const setSpan = (next: Span) => {
    keepSpan(next);
    setSpanState(next);
  };

  useEffect(() => {
    let live = true;
    setStandings(undefined);
    setError(undefined);
    const read = () =>
      void lobbyBoard(span, playerId()).then(
        (answer) => live && (setStandings(answer), setError(undefined)),
        () => live && setError('The board could not be reached.'),
      );
    read();
    const timer = setInterval(read, BOARD_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [span]);

  useEffect(() => {
    if (!keys) return;
    const onKey = (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'KeyT'].includes(event.code)) return;
      event.stopPropagation();
      event.preventDefault();
      setSpan(span === 'night' ? 'all' : 'night');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const shown = standings ? topTen(standings, top) : undefined;
  return (
    <div class="board">
      <div class="spans" role="tablist">
        {(['night', 'all'] as const).map((which) => (
          <button key={which} type="button" role="tab" aria-selected={span === which} class={span === which ? 'here' : ''} onClick={() => setSpan(which)}>
            {which === 'night' ? 'TONIGHT' : 'ALL TIME'}
          </button>
        ))}
      </div>
      {error ? (
        <p class="bad">{error}</p>
      ) : !shown ? (
        <p class="dim">reading the board…</p>
      ) : shown.rows.length === 0 ? (
        <p class="dim">{span === 'night' ? 'Nobody has won a match online tonight. Be the first.' : 'Nobody has won a match online yet.'}</p>
      ) : (
        <table>
          <tbody>
            {shown.rows.map((row) => (
              <Line key={row.rank} row={row} />
            ))}
            {shown.pinned && (
              <>
                <tr class="gap" aria-hidden="true">
                  <td colSpan={4}>⋯</td>
                </tr>
                <Line row={shown.pinned} />
              </>
            )}
          </tbody>
        </table>
      )}
      {!brief && (
        <p class="dim small">
          {span === 'night' ? 'Tonight runs from 4 AM to 4 AM, New York time. ' : ''}Wins in online matches fought to the end; most wins first, then the longest run. ← → turn.
        </p>
      )}
    </div>
  );
}

/** The board in its own panel, from the title: Escape or B shuts it. */
export function BoardPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' && event.code !== 'KeyB') return;
      event.stopPropagation();
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div class="guide-backdrop" onClick={onClose}>
      <div class="guide online" onClick={(event) => event.stopPropagation()}>
        <nav class="tabs">
          <button class="here" type="button">TOP TEN</button>
          <button class="close" onClick={onClose} aria-label="Close" type="button">✕</button>
        </nav>
        <div class="body online-board">
          <BoardTable />
        </div>
      </div>
    </div>
  );
}
