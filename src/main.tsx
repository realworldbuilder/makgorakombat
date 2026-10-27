import { render } from 'preact';
import { Game } from './game/Game';
import { recordErrors } from './game/report';
import { Reporter } from './game/Reporter';
import { trackPage } from './game/track';
import { restoreGameFonts } from './game/ui/fonts';
import './style.css';
import './game/ui/wow.css';

// The last errors, for a bug report sent from the game.
recordErrors();

// The site's numbers: this page opened (track.ts).
trackPage('game');

// The game's fonts from an earlier visit, so the title screen is in them before a folder is opened.
restoreGameFonts();

// The reporter first, so its keys are heard before any screen's.
render(
  <>
    <Reporter />
    <Game />
  </>,
  document.querySelector('#app')!,
);
