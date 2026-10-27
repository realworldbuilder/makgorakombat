import type { DataClient } from '@mogshot/worker/client';
import { audioOut } from './sound';

/*
 * The interface's own sounds, the game's files by id: the character sheet opening and closing,
 * a bag opening and closing for the item picker, and an item picked up off the doll or put down
 * on it, by the item's ItemGroupSounds row as the game plays them. The kits behind them (839 and
 * 840, 862 and 863, and the groups' pick-up and put-down kits) were read from SoundKit and
 * SoundKitEntry on the classic beta on 26 Oct 2026; file ids do not change from one game to
 * the next, and an install without one simply stays quiet.
 */

export const SHEET_OPEN = 567507;
export const SHEET_CLOSE = 567433;
export const BAG_OPEN = 567461;
export const BAG_CLOSE = 567512;

/** ItemGroupSounds row → the file of its pick-up kit (Sound[0]) and its put-down kit (Sound[1]). */
const GROUPS: Record<number, [number, number]> = {
  7: [567565, 567571], 8: [567560, 567563], 9: [567554, 567569], 10: [567561, 567577], 11: [567550, 567572],
  12: [567576, 567566], 13: [567566, 567567], 14: [567542, 567551], 15: [567573, 567547], 16: [567546, 567570],
  17: [567555, 567557], 18: [567543, 567559], 19: [567545, 567548], 20: [567562, 567556], 21: [567544, 567549],
  22: [567564, 567575], 23: [567552, 567553], 24: [567568, 567574],
};

export const pickUpFile = (group: number | undefined): number | undefined => (group ? GROUPS[group]?.[0] : undefined);
export const putDownFile = (group: number | undefined): number | undefined => (group ? GROUPS[group]?.[1] : undefined);

/** The sheet's sounds at the kits' own volume; an item's are quieter, as theirs are. */
const SHEET_VOLUME = 0.75;
const ITEM_VOLUME = 0.5;

const buffers = new Map<number, Promise<AudioBuffer | undefined>>();

/** Play one of the game's sound files on the effects bus, read and decoded the first time; nothing before the page has sound, or for a file the install lacks. */
export function playFile(client: DataClient, fileId: number | undefined, volume = fileId === SHEET_OPEN || fileId === SHEET_CLOSE ? SHEET_VOLUME : ITEM_VOLUME): void {
  const out = audioOut();
  if (!out || !fileId) return;
  let buffer = buffers.get(fileId);
  if (!buffer) {
    buffer = client.file(fileId).then(
      (bytes) => (bytes && bytes.length > 0 ? out.context.decodeAudioData(bytes.slice().buffer as ArrayBuffer).catch(() => undefined) : undefined),
      () => undefined,
    );
    buffers.set(fileId, buffer);
  }
  void buffer.then((decoded) => {
    if (!decoded) return;
    const source = out.context.createBufferSource();
    source.buffer = decoded;
    const gain = out.context.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(out.effects);
    source.start();
  });
}
