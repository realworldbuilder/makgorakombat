import { useEffect, useRef, useState } from 'preact/hooks';
import { CLASSIC_SCREEN_ASPECT, composeBackdrop } from '@mogshot/render/backdrop';
import type { LoadingScreen } from '@mogshot/worker/api';
import type { DataClient } from '@mogshot/worker/client';
import type { BuiltFighter } from './fighters';
import { BATTLEGROUND, LEVEL, music, stageCue } from './music';
import { sameStage, type StageKey } from './net/handshake';
import type { Link } from './net/relay';
import { facingRadians, type Ground, type Stage, STAGES, thumbnailUrl } from './stages';

/*
 * NEXT STAGE: online, when the host has drawn the ground at random, both machines show it for a
 * moment, the stage's picture and name with the two champions under it, while the world is raised
 * around the spot; then the fight. The guest's card waits on the host's word for which ground.
 */

/** How long the card stays up, at the least; a stage still rising keeps it up longer. */
export const NEXT_STAGE_MS = 3000;

interface NextStageProps {
  client: DataClient;
  fighters: [BuiltFighter, BuiltFighter];
  stages: Stage[];
  screens: LoadingScreen[];
  /** The ground the host drew; undefined while the guest waits for it. */
  ground: StageKey | undefined;
  onFight: (ground: Ground) => void;
  onBack: () => void;
  link: Link;
}

export function NextStage({ client, fighters, stages, screens, ground, onFight, onBack, link }: NextStageProps) {
  const stage = ground?.kind === 'stage' ? stages.find((s) => sameStage(ground, { kind: 'stage', slug: s.slug })) : undefined;
  const screen = ground?.kind === 'screen' ? screens.find((s) => s.id === ground.id) : undefined;
  // A stage the host has and this install cannot draw is still named and pictured; the fight stands on none.
  const named = stage ?? (ground?.kind === 'stage' ? STAGES.find((s) => s.slug === ground.slug) : undefined);
  const [picture, setPicture] = useState<string>();
  const fought = useRef(false);
  const fight = useRef(onFight);
  fight.current = onFight;

  // The ground is read while the card is up; the fight goes once both it and the three seconds are done.
  useEffect(() => {
    if (!ground) return;
    let stale = false;
    music.play(stage ? stageCue(stage) : BATTLEGROUND, LEVEL.versus);
    const shown = new Promise((resolve) => setTimeout(resolve, NEXT_STAGE_MS));
    const read: Promise<Ground> = stage
      ? client.place(stage.map, stage.x, stage.y, facingRadians(stage), stage.reach, stage.z).then(
          (place) => ({ stage, place }),
          (cause: unknown) => {
            console.warn(`${stage.name} could not be raised:`, cause);
            return {};
          },
        )
      : screen
        ? client.icon(screen.fileId).then(
            (image) => ({ screen, image }),
            () => ({ screen }),
          )
        : Promise.resolve({});
    if (screen) {
      void read.then((got) => {
        if (stale || !got.image) return;
        const drawn = composeBackdrop({ kind: 'screen', fileId: screen.fileId, blur: 0, vignette: 0 }, 384, 216, got.image, screen.wide ? undefined : CLASSIC_SCREEN_ASPECT);
        if (drawn instanceof HTMLCanvasElement) setPicture(drawn.toDataURL());
      });
    }
    void Promise.all([read, shown]).then(([got]) => {
      if (stale || fought.current) return;
      fought.current = true;
      fight.current(got);
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ground?.kind, stage, screen]);

  // Escape takes both players back to the roster, as on the VS screen.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return;
      event.preventDefault();
      link.send({ t: 'back' });
      onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [link, onBack]);

  const [a, b] = fighters;
  const name = named ? named.name : screen ? screen.name : ground ? 'NO GROUND' : '';
  const where = stage ? stage.where : named ? `${named.where} · not in your folder, so you fight on none` : screen ? 'Loading Screen' : ground ? 'The fight stands on nothing' : 'The host is choosing…';
  const src = named ? thumbnailUrl(named) : picture;
  return (
    <div class="screen next-stage">
      <div class="guide-backdrop">
        <div class="guide">
          <div class="body next-stage-card">
            <p class="label">NEXT STAGE</p>
            <div class="picture">{src && <img src={src} alt={name} />}</div>
            <p class="big">{name}</p>
            <p class="dim">{where}</p>
            <div class="names">
              <span>{a.champion.name}</span>
              <span class="vs">VS</span>
              <span>{b.champion.name}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
