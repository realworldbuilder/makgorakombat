import { useEffect } from 'preact/hooks';
import { type InputAction, KEY_LABELS, KEYS } from '../engine/input';

/*
 * The guide: how to play, and how to get your own characters into the ring (the Mogshot
 * addon captures them in the game; the page reads them from the folder you drop).
 */

export type GuidePage = 'play' | 'champion';

interface GuideProps {
  page: GuidePage;
  onPage: (page: GuidePage) => void;
  onClose: () => void;
}

/** Every key bound to an action, as the action bar labels them: "J", ", or NUM 0". */
const keys = (player: 0 | 1, action: InputAction) => KEYS[player][action].map((code) => KEY_LABELS[code] ?? code).join(' or ');

const ADDON = 'https://github.com/realworldbuilder/mogshot/tree/main/addon/Mogshot';
const ADDON_ZIP = 'https://github.com/realworldbuilder/mogshot/archive/refs/heads/main.zip';

export function Guide({ page, onPage, onClose }: GuideProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div class="guide-backdrop" onClick={onClose}>
      <div class="guide" onClick={(event) => event.stopPropagation()}>
        <nav class="tabs">
          <button class={page === 'play' ? 'here' : ''} onClick={() => onPage('play')}>HOW TO PLAY</button>
          <button class={page === 'champion' ? 'here' : ''} onClick={() => onPage('champion')}>CREATE YOUR CHAMPION</button>
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
                <b>CHOOSE YOUR CHAMPION.</b> Every race, the legends, and your own characters. Rest on a tile and your champion appears on
                your side. Lock in and they roar.
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
                <tr><td>On the roster</td><td>WASD · J choose · H back · U ♂/♀ · K L class</td><td>arrows · , choose · M back · Right Shift ♂/♀ · . / class</td></tr>
              </tbody>
            </table>
            <p class="dim small">
              <b>Tab</b> switches player 2 between the keyboard, a gamepad and the computer · <b>Enter</b> rematch · <b>Esc</b> back ·{' '}
              <b>M</b> mute · <b>F3</b> frame times
            </p>
          </div>
        ) : (
          <div class="body">
            <p>
              Your own characters fight with their real gear, face and transmog. The game cannot ask Blizzard who you are, so a small addon
              writes each character down inside your game folder, and the page reads it from the folder you drop.
            </p>
            <ol>
              <li>
                <a href={ADDON_ZIP}>Download Mogshot</a> and copy its <code>addon/Mogshot</code> folder into{' '}
                <code>World of Warcraft/_retail_/Interface/AddOns/</code> (or <code>_forever_</code> for WoW Forever; one copy loads in both). The source is{' '}
                <a href={ADDON} target="_blank" rel="noreferrer">on GitHub</a>.
              </li>
              <li>
                Log in to each character you want in the ring. Sit in a <b>barber chair</b> once so the addon can read your face and hair (the game
                only tells addons that while the barber window is open), then type <code>/reload</code> or log out. The game writes the file then.
              </li>
              <li>
                Come back here and <b>drop the folder again</b>. Your characters appear in the <b>YOUR CHAMPIONS</b> row with their names.
              </li>
            </ol>
            <p class="dim small">
              <code>/mogshot</code> in the game also shows a code for the character you are on. Transmog is drawn as the item's own look for now;
              an item the files do not name is listed under the champion's plate.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
