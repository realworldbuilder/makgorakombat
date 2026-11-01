import { useEffect, useState } from 'preact/hooks';

/*
 * The fullscreen tab, just right of the bug tab at the top of every screen, the title's too: a click fills the whole
 * screen with the game, the browser's bars and the desktop gone, and a second click (or Escape,
 * the browser's own) gives the window back. The whole page goes fullscreen, not the fight's
 * canvas, so the tabs, the chat and every box over the screens come along. On a phone it also
 * asks to stay landscape. Where the browser cannot do it (an iPhone's Safari) there is no tab.
 */
export function FullscreenTab() {
  const [full, setFull] = useState(isFullscreen());
  useEffect(() => {
    const onChange = () => setFull(isFullscreen());
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  if (!canFullscreen()) return null;
  return (
    <button
      class={`reporter-tab fullscreen-tab ${full ? 'on' : ''}`}
      type="button"
      onClick={(event) => {
        toggleFullscreen();
        // Off the button again, so a later Enter or Space is the screen's, not another flip.
        event.currentTarget.blur();
      }}
      aria-pressed={full}
      aria-label={full ? 'Leave fullscreen' : 'Fullscreen'}
    >
      <CornersGlyph full={full} />
      <span class="wow-tooltip reporter-tip">
        <span class="line tt-name">Fullscreen</span>
        <span class="line h-gold">{full ? 'Give the window back' : 'Fill the whole screen with the game'}</span>
        {full && <span class="line h-grey">Esc</span>}
      </span>
    </button>
  );
}

function canFullscreen(): boolean {
  return typeof document !== 'undefined' && document.fullscreenEnabled === true;
}

function isFullscreen(): boolean {
  return typeof document !== 'undefined' && document.fullscreenElement !== null && document.fullscreenElement !== undefined;
}

/** Into fullscreen, landscape where a phone lets the page choose; or out of it. */
export async function toggleFullscreen(): Promise<void> {
  try {
    if (isFullscreen()) {
      await document.exitFullscreen();
      return;
    }
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    // Only phones and tablets lock, and only in fullscreen; a desktop says no, which is fine.
    const orientation = screen.orientation as ScreenOrientation & { lock?: (to: string) => Promise<void> };
    await orientation.lock?.('landscape').catch(() => {});
  } catch {
    // Refused (no click behind it, or a frame that does not allow it): the window stays as it is.
  }
}

function CornersGlyph({ full }: { full: boolean }) {
  // Four corners pointing out to go fullscreen, pointing in to leave it.
  const d = full
    ? 'M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5'
    : 'M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5';
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}
