import type { DataClient } from '@mogshot/worker/client';

/*
 * The game's own typefaces, read from the open folder by file id and loaded into the page:
 * Friz Quadrata for every label and tooltip, Arial Narrow for the numbers on the bars, Morpheus
 * for the big titles, Skurri for the damage that floats off a blow. They are never shipped with the game; once read from a player's own
 * install they are kept in that browser, so the title screen has them on the next visit too.
 */

interface GameFont {
  family: string;
  fileId: number;
}

/** File ids are fixed across builds: the font cache in a Fonts folder of the game names them. */
export const GAME_FONTS: readonly GameFont[] = [
  { family: 'WoW Friz', fileId: 615960 },
  { family: 'WoW Narrow', fileId: 615958 },
  { family: 'WoW Morpheus', fileId: 615962 },
  { family: 'WoW Skurri', fileId: 615961 },
];

const STORE = 'mk.font:';
const loaded = new Set<string>();

/** Fonts kept from an earlier visit, loaded at once. */
export function restoreGameFonts(): void {
  for (const font of GAME_FONTS) {
    try {
      const stored = localStorage.getItem(STORE + font.fileId);
      if (stored) void add(font, fromBase64(stored));
    } catch {
      // No storage: the fonts arrive when a folder is opened.
    }
  }
}

/** Reads the fonts from the open folder; a font the install lacks is left to the fallback. */
export async function loadGameFonts(client: DataClient): Promise<void> {
  await Promise.all(
    GAME_FONTS.map(async (font) => {
      if (loaded.has(font.family)) return;
      const bytes = await client.file(font.fileId).catch(() => undefined);
      if (!bytes || !(await add(font, bytes))) return;
      try {
        localStorage.setItem(STORE + font.fileId, toBase64(bytes));
      } catch {
        // Full or disallowed: read again next visit.
      }
    }),
  );
}

async function add(font: GameFont, bytes: Uint8Array): Promise<boolean> {
  if (loaded.has(font.family)) return true;
  try {
    // One face for every weight, so bold text is not smeared into a fake bold the game never draws.
    const face = new FontFace(font.family, bytes.slice().buffer, { weight: '100 900' });
    await face.load();
    document.fonts.add(face);
    loaded.add(font.family);
    document.documentElement.classList.add('wow-fonts');
    return true;
  } catch (error) {
    console.warn(`The game's ${font.family} could not be loaded:`, error);
    return false;
  }
}

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
