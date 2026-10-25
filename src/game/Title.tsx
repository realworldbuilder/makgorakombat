import { useEffect, useRef, useState } from 'preact/hooks';
import { BRAND } from '../engine/brand';
import { ActionBar, GLYPHS } from './ActionBar';
import type { Phase } from './folder';
import { Guide, type GuidePage } from './Guide';
import { type Counts, lobbyStats } from './net/lobby';
import { Settings } from './Settings';

interface TitleProps {
  phase: Phase;
  dragging: boolean;
  onPick: (input: HTMLInputElement) => void;
  /** CREATE YOUR CHAMPION is open (or closed): a folder chosen meanwhile opens the roster on the creator's question mark. */
  onCreate: (open: boolean) => void;
  /** PLAY ONLINE is open (or closed): a folder chosen meanwhile opens the online panel over the roster. */
  onOnline: (open: boolean) => void;
}

const chromium = typeof window !== 'undefined' && 'chrome' in window;
const SOURCE = 'https://github.com/realworldbuilder/makgorakombat';

/** The title's art, drawn once and shipped with the page: the logo, and the two champions the ring always opens on. */
export const art = (name: string) => `${import.meta.env.BASE_URL}title/${name}`;

export function Logo({ small }: { small?: boolean }) {
  return (
    <div class={`logo ${small ? 'small' : ''}`}>
      <span class="makgora">MAK'GORA</span>
      <span class="kombat">KOMBAT</span>
    </div>
  );
}

export function LogoArt({ small }: { small?: boolean }) {
  return (
    <h1 class={`logo-art ${small ? 'small' : ''}`}>
      <img src={art('logo.png')} alt={BRAND.title} draggable={false} />
    </h1>
  );
}

/** How often the presence line asks the relay again. */
const PRESENCE_MS = 30_000;

/**
 * The line that says there is somebody to play: how many are fighting online, and how many wait in
 * the queue for anyone. On the title under the action bar, where a visitor decides whether to drop
 * their folder at all, and on the roster under the call once it is open; `online` is the key that
 * opens PLAY ONLINE there. It asks the relay's lobby every thirty seconds, needing no folder, and
 * says nothing until it answers, if it cannot be reached, or while nobody is there.
 */
export function Presence({ online }: { online: string }) {
  const [counts, setCounts] = useState<Counts>();
  useEffect(() => {
    let live = true;
    const read = () => void lobbyStats().then((answer) => live && setCounts(answer), () => undefined);
    read();
    const timer = setInterval(read, PRESENCE_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  if (!counts || counts.online + counts.fighting === 0) return null;
  return (
    <p class="presence">
      <b>{counts.fighting}</b> fighting online
      {counts.waiting > 0 && (
        <>
          {' · '}<b>{counts.waiting}</b> waiting for a fight · <b>{online}</b> play online
        </>
      )}
    </p>
  );
}

export function Title({ phase, dragging, onPick, onCreate, onOnline }: TitleProps) {
  const [guide, setGuidePage] = useState<GuidePage>();
  const setGuide = (page: GuidePage | undefined) => {
    setGuidePage(page);
    onCreate(page === 'create');
    onOnline(page === 'online');
  };
  const [settings, setSettings] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const opening = phase.kind === 'opening';
  // The folder is on its way: the panel gives way to the opening, and the wish to create stands.
  useEffect(() => {
    if (opening) setGuidePage(undefined);
  }, [opening]);

  // The action bar's hotkeys: 1 opens the folder picker (a key press counts as the click the
  // browser wants), 2 how to play, 3 CREATE YOUR CHAMPION, 4 the source, 5 the settings, 6 PLAY ONLINE.
  useEffect(() => {
    if (opening) return;
    const onKey = (event: KeyboardEvent) => {
      if (guide || settings || event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.code) {
        case 'Digit1': case 'Numpad1': picker.current?.click(); break;
        case 'Digit2': case 'Numpad2': setGuide('play'); break;
        case 'Digit3': case 'Numpad3': setGuide('create'); break;
        case 'Digit4': case 'Numpad4': window.open(SOURCE, '_blank', 'noreferrer'); break;
        case 'Digit5': case 'Numpad5': setSettings(true); break;
        case 'Digit6': case 'Numpad6': setGuide('online'); break;
        default: return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opening, guide, settings]);
  return (
    <div class={`screen title ${dragging ? 'over' : ''}`}>
      <div class="faceoff" aria-hidden="true">
        <img class="champion left" src={art('tyrande.png')} alt="" draggable={false} />
        <img class="champion right" src={art('thrall.png')} alt="" draggable={false} />
      </div>
      <LogoArt />
      <p class="tagline">{BRAND.tagline}</p>
      <div class="billing">
        <span class="p1">TYRANDE</span>
        <span class="vs">VS</span>
        <span class="p2">THRALL</span>
      </div>
      {opening ? (
        <div class="opening">
          <p class="big">ENTERING THE RING</p>
          <p class="dim">{phase.message}</p>
        </div>
      ) : (
        <>
          <ActionBar
            slots={[
              {
                key: '1',
                label: 'ENTER THE RING',
                icon: GLYPHS.folder,
                lit: true,
                tip: [
                  { left: 'Enter the Ring', kind: 'name', hue: 'legendary' },
                  { left: 'Unique' },
                  { left: 'Use: Choose your World of Warcraft folder. The fighters, their gear, the arenas and the sounds are read from it here in the browser.', hue: 'green' },
                  { left: '"Your game files never leave your computer."', hue: 'gold' },
                ],
                input: (
                  <input
                    ref={picker}
                    type="file"
                    // @ts-expect-error webkitdirectory is not in the DOM typings
                    webkitdirectory
                    hidden
                    onChange={(event) => onPick(event.currentTarget)}
                  />
                ),
              },
              {
                key: '2',
                label: 'HOW TO PLAY',
                icon: GLYPHS.swords,
                onClick: () => setGuide('play'),
                tip: [
                  { left: 'How to Play', kind: 'name', hue: 'rare' },
                  { left: 'Use: The keys for both players, the action bar and how a round is won.', hue: 'green' },
                ],
              },
              {
                key: '3',
                label: 'CREATE YOUR CHAMPION',
                icon: GLYPHS.champion,
                onClick: () => setGuide('create'),
                tip: [
                  { left: 'Create Your Champion', kind: 'name', hue: 'epic' },
                  { left: 'Soulbound' },
                  { left: 'Use: Make a champion of your own: race, class, look, armour and name. Drop your World of Warcraft folder first.', hue: 'green' },
                ],
              },
              {
                key: '4',
                label: 'SOURCE',
                icon: GLYPHS.code,
                href: SOURCE,
                tip: [
                  { left: 'Source', kind: 'name', hue: 'uncommon' },
                  { left: 'Use: Read how the game is made, on GitHub.', hue: 'green' },
                ],
              },
              {
                key: '5',
                label: 'SETTINGS',
                icon: GLYPHS.gear,
                onClick: () => setSettings(true),
                tip: [
                  { left: 'Settings', kind: 'name', hue: 'common' },
                  { left: 'Use: The sound, the music, which keys the two players hold and the relay for online play. Remembered in this browser.', hue: 'green' },
                ],
              },
              {
                key: '6',
                label: 'PLAY ONLINE',
                icon: GLYPHS.globe,
                onClick: () => setGuide('online'),
                tip: [
                  { left: 'Play Online', kind: 'name', hue: 'legendary' },
                  { left: 'Binds when used' },
                  { left: 'Use: Fight a friend on another computer: give a name, then challenge them by theirs or wait for anyone with QUICK MATCH. Each needs their own World of Warcraft folder; drop it first.', hue: 'green' },
                ],
              },
            ]}
          />
          <Presence online="6" />
          <p class="hint">
            <b>Drop your World of Warcraft folder</b> anywhere on this page, or press 1 to choose it. It is in <code>Applications</code> on a
            Mac. Your game files are read here in the browser and never leave your computer.
          </p>
          {phase.kind === 'error' && <p class="bad">{phase.message}</p>}
          {!chromium && <p class="bad">Made for Chrome. Other browsers may not read the folder.</p>}
        </>
      )}
      <p class="dim small credits">
        A fan game. World of Warcraft is Blizzard Entertainment's; the fighters are drawn from your own copy of it with the{' '}
        <a href="https://realworldbuilder.github.io/mogshot/">Mogshot</a> engine.
      </p>
      {guide && <Guide page={guide} onPage={setGuide} onClose={() => setGuide(undefined)} onFolder={() => picker.current?.click()} />}
      {settings && <Settings onClose={() => setSettings(false)} />}
    </div>
  );
}
