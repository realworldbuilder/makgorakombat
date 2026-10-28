/*
 * BOOBY BAY's dress over every screen of a match in the bay (bay.ts): hearts and bubbles rising
 * from the bottom of the screen as if from the surf, a warm sunset glow at the edges, and the
 * bay's name in the corner. It takes no clicks and no keys; the screens under it work as ever.
 */

/** A rising thing: what it is, where across the screen, how big, how long it takes and when it starts. */
interface Float {
  glyph: string;
  left: number;
  size: number;
  seconds: number;
  delay: number;
  drift: number;
}

/** The same scatter every time, so the dress does not jump about when a screen changes. */
function scatter(count: number): Float[] {
  let seed = 0x0b00b5;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return Array.from({ length: count }, (_, i) => ({
    glyph: i % 3 === 2 ? '○' : '♥',
    left: next() * 100,
    size: 14 + next() * 26,
    seconds: 7 + next() * 7,
    delay: -next() * 14,
    drift: (next() - 0.5) * 80,
  }));
}

const FLOATS = scatter(22);

/** `quiet` in a fight: fewer and fainter, so nothing stands in front of the fighters for long. */
export function BayDress({ quiet = false }: { quiet?: boolean }) {
  const floats = quiet ? FLOATS.filter((_, i) => i % 2 === 0) : FLOATS;
  return (
    <div class={`bay-dress ${quiet ? 'quiet' : ''}`} aria-hidden="true">
      <div class="bay-glow" />
      {floats.map((float, i) => (
        <span
          key={i}
          class={`bay-float ${float.glyph === '○' ? 'bubble' : 'heart'}`}
          style={{
            left: `${float.left}%`,
            fontSize: `${float.size}px`,
            animationDuration: `${float.seconds}s`,
            animationDelay: `${float.delay}s`,
            '--drift': `${float.drift}px`,
          }}
        >
          {float.glyph}
        </span>
      ))}
      <div class="bay-mark">
        <span class="heart">♥</span> BOOBY BAY <span class="heart">♥</span>
      </div>
    </div>
  );
}
