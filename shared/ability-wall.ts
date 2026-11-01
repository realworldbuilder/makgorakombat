/*
 * The ability wall: every ability in the game as the icon its action bar shows, three per class in
 * roster order, laid in a tilted, darkened wall. It began as the combos guide's cover and is the
 * ground of our marketing. Any element with the class "ability-wall" is filled when this module
 * loads; ability-wall.css draws it, and its custom properties set the tilt, the darkening and the size.
 *
 *   <div class="ability-wall" aria-hidden="true"></div>             the still wall
 *   <div class="ability-wall drift" style="--wall-columns: 16"></div>   more, smaller tiles, drifting
 */

export const ABILITY_ICONS = [
  'charge', 'mortal-strike', 'execute',
  'crusader-strike', 'hammer-of-justice', 'holy-light',
  'aimed-shot', 'disengage', 'raptor-strike',
  'sinister-strike', 'kidney-shot', 'evasion',
  'mind-blast', 'holy-nova', 'power-word-shield',
  'icy-touch', 'death-strike', 'death-coil',
  'lightning-bolt', 'earth-shock', 'stormstrike',
  'frostbolt', 'frost-nova', 'blink',
  'shadow-bolt', 'corruption', 'howl-of-terror',
  'tiger-palm', 'rising-sun-kick', 'leg-sweep',
  'wrath', 'moonfire', 'rake',
  'chaos-strike', 'fel-rush', 'blade-dance',
  'living-flame', 'fire-breath', 'hover',
];

/**
 * The icon at a row and column. Every wall is a window on the same endless plane, nine tiles to a row
 * as the combos cover first was, however many it shows across: a stride of 7 through the 39 keeps a
 * class's three apart in every direction, and no icon meets itself nearer than five tiles away. The
 * plane repeats every 13 rows, which is how far a drifting wall slides before it starts again.
 */
export function wallIcon(row: number, column: number): string {
  return ABILITY_ICONS[((row * 9 + column) * 7) % ABILITY_ICONS.length]!;
}

/** Rows before the plane repeats. */
const PERIOD = 13;

/** How many tiles across: the wall's --wall-columns, 9 unless set. */
function columnsOf(wall: HTMLElement): number {
  return Number(getComputedStyle(wall).getPropertyValue('--wall-columns')) || 9;
}

/**
 * Fills a wall with tiles: --wall-columns across, and enough rows to cover the element once tilted,
 * or data-rows. A drifting wall gets one period more, and slides up by exactly that (--wall-shift),
 * so the end is the start and the loop has no seam.
 */
export function fillWall(wall: HTMLElement): void {
  const columns = columnsOf(wall);
  const box = wall.getBoundingClientRect();
  const rows = Number(wall.dataset.rows) || Math.ceil((columns * box.height) / Math.max(box.width, 1)) + 1;
  const drift = wall.classList.contains('drift');
  const grid = document.createElement('div');
  grid.className = 'ability-wall-grid';
  const total = drift ? rows + PERIOD : rows;
  grid.style.setProperty('--wall-shift', `${(-100 * PERIOD) / total}%`);
  for (let row = 0; row < total; row++) {
    for (let column = 0; column < columns; column++) {
      const img = document.createElement('img');
      img.src = `${import.meta.env.BASE_URL}guides/combos/${wallIcon(row, column)}.webp`;
      img.alt = '';
      grid.append(img);
    }
  }
  wall.replaceChildren(grid);
}

// Filled now, and again if a media query changes how many tiles go across, so the rows still cover it.
for (const wall of document.querySelectorAll<HTMLElement>('.ability-wall')) {
  fillWall(wall);
  let columns = columnsOf(wall);
  new ResizeObserver(() => {
    if (columnsOf(wall) !== columns) {
      columns = columnsOf(wall);
      fillWall(wall);
    }
  }).observe(wall);
}
