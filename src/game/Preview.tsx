import { useEffect, useRef } from 'preact/hooks';
import { type Camera, CharacterRenderer, DEFAULT_CAMERA } from '@mogshot/render/renderer';
import type { BuiltFighter } from './fighters';

/*
 * One player's side of the select screen: the champion under the cursor, full size, idling in
 * its Ready stance and turning a little; a battle roar when the player locks in. In the middle
 * (the creator) it faces the player.
 */

interface PreviewProps {
  fighter: BuiltFighter | undefined;
  locked: boolean;
  side: 'left' | 'right' | 'middle';
}

const DEGREE = Math.PI / 180;

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

  useEffect(() => {
    const element = canvas.current!;
    renderer.current ??= new CharacterRenderer(element);
    const draw = renderer.current;
    let frame = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const current = fighterRef.current;
      if (!current) return;
      if (shown.current !== current) {
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
      const turned: Camera = { ...DEFAULT_CAMERA, yaw: (side === 'left' ? -28 : side === 'right' ? 28 : -8) * DEGREE + sway, pitch: 4 * DEGREE, fov: 28 * DEGREE };
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

  return <canvas class={`preview ${side}`} ref={canvas} />;
}
