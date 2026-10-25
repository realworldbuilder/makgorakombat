import { useEffect } from 'preact/hooks';
import { type InputAction, KEY_LABELS, KEYS, keyLayout, LAYOUT_WORDS } from '../engine/input';

/*
 * The guide: how to play, and CREATE YOUR CHAMPION and PLAY ONLINE before the folder is open
 * (the creator and an online fight draw from the game's own files, so they wait for them).
 */

export type GuidePage = 'play' | 'create' | 'online';

interface GuideProps {
  page: GuidePage;
  onPage: (page: GuidePage) => void;
  onClose: () => void;
  /** Opens the folder picker, from the CREATE YOUR CHAMPION and PLAY ONLINE pages; a key press counts as the click the browser wants. */
  onFolder?: () => void;
}

/** Every key bound to an action, as the action bar labels them: "J", ", or NUM 0". */
const keys = (player: 0 | 1, action: InputAction) => KEYS[player][action].map((code) => KEY_LABELS[code] ?? code).join(' or ');

export function Guide({ page, onPage, onClose, onFolder }: GuideProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.stopPropagation();
        onClose();
      } else if (page !== 'play' && onFolder && ['Digit1', 'Numpad1', 'Enter', 'NumpadEnter'].includes(event.code)) {
        event.stopPropagation();
        event.preventDefault();
        onFolder();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, onFolder, page]);

  return (
    <div class="guide-backdrop" onClick={onClose}>
      <div class="guide" onClick={(event) => event.stopPropagation()}>
        <nav class="tabs">
          <button class={page === 'play' ? 'here' : ''} onClick={() => onPage('play')}>HOW TO PLAY</button>
          <button class={page === 'create' ? 'here' : ''} onClick={() => onPage('create')}>CREATE YOUR CHAMPION</button>
          <button class={page === 'online' ? 'here' : ''} onClick={() => onPage('online')}>PLAY ONLINE</button>
          <button class="close" onClick={onClose} aria-label="Close">✕</button>
        </nav>
        {page === 'play' ? (
          <div class="body">
            <ol>
              <li>
                <b>Drop your World of Warcraft folder</b> on the page. It is in <code>Applications</code> on a Mac. Your game files are read
                here in the browser and never leave your computer; the first open takes a moment, later ones are instant.
              </li>
              <li>
                <b>CHOOSE YOUR CHAMPION.</b> The legends, and after them the question mark: <b>CREATE YOUR CHAMPION</b> makes one of your
                own, who joins the row. Rest on a tile and your champion appears on your side. Lock in and they roar.
              </li>
              <li>
                <b>Pick the ground</b> from the game's loading screens, then fight: best of three, sixty seconds a round.
              </li>
              <li>
                Take their health to nothing and they are dazed: <b>FINISH THE MAK'GORA!</b> A heavy blow then is <b>DISHONOR!</b>; a round
                won untouched is <b>HONOR RESTORED</b>.
              </li>
            </ol>
            <table class="keys">
              <thead>
                <tr><th></th><th>Player 1</th><th>Player 2</th></tr>
              </thead>
              <tbody>
                <tr><td>Move</td><td>{keys(0, 'left')} / {keys(0, 'right')}</td><td>{keys(1, 'left')} / {keys(1, 'right')}</td></tr>
                <tr><td>Jump</td><td>{keys(0, 'jump')}</td><td>{keys(1, 'jump')}</td></tr>
                <tr><td>Attack (hold to keep swinging)</td><td>{keys(0, 'attack')}</td><td>{keys(1, 'attack')}</td></tr>
                <tr><td>Abilities, on the action bar</td><td>{keys(0, 'ability1')} · {keys(0, 'ability2')} · {keys(0, 'ability3')}</td><td>{keys(1, 'ability1')} · {keys(1, 'ability2')} · {keys(1, 'ability3')}</td></tr>
                <tr><td>What an ability does</td><td colSpan={2}>Hover its slot, or hold its key</td></tr>
                {keyLayout() === 'wow' ? (
                  <tr><td>On the roster</td><td>arrows · 1 choose · Backspace back · 4 ♂/♀ · 2 3 class</td><td>WASD · J choose · H back · U ♂/♀ · K L class</td></tr>
                ) : (
                  <tr><td>On the roster</td><td>WASD · J choose · H back · U ♂/♀ · K L class</td><td>arrows · , choose · M back · Right Shift ♂/♀ · . / class</td></tr>
                )}
              </tbody>
            </table>
            <p class="dim small">
              <b>C</b> on the roster switches the keys ({LAYOUT_WORDS[keyLayout()]} now): player 1 on the game's own keys, the arrows to move and jump
              and 1 2 3 4 for the attack and the action bar, with player 2 on WASD and J K L U · <b>Tab</b> switches player 2 between the keyboard, a gamepad
              and the computer · <b>O</b> there plays online · <b>Enter</b> rematch · <b>Esc</b> back · <b>M</b> mute · <b>F3</b> frame times
            </p>
          </div>
        ) : (
          <div class="body create-first">
            <p class="big">Drop your World of Warcraft folder first.</p>
            {page === 'online' && <p class="dim">Each player's champions and ground are drawn from their own folder; then give a name, and you find each other under WHO'S HERE: one challenges, the other accepts.</p>}
            {onFolder && (
              <button type="button" class="button" onClick={onFolder}>
                CHOOSE THE FOLDER · 1
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
