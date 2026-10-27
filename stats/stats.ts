import { RELAY_URL } from '../src/game/net/relay';
import { NO_TRACK } from '../src/game/track';

/*
 * /stats/: the site's numbers, linked from the welcome page's footer and its privacy note. It reads the
 * relay's GET /site/report (relay/src/site.ts, fed by src/game/track.ts) and GET /lobby/report for
 * online play, for the range picked, and asks again every thirty seconds. ?relay=<url> reads
 * another relay, for trying it against a local one.
 */

// The shapes of the relay's two answers (SiteReport in relay/src/site.ts, NightReport in relay/src/fights.ts), as far as this page reads them.
type SiteSpan = 'day' | 'week' | 'month' | 'all';
interface Count {
  key: string;
  visitors: number;
  n: number;
}
interface SiteReport {
  span: SiteSpan;
  from: number;
  to: number;
  live: number;
  livePages: Record<string, number>;
  visitors: number;
  newVisitors: number;
  views: number;
  series: { label: string; visitors: number; views: number }[];
  funnel: { welcome: number; game: number; folder: number; fight: number; online: number };
  pages: Count[];
  referrers: Count[];
  countries: Count[];
  devices: Count[];
  browsers: Count[];
  systems: Count[];
  editions: Count[];
  modes: Count[];
  champions: Count[];
  watched: number;
  errors: Count[];
}
interface NightReport {
  players: number;
  started: number;
  finished: number;
  desyncs: number;
  left: number;
  drops: number;
  wait: { n: number; median: number | null; worst: number | null };
  busiest: { hour: string; fights: number } | null;
}

const relay = (new URLSearchParams(location.search).get('relay') || RELAY_URL).replace(/\/$/, '');
const REFRESH_MS = 30 * 1000;
const SPAN = 'makgora.stats.span';

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const nf = new Intl.NumberFormat('en-US');
const regions = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return undefined;
  }
})();

let span: SiteSpan = (() => {
  try {
    const kept = localStorage.getItem(SPAN);
    return kept === 'day' || kept === 'week' || kept === 'month' || kept === 'all' ? kept : 'week';
  } catch {
    return 'week';
  }
})();

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function tile(label: string, value: string, hint?: string): HTMLElement {
  const node = el('div', 'tile');
  node.append(el('div', 'label', label), el('div', 'value', value));
  if (hint) node.append(el('div', 'hint', hint));
  return node;
}

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–');

/** A ranked list: the name, a bar against the largest, and the number. */
function rows(items: { name: string; value: number; extra?: string; title?: string }[], empty = 'Nothing yet.'): HTMLElement {
  if (items.length === 0) return el('p', 'empty', empty);
  const max = Math.max(...items.map((item) => item.value), 1);
  const list = el('div', 'rows');
  for (const item of items) {
    const row = el('div', 'row');
    const name = el('span', 'name', item.name);
    name.title = item.title ?? item.name;
    const num = el('span', 'num', nf.format(item.value));
    if (item.extra) num.append(' ', el('small', undefined, item.extra));
    const bar = el('div', 'bar');
    const fill = el('span');
    fill.style.width = `${Math.max((item.value / max) * 100, item.value > 0 ? 1.5 : 0)}%`;
    bar.append(fill);
    row.append(name, num, bar);
    list.append(row);
  }
  return list;
}

const LABELS: Record<string, Record<string, string>> = {
  modes: { cpu: 'Against the computer', local: 'Two on one machine', online: 'Online' },
  editions: { retail: 'Retail (Midnight)', forever: 'WoW Forever', classic: 'Classic' },
  pages: { welcome: 'Welcome page', game: 'The game' },
  referrers: { direct: 'Direct, or no referrer' },
  devices: { desktop: 'Desktop', phone: 'Phone', tablet: 'Tablet' },
};

function nameOf(list: string, key: string): string {
  if (list === 'countries') return key === 'none' ? 'Unknown' : (regions?.of(key) ?? key);
  return LABELS[list]?.[key] ?? key;
}

function renderList(list: string, counts: Count[], total: number): void {
  const box = $(`[data-list="${list}"]`);
  const byTimes = box.dataset.by === 'n';
  box.replaceChildren(
    rows(
      counts.map((count) => ({
        name: nameOf(list, count.key),
        value: byTimes ? count.n : count.visitors,
        extra: byTimes ? `${nf.format(count.visitors)} ${count.visitors === 1 ? 'person' : 'people'}` : pct(count.visitors, total),
      })),
    ),
  );
}

/** The series as columns: one per hour or day, from one baseline, the number on hover. */
function renderSeries(report: SiteReport): void {
  const box = $('[data-series]');
  $('[data-series-title]').textContent = report.span === 'day' ? 'Visitors per hour, New York time' : 'Visitors per day, New York time';
  const data = report.series;
  // Drawn at the box's own width, so its text is the same size on a phone as on a desktop.
  const W = Math.max(box.clientWidth, 280);
  const H = W < 600 ? 180 : 220;
  const left = 36;
  const bottom = 24;
  const top = 8;
  const max = Math.max(...data.map((d) => d.visitors), 1);
  // A top of the scale whose middle is a whole number.
  const nice = max <= 4 ? 4 : max <= 10 ? 10 : Math.ceil(max / 10) * 10;
  const slot = (W - left) / Math.max(data.length, 1);
  const bar = Math.min(24, Math.max(slot - 2, 1));
  const y = (v: number) => H - bottom - (v / nice) * (H - bottom - top);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${report.span === 'day' ? 'Visitors per hour' : 'Visitors per day'}, most ${max}`);
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (text !== undefined) node.textContent = text;
    svg.append(node);
    return node;
  };
  for (const v of [0, nice / 2, nice]) {
    add('line', { class: 'gridline', x1: left, x2: W, y1: y(v), y2: y(v) });
    add('text', { class: 'axis', x: left - 8, y: y(v) + 4, 'text-anchor': 'end' }, nf.format(v));
  }
  const every = Math.ceil(data.length / Math.max(2, Math.floor(W / 90)));
  const tip = $('[data-tip]');
  data.forEach((d, i) => {
    const cx = left + slot * i + slot / 2;
    const x = cx - bar / 2;
    const top = y(d.visitors);
    const h = H - bottom - top;
    const hit = add('rect', { class: 'hit', x: left + slot * i, y: 0, width: slot, height: H - bottom });
    // The column comes after its hit area, so hovering the slot lights it.
    let col: SVGElement | undefined;
    if (h > 0) {
      // A 4px round cap, square at the baseline.
      const r = Math.min(4, h, bar / 2);
      col = add('path', {
        class: 'col',
        d: `M${x},${H - bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + bar - r} Q${x + bar},${top} ${x + bar},${top + r} V${H - bottom} Z`,
      });
    }
    const label = report.span === 'day' ? d.label.slice(11) : shortDay(d.label);
    if (i % every === 0 || i === data.length - 1) add('text', { class: 'axis', x: cx, y: H - 6, 'text-anchor': 'middle' }, label);
    hit.addEventListener('pointerenter', () => {
      col?.classList.add('on');
      tip.innerHTML = '';
      tip.append(el('b', undefined, report.span === 'day' ? `${shortDay(d.label.slice(0, 10))}, ${d.label.slice(11)}` : longDay(d.label)));
      tip.append(el('div', undefined, `${nf.format(d.visitors)} ${d.visitors === 1 ? 'visitor' : 'visitors'}`));
      tip.append(el('div', undefined, `${nf.format(d.views)} page ${d.views === 1 ? 'view' : 'views'}`));
      tip.hidden = false;
    });
    hit.addEventListener('pointermove', (event) => {
      const e = event as PointerEvent;
      const w = tip.offsetWidth;
      tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - w - 8)}px`;
      tip.style.top = `${e.clientY + 14}px`;
    });
    hit.addEventListener('pointerleave', () => {
      col?.classList.remove('on');
      tip.hidden = true;
    });
  });
  box.replaceChildren(svg);
}

function shortDay(label: string): string {
  const [yy, mm, dd] = label.split('-').map(Number);
  return new Date(Date.UTC(yy!, mm! - 1, dd!)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function longDay(label: string): string {
  const [yy, mm, dd] = label.split('-').map(Number);
  return new Date(Date.UTC(yy!, mm! - 1, dd!)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

let shown: SiteReport | undefined;
function renderSite(report: SiteReport): void {
  shown = report;
  const live = $('[data-live]');
  const pages = Object.entries(report.livePages)
    .map(([page, n]) => `${n} ${page === 'welcome' ? 'on welcome' : 'in the game'}`)
    .join(', ');
  $('[data-live-text]').textContent = report.live > 0 ? `${report.live} on the site now${pages ? ` (${pages})` : ''}` : 'Nobody on the site right now';
  live.dataset.state = report.live > 0 ? 'on' : 'off';

  const fights = report.modes.reduce((sum, mode) => sum + mode.n, 0);
  $('[data-tiles]').replaceChildren(
    tile('Visitors', nf.format(report.visitors), `${nf.format(report.newVisitors)} new`),
    tile('Page views', nf.format(report.views), report.visitors > 0 ? `${(report.views / report.visitors).toFixed(1)} each` : undefined),
    tile('Opened a WoW folder', nf.format(report.funnel.folder), `${pct(report.funnel.folder, report.funnel.game)} of game visitors`),
    tile('Fights started', nf.format(fights), `by ${nf.format(report.funnel.fight)} ${report.funnel.fight === 1 ? 'person' : 'people'}`),
    tile('Watched a fight', nf.format(report.watched)),
  );

  renderSeries(report);

  const f = report.funnel;
  const steps = [
    { name: 'Saw the welcome page', value: f.welcome },
    { name: 'Opened the game', value: f.game },
    { name: 'Opened their WoW folder', value: f.folder },
    { name: 'Started a fight', value: f.fight },
    { name: 'Fought online', value: f.online },
  ];
  $('[data-funnel]').replaceChildren(rows(steps.map((step) => ({ ...step, extra: pct(step.value, report.visitors) }))));

  for (const list of ['referrers', 'countries', 'browsers', 'systems', 'devices', 'pages', 'editions', 'modes', 'champions', 'errors'] as const) {
    renderList(list, report[list], report.visitors);
  }

  const range = `${new Date(report.from).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} to ${new Date(report.to).toLocaleString('en-US', { timeStyle: 'short' })}`;
  $('[data-foot]').textContent = `${range}. A visitor is one browser. Robots and headless browsers are left out, and so are browsers that ask not to be tracked. Updated ${new Date().toLocaleTimeString('en-US', { timeStyle: 'short' })}; it refreshes every 30 seconds.`;
}

function renderLobby(report: NightReport | undefined): void {
  const box = $('[data-lobby]');
  if (!report) {
    $('[data-lobby-note]').textContent = "The lobby's report could not be read.";
    box.replaceChildren();
    return;
  }
  $('[data-lobby-note]').textContent = span === 'month' || span === 'all' ? "From the lobby's report; it keeps 30 days." : "From the lobby's report.";
  const secs = (s: number | null) => (s === null ? '–' : s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);
  box.replaceChildren(
    tile('Players in the lobby', nf.format(report.players)),
    tile('Matches started', nf.format(report.started)),
    tile('Fought to the end', nf.format(report.finished), pct(report.finished, report.started)),
    tile('Desyncs', nf.format(report.desyncs), pct(report.desyncs, report.started)),
    tile('Left or dropped', nf.format(report.left + report.drops)),
    tile('Queue wait', secs(report.wait.median), report.wait.n > 0 ? `median; worst ${secs(report.wait.worst)}` : 'nobody queued'),
    tile('Busiest hour', report.busiest ? report.busiest.hour.slice(11) : '–', report.busiest ? `${report.busiest.fights} matches, ${shortDay(report.busiest.hour.slice(0, 10))}` : undefined),
  );
}

async function json<T>(path: string): Promise<T> {
  const response = await fetch(`${relay}${path}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return (await response.json()) as T;
}

let asking = 0;
async function load(): Promise<void> {
  const mine = ++asking;
  const lobbySpan = span === 'day' ? 'day' : span === 'week' ? 'week' : 'all';
  const [site, lobby] = await Promise.allSettled([json<SiteReport>(`/site/report?span=${span}`), json<NightReport>(`/lobby/report?span=${lobbySpan}`)]);
  if (mine !== asking) return;
  const error = $('[data-error]');
  if (site.status === 'fulfilled') {
    error.hidden = true;
    renderSite(site.value);
  } else {
    error.hidden = false;
    error.textContent = `The relay at ${relay} did not answer with the site's numbers (${site.reason instanceof Error ? site.reason.message : 'no answer'}). Has the Relay workflow deployed it yet?`;
  }
  renderLobby(lobby.status === 'fulfilled' ? lobby.value : undefined);
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-span]')) {
  button.setAttribute('aria-pressed', String(button.dataset.span === span));
  button.addEventListener('click', () => {
    span = button.dataset.span as SiteSpan;
    try {
      localStorage.setItem(SPAN, span);
    } catch {
      // Not kept: fine.
    }
    for (const other of document.querySelectorAll<HTMLButtonElement>('[data-span]')) other.setAttribute('aria-pressed', String(other === button));
    void load();
  });
}

// Our own visits need not count: this browser can be left out, here, for good.
const notrack = $<HTMLInputElement>('[data-notrack]');
try {
  notrack.checked = localStorage.getItem(NO_TRACK) === '1';
} catch {
  notrack.disabled = true;
}
notrack.addEventListener('change', () => {
  try {
    if (notrack.checked) localStorage.setItem(NO_TRACK, '1');
    else localStorage.removeItem(NO_TRACK);
  } catch {
    // Storage blocked: nothing kept.
  }
});

// A turned phone or a narrowed window: the chart again at the new width.
let resized = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resized);
  resized = requestAnimationFrame(() => shown && renderSeries(shown));
});

void load();
setInterval(() => {
  if (document.visibilityState === 'visible') void load();
}, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void load();
});
