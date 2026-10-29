/**
 * The demo page: the reel of the game playing itself, round and round, with the way in under it.
 * Enter goes into the game, as it would on an arcade cabinet. A browser that will not start the
 * video by itself (a phone saving data) gets the controls instead of a still frame.
 */

const reel = document.querySelector<HTMLVideoElement>('.reel')!;
const play = document.querySelector<HTMLAnchorElement>('#play')!;

void reel.play().catch(() => {
  reel.controls = true;
});

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Enter' || event.target instanceof HTMLAnchorElement) return;
  location.href = play.href;
});
