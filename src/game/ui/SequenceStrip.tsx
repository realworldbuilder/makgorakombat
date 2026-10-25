import { directionOf, PENALTY_FRAMES, type SequenceToken, STEP_FRAMES } from '../../engine/fatalities';
import { actionLabel, type InputSource } from '../../engine/input';
import { FINISH_FRAMES } from '../../engine/stage';

/*
 * The fatality's key sequence, on the winner's side while FINISH THE MAK'GORA! runs, drawn as
 * the game draws a bar of buttons: the fatality's name in its colour, a slot per key (an arrow
 * for a direction the way the winner faces, the ability's own icon for an ability key, the
 * weapon's for the attack key) lit gold as the keys land, a ring wiping round the next slot for
 * its 1.5 s, every slot red through a wrong key's half second, and a cast bar for the finish.
 */

export interface SequenceView {
  winner: 0 | 1;
  facing: 1 | -1;
  name: string;
  /** 'r, g, b'. */
  colour: string;
  tokens: readonly SequenceToken[];
  progress: number;
  windowT: number;
  penaltyT: number;
  /** Frames into the finish. */
  phaseT: number;
  source: InputSource;
  /** Whose keys label the slots: the winner's own player's, or online this keyboard's player 1. */
  keys: 0 | 1;
}

export function SequenceStrip({ view, icons }: { view: SequenceView; icons: ReadonlyMap<string, string> }) {
  const wrong = view.penaltyT > 0;
  const left = Math.max(0, 1 - view.phaseT / FINISH_FRAMES);
  return (
    <div class={`sequence p${view.winner + 1} ${wrong ? 'wrong' : ''}`} style={{ '--fatality': `rgb(${view.colour})` }}>
      <div class="sequence-name">{view.name}</div>
      <div class="sequence-keys">
        {view.tokens.map((token, k) => {
          const lit = k < view.progress;
          const current = k === view.progress && !wrong;
          const fresh = lit && k === view.progress - 1 && view.windowT > STEP_FRAMES - 10;
          const direction = directionOf(token, view.facing);
          const icon = direction ? undefined : icons.get(token === 'attack' ? 'attack' : token);
          return (
            <div class={`seq-slot ${lit ? 'lit' : ''} ${current ? 'current' : ''} ${fresh ? 'fresh' : ''}`} key={k}>
              {direction ? (
                <svg class="arrow" viewBox="0 0 32 32" aria-hidden="true">
                  <path d={direction === 'left' ? 'M20 6 L8 16 L20 26 M8 16 H26' : 'M12 6 L24 16 L12 26 M24 16 H6'} />
                </svg>
              ) : icon ? (
                <img src={icon} alt="" draggable={false} />
              ) : null}
              {!direction && <span class="key">{actionLabel(view.keys, view.source, token as Exclude<SequenceToken, 'back' | 'forward'>)}</span>}
              {current && view.windowT > 0 && <span class="ring" style={{ '--t': view.windowT / STEP_FRAMES }} />}
              {wrong && <span class="penalty" style={{ '--t': view.penaltyT / PENALTY_FRAMES }} />}
            </div>
          );
        })}
      </div>
      <div class={`sequence-bar ${left < 0.35 ? 'late' : ''}`} style={{ '--fill': left }}>
        <span class="fill" />
        <span class="spark" />
        <span class="text">{(left * FINISH_FRAMES / 60).toFixed(1)}</span>
      </div>
    </div>
  );
}
