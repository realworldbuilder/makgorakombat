/*
 * Voice for a match, on Discord. The relay has a Discord bot in the game's own server: when one
 * of the two players in a room asks for voice, the room has the bot make a voice channel for the
 * two of them ("Chris vs Will", room for two and no more) and an invite to it, and hands both
 * players the invite. Opening it takes a player into Discord, into the server if they are not in
 * it yet, and into the channel. The room deletes the channel when it closes, and once an hour the
 * relay deletes any of its channels a closed room left behind.
 *
 * It needs the bot's token as the secret DISCORD_TOKEN and the server's id as DISCORD_GUILD, and
 * may be given a category to put the channels under as DISCORD_CATEGORY. Without the token and
 * the server, voice is off: GET /voice says so, and the game shows no VOICE tab.
 */

const API = 'https://discord.com/api/v10';
/** Discord's channel type for a voice channel. */
const GUILD_VOICE = 2;
/** Every channel the relay makes starts with this, so the hourly sweep touches no other. */
export const MARK = '⚔ ';
/** A channel of the relay's this old is a closed room's, whatever the room said: the sweep deletes it. */
export const STALE_MS = 12 * 60 * 60 * 1000;
/** Discord counts its ids from the start of 2015. */
const EPOCH = 1420070400000n;

export interface VoiceEnv {
  DISCORD_TOKEN?: string;
  DISCORD_GUILD?: string;
  DISCORD_CATEGORY?: string;
}

/** A match's voice channel and the invite to it, as the room keeps them. */
export interface Voice {
  channel: string;
  url: string;
}

/** Whether the relay has a bot and a server to make voice channels in. */
export function voiceOn(env: VoiceEnv): boolean {
  return Boolean(env.DISCORD_TOKEN && env.DISCORD_GUILD);
}

/** The channel's name: the two players, as the lobby knows them, under the relay's mark; the room's code for a room made by code. */
export function channelName(names: [string, string] | undefined, code: string): string {
  return names ? `${MARK}${names[0]} vs ${names[1]}` : `${MARK}Room ${code}`;
}

/** When Discord made the thing with this id. */
export function madeAt(id: string): number {
  return Number((BigInt(id) >> 22n) + EPOCH);
}

async function discord<T>(env: VoiceEnv, method: string, path: string, body?: object): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${env.DISCORD_TOKEN}`,
      'User-Agent': 'DiscordBot (https://github.com/realworldbuilder/makgorakombat, 1)',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Discord answered ${method} ${path} with ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** Makes a voice channel for two under `name` and an invite to it that lasts as long as the channel. */
export async function openVoice(env: VoiceEnv, name: string): Promise<Voice> {
  const channel = await discord<{ id: string }>(env, 'POST', `/guilds/${env.DISCORD_GUILD}/channels`, {
    name: name.slice(0, 100),
    type: GUILD_VOICE,
    user_limit: 2,
    ...(env.DISCORD_CATEGORY ? { parent_id: env.DISCORD_CATEGORY } : {}),
  });
  try {
    const invite = await discord<{ code: string }>(env, 'POST', `/channels/${channel.id}/invites`, { max_age: 0, max_uses: 0, unique: true });
    return { channel: channel.id, url: `https://discord.gg/${invite.code}` };
  } catch (cause) {
    // A channel nobody can be invited to is no use: it goes, and the asking page hears why.
    await closeVoice(env, channel.id).catch(() => undefined);
    throw cause;
  }
}

/** Deletes a match's channel; one already gone is fine. */
export async function closeVoice(env: VoiceEnv, channel: string): Promise<void> {
  try {
    await discord(env, 'DELETE', `/channels/${channel}`);
  } catch (cause) {
    if (!String(cause).includes(' 404:')) throw cause;
  }
}

/** The hourly sweep: deletes the relay's channels older than STALE_MS, which a closed room should have deleted. Answers how many went. */
export async function sweepVoice(env: VoiceEnv, now = Date.now()): Promise<number> {
  if (!voiceOn(env)) return 0;
  const channels = await discord<{ id: string; type: number; name: string; parent_id?: string | null }[]>(env, 'GET', `/guilds/${env.DISCORD_GUILD}/channels`);
  const stale = channels.filter(
    (c) => c.type === GUILD_VOICE && c.name.startsWith(MARK) && (!env.DISCORD_CATEGORY || c.parent_id === env.DISCORD_CATEGORY) && now - madeAt(c.id) >= STALE_MS,
  );
  for (const c of stale) await closeVoice(env, c.id);
  return stale.length;
}
