import { useEffect, useRef, useState } from 'preact/hooks';
import type { BuildInfoEntry } from '@mogshot/casc/build-info';
import { BRAND } from '../engine/brand';
import { ActionBar, GLYPHS, type Slot } from './ActionBar';
import { BoardPanel, BoardTable } from './Board';
import { editionOf, type EditionKey } from './edition';
import { lastProduct, type Phase } from './folder';
import { Guide, type GuidePage } from './Guide';
import { type Counts, lobbyStats } from './net/lobby';
import { Settings } from './Settings';

interface TitleProps {
  phase: Phase;
  dragging: boolean;
  onPick: (input: HTMLInputElement) => void;
  /** A game picked from a folder that holds several. */
  onChoose?: (product: string) => void;
  /** CREATE YOUR CHAMPION is open (or closed): a folder chosen meanwhile opens the roster on the creator's question mark. */
  onCreate: (open: boolean) => void;
  /** PLAY ONLINE is open (or closed): a folder chosen meanwhile opens the online panel over the roster. */
  onOnline: (open: boolean) => void;
  /**
   * The folder is open already: the title come back to from the roster. ENTER THE RING goes
   * straight back to it, with no drop and no second read; `onChange` lets the folder go for another.
   */
  open?: { name: string; onEnter: () => void; onChange: () => void };
}

/** What each edition brings to the ring, for the slot's tooltip before anything is read. */
const EDITION_WORDS: Record<EditionKey, { hue: 'legendary' | 'epic' | 'rare'; lines: string[] }> = {
  retail: { hue: 'epic', lines: ["Today's Azeroth: every allied race and all thirteen classes.", 'The legends in their newest looks, with their artifact weapons.', 'Stages on the rebuilt world.'] },
  forever: { hue: 'legendary', lines: ['The world before Molten Core, and the Skyborne.', 'The legends as they first looked, Sylvanas among them.', 'Stages on the 2004 ground, the Valley of Heroes too.'] },
  classic: { hue: 'rare', lines: ['The original races and classes.', 'The legends as they first looked.'] },
};

/** One slot per game in the folder, the one played last lit. */
function editionSlots(products: readonly BuildInfoEntry[], onChoose: (product: string) => void): Slot[] {
  const last = lastProduct();
  return products.map((entry, i) => {
    const edition = editionOf(entry.product, entry.version);
    const words = EDITION_WORDS[edition.key];
    return {
      key: String(i + 1),
      label: edition.name.replace(/ Edition$/, '').toUpperCase(),
      icon: GLYPHS[edition.key],
      lit: entry.product === last,
      onClick: () => onChoose(entry.product),
      tip: [
        { left: edition.name, kind: 'name', hue: words.hue },
        { left: edition.game, right: entry.version.split('.').slice(0, 3).join('.') },
        ...words.lines.map((line) => ({ left: line, hue: 'green' as const })),
        { left: `"${entry.product}"`, hue: 'gold' },
      ],
    };
  });
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

export function Title({ phase, dragging, onPick, onChoose, onCreate, onOnline, open }: TitleProps) {
  const [guide, setGuidePage] = useState<GuidePage>();
  const setGuide = (page: GuidePage | undefined) => {
    setGuidePage(page);
    onCreate(page === 'create');
    onOnline(page === 'online');
  };
  const [settings, setSettings] = useState(false);
  // TOP TEN in full, from the board on the title, or B.
  const [board, setBoard] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  // The word before Chrome's own "Upload N files?" box, the first time the folder is picked.
  const [note, setNote] = useState(false);
  const choose = () => {
    if (noteSeen()) picker.current?.click();
    else setNote(true);
  };
  const opening = phase.kind === 'opening';
  // The folder is on its way: the panel gives way to the opening, and the wish to create stands.
  useEffect(() => {
    if (opening) setGuidePage(undefined);
  }, [opening]);

  // The action bar's hotkeys: 1 opens the folder picker (a key press counts as the click the
  // browser wants), or with the folder open already 1 or Enter goes back to the roster; 2 how to play, 3 CREATE YOUR CHAMPION, 4 the source, 5 the settings, 6 PLAY ONLINE;
  // and B the board.
  useEffect(() => {
    // A folder with several games takes the digits for its WHICH WORLD? slots instead.
    if (opening || phase.kind === 'choose') return;
    const onKey = (event: KeyboardEvent) => {
      if (guide || settings || board || note || event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.code) {
        case 'Digit1': case 'Numpad1': if (open) open.onEnter(); else choose(); break;
        case 'Enter': case 'NumpadEnter': if (open) open.onEnter(); else return; break;
        case 'Digit2': case 'Numpad2': setGuide('play'); break;
        case 'Digit3': case 'Numpad3': setGuide('create'); break;
        case 'Digit4': case 'Numpad4': window.open(SOURCE, '_blank', 'noreferrer'); break;
        case 'Digit5': case 'Numpad5': setSettings(true); break;
        case 'Digit6': case 'Numpad6': setGuide('online'); break;
        case 'KeyB': setBoard(true); break;
        default: return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opening, phase.kind, guide, settings, board, note, open]);

  // A folder with several games: 1, 2... pick one, Enter the one played last.
  useEffect(() => {
    if (phase.kind !== 'choose' || !onChoose) return;
    const onKey = (event: KeyboardEvent) => {
      const index = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)?.[1];
      const picked = index ? phase.products[Number(index) - 1] : event.code === 'Enter' ? (phase.products.find((p) => p.product === lastProduct()) ?? phase.products[0]) : undefined;
      if (picked) onChoose(picked.product);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onChoose]);

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
      ) : phase.kind === 'choose' && onChoose ? (
        <div class="choose-edition">
          <p class="big">WHICH WORLD?</p>
          <p class="dim">This folder holds {phase.products.length} games. Each brings its own champions, its own ground and its own edition of the ring.</p>
          <ActionBar slots={editionSlots(phase.products, onChoose)} />
        </div>
      ) : (
        <>
          <ActionBar
            slots={[
              open ? {
                key: '1',
                label: 'ENTER THE RING',
                icon: GLYPHS.folder,
                lit: true,
                onClick: open.onEnter,
                tip: [
                  { left: 'Enter the Ring', kind: 'name', hue: 'legendary' },
                  { left: 'Unique' },
                  { left: `Use: Back to CHOOSE YOUR CHAMPION. ${open.name} is open already, so nothing is read again.`, hue: 'green' },
                  { left: '"Your game files never leave your computer."', hue: 'gold' },
                ],
              } : {
                key: '1',
                label: 'ENTER THE RING',
                icon: GLYPHS.folder,
                lit: true,
                onClick: choose,
                tip: [
                  { left: 'Enter the Ring', kind: 'name', hue: 'legendary' },
                  { left: 'Unique' },
                  { left: 'Use: Choose your World of Warcraft folder. The fighters, their gear, the arenas and the sounds are read from it here in the browser.', hue: 'green' },
                  { left: '"Your game files never leave your computer."', hue: 'gold' },
                ],
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
          <section class="title-board" aria-label="The board">
            <h2>THE BOARD</h2>
            <BoardTable keys={false} top={innerHeight < 900 ? 3 : 5} brief />
            <button type="button" class="link" onClick={() => setBoard(true)}>
              the top ten · B
            </button>
          </section>
          {open ? (
            <p class="hint opened">
              <b>{open.name}</b> is open. Press 1 or Enter for CHOOSE YOUR CHAMPION.{' '}
              <button type="button" class="link" onClick={open.onChange}>
                change folder
              </button>
            </p>
          ) : (
            <p class="hint">
              <b>Drop your World of Warcraft folder</b> anywhere on this page, or press 1 to choose it. It is in <code>Applications</code> on a
              Mac. Your game files are read here in the browser and never leave your computer.{' '}
              <a class="link" href={`${import.meta.env.BASE_URL}demo/`}>
                Watch a fight first
              </a>
            </p>
          )}
          {!open && (
            <input
              ref={picker}
              type="file"
              // @ts-expect-error webkitdirectory is not in the DOM typings
              webkitdirectory
              hidden
              onChange={(event) => onPick(event.currentTarget)}
            />
          )}
          {phase.kind === 'error' && <p class="bad">{phase.message}</p>}
          {!chromium && <p class="bad">Made for Chrome. Other browsers may not read the folder.</p>}
        </>
      )}
      <p class="dim small credits">
        A fan game. World of Warcraft is Blizzard Entertainment's; the fighters are drawn from your own copy of it with the{' '}
        <a href="https://realworldbuilder.github.io/mogshot/">Mogshot</a> engine.
      </p>
      {guide && !note && <Guide page={guide} onPage={setGuide} onClose={() => setGuide(undefined)} onFolder={open ? open.onEnter : choose} opened={open !== undefined} />}
      {note && (
        <FolderNote
          onChoose={() => {
            setNote(false);
            markNoteSeen();
            picker.current?.click();
          }}
          onClose={() => setNote(false)}
        />
      )}
      {settings && <Settings onClose={() => setSettings(false)} />}
      {board && <BoardPanel onClose={() => setBoard(false)} />}
    </div>
  );
}

const NOTE_KEY = 'mk.folderNote';

function noteSeen(): boolean {
  try {
    return localStorage.getItem(NOTE_KEY) === '1';
  } catch {
    return false;
  }
}

function markNoteSeen(): void {
  try {
    localStorage.setItem(NOTE_KEY, '1');
  } catch {
    // A private window keeps nothing; the word comes again next visit.
  }
}

/**
 * Before the folder picker opens the first time: Chrome then asks "Upload 3,000 files to this
 * site?" in its own words, which no page can change, and which sounds like the files are being
 * sent somewhere. They are not; this says so, and that dropping the folder asks nothing at all.
 * 1 or Enter opens the picker (a key press counts as the click the browser wants), Esc closes.
 */
function FolderNote({ onChoose, onClose }: { onChoose: () => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Escape') onClose();
      else if (['Digit1', 'Numpad1', 'Enter', 'NumpadEnter'].includes(event.code)) onChoose();
      else return;
      event.stopPropagation();
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onChoose, onClose]);
  return (
    <div class="guide-backdrop" onClick={onClose}>
      <div class="guide folder-note" onClick={(event) => event.stopPropagation()}>
        <nav class="tabs">
          <button class="here" type="button">BEFORE YOU CHOOSE</button>
          <button class="close" onClick={onClose} aria-label="Close" type="button">✕</button>
        </nav>
        <div class="body create-first">
          <p class="big">Chrome will ask: “Upload 3,000 files to this site?”</p>
          <p>
            <b>Click Upload. Nothing is uploaded.</b> That is how Chrome words it for any folder you pick on any website, and no
            website can change it. The game only reads your files, right here in this tab: nothing is sent anywhere, nothing is
            copied, and there is no upload to wait for.
          </p>
          <p class="dim">
            Rather not see the question? Close this and drag your World of Warcraft folder onto the page instead. Chrome asks
            nothing then.
          </p>
          <button type="button" class="button" onClick={onChoose}>
            CHOOSE THE FOLDER · 1
          </button>
        </div>
      </div>
    </div>
  );
}
