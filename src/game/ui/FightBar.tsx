import { useEffect, useRef, useState } from 'preact/hooks';
import type { Ability } from '../../engine/abilities';
import { type InputAction, KEYS, keyLabel } from '../../engine/input';
import type { Weapon } from '../../engine/moves';
import type { AbilityView, FighterView } from '../../engine/view';
import { describeAbility, describeWeapon, type Tooltip } from './describe';
import { type Line, WowTooltip } from './WowTooltip';
import { seconds } from './UnitFrame';

/*
 * A player's action bar as the game lays its buttons out: square slots with the spell's own
 * icon, the key in the corner, a clockwise cooldown wipe with the seconds left in the middle, a
 * quick wipe over every slot for the global cooldown, the icon greyed while it cannot go and
 * washed blue when the resource is short, the key in red when the target is out of reach, a
 * gold flash when the key is pressed and a glow while the ability is in use. The first slot is
 * the auto-attack, with the swing timer wiping round it. Hovering a slot, or holding its key,
 * opens the game's tooltip: name, cost, range, cast time, cooldown and what it does.
 */

export interface FightBarProps {
  side: 0 | 1;
  view: FighterView;
  /** Icons by ability id; 'attack' for the auto-attack. */
  icons: ReadonlyMap<string, string>;
  /** The abilities' numbers, by id, for the tooltips. */
  specs: ReadonlyMap<string, Ability>;
  weapon: Weapon;
  /** Whose keys the bar labels and flashes for: its own player's by default; online, this keyboard's player 1 for the local fighter and none for the other. */
  keys?: 0 | 1 | null;
}

/** How long the flash of a pressed key lasts. */
const FLASH_MS = 180;
/** Holding a key this long opens its tooltip. */
const HOLD_MS = 350;

export function FightBar({ side, view, icons, specs, weapon, keys = side }: FightBarProps) {
  // When each action's key went down (and whether it is still down), so a slot can flash even
  // when the press did nothing, and show its tooltip while the key is held.
  const pressed = useRef(new Map<InputAction, { at: number; down: boolean }>());
  const [hovered, setHovered] = useState<string>();
  useEffect(() => {
    if (keys === null) return;
    const map = KEYS[keys];
    const actionsOf = (code: string) => (Object.keys(map) as InputAction[]).filter((action) => map[action].includes(code));
    const onDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      for (const action of actionsOf(event.code)) pressed.current.set(action, { at: performance.now(), down: true });
    };
    const onUp = (event: KeyboardEvent) => {
      for (const action of actionsOf(event.code)) {
        const press = pressed.current.get(action);
        if (press) press.down = false;
      }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [keys]);
  const now = performance.now();
  const flashing = (action: InputAction) => now - (pressed.current.get(action)?.at ?? -Infinity) < FLASH_MS;
  const held = (action: InputAction) => {
    const press = pressed.current.get(action);
    return press !== undefined && press.down && now - press.at >= HOLD_MS;
  };

  const swing = view.swing;
  const swingSweep = swing.total > 0 ? Math.min(1, swing.remaining / swing.total) : 0;
  const attackTip = describeWeapon(weapon);
  return (
    // A click on the bar must not take the keyboard focus off the stage, or the keys go dead.
    <div class={`fightbar p${side + 1}`} onMouseDown={(event) => event.preventDefault()} onMouseLeave={() => setHovered(undefined)}>
      <div
        class={`slot auto ${swing.auto ? 'on' : ''} ${swing.inReach ? '' : 'far'} ${flashing('attack') ? 'flash' : ''}`}
        onMouseEnter={() => setHovered('attack')}
      >
        <Icon url={icons.get('attack')} name={attackTip.name.toUpperCase()} />
        <span class="sweep" style={{ '--sweep': swingSweep }} />
        {keys !== null && <span class="key">{keyLabel(keys, 'attack')}</span>}
        <span class="rim" />
        {(hovered === 'attack' || held('attack')) && <TooltipBox tip={attackTip} why={swing.inReach ? undefined : 'OUT OF RANGE'} colour={view.resource.colour} />}
      </div>
      {view.abilities.map((ability) => (
        <AbilitySlot
          key={ability.id}
          keys={keys}
          ability={ability}
          spec={specs.get(ability.id)}
          resource={view.resource}
          icon={icons.get(ability.id)}
          flash={flashing(ability.action)}
          open={hovered === ability.id || held(ability.action)}
          onHover={() => setHovered(ability.id)}
        />
      ))}
    </div>
  );
}

interface SlotProps {
  keys: 0 | 1 | null;
  ability: AbilityView;
  spec: Ability | undefined;
  resource: FighterView['resource'];
  icon: string | undefined;
  flash: boolean;
  open: boolean;
  onHover: () => void;
}

function AbilitySlot({ keys, ability, spec, resource, icon, flash, open, onHover }: SlotProps) {
  const cooling = ability.cooldown.remaining > 0 && ability.cooldown.total > 0;
  const onGcd = !cooling && ability.gcd > 0;
  const sweep = cooling ? ability.cooldown.remaining / ability.cooldown.total : onGcd ? ability.gcd / ability.gcdTotal : 0;
  const why = ability.blocked;
  const short = why !== undefined && why.startsWith('NOT ENOUGH');
  const far = why === 'OUT OF RANGE' || why === 'TOO CLOSE';
  const dim = why !== undefined && !short && !far && !cooling && why !== 'NOT READY';
  const cls = [
    'slot',
    ability.active ? 'active' : '',
    flash ? 'flash' : '',
    cooling ? 'cooling' : onGcd ? 'gcd' : '',
    short ? 'short' : '',
    far ? 'far' : '',
    dim ? 'dim' : '',
    ability.usable ? 'ready' : '',
  ].join(' ');
  const tip: Tooltip = spec
    ? describeAbility(spec, resource.kind)
    : { name: ability.name, cost: ability.cost ? `${ability.cost} ${resource.name}` : '', range: '', cast: ability.castTime ? `${(ability.castTime / 60).toFixed(1)} sec cast` : 'Instant', cooldown: '', description: '' };
  return (
    <div class={cls} style={{ '--power': resource.colour }} onMouseEnter={onHover}>
      <Icon url={icon} name={ability.short} />
      <span class="sweep" style={{ '--sweep': sweep }} />
      {cooling && <span class="time">{seconds(ability.cooldown.remaining)}</span>}
      {keys !== null && <span class="key">{keyLabel(keys, ability.action)}</span>}
      {ability.cost > 0 && <span class="cost">{ability.cost}</span>}
      <span class="rim" />
      {open && <TooltipBox tip={tip} why={why} colour={resource.colour} />}
    </div>
  );
}

/** The game's spell tooltip: name; cost and range; cast time and cooldown; what it does in gold; why not, in red. */
function TooltipBox({ tip, why }: { tip: Tooltip; why: string | undefined; colour: string }) {
  const lines: Line[] = [{ left: tip.name, kind: 'name' }];
  if (tip.cost || tip.range) lines.push({ left: tip.cost, right: tip.range || undefined });
  lines.push({ left: tip.cast, right: tip.cooldown || undefined });
  if (tip.description) lines.push({ left: tip.description, hue: 'gold' });
  if (why && why !== 'NOT NOW') lines.push({ left: why.charAt(0) + why.slice(1).toLowerCase(), hue: 'red' });
  return <WowTooltip lines={lines} />;
}

/** The spell's picture, or its short name on the plain slot until the picture arrives. */
function Icon({ url, name }: { url: string | undefined; name: string }) {
  return url ? <img class="icon" src={url} alt="" draggable={false} /> : <span class="icon text">{name}</span>;
}
