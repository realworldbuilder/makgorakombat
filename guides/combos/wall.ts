/*
 * The combos guide's cover: every ability in the game, three per class in roster order, laid in a
 * tilted wall behind the title. The icons are the game's own, the ones the action bar shows.
 */

const ICONS = [
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

/** Enough tiles to cover the tilted wall: nine across, eleven down. */
const TILES = 99;

const wall = document.querySelector<HTMLElement>('.wall');
if (wall) {
  for (let n = 0; n < TILES; n++) {
    const img = document.createElement('img');
    // A stride of 7 through the 39 keeps a class's three apart.
    img.src = `${import.meta.env.BASE_URL}guides/combos/${ICONS[(n * 7) % ICONS.length]}.webp`;
    img.alt = '';
    wall.append(img);
  }
}
