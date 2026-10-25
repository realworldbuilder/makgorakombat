import { useEffect, useState } from 'preact/hooks';
import { type InputAction, KEY_LABELS, KEY_LAYOUTS, type KeyLayout, keyLayout, LAYOUT_WORDS, setKeyLayout } from '../engine/input';
import type { RulesName } from '../engine/rules';
import { isMuted, setLevel, setMuted, soundSettings } from './sound';
import { RELAY_URL, relayUrl, setRelayUrl } from './net/relay';

/*
 * Settings, from the title screen: the sound (mute, the music's level, the effects' level), which
 * keys the two players hold, the rules the fight is fought under, and the relay online play goes
 * through. Everything is remembered in the browser; nothing here needs the folder. The same panel
 * as the guide, so it reads as one interface.
 */

const RULES_STORAGE = 'makgora.rules';
/** KOMBAT until the player chooses otherwise. */
let rules: RulesName = 'kombat';
try {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(RULES_STORAGE) : null;
  if (saved === 'warcraft' || saved === 'kombat') rules = saved;
} catch {
  // No storage: KOMBAT.
}

/** The rules the next fight is fought under, as last chosen. */
export function chosenRules(): RulesName {
  return rules;
}

export function chooseRules(next: RulesName): void {
  rules = next;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(RULES_STORAGE, next);
  } catch {
    // Storage may be blocked; the choice then lasts for this visit.
  }
}

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
  const [ruleset, setRuleset] = useState<RulesName>(chosenRules());
  const [relay, setRelay] = useState(relayUrl());

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Letters typed in the relay's field are the field's.
      if (event.target instanceof HTMLInputElement && event.target.type === 'url' && event.code !== 'Escape') return;
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
  const pick = (next: RulesName) => {
    chooseRules(next);
    setRuleset(next);
  };

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
            the right trigger and Y · online you play with player 1's keys whichever side you are
          </p>

          <h3>Network</h3>
          <div class="row relay">
            <label for="setting-relay">Relay</label>
            <input
              id="setting-relay"
              type="url"
              spellcheck={false}
              value={relay}
              placeholder={RELAY_URL}
              onChange={(event) => {
                setRelayUrl(event.currentTarget.value);
                setRelay(relayUrl());
              }}
            />
            <button
              type="button"
              class="toggle"
              disabled={relay === RELAY_URL}
              onClick={() => {
                setRelayUrl('');
                setRelay(relayUrl());
              }}
            >
              DEFAULT
            </button>
          </div>
          <p class="dim small">
            PLAY ONLINE goes through this relay; both players must use the same one. To run your own, deploy <code>relay/</code> from the game's source to your
            Cloudflare account and put its address here.
          </p>

          <h3>Rules</h3>
          <div class="choice" role="radiogroup" aria-label="Rules">
            <button type="button" class={ruleset === 'warcraft' ? 'here' : ''} role="radio" aria-checked={ruleset === 'warcraft'} onClick={() => pick('warcraft')}>
              <b>Warcraft</b>
              <span>swing timers, the hit table, the global cooldown, as the game plays</span>
            </button>
            <button type="button" class={ruleset === 'kombat' ? 'here' : ''} role="radio" aria-checked={ruleset === 'kombat'} onClick={() => pick('kombat')}>
              <b>Kombat</b>
              <span>attacks on the press, combos, block, no dice</span>
            </button>
          </div>
          <p class="dim small">
            Under Kombat three presses in rhythm are a string, holding back blocks, a double tap forward or back dashes, and attack in the air is a jumping attack. The next fight takes the change.
          </p>
        </div>
      </div>
    </div>
  );
}
