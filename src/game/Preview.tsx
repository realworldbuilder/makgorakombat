import { useEffect, useRef } from 'preact/hooks';
import { type Camera, CharacterRenderer, DEFAULT_CAMERA } from '@mogshot/render/renderer';
import { releaseRenderer } from './arena';
import type { BuiltFighter } from './fighters';

/*
 * One player's side of the select screen: the champion under the cursor, full size, idling in
 * its Ready stance and turning a little; a battle roar when the player locks in. In the middle
 * (the creator) it faces the player. As on the game's own character select, a drag across the
 * champion turns them round, and they keep turning a moment after letting go; a new champion
 * comes in facing the way the screen first had them (on the creator, a change of look keeps the turn).
 */

interface PreviewProps {
  fighter: BuiltFighter | undefined;
  locked: boolean;
  side: 'left' | 'right' | 'middle';
}

const DEGREE = Math.PI / 180;
/** How far a drag turns the champion: a full turn across about two thirds of a wide preview. */
const TURN_PER_PIXEL = 0.6 * DEGREE;
/** How much of the turn's speed is left after a second once the drag lets go. */
const GLIDE = 0.04;

export function Preview({ fighter, locked, side }: PreviewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<CharacterRenderer>(null);
  const shown = useRef<BuiltFighter>(null);
  // The roar plays once from when the lock happened, then the idle takes over.
  const lockedAt = useRef<number>(0);
  const lockedRef = useRef(locked);
  if (locked && !lockedRef.current) lockedAt.current = performance.now();
  lockedRef.current = locked;
  const fighterRef = useRef(fighter);
  fighterRef.current = fighter;
  // The turn the player gave by dragging, on top of the screen's own, and its speed after letting go.
  const spin = useRef({ yaw: 0, speed: 0, dragging: false, x: 0, at: 0 });

  useEffect(() => {
    const element = canvas.current!;
    renderer.current ??= new CharacterRenderer(element);
    const draw = renderer.current;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const step = Math.min(0.1, (now - last) / 1000);
      last = now;
      const turn = spin.current;
      if (!turn.dragging && turn.speed !== 0) {
        turn.yaw += turn.speed * step;
        turn.speed *= GLIDE ** step;
        if (Math.abs(turn.speed) < 0.05) turn.speed = 0;
      }
      const current = fighterRef.current;
      if (!current) return;
      if (shown.current !== current) {
        // On the creator the champion is the same one being dressed, so the turn stays.
        if (side !== 'middle') {
          turn.yaw = 0;
          turn.speed = 0;
        }
        shown.current = current;
        draw.setScene(current.result.scene);
        draw.holdFraming(current.result.scene.bounds);
      }
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(element.clientWidth * ratio));
      const height = Math.max(1, Math.round(element.clientHeight * ratio));
      if (element.width !== width || element.height !== height) {
        element.width = width;
        element.height = height;
      }
      const { moves } = current;
      const idle = moves.moves.idle.variations[0]!;
      const intro = moves.moves.intro.variations[0]!;
      const sinceLock = now - lockedAt.current;
      let sequence = idle.sequence;
      let time = idle.duration > 0 ? now % idle.duration : 0;
      if (lockedRef.current && sinceLock < intro.duration) {
        sequence = intro.sequence;
        time = sinceLock;
      }
      draw.setPose({ meshes: current.rig.pose(sequence, time), bounds: current.result.scene.bounds, pose: current.result.scene.pose });
      // Turned a little toward the middle of the screen, swaying as on character select.
      const sway = Math.sin(now / 2600) * 6 * DEGREE;
      const turned: Camera = { ...DEFAULT_CAMERA, yaw: (side === 'left' ? -28 : side === 'right' ? 28 : -8) * DEGREE + sway + turn.yaw, pitch: 4 * DEGREE, fov: 28 * DEGREE };
      // Aimed at the body's middle so the champion fills the height, whatever is held out in front.
      const { min, max } = current.result.scene.bounds;
      const tall = max[2] - min[2];
      const middle: [number, number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2] + tall * 0.5];
      const camera = draw.aimAt(turned, middle, tall * 0.56, width / height);
      draw.render(camera);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [side]);

  // The renderer's context goes with the canvas, so the next screen's do not push the browser past its few.
  useEffect(() => {
    const element = canvas.current!;
    return () => {
      if (renderer.current) releaseRenderer(renderer.current, element);
      renderer.current = null;
      shown.current = null;
    };
  }, []);

  const grab = (event: PointerEvent) => {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
    spin.current = { ...spin.current, dragging: true, speed: 0, x: event.clientX, at: event.timeStamp };
  };
  const drag = (event: PointerEvent) => {
    const turn = spin.current;
    if (!turn.dragging) return;
    // As if taking hold of them: a drag to the right carries the near side of the champion to the right.
    const by = (turn.x - event.clientX) * TURN_PER_PIXEL;
    const seconds = Math.max(0.001, (event.timeStamp - turn.at) / 1000);
    turn.yaw += by;
    // The speed the drag had just before letting go, smoothed so one jumpy event does not fling them.
    turn.speed = turn.speed * 0.5 + (by / seconds) * 0.5;
    turn.x = event.clientX;
    turn.at = event.timeStamp;
  };
  const release = (event: PointerEvent) => {
    const turn = spin.current;
    if (!turn.dragging) return;
    turn.dragging = false;
    // Held still before letting go: they stay where they were put.
    if (event.timeStamp - turn.at > 80) turn.speed = 0;
  };

  return <canvas class={`preview ${side}`} ref={canvas} onPointerDown={grab} onPointerMove={drag} onPointerUp={release} onPointerCancel={release} />;
}
