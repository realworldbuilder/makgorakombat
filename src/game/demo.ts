/**
 * `?demo` on the address: the attract loop. Once a folder is open the game plays itself, CPU
 * against CPU, round and round: both players pick on CHOOSE YOUR CHAMPION, the VS screen picks a
 * stage, the two fight to the finish and the fatality, and it starts again on the roster. Nothing
 * is pressed. The /demo/ page's reel is recorded from it, so people can watch the game before they
 * have a folder to open; anyone with one can leave it running on a screen.
 */
export const DEMO = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');

/** How long player 1's cursor waits on the roster before sweeping, so the screen is seen first. */
export const DEMO_PICK_MS = 1600;
/** How long the VS screen shows the stage it drew before the fight. */
export const DEMO_STAGE_MS = 4200;
/** How long the match's end stays up, the winner's pose and the fatality's last, before the roster again. */
export const DEMO_END_MS = 5500;
