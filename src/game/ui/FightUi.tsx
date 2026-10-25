import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BRAND } from '../../engine/brand';
import { RULES } from '../../engine/rules';
import type { Ability } from '../../engine/abilities';
import type { Match } from '../../engine/engine';
import type { MoveTable, Weapon } from '../../engine/moves';
import { keyLabel } from '../../engine/input';
import { ROUNDS_TO_WIN } from '../../engine/stage';
import { type FighterView, fighterView } from '../../engine/view';
import type { BuiltFighter } from '../fighters';
import { headshotOf } from '../headshot';
import type { Source } from '../Select';
import { FightBar } from './FightBar';
import { SequenceStrip, type SequenceView } from './SequenceStrip';
import { Icons, type UiAssets } from './icons';
import { UnitFrame } from './UnitFrame';
import './ui.css';

/*
 * The game's interface over the fight, in the DOM: a unit frame for each champion at the top
 * with the clock between them, an action bar for each player along the bottom. It reads the
 * live match once a frame through `window.mk.match()`, which the fight screen exposes, so the
 * fight itself need not know it is there.
 */

export interface FightUiProps {
  fighters: [BuiltFighter, BuiltFighter];
  p2: Source;
  assets: UiAssets;
  /** Online: which fighter this machine plays. Its bar shows player 1's keys, the one played over the wire none. */
  me?: 0 | 1;
}

interface Frame {
  views: [FighterView, FighterView];
  seconds: number;
  round: number;
  phase: Match['phase'];
  weapons: [Weapon, Weapon];
  /** Each kit's abilities by id, for the tooltips. */
  specs: [Map<string, Ability>, Map<string, Ability>];
  /** The fatality's key sequence while the winner enters it. */
  sequence: SequenceView | undefined;
  /** The fatality is playing: the frames step aside for it. */
  cinematic: boolean;
  /** Each side's ability ids in slot order, for the sequence's icons. */
  kits: [string[], string[]];
  /** The rules the fight is fought under. */
  rules: Match['rules'];
}

/** Status effects whose icons are wanted before they appear. */
const EFFECT_NAMES = ['Stunned', 'Feared', 'Slowed', 'Shield', 'Evasion', 'Riposte', 'Interrupted'];

/** A player's rounds won as studs on the clock plate: gold when won, recessed until then. */
function Studs({ wins, side }: { wins: number; side: 0 | 1 }) {
  return (
    <div class={`studs p${side + 1}`}>
      {Array.from({ length: ROUNDS_TO_WIN }, (_, n) => (
        <span class={`stud ${n < wins ? 'won' : ''}`} key={n} />
      ))}
    </div>
  );
}

const specCache = new WeakMap<MoveTable, Map<string, Ability>>();
/** A kit's abilities by id, kept per table so the frame snapshot is cheap. */
function specsOf(table: MoveTable): Map<string, Ability> {
  let specs = specCache.get(table);
  if (!specs) specCache.set(table, (specs = new Map(table.kit.abilities.map((a) => [a.id, a]))));
  return specs;
}

/** What the sequence strip shows, during the finish while the winner enters the fatality's keys. */
function sequenceOf(match: Match, p2: Source, me: 0 | 1 | undefined): SequenceView | undefined {
  const s = match.sequence;
  const winner = match.roundWinner;
  if (match.phase !== 'finish' || !s || winner === undefined) return undefined;
  const spec = match.tables[winner].fatality.spec;
  return {
    winner,
    facing: match.fighters[winner].facing,
    name: spec.name,
    colour: spec.colour,
    tokens: spec.sequence,
    progress: s.progress,
    windowT: s.windowT,
    penaltyT: s.penaltyT,
    phaseT: match.phaseT,
    source: winner === 0 || me !== undefined ? 'keyboard' : p2,
    keys: me === undefined ? winner : 0,
  };
}

const liveMatch = (): Match | undefined => (window as unknown as { mk?: { match?: () => Match } }).mk?.match?.();

export function FightUi({ fighters, p2, assets, me }: FightUiProps) {
  const icons = useMemo(() => new Icons(assets), [assets]);
  const [frame, setFrame] = useState<Frame>();
  const [abilityIcons, setAbilityIcons] = useState<[Map<string, string>, Map<string, string>]>([new Map(), new Map()]);
  const [spellIcons, setSpellIcons] = useState<Map<string, string>>(new Map());
  const loaded = useRef(false);

  // Once a frame: a snapshot of each fighter.
  useEffect(() => {
    let handle = 0;
    const loop = () => {
      handle = requestAnimationFrame(loop);
      const match = liveMatch();
      if (!match) return;
      setFrame({
        views: [fighterView(match, 0), fighterView(match, 1)],
        seconds: Math.max(0, Math.ceil(match.timer / 60)),
        round: match.round,
        phase: match.phase,
        weapons: [match.tables[0].weapon, match.tables[1].weapon],
        specs: [specsOf(match.tables[0]), specsOf(match.tables[1])],
        sequence: sequenceOf(match, p2, me),
        cinematic: match.fatality !== undefined && (match.phase === 'fatality' || match.phase === 'ko'),
        kits: [match.tables[0].kit.abilities.map((a) => a.id), match.tables[1].kit.abilities.map((a) => a.id)],
        rules: match.rules,
      });
      if (!loaded.current) {
        loaded.current = true;
        void loadIcons(match);
      }
    };
    handle = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [icons]);

  /** Every picture the two kits can show, fetched together; the bar fills in as they arrive. */
  const loadIcons = async (match: Match) => {
    const byName = new Map<string, string>();
    const names = new Set<string>(EFFECT_NAMES);
    for (const table of match.tables) for (const ability of table.kit.abilities) names.add(ability.name);
    await Promise.all(
      [...names].map(async (name) => {
        const url = await icons.spell(name);
        if (url) byName.set(name, url);
      }),
    );
    setSpellIcons(new Map(byName));
    const sides = await Promise.all(
      ([0, 1] as const).map(async (i) => {
        const table = match.tables[i];
        const map = new Map<string, string>();
        for (const ability of table.kit.abilities) {
          const url = byName.get(ability.name) ?? icons.classIcon(table.kit.classKey);
          if (url) map.set(ability.id, url);
        }
        const mainHand = fighters[i].champion.gear.find(([slot]) => slot === 'mainHand')?.[1];
        const weapon = (await icons.item(mainHand)) ?? (await icons.spell(table.weapon.ranged ? 'Shoot' : 'Attack'));
        if (weapon) map.set('attack', weapon);
        return map;
      }),
    );
    setAbilityIcons([sides[0]!, sides[1]!]);
  };

  // The champion's own face, drawn from the model; the race's stock picture when it cannot be.
  const portraits = useMemo(
    () => [headshotOf(fighters[0]) ?? icons.portrait(fighters[0].champion), headshotOf(fighters[1]) ?? icons.portrait(fighters[1].champion)] as const,
    [icons, fighters],
  );

  if (!frame) return <div class="wowui" />;
  // The winner's icons by sequence key: the ability in each slot, the weapon for the attack key.
  const tokenIcons = (side: 0 | 1) => {
    const map = new Map<string, string>();
    frame.kits[side].forEach((id, n) => {
      const url = abilityIcons[side].get(id);
      if (url) map.set(`ability${n + 1}`, url);
    });
    const weapon = abilityIcons[side].get('attack');
    if (weapon) map.set('attack', weapon);
    return map;
  };
  const human: [boolean, boolean] = [true, me !== undefined || p2 !== 'cpu'];
  /** Whose keys a side's bar shows: its own player's, or online player 1's for this machine's fighter and none for the other. */
  const keysOf = (i: 0 | 1): 0 | 1 | null => (me === undefined ? i : i === me ? 0 : null);
  return (
    <div class={`wowui ${frame.cinematic ? 'cinematic' : ''}`}>
      {frame.sequence && <SequenceStrip view={frame.sequence} icons={tokenIcons(frame.sequence.winner)} />}
      <div class="top">
        <UnitFrame side={0} view={frame.views[0]} portrait={portraits[0]} effectIcons={spellIcons} spellIcons={spellIcons} />
        <div class="clock-plate">
          <Studs wins={frame.views[0].wins} side={0} />
          <div class="face">
            <div class={`clock ${frame.seconds <= 10 ? 'late' : ''}`}>{frame.seconds}</div>
            <div class="round">{BRAND.round(frame.round)}</div>
          </div>
          <Studs wins={frame.views[1].wins} side={1} />
        </div>
        <UnitFrame side={1} view={frame.views[1]} portrait={portraits[1]} effectIcons={spellIcons} spellIcons={spellIcons} />
      </div>
      {frame.phase === 'matchEnd' && (
        <div class="hint end">
          {me === 1 ? <>the host calls the rematch · <b>ESC</b> new champions</> : <><b>ENTER</b> rematch · <b>ESC</b> new champions</>}
        </div>
      )}
      <div class="bottom">
        {([0, 1] as const).map((i) => (
          <div class={`bar-stack p${i + 1}`} key={i}>
            <FightBar side={i} view={frame.views[i]} icons={abilityIcons[i]} specs={frame.specs[i]} weapon={frame.weapons[i]} keys={keysOf(i)} />
            {frame.phase === 'intro' && frame.round === 1 && (
              <div class="hint">
                {keysOf(i) === null ? (
                  'YOUR OPPONENT'
                ) : human[i] ? (
                  <>
                    {RULES[frame.rules].word} rules · <b>{keyLabel(keysOf(i)!, 'left')}</b> <b>{keyLabel(keysOf(i)!, 'right')}</b> move{frame.rules === 'kombat' ? ', back blocks, twice dashes' : ''} · <b>{keyLabel(keysOf(i)!, 'jump')}</b> jump · <b>{keyLabel(keysOf(i)!, 'attack')}</b> attack · hover or hold a key for what it does
                  </>
                ) : (
                  'COMPUTER'
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
