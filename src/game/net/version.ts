/*
 * The version two players must share to fight online. Both machines run the fight themselves
 * and only the inputs cross, so the two engines must be the same tick for tick. It is made at
 * build time (vite.config.ts) as a fingerprint of src/engine and src/game/net, so it changes by
 * itself with every change that could make one build play a different fight from another, and a
 * page left open from before a deploy is refused with a message saying to reload, rather than
 * parting mid-fight on a DESYNC.
 */
export const VERSION: string = (import.meta.env.VITE_NET_VERSION as string | undefined) ?? 'dev';
