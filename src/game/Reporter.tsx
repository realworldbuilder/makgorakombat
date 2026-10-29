import { useEffect, useRef, useState } from 'preact/hooks';
import type { Match } from '../engine/engine';
import { TICK_MS } from '../engine/stage';
import { feedbackOf, MAX_FEEDBACK, sendFeedback } from './feedback';
import { savedName } from './net/lobby';
import {
  currentWhere,
  issueBody,
  issueTitle,
  issueUrl,
  MAX_TEXT,
  type Moment,
  recentErrors,
  type Report,
  type ReportKind,
  setReporting,
} from './report';

/*
 * The Issue Reporter: the little bug tab pinned to the top of the screen, as the WoW Forever beta
 * pins its own, and F6 from anywhere. FEEDBACK is a few words and stars sent straight to us
 * through the relay (feedback.ts), no account needed, the same box the match-end screen offers.
 * REPORT A BUG or SUGGESTION, a few words and a description;
 * where the player is (screen, fighters, stage, the round, the build, the browser, the last
 * console errors) is attached for them. SEND opens GitHub's new-issue page filled in; COPY is for
 * a player without a GitHub account to paste it to us instead.
 */

const KEY = 'F6';

type Context = Omit<Report, 'kind' | 'title' | 'text'>;

/** Where the player is, read the moment the window opens: what they were looking at. */
function capture(): Context {
  const where = currentWhere();
  let moment: Moment | undefined;
  const match = (window as unknown as { mk?: { match: () => Match | undefined } }).mk?.match();
  if (where.screen === 'The fight' && match) {
    moment = {
      round: match.round,
      phase: match.phase,
      secondsLeft: Math.ceil((match.timer * TICK_MS) / 1000),
      health: [Math.round(match.fighters[0].hp), Math.round(match.fighters[1].hp)],
    };
  }
  return {
    where,
    moment,
    build: import.meta.env.VITE_BUILD ?? 'dev',
    page: location.href,
    browser: navigator.userAgent,
    window: `${innerWidth}×${innerHeight} at ${devicePixelRatio}x`,
    errors: [...recentErrors()],
  };
}

type Tab = ReportKind | 'feedback';

export function Reporter() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('feedback');
  const kind: ReportKind = tab === 'feedback' ? 'bug' : tab;
  const [rating, setRating] = useState<number>();
  const [said, setSaid] = useState<'sending' | 'thanks' | 'failed'>();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [context, setContext] = useState<Context>();
  const [done, setDone] = useState<'sent' | 'copied' | 'blocked' | 'feedback'>();
  const [link, setLink] = useState('');
  const titleInput = useRef<HTMLInputElement>(null);
  const wordInput = useRef<HTMLTextAreaElement>(null);

  const report = (): Report => ({ kind, title, text, ...(context ?? capture()) });

  const show = () => {
    setContext(capture());
    setDone(undefined);
    setOpen(true);
  };
  const hide = () => {
    setOpen(false);
    // A sent report starts the next one empty; one closed half-written keeps its words.
    if (done) {
      setTitle('');
      setText('');
      setRating(undefined);
      setDone(undefined);
    }
  };
  // FEEDBACK: straight to the relay with what is on screen; the window says whether it got there.
  const sendWord = () => {
    const where = (context ?? capture()).where;
    const fighters = where.fighters?.split(' vs ').map((f) => f.replace(/ \(.*$/, '').replace(/, player 2.*$/, ''));
    const message = feedbackOf(text, rating, {
      mode: 'menu',
      fighters: fighters?.length === 2 ? [fighters[0]!, fighters[1]!] : ['', ''],
      stage: where.stage,
      game: where.edition,
    }, { name: savedName() });
    if (!message) return;
    setSaid('sending');
    setDone('feedback');
    void sendFeedback(message).then((ok) => setSaid(ok ? 'thanks' : 'failed'));
  };
  const send = () => {
    if (tab === 'feedback') return sendWord();
    const url = issueUrl(report());
    setLink(url);
    // Without 'noopener', which would hand back nothing and hide a blocked tab; the opener is let go instead.
    const opened = window.open(url, '_blank');
    if (opened) opened.opener = null;
    setDone(opened ? 'sent' : 'blocked');
  };
  const copy = () => {
    const r = report();
    void navigator.clipboard.writeText(`${issueTitle(r)}\n\n${issueBody(r)}`).then(() => setDone('copied'));
  };

  useEffect(() => {
    setReporting(open);
    if (open) (tab === 'feedback' ? wordInput : titleInput).current?.focus();
  }, [open, tab]);

  // Listened for first, from the page's start: while the window is open no key reaches the game or
  // its menus, so typing a report does not throw a punch or close the roster. The keys still type.
  const keys = useRef({ open, show, hide, send });
  keys.current = { open, show, hide, send };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const now = keys.current;
      if (event.code === KEY) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (now.open) now.hide();
        else now.show();
        return;
      }
      if (!now.open) return;
      event.stopImmediatePropagation();
      if (event.code === 'Escape') now.hide();
      else if ((event.code === 'Enter' || event.code === 'NumpadEnter') && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        now.send();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const bug = tab === 'bug';
  const word = tab === 'feedback';
  const lines = context ? attached(context) : [];

  return (
    <>
      <button class="reporter-tab bug-tab" type="button" onClick={show} aria-label={`Feedback and bugs (${KEY})`}>
        <BugGlyph />
        <span class="reporter-word">FEEDBACK</span>
        <span class="wow-tooltip reporter-tip">
          <span class="line tt-name">Feedback &amp; Bugs</span>
          <span class="line h-gold">Tell us what you think, report a bug, or suggest an idea</span>
          <span class="line h-grey">{KEY}</span>
        </span>
      </button>
      {open && (
        <div class="guide-backdrop reporter-backdrop" onClick={hide}>
          <div class="guide reporter" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Report an issue">
            <nav class="tabs">
              <button type="button" class={word ? 'here' : ''} onClick={() => setTab('feedback')}>FEEDBACK</button>
              <button type="button" class={bug ? 'here' : ''} onClick={() => setTab('bug')}>REPORT A BUG</button>
              <button type="button" class={tab === 'idea' ? 'here' : ''} onClick={() => setTab('idea')}>SUGGESTION</button>
              <button class="close" onClick={hide} aria-label="Close" type="button">✕</button>
            </nav>
            {done ? (
              <div class="body done">
                <h3>{done === 'feedback' && said === 'sending' ? 'Sending…' : done === 'feedback' && said === 'failed' ? 'It did not get through' : 'Thank you!'}</h3>
                {done === 'feedback' && said === 'thanks' && <p>We have it. Every word is read.</p>}
                {done === 'feedback' && said === 'failed' && <p>The game could not reach us just now. Try again in a moment, or use REPORT A BUG, which goes through GitHub.</p>}
                {done === 'sent' && <p>GitHub opened in a new tab with your {bug ? 'report' : 'idea'} filled in. Press <b>Submit new issue</b> there and it reaches us.</p>}
                {done === 'blocked' && (
                  <p>
                    The browser kept the new tab from opening. <a href={link} target="_blank" rel="noopener">Open it here</a>, then press <b>Submit new issue</b>.
                  </p>
                )}
                {done === 'copied' && <p>It is on your clipboard, with where you were. Paste it to us wherever you like.</p>}
                <div class="actions">
                  <button type="button" class="button" onClick={hide}>BACK TO THE GAME</button>
                </div>
              </div>
            ) : word ? (
              <form
                class="body"
                onSubmit={(event) => {
                  event.preventDefault();
                  send();
                }}
              >
                <p class="dim small">What do you think of the game? A fight, a champion, the feel of it, anything. It comes straight to us; no account needed.</p>
                <span class="stars reporter-stars" role="radiogroup" aria-label="Rating, if you like">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      type="button"
                      key={n}
                      class={rating !== undefined && n <= rating ? 'on' : ''}
                      role="radio"
                      aria-checked={rating === n}
                      aria-label={`${n} of 5`}
                      onClick={() => setRating(rating === n ? undefined : n)}
                    >
                      ★
                    </button>
                  ))}
                </span>
                <textarea
                  ref={wordInput}
                  rows={6}
                  maxLength={MAX_FEEDBACK}
                  placeholder="Tell us anything."
                  value={text}
                  onInput={(event) => setText(event.currentTarget.value)}
                />
                <div class="count dim small">
                  {text.length} / {MAX_FEEDBACK}
                </div>
                <div class="actions">
                  <button type="submit" class="button primary" disabled={!text.trim()}>
                    SEND
                  </button>
                </div>
                <p class="dim small hint">
                  <b>Ctrl+Enter</b> sends · <b>Esc</b> closes
                </p>
              </form>
            ) : (
              <form
                class="body"
                onSubmit={(event) => {
                  event.preventDefault();
                  send();
                }}
              >
                <p class="dim small">
                  {bug
                    ? 'What went wrong, and what were you doing just before? Where you are in the game is attached for you.'
                    : 'What would make the game better? A move, a fighter, a stage, anything.'}
                </p>
                <input
                  ref={titleInput}
                  class="reporter-title"
                  type="text"
                  maxLength={120}
                  placeholder={bug ? 'In a few words: what broke?' : 'In a few words: your idea'}
                  value={title}
                  onInput={(event) => setTitle(event.currentTarget.value)}
                />
                <textarea
                  rows={7}
                  maxLength={MAX_TEXT}
                  placeholder={bug ? 'What happened, what you expected, and how to make it happen again.' : 'Tell us more.'}
                  value={text}
                  onInput={(event) => setText(event.currentTarget.value)}
                />
                <div class="count dim small">
                  {text.length} / {MAX_TEXT}
                </div>
                <details class="attached">
                  <summary>Attached for you</summary>
                  <ul>
                    {lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </details>
                <div class="actions">
                  <button type="button" class="button" onClick={copy}>COPY</button>
                  <button type="submit" class="button primary" disabled={!title.trim() && !text.trim()}>
                    SEND
                  </button>
                </div>
                <p class="dim small hint">
                  SEND opens the game's GitHub page in a new tab with this filled in · no GitHub account? COPY it and send it to us · <b>Ctrl+Enter</b> sends ·{' '}
                  <b>Esc</b> closes
                </p>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** The attached context, as the window lists it. */
function attached(context: Context): string[] {
  const { where, moment } = context;
  const lines = [`Screen: ${where.screen}`];
  if (where.fighters) lines.push(`Fighters: ${where.fighters}`);
  if (where.stage) lines.push(`Stage: ${where.stage}`);
  if (moment) lines.push(`Round ${moment.round}, ${moment.secondsLeft} s left, health ${moment.health[0]} / ${moment.health[1]}`);
  if (where.edition) lines.push(`Game: ${where.edition}`);
  lines.push(`Build: ${context.build}`, `Window: ${context.window}`);
  lines.push(context.errors.length > 0 ? `The last ${context.errors.length} console errors and warnings` : 'No console errors');
  return lines;
}

/** A bug, drawn: our own mark, not the game's art. */
function BugGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <path d="M10.6 4.6L8.6 2.2M13.4 4.6l2-2.4" />
        <path d="M7 11.2L3.2 9M6.8 14.6H2.6M7 18l-3.8 2.4M17 11.2L20.8 9M17.2 14.6h4.2M17 18l3.8 2.4" />
      </g>
      <circle cx="12" cy="7" r="2.7" fill="currentColor" />
      <ellipse cx="12" cy="15" rx="5.3" ry="6.3" fill="currentColor" />
      <path d="M12 9.6v11.4" stroke="#1a0606" stroke-width="1.3" />
    </svg>
  );
}
