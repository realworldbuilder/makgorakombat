import type { DataClient } from '@mogshot/worker/client';
import { audioOut, whenAudio } from './sound';
import type { Stage } from './stages';

/*
 * The music: the game's own tracks, read from the open folder by file id like everything else.
 * CHOOSE YOUR CHAMPION has the open game's login theme (edition.ts); the VS screen plays the music of the stage
 * under the cursor, as the game plays it in that zone; the fight keeps that music on underneath,
 * lower, and lower still while a fatality plays.
 *
 * A stage's tracks are its zone's ZoneMusic kit, found once in the game's tables (AreaTable's
 * ZoneMusic, ZoneMusic.Sounds, SoundKitEntry) and kept here by file id, since the page has no
 * tables of its own to ask. Each cue lists its files in groups: the files the game plays now
 * first, then the original 2004 files the same music shipped as. The first group the install
 * has any file of is the playlist; its tracks follow one another in a shuffled order.
 *
 * Tracks are streamed through an audio element into the fight sound's master gain, so M mutes
 * both, and nothing plays until the page has seen a key or a click.
 */

export interface Cue {
  key: string;
  /** Alternatives, best first: the first group with a file on disk is played. */
  groups: readonly (readonly number[])[];
}

/** The battlegrounds' music, for a fight before a loading screen. */
export const BATTLEGROUND: Cue = { key: 'battleground', groups: [[53684, 53685, 53686, 53687, 53688]] };

/** Each stage's zone music, by the stage's slug. */
const ZONES: Record<string, Cue> = {
  // Gurubashi Arena has none of its own, so it is Stranglethorn's: Zone-Jungle.
  gurubashi: { key: 'jungle', groups: [[8181259, 8181261, 8181263, 8181265, 8181267, 8181269], [53541, 53542, 53543, 53544, 53545, 53546]] },
  // Zone-Crossroads: Orgrimmar's two zone tracks, a dry Barrens day and Thunder Bluff's walk. Classic's kit
  // also lists the original orgrimmar02-zone, left out here since its own copy of it is in the first group.
  crossroads: { key: 'crossroads', groups: [[8181033, 8181037, 8181053, 8181001], [53198, 53200, 53301, 53215]] },
  // The Valley of Heroes is Stormwind's: Zone-Stormwind.
  'valley-of-heroes': { key: 'stormwind', groups: [[8180866, 8180868, 8180870, 8180872, 8180874, 8180876, 8180878, 8180880], [53205, 53206, 53207, 53208, 53209]] },
  // Goldshire is Elwynn's: Zone-Forest.
  goldshire: { key: 'forest', groups: [[8180778, 8180780, 8180782], [53492, 53493, 53494]] },
  darnassus: { key: 'darnassus', groups: [[8180752, 8180754, 8180756], [53184, 53185, 53186]] },
  'thunder-bluff': { key: 'thunder-bluff', groups: [[8180997, 8180999, 8181001], [53213, 53214, 53215]] },
  // The Maul has none of its own; Dire Maul's is Zone-EnchantedForest.
  'the-maul': { key: 'enchanted-forest', groups: [[8180792, 8180784, 8180790, 8180786, 8180788], [53457, 53453, 53456, 53454, 53455]] },
  'obsidian-sanctum': { key: 'chamber-of-aspects', groups: [[229783, 229784, 229785, 229786, 229787, 229788, 229789, 229790, 229791, 229792, 229794]] },
  zangarmarsh: { key: 'zangarmarsh', groups: [[53819, 53820, 53821, 53822, 53823, 53824]] },
  // The Frozen Throne's area has none, so it is the citadel's: Zone-IcecrownDungeon.
  'frozen-throne': { key: 'icecrown-citadel', groups: [[349988, 350067, 350027, 350034, 350040, 350051, 349991, 350005]] },
};

/** The music for a fight's ground: the stage's zone, else the battlegrounds'. */
export function stageCue(stage: Stage | undefined): Cue {
  return (stage && ZONES[stage.slug]) ?? BATTLEGROUND;
}

/** How loud the music sits under each screen: well under the fight's own sounds while fighting. */
export const LEVEL = { select: 0.5, versus: 0.5, fight: 0.22, fatality: 0.07 } as const;

/** Seconds for one track to fade into another, and for a level to settle. */
const CROSSFADE = 1.6;
const SETTLE = 0.35;

interface Playing {
  cue: Cue;
  audio: HTMLAudioElement;
  gain: GainNode;
  source: MediaElementAudioSourceNode;
}

export class Music {
  private client: DataClient | undefined;
  /** Which open folder and product the tracks were read from. */
  private opened: string | undefined;
  private wanted: { cue: Cue; level: number } | undefined;
  private playing: Playing | undefined;
  /** Bumped by every change of cue, so a track still loading for an old one is dropped. */
  private generation = 0;
  private readonly urls = new Map<number, Promise<string | undefined>>();
  /** Each cue's playlist: the group being played, its files left in shuffled order, and where it has got to. */
  private readonly lists = new Map<string, { group: number; files: number[]; next: number }>();

  constructor() {
    whenAudio(() => {
      if (this.wanted) this.start(this.wanted.cue);
    });
  }

  /** The open folder to read tracks from, `opened` naming the folder and product; another forgets the old one's. */
  use(client: DataClient, opened: string): void {
    if (client === this.client && opened === this.opened) return;
    this.client = client;
    this.opened = opened;
    for (const url of this.urls.values()) void url.then((u) => u && URL.revokeObjectURL(u));
    this.urls.clear();
    this.lists.clear();
  }

  /** Play `cue` at `level`: a different cue fades in over the one playing; the same one only changes level. */
  play(cue: Cue, level: number): void {
    const same = this.wanted?.cue.key === cue.key;
    this.wanted = { cue, level };
    if (same) {
      this.level(level);
      return;
    }
    this.start(cue);
  }

  /** Move the music playing to `level`. */
  level(level: number): void {
    if (this.wanted) this.wanted.level = level;
    const out = audioOut();
    if (out && this.playing) this.playing.gain.gain.setTargetAtTime(level, out.context.currentTime, SETTLE);
  }

  stop(): void {
    this.wanted = undefined;
    this.generation++;
    this.fadeOut();
  }

  /** What is playing, for the console. */
  now(): { cue: string; src: string; time: number; level: number } | undefined {
    const p = this.playing;
    return p && { cue: p.cue.key, src: p.audio.dataset.file ?? '', time: p.audio.currentTime, level: this.wanted?.level ?? 0 };
  }

  private start(cue: Cue): void {
    const generation = ++this.generation;
    void this.next(cue).then((file) => {
      if (generation !== this.generation || !file) return;
      this.begin(cue, file.id, file.url);
    });
  }

  /**
   * The next track of a cue, round its group's shuffled playlist. Files are read as they come up:
   * one the install lacks is dropped from the list, and a group with none left gives way to the next.
   */
  private async next(cue: Cue): Promise<{ id: number; url: string } | undefined> {
    let list = this.lists.get(cue.key);
    if (!list) this.lists.set(cue.key, (list = { group: 0, files: shuffle([...(cue.groups[0] ?? [])]), next: 0 }));
    while (list.group < cue.groups.length) {
      while (list.files.length > 0) {
        const at = list.next % list.files.length;
        const id = list.files[at]!;
        const url = await this.url(id);
        if (url) {
          list.next = at + 1;
          return { id, url };
        }
        list.files.splice(at, 1);
      }
      list.group++;
      list.files = shuffle([...(cue.groups[list.group] ?? [])]);
      list.next = 0;
    }
    return undefined;
  }

  /** A track as a page-local URL, read once from the folder; undefined when the install has no such file. */
  private url(id: number): Promise<string | undefined> {
    let url = this.urls.get(id);
    if (!url) {
      const client = this.client;
      url = client
        ? client.file(id).then(
            (bytes) => (bytes && bytes.length > 0 ? URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: isOgg(bytes) ? 'audio/ogg' : 'audio/mpeg' })) : undefined),
            () => undefined,
          )
        : Promise.resolve(undefined);
      this.urls.set(id, url);
    }
    return url;
  }

  private begin(cue: Cue, id: number, url: string): void {
    const out = audioOut();
    if (!out) return;
    this.fadeOut();
    const audio = new Audio(url);
    audio.dataset.file = String(id);
    const source = out.context.createMediaElementSource(audio);
    const gain = out.context.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(out.music);
    const playing: Playing = { cue, audio, gain, source };
    this.playing = playing;
    gain.gain.setTargetAtTime(this.wanted?.level ?? 0, out.context.currentTime, CROSSFADE / 3);
    // One track over, the next of the same cue.
    audio.addEventListener('ended', () => {
      if (this.playing === playing && this.wanted?.cue.key === cue.key) this.start(cue);
    });
    audio.play().catch((cause: unknown) => console.warn(`Music file ${id} would not play:`, cause));
  }

  private fadeOut(): void {
    const old = this.playing;
    this.playing = undefined;
    const out = audioOut();
    if (!old || !out) return;
    old.gain.gain.setTargetAtTime(0, out.context.currentTime, CROSSFADE / 3);
    setTimeout(() => {
      old.audio.pause();
      old.source.disconnect();
      old.gain.disconnect();
    }, CROSSFADE * 1000 * 1.5);
  }
}

function isOgg(bytes: Uint8Array): boolean {
  return bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/** The page's one music player. */
export const music = new Music();

// For scripts and the console: what is playing.
if (typeof window !== 'undefined') (window as unknown as { mkMusic?: () => unknown }).mkMusic = () => music.now();
