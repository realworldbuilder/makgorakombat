import { ABILITY_SLOTS } from './abilities';
import { abilityBlocked, type Inputs, type Match, nextRandom, noInputs } from './engine';
import { directionOf } from './fatalities';
import { FINISH_FRAMES, HALF } from './stage';

/** Past this share of the finish window the CPU gives up on the sequence and ends it plainly. */
const SEQUENCE_UNTIL = 0.72;
/** The chance the CPU fumbles a key once per finish. */
const FUMBLE = 0.35;

/** How often the CPU makes up its mind, in frames; it holds its inputs in between. */
export const CPU_DECIDE_FRAMES = 8;

/**
 * The CPU player's inputs for this tick. Decides every CPU_DECIDE_FRAMES frames from `match.rng`
 * alone, so the same seed and the same match give the same play. Call it once per tick, before `tick`.
 */
export function cpuInputs(match: Match, me: 0 | 1): Inputs {
  const memory = match.cpu[me];
  if (match.frame < memory.next) {
    // Presses are edge-triggered: only the decision tick carries them. The attack key stays held.
    return { ...memory.held, jump: false, abilities: [false, false, false] };
  }
  const decision = decide(match, me);
  memory.held = decision;
  memory.next = match.frame + CPU_DECIDE_FRAMES;
  return { ...decision, abilities: [...decision.abilities] };
}

/** Does this kit fight from a distance? Two or more spells or bolts, or a ranged weapon. */
function isCaster(match: Match, me: 0 | 1): boolean {
  const table = match.tables[me];
  if (table.weapon.ranged) return true;
  return table.kit.abilities.filter((a) => a.kind === 'bolt' || a.kind === 'spell').length >= 2;
}

function decide(match: Match, me: 0 | 1): Inputs {
  const out = noInputs();
  const f = match.fighters[me];
  const opp = match.fighters[me === 0 ? 1 : 0];
  const table = match.tables[me];
  const kit = table.kit;
  const toward: 1 | -1 = opp.x >= f.x ? 1 : -1;
  const dist = Math.abs(opp.x - f.x);
  const walkIn = () => {
    if (toward > 0) out.right = true;
    else out.left = true;
  };
  const backOff = () => {
    if (toward > 0) out.left = true;
    else out.right = true;
  };
  const cornered = Math.abs(f.x) > HALF - 0.6 && toward * f.x < 0;
  const press = (n: number) => {
    out.abilities[n] = true;
  };
  /** Abilities that would go right now, by index. */
  const usable = (): number[] => {
    const list: number[] = [];
    for (let n = 0; n < ABILITY_SLOTS; n++) {
      const a = kit.abilities[n]!;
      if (a.gcd && f.gcd > 0) continue;
      if (abilityBlocked(match, me, n)) continue;
      list.push(n);
    }
    return list;
  };

  if (match.phase !== 'fight' && match.phase !== 'finish') return out;
  if (f.state === 'death' || f.state === 'dazed' || f.state === 'knockdown' || f.state === 'stun' || f.state === 'fear' || f.state === 'dash') return out;
  // Let a cast finish.
  if (f.state === 'cast') return out;

  // The finish: enter the class fatality's sequence, one key per decision with a rest between so each
  // is its own press, fumbling one key now and then; late in the window, or after too many
  // fumbles, close in and end it with an ability or, failing that, a plain blow.
  if (match.phase === 'finish') {
    if (opp.state !== 'dazed') return out;
    const s = match.sequence;
    if (s && match.roundWinner === me && match.phaseT < FINISH_FRAMES * SEQUENCE_UNTIL) {
      const previous = match.cpu[me].held;
      if (previous.left || previous.right || previous.attack || previous.abilities.some(Boolean)) return out;
      if (s.penaltyT > 0) return out;
      const sequence = table.fatality.spec.sequence;
      let token = sequence[s.progress]!;
      if (s.fails === 0 && s.progress === 1 && nextRandom(match) < FUMBLE) token = sequence.find((t) => t !== token) ?? token;
      const key = directionOf(token, f.facing);
      if (key) out[key] = true;
      else if (token === 'attack') out.attack = true;
      else press(Number(token.slice(7)) - 1);
      return out;
    }
    const ready = usable().filter((n) => kit.abilities[n]!.kind !== 'self' && kit.abilities[n]!.kind !== 'blink' && kit.abilities[n]!.kind !== 'leap');
    if (ready.length > 0) {
      press(ready[Math.floor(nextRandom(match) * ready.length)]!);
      return out;
    }
    if (dist > table.weapon.range * 0.9 && !table.weapon.ranged) walkIn();
    else if (match.phaseT > FINISH_FRAMES * 0.55) out.attack = true;
    return out;
  }

  // Something flying at me: jump it, usually.
  const incoming = match.projectiles.find((p) => p.owner !== me && Math.sign(p.vx) === Math.sign(f.x - p.x) && Math.abs(p.x - f.x) < 2.4);
  if (incoming && !f.airborne && nextRandom(match) < 0.6) {
    out.jump = true;
    return out;
  }

  // The opponent is casting and I can stop them.
  if (opp.state === 'cast') {
    const kick = usable().find((n) => kit.abilities[n]!.interrupt);
    if (kick !== undefined && nextRandom(match) < 0.6) {
      press(kick);
      return out;
    }
  }

  const caster = isCaster(match, me);
  const ready = usable();
  if (ready.length > 0 && nextRandom(match) < 0.5) {
    // Finish them when it is on the table; a gap-closer when far; otherwise anything that fits the moment.
    const execute = ready.find((n) => kit.abilities[n]!.execute);
    const charge = ready.find((n) => kit.abilities[n]!.kind === 'charge' || kit.abilities[n]!.kind === 'rush');
    const fitting = ready.filter((n) => {
      const a = kit.abilities[n]!;
      switch (a.kind) {
        case 'self':
          return (a.heal > 0 && f.hp < 55) || (a.absorb > 0 && f.absorb === 0 && f.hp < 80) || (a.evasion > 0 && (opp.state === 'attack' || opp.state === 'ability'));
        case 'blink':
        case 'leap':
          return dist < 2.2 && !cornered && nextRandom(match) < 0.5;
        case 'charge':
        case 'rush':
          return dist > 3;
        default:
          return true;
      }
    });
    if (execute !== undefined) press(execute);
    else if (charge !== undefined && dist > 3) press(charge);
    else if (fitting.length > 0) press(fitting[Math.floor(nextRandom(match) * fitting.length)]!);
    if (out.abilities.some(Boolean)) {
      if (table.weapon.ranged || dist <= table.weapon.range) out.attack = true;
      return out;
    }
  }

  if (caster) {
    // A caster moves between casts: it backs off from a melee opponent at its elbow, comes in when too
    // far to reach, and otherwise steps one way or the other half the time rather than standing to cast.
    if (table.weapon.ranged) out.attack = dist <= table.weapon.range;
    // Pinned in melee it mostly stands and fights, swinging between casts: a backpedal never outruns a
    // runner and only spoils the next cast. The blink and the leap are its way out.
    if (dist < 2.0 && !cornered) {
      if (nextRandom(match) < 0.3) backOff();
      else out.attack = true;
    } else if (dist > 6.5) walkIn();
    else if (dist < 2.0) out.attack = true;
    else {
      const r = nextRandom(match);
      if (r < 0.3) walkIn();
      else if (r < 0.5 && !cornered) backOff();
    }
    return out;
  }

  // A melee kit: run in with the attack on, swing, step back now and then.
  out.attack = true;
  if (dist > table.weapon.range * 0.9) {
    walkIn();
    return out;
  }
  const r = nextRandom(match);
  if (r < 0.1) backOff();
  else if (r < 0.15) out.jump = true;
  return out;
}
