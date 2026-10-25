import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ClassEntry, Race } from '@mogshot/character/appearance';
import type { Image } from '@mogshot/formats/blp';
import type { LoadingScreen } from '@mogshot/worker/api';
import { DataClient } from '@mogshot/worker/client';
import { type Edition, editionOf, playableProducts } from './edition';
import { type EditionArt, loadEditionArt } from './editionArt';
import { Fight } from './Fight';
import { type BuiltFighter, Fighters } from './fighters';
import { messageOf, useFolder } from './folder';
import { LEVEL, music } from './music';
import { pictureUrl } from './pixels';
import { LEGENDS, legendTiles, type Tile } from './roster';
import { loadSaved, type SavedChampion, storeSaved } from './saved';
import { Select, type Source } from './Select';
import { Title } from './Title';
import { loadGameFonts } from './ui/fonts';
import { FightUi } from './ui/FightUi';
import { type Stage, stagesFor, type Ground } from './stages';
import { Versus } from './Versus';

/*
 * The screens: the title with the folder drop, CHOOSE YOUR CHAMPION, the VS screen with the
 * stage pick, and the fight. Everything the game knows about the open folder is loaded once
 * here and handed down, with the edition (edition.ts): which of the folder's games is open.
 */

type Screen =
  | { kind: 'select' }
  | { kind: 'versus'; fighters: [BuiltFighter, BuiltFighter] }
  | { kind: 'fight'; fighters: [BuiltFighter, BuiltFighter]; stage: Ground };

interface Loaded {
  edition: Edition;
  art: EditionArt;
  races: Race[];
  classes: ClassEntry[];
  portraits: { races: Map<string, string>; classes: Map<string, string> };
  screens: LoadingScreen[];
  /** The stages in the world this install can draw. */
  stages: Stage[];
  legends: Tile[];
  fighters: Fighters;
}

export function Game() {
  const client = useRef<DataClient>(null);
  client.current ??= new DataClient();
  const { phase, dragging, openFolder, onPick } = useFolder(client.current);
  const [loaded, setLoaded] = useState<Loaded>();
  const [loadError, setLoadError] = useState<string>();
  const [screen, setScreen] = useState<Screen>({ kind: 'select' });
  const [p2, setP2] = useState<Source>('cpu');
  // The champions made on CREATE YOUR CHAMPION, read from the browser once.
  const [saved, setSaved] = useState<SavedChampion[]>(() => loadSaved());
  const keepSaved = useCallback((list: SavedChampion[]) => {
    setSaved(list);
    if (!storeSaved(list)) console.warn('The browser would not keep the champions; they last for this visit.');
  }, []);
  // The title's CREATE YOUR CHAMPION was open when the folder was chosen: the roster opens on the question mark.
  const createNext = useRef(false);
  // A stable handler: Fight rebuilds the whole match when its props change, and dragging a file
  // across the window re-renders Game (the title's drop state), which must not restart a fight.
  const backToSelect = useCallback(() => setScreen({ kind: 'select' }), []);

  const openKey = phase.kind === 'ready' ? phase.opened.info.buildKey + phase.opened.info.product : undefined;
  useEffect(() => {
    setLoaded(undefined);
    setLoadError(undefined);
    setScreen({ kind: 'select' });
    if (openKey === undefined) return;
    let stale = false;
    const data = client.current!;
    const info = phase.kind === 'ready' ? phase.opened.info : undefined;
    const edition = editionOf(info?.product ?? '', info?.version ?? '');
    void (async () => {
      try {
        void loadGameFonts(data);
        const [races, classes, portraits, screens, looks, maps, art] = await Promise.all([
          data.races(),
          data.classList(),
          data.portraits().catch((cause: unknown) => {
            console.warn('The game\'s portraits could not be read:', cause);
            return { races: {}, classes: {}, problems: [] };
          }),
          data.backdrops().catch(() => [] as LoadingScreen[]),
          // The legends this folder can draw; a folder whose creature tables cannot be read just has none.
          data.creatureDisplays(LEGENDS.flatMap((legend) => legend.displays)).catch((cause: unknown) => {
            console.warn('The legends could not be looked up:', cause);
            return [];
          }),
          // Which maps are on disk, for the stages; an install whose map table cannot be read fights on loading screens.
          data.maps().catch((cause: unknown) => {
            console.warn('The maps could not be listed:', cause);
            return [];
          }),
          // The edition's logo and loading screen; a screen without them still plays.
          loadEditionArt(data, edition).catch((cause: unknown) => {
            console.warn('The edition\'s art could not be read:', cause);
            return {} as EditionArt;
          }),
        ]);
        if (stale) return;
        if (portraits.problems.length > 0) console.warn('Portraits:', portraits.problems.join('; '));
        const urls = (images: Record<string, Image>) => new Map(Object.entries(images).map(([key, image]) => [key, pictureUrl(image)]));
        setLoaded({
          edition,
          art,
          races,
          classes,
          portraits: { races: urls(portraits.races), classes: urls(portraits.classes) },
          screens,
          stages: stagesFor(maps.map((map) => map.id), edition.world),
          legends: legendTiles(LEGENDS, looks, races),
          fighters: new Fighters(data, classes),
        });
      } catch (cause) {
        if (!stale) setLoadError(messageOf(cause));
      }
    })();
    return () => {
      stale = true;
    };
  }, [openKey]);

  // The open game's login theme under CHOOSE YOUR CHAMPION; the VS screen and the fight play their stage's own.
  useEffect(() => {
    if (!loaded || openKey === undefined) return;
    music.use(client.current!, openKey);
    if (screen.kind === 'select') music.play(loaded.edition.title, LEVEL.select);
  }, [loaded, screen.kind]);

  // The folder's other games, for switching edition from the select screen.
  const others = useMemo(
    () => (phase.kind === 'ready' ? playableProducts(phase.opened.products).filter((entry) => entry.product !== phase.opened.info.product) : []),
    [phase],
  );
  const switchTo = (product: string) => {
    if (phase.kind === 'ready') void openFolder(phase.files, product);
  };

  const records = useMemo(() => (phase.kind === 'ready' ? phase.records : []), [phase]);

  useEffect(() => {
    document.body.classList.toggle('ingame', phase.kind === 'ready' && loaded !== undefined);
  }, [phase.kind, loaded]);

  const wantCreate = (yes: boolean) => {
    createNext.current = yes;
  };
  if (phase.kind === 'choose') return <Title phase={phase} dragging={dragging} onPick={onPick} onChoose={(product) => void openFolder(phase.files, product)} onCreate={wantCreate} />;
  if (phase.kind !== 'ready') return <Title phase={phase} dragging={dragging} onPick={onPick} onCreate={wantCreate} />;
  if (loadError) return <Title phase={{ kind: 'error', message: loadError }} dragging={false} onPick={onPick} onCreate={wantCreate} />;
  if (!loaded) return <Title phase={{ kind: 'opening', message: 'Summoning the roster…' }} dragging={false} onPick={onPick} onCreate={wantCreate} />;

  switch (screen.kind) {
    case 'select':
      return (
        <Select
          edition={loaded.edition}
          art={loaded.art}
          others={others}
          onEdition={switchTo}
          races={loaded.races}
          classes={loaded.classes}
          records={records}
          legends={loaded.legends}
          portraits={loaded.portraits}
          fighters={loaded.fighters}
          saved={saved}
          onSaved={keepSaved}
          startOnCreate={createNext.current}
          p2={p2}
          onP2={setP2}
          onReady={(fighters) => {
            createNext.current = false;
            setScreen({ kind: 'versus', fighters });
          }}
          onBack={() => location.reload()}
        />
      );
    case 'versus':
      return (
        <Versus
          client={client.current}
          fighters={screen.fighters}
          stages={loaded.stages}
          screens={loaded.screens}
          onFight={(ground) => setScreen({ kind: 'fight', fighters: screen.fighters, stage: ground })}
          onBack={() => setScreen({ kind: 'select' })}
        />
      );
    case 'fight':
      return (
        <>
          <Fight fighters={screen.fighters} stage={screen.stage} p2={p2} onBack={backToSelect} />
          <FightUi fighters={screen.fighters} p2={p2} assets={{ client: client.current, races: loaded.races, portraits: loaded.portraits }} />
        </>
      );
  }
}
