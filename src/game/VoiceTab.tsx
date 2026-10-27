import { useEffect, useState } from 'preact/hooks';
import { type Link, voiceOffered } from './net/relay';

/*
 * The voice tab, right of the music tab while this page is in an online match and the relay has a
 * Discord bot (relay/src/voice.ts). A click, or V from anywhere but a text box, opens the match's
 * own voice channel on Discord in a new tab: the first of the two to ask has the bot make it ("Chris
 * vs Will", room for two), and the other's tab lights up with the same invite. Discord takes it
 * from there: into the server for one who is not in it yet, and into the channel.
 */

/** The key that opens the match's voice; no screen uses it for anything else. */
export const VOICE_KEY = 'KeyV';

type State = { kind: 'idle' } | { kind: 'opening' } | { kind: 'open'; url: string } | { kind: 'called'; url: string } | { kind: 'error'; message: string };

export function VoiceTab({ link, them }: { link: Link; them?: string }) {
  const [on, setOn] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });

  useEffect(() => {
    let live = true;
    void voiceOffered().then((yes) => live && setOn(yes));
    return () => {
      live = false;
    };
  }, []);

  // The other player opened it: the same invite, lit up here until this page opens it too.
  useEffect(
    () =>
      link.listen((message) => {
        if (message.t === 'voice') setState((now) => (now.kind === 'open' ? now : { kind: 'called', url: message.url }));
      }),
    [link],
  );

  const open = () => {
    if (state.kind === 'opening') return;
    if (state.kind === 'open' || state.kind === 'called') {
      // Asked anyway, so the room tells the other player this one is coming.
      void link.voice().catch(() => undefined);
      window.open(state.url, '_blank', 'noopener');
      setState({ kind: 'open', url: state.url });
      return;
    }
    // The tab opens on the click itself, so no popup blocker takes it, and goes to Discord once the invite is back.
    const tab = window.open('', '_blank');
    setState({ kind: 'opening' });
    link.voice().then(
      (url) => {
        if (tab) {
          tab.opener = null;
          tab.location.href = url;
        } else window.open(url, '_blank', 'noopener');
        setState({ kind: 'open', url });
      },
      (error: unknown) => {
        tab?.close();
        setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      },
    );
  };

  useEffect(() => {
    if (!on) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== VOICE_KEY || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (target instanceof HTMLElement && target.isContentEditable) return;
      open();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!on || link.closed) return null;
  const who = them ?? 'Your opponent';
  const tip = {
    idle: ['Voice', `Talk to ${them ?? 'your opponent'} on Discord: opens a voice channel for the two of you`],
    opening: ['Voice', 'Opening the channel on Discord…'],
    open: ['Voice', 'Back to the match’s channel on Discord'],
    called: [`${who} is on voice`, 'Join them in the match’s channel on Discord'],
    error: ['Voice', state.kind === 'error' ? state.message : ''],
  }[state.kind];

  return (
    <button
      class={`reporter-tab voice-tab ${state.kind}`}
      type="button"
      onClick={(event) => {
        open();
        event.currentTarget.blur();
      }}
      aria-label={`${tip[0]} (V)`}
    >
      <MicGlyph />
      <span class="wow-tooltip reporter-tip">
        <span class="line tt-name">{tip[0]}</span>
        <span class={`line ${state.kind === 'error' ? 'h-red' : 'h-gold'}`}>{tip[1]}</span>
        <span class="line h-grey">V</span>
      </span>
    </button>
  );
}

function MicGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="currentColor" />
      <path d="M5 11.5a7 7 0 0 0 14 0M12 18.5v3M8.5 21.5h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
  );
}
