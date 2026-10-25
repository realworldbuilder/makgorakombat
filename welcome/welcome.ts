import { ALL_FATALITIES, type SequenceToken } from '../src/engine/fatalities';
import { lobbyStats } from '../src/game/net/lobby';

/*
 * The welcome page's few moving parts: the island nav's menu and the section it is on, the fade up
 * as each block comes into view, the tagline lighting word by word, the fatality picker (read from
 * the game's own table, so the page never shows a sequence the game has changed) and the lobby's
 * live count. Everything is IntersectionObserver; nothing listens to scroll.
 */

document.documentElement.classList.add('js');

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// No word alone on a last line: the last two words of every block are joined by a no-break space.
// text-wrap does not promise it on every width and engine; this does.
function keepLastTwo(el: Element): void {
  // A short caption is better left to wrap where it must than held as one wide piece.
  if ((el.textContent ?? '').trim().split(/\s+/).length < 3) return;
  const texts: Text[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const node of texts.reverse()) {
    const text = node.data.replace(/\s+$/, '');
    const at = text.search(/ \S+$/);
    if (at >= 0) {
      node.data = `${text.slice(0, at)}\u00a0${text.slice(at + 1)}${node.data.slice(text.length)}`;
      return;
    }
    if (/\s/.test(node.data) || node.data.trim()) return;
  }
}
for (const el of document.querySelectorAll('h1, h2, h3, p:not([data-words]), summary')) keepLastTwo(el);

// The menu: the burger turns into an X, the overlay opens and its links rise one after another.
const burger = document.querySelector<HTMLButtonElement>('.burger');
const menu = document.querySelector<HTMLElement>('#menu');
function setMenu(open: boolean): void {
  if (!burger || !menu) return;
  burger.setAttribute('aria-expanded', String(open));
  burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  menu.dataset.open = String(open);
  menu.inert = !open;
  document.body.style.overflow = open ? 'hidden' : '';
}
burger?.addEventListener('click', () => setMenu(burger.getAttribute('aria-expanded') !== 'true'));
menu?.addEventListener('click', (event) => {
  if ((event.target as Element).closest('a')) setMenu(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menu?.dataset.open === 'true') {
    setMenu(false);
    burger?.focus();
  }
});

// The nav marks the section in view.
const navLinks = [...document.querySelectorAll<HTMLAnchorElement>('a[data-section]')];
const sections = [...new Set(navLinks.map((a) => a.dataset.section))]
  .map((id) => document.getElementById(id ?? ''))
  .filter((el): el is HTMLElement => el !== null);
const inView = new Set<string>();
const sectionWatch = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) inView.add(entry.target.id);
      else inView.delete(entry.target.id);
    }
    const current = sections.find((s) => inView.has(s.id))?.id;
    for (const a of navLinks) a.setAttribute('aria-current', String(a.dataset.section === current));
  },
  { rootMargin: '-45% 0px -50% 0px' },
);
for (const s of sections) sectionWatch.observe(s);

// Each block fades up, heavy and unblurring, the first time it enters.
const reveals = new IntersectionObserver(
  (entries) => {
    let n = 0;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target as HTMLElement;
      el.style.transitionDelay = `${Math.min(n++, 4) * 80}ms`;
      el.classList.add('is-in');
      reveals.unobserve(el);
    }
  },
  { rootMargin: '0px 0px -8% 0px' },
);
for (const el of document.querySelectorAll('.reveal')) reveals.observe(el);

// The tagline: every word starts dim and lights as it rises past a line two fifths up the screen,
// one at a time in reading order, and dims again if it goes back below it.
const tagline = document.querySelector<HTMLElement>('[data-words]');
if (tagline) {
  const words = (tagline.textContent ?? '').trim().split(/\s+/);
  tagline.setAttribute('aria-label', words.join(' '));
  tagline.replaceChildren(
    ...words.flatMap((word, i) => {
      const span = document.createElement('span');
      span.className = 'w';
      span.textContent = word;
      span.dataset.i = String(i);
      span.setAttribute('aria-hidden', 'true');
      if (i === words.length - 1) return [span];
      return [span, document.createTextNode(i === words.length - 2 ? '\u00a0' : ' ')];
    }),
  );
  const lit = new IntersectionObserver(
    (entries) => {
      const changed = entries
        .map((entry) => ({ el: entry.target as HTMLElement, on: entry.isIntersecting || entry.boundingClientRect.top < 0 }))
        .filter(({ el, on }) => el.classList.contains('on') !== on)
        .sort((a, b) => Number(a.el.dataset.i) - Number(b.el.dataset.i));
      // Lighting runs forward through the words, dimming backward from the last.
      if (changed[0] && !changed[0].on) changed.reverse();
      changed.forEach(({ el, on }, k) => {
        el.style.transitionDelay = reducedMotion ? '0ms' : `${k * 70}ms`;
        el.classList.toggle('on', on);
      });
    },
    { rootMargin: '0px 0px -40% 0px' },
  );
  for (const span of tagline.querySelectorAll('.w')) lit.observe(span);
}

// The fatality picker.
const CLASS_NAMES: Record<number, string> = {
  1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest', 6: 'Death Knight', 7: 'Shaman',
  8: 'Mage', 9: 'Warlock', 10: 'Monk', 11: 'Druid', 12: 'Demon Hunter', 13: 'Evoker',
};
/** What each scene shows, beat by beat, as the README's table has it. */
const SCENES: Record<string, string> = {
  warrior: 'Charges in, spins through them, they kneel, the execute.',
  paladin: 'A pillar of light, a hammer blow that floors them, the execute.',
  hunter: 'Leaps back, a volley of arrows, the kill shot.',
  rogue: 'Steps behind them, two strikes, the eviscerate.',
  priest: 'Shadow gathers, a channel that wracks them, the word.',
  deathknight: 'A death grip drags them in, a frost strike, the reap.',
  shaman: 'Lightning from the sky twice, a charge, Stormstrike.',
  mage: 'Frost grows over them, a frozen beat, the shatter.',
  warlock: 'Shadow, a long drain, the burst.',
  monk: 'A flying kick, a roundhouse, the touch.',
  druid: 'Moonlight, stars that fall on them, the last star.',
  demonhunter: 'Fel Rush, Blade Dance, a hop back and the beam.',
  evoker: 'Takes to the air, a breath of fire, the last breath.',
};
/** Player 1's keys facing right, as the game's prompt shows them. */
const KEYS: Record<SequenceToken, [key: string, label: string]> = {
  back: ['A', 'Back'],
  forward: ['D', 'Forward'],
  attack: ['J', 'Attack'],
  ability1: ['K', 'Ability 1'],
  ability2: ['L', 'Ability 2'],
  ability3: ['U', 'Ability 3'],
};

const picker = document.querySelector<HTMLElement>('[data-classes]');
const panel = document.querySelector<HTMLElement>('[data-panel]');
if (picker && panel) {
  const classes = [...ALL_FATALITIES.entries()].filter(([id]) => CLASS_NAMES[id]).sort(([a], [b]) => a - b);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const show = (id: number): void => {
    const f = ALL_FATALITIES.get(id);
    if (!f) return;
    for (const b of picker.querySelectorAll('button')) {
      const selected = b.dataset.id === String(id);
      b.setAttribute('aria-selected', String(selected));
      b.tabIndex = selected ? 0 : -1;
    }
    panel.style.setProperty('--fx', f.colour);
    const keys = el('div', 'keys');
    keys.setAttribute('aria-label', `Sequence: ${f.sequence.map((t) => KEYS[t][1]).join(', ')}`);
    for (const token of f.sequence) {
      const [key, label] = KEYS[token];
      const cap = el('div', 'key');
      cap.setAttribute('aria-hidden', 'true');
      cap.append(el('b', '', key), el('small', '', label));
      keys.append(cap);
    }
    panel.setAttribute('aria-labelledby', `class-${id}`);
    panel.replaceChildren(
      el('p', 'fatality-class', CLASS_NAMES[id]),
      el('h3', 'fatality-name', f.name),
      keys,
      el('p', 'fatality-scene', SCENES[f.id] ?? ''),
    );
  };
  for (const [id] of classes) {
    const button = el('button', '', CLASS_NAMES[id]);
    button.type = 'button';
    button.id = `class-${id}`;
    button.dataset.id = String(id);
    button.setAttribute('role', 'tab');
    button.addEventListener('click', () => show(id));
    picker.append(button);
  }
  // Arrow keys move along the tabs, as a tab list does.
  picker.addEventListener('keydown', (event) => {
    const buttons = [...picker.querySelectorAll<HTMLButtonElement>('button')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step || at < 0) return;
    event.preventDefault();
    const next = buttons[(at + step + buttons.length) % buttons.length];
    next?.focus();
    next?.click();
  });
  if (classes[0]) show(classes[0][0]);
}

// The lobby's live count, beside the proof line: a skeleton while it is asked, the count when the
// relay answers with anyone in it, and nothing at all when it does not.
const live = document.querySelector<HTMLElement>('[data-live]');
if (live) {
  lobbyStats()
    .then(({ online, fighting }) => {
      if (online < 1) throw new Error('Nobody in the lobby.');
      const dot = document.createElement('span');
      dot.className = 'live-dot';
      dot.setAttribute('aria-hidden', 'true');
      const text = fighting > 0 ? `${online} online now, ${fighting} fighting` : `${online} online now`;
      live.replaceChildren(dot, document.createTextNode(text));
      live.dataset.state = 'on';
    })
    .catch(() => {
      live.replaceChildren();
      live.dataset.state = 'off';
    });
}
