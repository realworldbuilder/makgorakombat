import { useEffect, useState } from 'preact/hooks';
import { type InputAction, KEY_LABELS, KEY_LAYOUTS, type KeyLayout, keyLayout, LAYOUT_WORDS, setKeyLayout } from '../engine/input';
import { isMuted, setLevel, setMuted, soundSettings } from './sound';

/*
 * Settings, from the title screen: the sound (mute, the music's level, the effects' level) and
 * which keys the two players hold. Everything is remembered in the browser; nothing here needs
 * the folder. The same panel as the guide, so it reads as one interface.
 */

interface SettingsProps {
  onClose: () => void;
}

const ACTIONS: readonly [InputAction, string][] = [
  ['left', 'Move'],
  ['jump', 'Jump'],
  ['attack', 'Attack'],
  ['ability1', 'Ability 1'],
  ['ability2', 'Ability 2'],
  ['ability3', 'Ability 3'],
];

const label = (codes: readonly string[]) => codes.map((code) => KEY_LABELS[code] ?? code).join(' or ');

export function Settings({ onClose }: SettingsProps) {
  const [muted, setMutedState] = useState(isMuted());
  const [music, setMusic] = useState(soundSettings().music);
  const [effects, setEffects] = useState(soundSettings().effects);
  const [layout, setLayout] = useState<KeyLayout>(keyLayout());

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.stopPropagation();
        onClose();
      } else if (event.code === 'KeyM') {
        setMuted(!isMuted());
        setMutedState(isMuted());
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const choose = (next: KeyLayout) => {
    setKeyLayout(next);
    setLayout(next);
  };
  const [p1, p2] = KEY_LAYOUTS[layout];

  return (
    <div class="guide-backdrop" onClick={onClose}>
      <div class="guide settings" onClick={(event) => event.stopPropagation()}>
        <nav class="tabs">
          <button class="here" type="button">SETTINGS</button>
          <button class="close" onClick={onClose} aria-label="Close" type="button">✕</button>
        </nav>
        <div class="body">
          <h3>Sound</h3>
          <div class="row">
            <label for="setting-mute">Sound</label>
            <button
              id="setting-mute"
              type="button"
              class={`toggle ${muted ? '' : 'on'}`}
              aria-pressed={!muted}
              onClick={() => {
                setMuted(!muted);
                setMutedState(!muted);
              }}
            >
              {muted ? 'OFF · M' : 'ON · M'}
            </button>
          </div>
          <div class="row">
            <label for="setting-music">Music</label>
            <input
              id="setting-music"
              type="range"
              min="0"
              max="100"
              value={Math.round(music * 100)}
              onInput={(event) => {
                const value = Number(event.currentTarget.value) / 100;
                setLevel('music', value);
                setMusic(value);
              }}
            />
            <span class="value">{Math.round(music * 100)}</span>
          </div>
          <div class="row">
            <label for="setting-effects">Effects</label>
            <input
              id="setting-effects"
              type="range"
              min="0"
              max="100"
              value={Math.round(effects * 100)}
              onInput={(event) => {
                const value = Number(event.currentTarget.value) / 100;
                setLevel('effects', value);
                setEffects(value);
              }}
            />
            <span class="value">{Math.round(effects * 100)}</span>
          </div>
          <p class="dim small">Browsers keep sound off until a key is pressed or the page is clicked, so the first screen may start quiet.</p>

          <h3>Controls</h3>
          <div class="choice" role="radiogroup" aria-label="Keys">
            <button type="button" class={layout === 'classic' ? 'here' : ''} role="radio" aria-checked={layout === 'classic'} onClick={() => choose('classic')}>
              <b>Fighting game</b>
              <span>{LAYOUT_WORDS.classic} · player 2 on the arrows</span>
            </button>
            <button type="button" class={layout === 'wow' ? 'here' : ''} role="radio" aria-checked={layout === 'wow'} onClick={() => choose('wow')}>
              <b>World of Warcraft</b>
              <span>{LAYOUT_WORDS.wow} · player 2 on WASD</span>
            </button>
          </div>
          <table class="keys">
            <thead>
              <tr><th></th><th>Player 1</th><th>Player 2</th></tr>
            </thead>
            <tbody>
              {ACTIONS.map(([action, name]) => (
                <tr key={action}>
                  <td>{name}</td>
                  <td>{action === 'left' ? `${label(p1.left)} / ${label(p1.right)}` : label(p1[action])}</td>
                  <td>{action === 'left' ? `${label(p2.left)} / ${label(p2.right)}` : label(p2[action])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="dim small">
            <b>C</b> on the roster switches the keys too · <b>Tab</b> there makes player 2 the keyboard, a gamepad or the computer · a gamepad plays with A B X,
            the right trigger and Y
          </p>
        </div>
      </div>
    </div>
  );
}
