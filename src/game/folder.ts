import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { BuildInfoEntry } from '@mogshot/casc/build-info';
import { InstallError, listProducts, type OpenStage } from '@mogshot/casc/storage';
import { recordsFromFolder } from '@mogshot/import/folder';
import type { ImportedRecord } from '@mogshot/import/record';
import { filesFromDroppedFolder } from '@mogshot/io/dropped-folder';
import { FileListSource, type PickedFile, pickedFiles } from '@mogshot/io/file-list-source';
import type { OpenResult } from '@mogshot/worker/api';
import { DataClient, DataError } from '@mogshot/worker/client';
import { playableProducts } from './edition';

/*
 * Opening the World of Warcraft folder: dropped onto the page (the whole page is the target)
 * or picked with the folder button. The same flow as Mogshot's page, kept here so the game's
 * title screen can show it its own way. A folder can hold several games (retail beside WoW
 * Forever, say); then the player is asked which to fight in before anything heavy is read,
 * and the files are kept so the select screen can switch to another.
 */

/** The game picked last time, offered first when a folder holds several. */
const PRODUCT_KEY = 'mk.product';

export function lastProduct(): string | undefined {
  try {
    return localStorage.getItem(PRODUCT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export const STAGE_TEXT: Record<OpenStage, string> = {
  config: 'Reading the build information…',
  index: 'Reading the archive index…',
  encoding: 'Reading the encoding table (about 160 MB)…',
  root: 'Reading the file list…',
  join: 'Matching file IDs to archives…',
};

export type Phase =
  | { kind: 'empty' }
  | { kind: 'opening'; message: string }
  | { kind: 'error'; message: string }
  /** The folder holds more than one game: which one. */
  | { kind: 'choose'; files: PickedFile[]; products: BuildInfoEntry[] }
  | { kind: 'ready'; opened: OpenResult; files: PickedFile[]; records: ImportedRecord[]; recordsError?: string };

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useFolder(data: DataClient) {
  const [phase, setPhase] = useState<Phase>({ kind: 'empty' });
  const [dragging, setDragging] = useState(false);
  const busy = useRef(false);

  const fail = (error: unknown) => {
    const install = error instanceof InstallError || (error instanceof DataError && error.install);
    setPhase({ kind: 'error', message: install ? messageOf(error) : `Something went wrong reading the folder: ${messageOf(error)}` });
  };

  const openFolder = useCallback(async (files: PickedFile[], product?: string) => {
    if (busy.current) return;
    busy.current = true;
    try {
      setPhase({ kind: 'opening', message: STAGE_TEXT.config });
      if (product === undefined) {
        const products = playableProducts(await listProducts(new FileListSource(files)));
        if (products.length > 1) {
          setPhase({ kind: 'choose', files, products });
          return;
        }
      } else {
        try {
          localStorage.setItem(PRODUCT_KEY, product);
        } catch {
          // A private window keeps no choice; the folder still opens.
        }
      }
      const opened = await data.open(files, product, (stage) => setPhase({ kind: 'opening', message: STAGE_TEXT[stage] }));
      const { records, error: recordsError } = await recordsFromFolder(files);
      setPhase({ kind: 'ready', opened, files, records, recordsError });
    } catch (error) {
      fail(error);
    } finally {
      busy.current = false;
    }
  }, [data]);

  useEffect(() => {
    const over = (event: DragEvent) => {
      event.preventDefault();
      setDragging(true);
    };
    const leave = () => setDragging(false);
    const drop = async (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      // The entry must be taken during the event; it is gone afterwards.
      const entry = event.dataTransfer?.items[0]?.webkitGetAsEntry();
      if (!entry?.isDirectory) {
        setPhase({ kind: 'error', message: 'Drop the World of Warcraft folder itself, not a file inside it.' });
        return;
      }
      try {
        setPhase({ kind: 'opening', message: STAGE_TEXT.config });
        await openFolder(await filesFromDroppedFolder(entry as FileSystemDirectoryEntry));
      } catch (error) {
        fail(error);
      }
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [openFolder]);

  const onPick = (input: HTMLInputElement) => {
    if (input.files && input.files.length > 0) void openFolder(pickedFiles(input.files));
    input.value = '';
  };

  /** The folder let go, for another: the title's drop again. Not while one is being opened. */
  const closeFolder = useCallback(() => {
    if (!busy.current) setPhase({ kind: 'empty' });
  }, []);

  return { phase, dragging, openFolder, onPick, closeFolder };
}
