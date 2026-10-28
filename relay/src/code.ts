/*
 * Room codes. Kept out of index.ts, the Worker's main module, whose exports the runtime takes for
 * handlers and Durable Object classes: `wrangler dev` will not start on a main module that also
 * exports a string.
 */

/** Consonants only, so no code spells a word, and none of the ones that pass for a digit or each other (L, Y). */
export const ALPHABET = 'BCDFGHJKMNPQRSTVWXZ';
export const CODE_LENGTH = 6;

export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function isCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c));
}
