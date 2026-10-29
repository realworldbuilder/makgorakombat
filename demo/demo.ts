/**
 * The front door (the site's own address, index.html): the reel of the game playing itself, round
 * and round, with the way in under it. The game is at play/. Enter goes into it, as it would on an
 * arcade cabinet. A browser that will not start the video by itself (a phone saving data) gets the
 * controls instead of a still frame.
 */

// The game was at this address until the front door took it: a link from then with one of the
// game's own flags on it (?all, ?demo, the dev server's ?bay) still goes into the game.
const GAME_FLAGS = ['all', 'demo', 'bay'];
const query = new URLSearchParams(location.search);
if (GAME_FLAGS.some((flag) => query.has(flag))) location.replace(`play/${location.search}${location.hash}`);

const reel = document.querySelector<HTMLVideoElement>('.reel')!;
const play = document.querySelector<HTMLAnchorElement>('#play')!;

void reel.play().catch(() => {
  reel.controls = true;
});

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Enter' || event.target instanceof HTMLAnchorElement) return;
  location.href = play.href;
});
