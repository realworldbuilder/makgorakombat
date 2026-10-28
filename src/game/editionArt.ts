import { CLASSIC_SCREEN_ASPECT, composeBackdrop } from '@mogshot/render/backdrop';
import type { DataClient } from '@mogshot/worker/client';
import type { Edition } from './edition';

/*
 * The edition's art, read from the open install: one of its loading screens drawn full screen
 * behind CHOOSE YOUR CHAMPION, left out when the install has none of the files the edition names.
 */

export interface EditionArt {
  /** A loading screen of the game, cropped to the screen's shape. */
  backdrop?: string;
}

/** The first of `ids` the install has, read as a picture. */
async function firstImage(client: DataClient, ids: readonly number[]) {
  for (const fileId of ids) {
    const image = await client.icon(fileId).catch(() => undefined);
    if (image) return { fileId, image };
  }
  return undefined;
}

/** A canvas, on screen or off, as a URL an image or a CSS background can use. */
async function canvasUrl(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<string> {
  if (canvas instanceof HTMLCanvasElement) return canvas.toDataURL('image/jpeg', 0.88);
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 }));
}

export async function loadEditionArt(client: DataClient, edition: Edition): Promise<EditionArt> {
  const screen = await firstImage(client, edition.backdrops);
  const art: EditionArt = {};
  if (screen) {
    // A square file is a 4:3 screen of the original game, stretched; the newer ones are wide with bars.
    const square = screen.image.width === screen.image.height;
    const drawn = composeBackdrop({ kind: 'screen', fileId: screen.fileId, blur: 0, vignette: 0.55 }, 1920, 1080, screen.image, square ? CLASSIC_SCREEN_ASPECT : undefined);
    if (drawn) art.backdrop = await canvasUrl(drawn);
  }
  return art;
}
