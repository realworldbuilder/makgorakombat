import type { FightSoundName, FightSoundSet, SoundKitClips } from '@mogshot/worker/api';
import { BRAND } from '../engine/brand';
import type { Fighter, Match, Projectile, Spark } from '../engine/engine';

/*
 * The fight's sound. The engine says nothing about sound, so the mixer watches the match from
 * the outside once a frame: a spark that was not there last frame is a hit, a fighter whose move
 * clock went back started a move, a banner that changed is a round event. Every clip is one of
 * the player's own game files (see Mogshot's character/sounds.ts for how each was chosen),
 * decoded once with WebAudio.
 *
 * Browsers keep audio silent until the page has seen a key or a click, so the AudioContext is
 * made on the first key press anywhere and nothing plays before it. M mutes.
 */

/** The page's one audio context, made on the first key press. */
let context: AudioContext | undefined;
let master: GainNode | undefined;
/** The music and the fight's effects each have a bus under the master, with their own level. */
let musicBus: GainNode | undefined;
let effectsBus: GainNode | undefined;
const listeners = new Set<() => void>();

/** The sound settings, remembered in the browser: the mute and a level for the music and for the effects, 0 to 1. */
export interface SoundSettings {
  muted: boolean;
  music: number;
  effects: number;
}

const SOUND_STORAGE = 'makgora.sound';
const settings: SoundSettings = { muted: false, music: 1, effects: 1 };
try {
  if (typeof localStorage !== 'undefined') {
    const saved = JSON.parse(localStorage.getItem(SOUND_STORAGE) ?? '{}') as Partial<SoundSettings>;
    if (typeof saved.muted === 'boolean') settings.muted = saved.muted;
    if (typeof saved.music === 'number') settings.music = Math.max(0, Math.min(1, saved.music));
    if (typeof saved.effects === 'number') settings.effects = Math.max(0, Math.min(1, saved.effects));
  }
} catch {
  // No storage: the defaults.
}

function remember(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SOUND_STORAGE, JSON.stringify(settings));
  } catch {
    // The choice then lasts for this visit.
  }
}

function unlock(): void {
  if (context) {
    if (context.state === 'suspended') void context.resume();
    return;
  }
  try {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = settings.muted ? 0 : 1;
    master.connect(context.destination);
    musicBus = context.createGain();
    musicBus.gain.value = settings.music;
    musicBus.connect(master);
    effectsBus = context.createGain();
    effectsBus.gain.value = settings.effects;
    effectsBus.connect(master);
  } catch (error) {
    console.warn('No audio:', error);
    return;
  }
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', unlock);
  window.addEventListener('pointerdown', unlock);
}

export function isMuted(): boolean {
  return settings.muted;
}

/** The settings as they stand. */
export function soundSettings(): Readonly<SoundSettings> {
  return settings;
}

/** Mute or unmute. */
export function setMuted(on: boolean): void {
  settings.muted = on;
  if (master && context) master.gain.setTargetAtTime(on ? 0 : 1, context.currentTime, 0.02);
  remember();
}

/** Flip the mute, and say whether sound is now off. */
export function toggleMute(): boolean {
  setMuted(!settings.muted);
  return settings.muted;
}

/** Set the music's or the effects' level, 0 to 1. */
export function setLevel(bus: 'music' | 'effects', level: number): void {
  const value = Math.max(0, Math.min(1, level));
  settings[bus] = value;
  const node = bus === 'music' ? musicBus : effectsBus;
  if (node && context) node.gain.setTargetAtTime(value, context.currentTime, 0.02);
  remember();
}

/** Is the audio context up, so that sounds can play? */
export function soundReady(): boolean {
  return context !== undefined;
}

/** The context and the buses (under the mute), once a key has made them: the master, and the music and effects buses below it. */
export function audioOut(): { context: AudioContext; master: GainNode; music: GainNode; effects: GainNode } | undefined {
  return context && master && musicBus && effectsBus ? { context, master, music: musicBus, effects: effectsBus } : undefined;
}

/** Call `listener` when the audio context comes up: at once if it is up already. */
export function whenAudio(listener: () => void): void {
  if (context) listener();
  else listeners.add(listener);
}

interface Decoded {
  kit: number;
  pitchVariation: [number, number];
  clips: { buffer: AudioBuffer; volume: number; weight: number }[];
}

/** One fighter's decoded sounds, by name. */
class Voice {
  private readonly decoded = new Map<number, Decoded>();
  /** Set once the clips are decoded; until then everything is silent. */
  ready = false;

  constructor(readonly set: FightSoundSet) {}

  async decode(ctx: AudioContext): Promise<void> {
    await Promise.all(
      Object.values(this.set.kits).map(async (kit: SoundKitClips) => {
        const clips: Decoded['clips'] = [];
        for (const clip of kit.clips) {
          try {
            // decodeAudioData takes the buffer, so each clip is copied out of the set.
            const buffer = await ctx.decodeAudioData(clip.bytes.slice().buffer as ArrayBuffer);
            clips.push({ buffer, volume: clip.volume, weight: clip.weight });
          } catch (error) {
            console.warn(`Sound file ${clip.fileId} did not decode:`, error);
          }
        }
        if (clips.length > 0) this.decoded.set(kit.kit, { kit: kit.kit, pitchVariation: kit.pitchVariation, clips });
      }),
    );
    this.ready = true;
  }

  pick(name: FightSoundName): Decoded | undefined {
    const kit = this.set.sounds[name];
    return kit === undefined ? undefined : this.decoded.get(kit);
  }
}

/** Where a fighter's sound seems to come from: left or right of centre, by stage x. */
const PAN = 0.6;

export class Mixer {
  private readonly voices: [Voice | undefined, Voice | undefined] = [undefined, undefined];
  private readonly seenSparks = new WeakSet<Spark>();
  private readonly seenProjectiles = new WeakSet<Projectile>();
  private lastProjectiles: Projectile[] = [];
  private last: [{ state: string; move: string; t: number } | undefined, { state: string; move: string; t: number } | undefined] = [undefined, undefined];
  private lastBanner: string | undefined;
  private lastMatch: Match | undefined;
  /** The fatality's beat and blows seen so far. */
  private lastBeat = -1;
  private lastHits = 0;
  private readonly onUnlock = () => void this.decodeAll();

  constructor() {
    listeners.add(this.onUnlock);
  }

  /** Give a side its sounds. `undefined` leaves it silent. */
  async load(side: 0 | 1, set: Promise<FightSoundSet | undefined>): Promise<void> {
    const loaded = await set;
    if (!loaded) return;
    const voice = new Voice(loaded);
    this.voices[side] = voice;
    if (context) await voice.decode(context);
  }

  private async decodeAll(): Promise<void> {
    if (!context) return;
    for (const voice of this.voices) if (voice && !voice.ready) await voice.decode(context);
  }

  dispose(): void {
    listeners.delete(this.onUnlock);
  }

  /** How many sounds have gone out: for the console and the headless check. */
  played = 0;

  /** What each side has loaded, for the console. */
  summary(): { side: number; kits: number; clips: number; bytes: number; problems: string[] }[] {
    return this.voices.flatMap((voice, side) => {
      if (!voice) return [];
      const kits = Object.values(voice.set.kits);
      return [{ side, kits: kits.length, clips: kits.reduce((n, k) => n + k.clips.length, 0), bytes: kits.reduce((n, k) => n + k.clips.reduce((m, c) => m + c.bytes.length, 0), 0), problems: voice.set.problems }];
    });
  }

  /** Play a side's sound, placed by `x` on the stage, `delay` seconds from now. */
  play(side: 0 | 1, name: FightSoundName, x = 0, delay = 0, gain = 1): void {
    const voice = this.voices[side];
    if (!context || !effectsBus || !voice?.ready) return;
    const sound = voice.pick(name);
    if (!sound) return;
    // Weighted choice among the kit's files, as the game does.
    const total = sound.clips.reduce((n, clip) => n + clip.weight, 0);
    let roll = Math.random() * total;
    let clip = sound.clips[0]!;
    for (const candidate of sound.clips) {
      roll -= candidate.weight;
      if (roll <= 0) {
        clip = candidate;
        break;
      }
    }
    const source = context.createBufferSource();
    source.buffer = clip.buffer;
    const [below, above] = sound.pitchVariation;
    source.playbackRate.value = 1 - below + Math.random() * (below + above);
    const volume = context.createGain();
    volume.gain.value = clip.volume * gain;
    const pan = context.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, (x / 5) * PAN));
    source.connect(volume).connect(pan).connect(effectsBus);
    source.start(context.currentTime + delay);
    this.played++;
  }

  /** Look at the match after this frame's ticks and play what changed. */
  observe(match: Match): void {
    if (match !== this.lastMatch) {
      // A new match: forget the old one's objects.
      this.lastMatch = match;
      this.lastProjectiles = [];
      this.last = [undefined, undefined];
      this.lastBanner = undefined;
      this.lastBeat = -1;
      this.lastHits = 0;
    }
    const [a, b] = match.fighters;

    // Round events, from the words on screen.
    const banner = match.banner?.text;
    if (banner !== undefined && banner !== this.lastBanner) {
      if (match.phase === 'intro') {
        this.play(0, 'gong');
        this.play(0, 'roar', a.x, 0.5);
        this.play(1, 'roar', b.x, 1.0);
      } else if (banner === BRAND.fight) {
        this.play(0, 'flagUp');
      } else if (banner === BRAND.ko || banner === BRAND.fatality) {
        this.play(0, 'flagDown', 0, 0.2);
        if (banner === BRAND.fatality) this.play(0, 'gong', 0, 0.6, 0.8);
      }
    }
    this.lastBanner = banner;

    // The fatality: a gong and the winner's roar as it begins, the loser's cry at each blow. The
    // winner's grunts come with each beat's move and the death cry with the death, through the paths below.
    const run = match.fatality;
    if (run && match.phase === 'fatality' && match.roundWinner !== undefined) {
      const winner = match.roundWinner;
      const loser = winner === 0 ? 1 : 0;
      if (this.lastBeat === -1) {
        this.play(0, 'gong', 0, 0, 0.6);
        this.play(winner, 'roar', match.fighters[winner].x, 0.1);
      }
      this.lastBeat = run.beat;
      if (run.hits !== this.lastHits) {
        const beat = match.tables[winner].fatality.spec.beats[run.beat];
        this.play(loser, beat?.impact === 'crit' ? 'injuryCrit' : 'injury', match.fighters[loser].x, 0.04);
        this.lastHits = run.hits;
      }
    } else {
      this.lastBeat = -1;
      this.lastHits = 0;
    }

    // Moves that started since last frame: a swing, a cry, a death.
    for (let i = 0 as 0 | 1; i < 2; i++) {
      const f = match.fighters[i];
      const was = this.last[i];
      const started = was === undefined ? false : f.move !== was.move || f.state !== was.state || f.t < was.t;
      if (started) this.onMove(match, i, f);
      this.last[i] = { state: f.state, move: f.move, t: f.t };
    }

    // Projectiles: new ones were cast, ones gone with a spark nearby landed.
    const sparks = match.sparks.filter((spark) => !this.seenSparks.has(spark));
    for (const spark of sparks) this.seenSparks.add(spark);
    for (const p of match.projectiles) {
      if (this.seenProjectiles.has(p)) continue;
      this.seenProjectiles.add(p);
      this.play(p.owner, 'cast', p.x);
    }
    for (const p of this.lastProjectiles) {
      if (match.projectiles.includes(p)) continue;
      const landed = sparks.findIndex((spark) => Math.abs(spark.x - p.x) < 1.2);
      if (landed < 0) continue;
      const spark = sparks.splice(landed, 1)[0]!;
      this.play(p.owner, 'impact', spark.x);
      if (spark.kind === 'block') this.play(this.attacker(match, p.owner), 'block', spark.x, 0.05);
    }
    this.lastProjectiles = [...match.projectiles];

    // Any spark left is a weapon landing: the attacker's weapon on the other's body. A parry rings
    // like a block; a spell that lands without flying sounds like its impact.
    for (const spark of sparks) {
      if (spark.kind === 'dot') continue;
      const attacker = this.attacker(match);
      if (spark.kind === 'spell') {
        this.play(attacker, 'cast', spark.x);
        this.play(attacker, 'impact', spark.x, 0.05);
        continue;
      }
      this.play(attacker, spark.kind === 'block' || spark.kind === 'parry' ? 'block' : spark.kind === 'crit' ? 'crit' : 'hit', spark.x);
    }
  }

  /** Who is swinging right now: the fighter in a swing or ability that has connected; else the one not being hit. */
  private attacker(match: Match, fallback: 0 | 1 = 0): 0 | 1 {
    const [a, b] = match.fighters;
    const swinging = (f: Fighter) => f.state === 'attack' || f.state === 'ability';
    if (swinging(a) && a.hitDone && !(swinging(b) && b.hitDone)) return 0;
    if (swinging(b) && b.hitDone && !(swinging(a) && a.hitDone)) return 1;
    if (swinging(a) && !swinging(b)) return 0;
    if (swinging(b) && !swinging(a)) return 1;
    if (a.state === 'hit' || a.state === 'knockdown' || a.state === 'death' || a.state === 'dazed' || a.state === 'stun' || a.state === 'dodge' || a.state === 'parry') return 1;
    if (b.state === 'hit' || b.state === 'knockdown' || b.state === 'death' || b.state === 'dazed' || b.state === 'stun' || b.state === 'dodge' || b.state === 'parry') return 0;
    return fallback;
  }

  private onMove(match: Match, i: 0 | 1, f: Fighter): void {
    switch (f.state) {
      case 'attack':
        // The auto-attack: a swing, or a shot's release.
        this.play(i, 'swing', f.x, 0.08);
        if (Math.random() < 0.4) this.play(i, 'exert', f.x);
        return;
      case 'ability': {
        const ability = match.tables[i].kit.abilities[f.ability];
        if (!ability) return;
        if (ability.kind === 'melee' || ability.kind === 'rush' || ability.kind === 'charge') {
          this.play(i, 'swingCrit', f.x, 0.1);
          this.play(i, 'exertCrit', f.x);
        } else if (ability.kind === 'bolt') {
          // The cast itself sounds when the bolt leaves the hand.
          this.play(i, 'exert', f.x);
        } else if (ability.kind === 'self' || ability.kind === 'blink' || ability.kind === 'leap') {
          this.play(i, 'exert', f.x, 0, 0.6);
        }
        return;
      }
      case 'cast':
      case 'dash':
        this.play(i, 'exert', f.x, 0, 0.7);
        return;
      case 'dodge':
        this.play(i, 'exert', f.x, 0, 0.5);
        return;
      case 'hit':
        this.play(i, f.move === 'crit' ? 'injuryCrit' : 'injury', f.x, 0.03);
        return;
      case 'stun':
        this.play(i, 'injuryCrit', f.x, 0.03);
        return;
      case 'knockdown':
        this.play(i, 'injuryCrit', f.x, 0.03);
        return;
      case 'death':
        this.play(i, 'death', f.x, 0.05);
        return;
      case 'win':
        this.play(i, 'cheer', f.x, 0.4);
        return;
      case 'finisher':
        this.play(i, 'exertCrit', f.x);
        return;
      default:
        if (match.phase === 'fight' && f.state === 'jump' && f.move === 'jumpStart') this.play(i, 'exert', f.x, 0, 0.5);
    }
  }
}
