import { useEffect, useState } from 'preact/hooks';
import { soundSettings, toggleMusic, watchSound } from './sound';

/*
 * The music tab, beside the bug tab at the top of every screen that has music: a click, or P from
 * anywhere, turns the music off and on. Only the music: the fight's sounds and the call when a
 * match is found go on, which the mute (M) would silence too.
 */
export function MusicTab() {
  const [on, setOn] = useState(soundSettings().musicOn);
  useEffect(() => watchSound(() => setOn(soundSettings().musicOn)), []);

  return (
    <button
      class={`reporter-tab music-tab ${on ? '' : 'off'}`}
      type="button"
      onClick={(event) => {
        toggleMusic();
        // Off the button again, so a later Enter or Space is the screen's, not another flip.
        event.currentTarget.blur();
      }}
      aria-pressed={on}
      aria-label={on ? 'Music on (P)' : 'Music off (P)'}
    >
      <NoteGlyph off={!on} />
      <span class="wow-tooltip reporter-tip">
        <span class="line tt-name">{on ? 'Music' : 'Music off'}</span>
        <span class="line h-gold">{on ? 'Turn the music off; the fight and the match call still sound' : 'Turn the music back on'}</span>
        <span class="line h-grey">P</span>
      </span>
    </button>
  );
}

function NoteGlyph({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M9 17.5V5.2l10-2v11.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
      <ellipse cx="6.6" cy="17.6" rx="2.9" ry="2.3" fill="currentColor" />
      <ellipse cx="16.6" cy="15" rx="2.9" ry="2.3" fill="currentColor" />
      {off && <path d="M3.5 3.5l17 17" stroke="#1a0606" stroke-width="4" stroke-linecap="round" />}
      {off && <path d="M3.5 3.5l17 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />}
    </svg>
  );
}
