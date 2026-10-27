import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ItemSummary, Slot } from '@mogshot/character/equipment';
import type { Fighters } from './fighters';
import { kindOf, LEFT_SLOTS, RIGHT_SLOTS, SLOT_NAMES, WEAPON_SLOTS } from './slots';
import type { Icons } from './ui/icons';
import { type Line, type Quality, WowTooltip } from './ui/WowTooltip';

/*
 * The slots round the champion on CREATE YOUR CHAMPION, as the game's character sheet has them,
 * each with the icon of what is worn there in its quality's colour, and a tooltip on hover. A
 * click on one opens the picker over the column: every item this folder has for the slot, found
 * by name as one types, and an empty slot at the top to take the piece off.
 */

const QUALITIES: readonly Quality[] = ['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary'];
export const qualityOf = (item: ItemSummary): Quality => QUALITIES[Math.min(Math.max(item.quality, 0), 5)] ?? 'common';

/** How long the picker waits after the last key before it searches. */
const SEARCH_MS = 150;

/** An item's icon, read through the worker once and kept; the slot is dark until it comes. */
function ItemIcon({ icons, fileId }: { icons: Icons; fileId: number }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let stale = false;
    setUrl(undefined);
    void icons.picture(fileId).then((found) => !stale && setUrl(found));
    return () => {
      stale = true;
    };
  }, [icons, fileId]);
  return url ? <img class="item-icon" src={url} alt="" draggable={false} /> : null;
}

interface PaperDollProps {
  icons: Icons;
  /** What is worn, as the items; a piece known only by id until it is read is in `gear` alone. */
  worn: readonly [Slot, ItemSummary][];
  gear: readonly [Slot, number][];
  /** The slot the keys are on, or the one whose picker is open. */
  cursor: Slot | undefined;
  /** The picker is open: the slots keep their tooltips to themselves. */
  picking: boolean;
  /** A champion that comes with the game: shown, not changed. */
  readOnly: boolean;
  onPick: (slot: Slot) => void;
  children: ComponentChildren;
}

export function PaperDoll({ icons, worn, gear, cursor, picking, readOnly, onPick, children }: PaperDollProps) {
  const [hover, setHover] = useState<Slot>();
  const items = new Map(worn);
  const ids = new Map(gear);

  const tip = (slot: Slot): Line[] => {
    const item = items.get(slot);
    const hint: Line[] = readOnly ? [] : [{ kind: 'gap' }, { left: item ? 'Click to change, or to take it off.' : 'Click to choose an item.', hue: 'green', kind: 'small' }];
    if (!item) {
      return ids.has(slot)
        ? [{ left: SLOT_NAMES[slot], kind: 'name' }, { left: `Item ${ids.get(slot)}`, hue: 'grey' }, ...hint]
        : [{ left: SLOT_NAMES[slot], kind: 'name' }, { left: 'Empty', hue: 'grey' }, ...hint];
    }
    const kind = kindOf(item, slot);
    return [{ left: item.name, kind: 'name', hue: qualityOf(item) }, { left: SLOT_NAMES[slot], ...(kind !== SLOT_NAMES[slot] && { right: kind }) }, ...hint];
  };

  const slotView = (slot: Slot, side: 'left' | 'right' | 'bottom') => {
    const item = items.get(slot);
    return (
      <button
        key={slot}
        type="button"
        tabIndex={-1}
        class={`doll-slot wow-slot ${item ? `q-${qualityOf(item)}` : 'empty'} ${cursor === slot ? 'here' : ''} ${readOnly ? 'fixed' : ''}`}
        aria-label={item ? `${SLOT_NAMES[slot]}: ${item.name}` : `${SLOT_NAMES[slot]}: empty`}
        onMouseEnter={() => setHover(slot)}
        onMouseLeave={() => setHover((h) => (h === slot ? undefined : h))}
        onClick={() => !readOnly && onPick(slot)}
      >
        {item ? <ItemIcon icons={icons} fileId={item.iconFileId} /> : <span class="slot-word">{SLOT_NAMES[slot]}</span>}
        {!picking && (hover === slot || (hover === undefined && cursor === slot)) && <WowTooltip class={`slot-tip ${side}`} lines={tip(slot)} />}
      </button>
    );
  };

  return (
    <div class="doll">
      <div class="doll-side left">{LEFT_SLOTS.map((slot) => slotView(slot, 'left'))}</div>
      <div class="doll-model">{children}</div>
      <div class="doll-side right">{RIGHT_SLOTS.map((slot) => slotView(slot, 'right'))}</div>
      <div class="doll-weapons">{WEAPON_SLOTS.map((slot) => slotView(slot, 'bottom'))}</div>
    </div>
  );
}

interface ItemPickerProps {
  slot: Slot;
  fighters: Fighters;
  icons: Icons;
  /** What the slot has on now, marked in the list. */
  current: number | undefined;
  onChoose: (item: ItemSummary | undefined) => void;
  onClose: () => void;
  /** Where the creator hands the keys while the picker is open. */
  keys: { current: ((event: KeyboardEvent) => void) | undefined };
}

export function ItemPicker({ slot, fighters, icons, current, onChoose, onClose, keys }: ItemPickerProps) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ query: string; items: ItemSummary[]; total: number }>();
  const [failed, setFailed] = useState(false);
  // 0 is the empty slot; 1 on are the items; -1 is nothing yet, so an Enter straight away takes nothing off.
  const [at, setAt] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, [slot]);

  useEffect(() => {
    let stale = false;
    const asked = query.trim();
    const timer = setTimeout(() => {
      fighters.searchItems(slot, asked).then(
        (result) => {
          if (stale) return;
          setFound({ query: asked, ...result });
          setFailed(false);
          setAt(asked && result.items.length > 0 ? 1 : -1);
        },
        (cause: unknown) => {
          console.warn('The items could not be searched:', cause);
          if (!stale) setFailed(true);
        },
      );
    }, query ? SEARCH_MS : 0);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [slot, query, fighters]);

  const items = found?.items ?? [];
  const count = items.length + 1;
  // The list on screen is the one for what is typed: Enter before the search has answered does nothing, rather than choose from the old list.
  const answered = found?.query === query.trim();
  const choose = (i: number) => onChoose(i === 0 ? undefined : items[i - 1]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-at="${at}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  const state = useRef({ at, count, choose, onClose, ready: answered });
  state.current = { at, count, choose, onClose, ready: answered };
  keys.current = (event: KeyboardEvent) => {
    const s = state.current;
    // A letter typed before the search box had the focus goes into it all the same.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && event.target !== input.current) {
      event.preventDefault();
      input.current?.focus();
      setQuery((q) => q + event.key);
      return;
    }
    if (event.code === 'Escape') {
      event.preventDefault();
      s.onClose();
    } else if (event.code === 'Enter' || event.code === 'NumpadEnter') {
      event.preventDefault();
      if (!event.repeat && s.ready && s.at >= 0) s.choose(s.at);
    } else if (event.code === 'ArrowDown') {
      event.preventDefault();
      setAt((s.at + 1) % s.count);
    } else if (event.code === 'ArrowUp') {
      event.preventDefault();
      setAt(s.at <= 0 ? s.count - 1 : s.at - 1);
    } else if (event.code === 'PageDown' || event.code === 'PageUp') {
      event.preventDefault();
      setAt(Math.max(0, Math.min(s.count - 1, Math.max(s.at, 0) + (event.code === 'PageDown' ? 10 : -10))));
    }
  };
  useEffect(() => () => {
    keys.current = undefined;
  }, [keys]);

  const more = found && found.total > items.length;
  return (
    <div class="item-picker wow-panel">
      <div class="picker-head">
        <span class="picker-title">{SLOT_NAMES[slot]}</span>
        <button type="button" class="picker-close" aria-label="Close" tabIndex={-1} onClick={onClose}>×</button>
      </div>
      <input
        ref={input}
        class="picker-search"
        type="search"
        placeholder="Search by name or item id"
        value={query}
        spellcheck={false}
        autoComplete="off"
        onInput={(event) => setQuery(event.currentTarget.value)}
      />
      <div class="picker-list" ref={list}>
        <button type="button" tabIndex={-1} data-at={0} class={`picker-item ${at === 0 ? 'here' : ''} ${current === undefined ? 'worn' : ''}`} onMouseEnter={() => setAt(0)} onClick={() => choose(0)}>
          <span class="doll-slot wow-slot empty small" />
          <span class="picker-name h-grey">Empty slot</span>
        </button>
        {items.map((item, i) => (
          <button
            key={item.id}
            type="button"
            tabIndex={-1}
            data-at={i + 1}
            class={`picker-item ${at === i + 1 ? 'here' : ''} ${current === item.id ? 'worn' : ''}`}
            onMouseEnter={() => setAt(i + 1)}
            onClick={() => choose(i + 1)}
          >
            <span class={`doll-slot wow-slot small q-${qualityOf(item)}`}>
              <ItemIcon icons={icons} fileId={item.iconFileId} />
            </span>
            <span class={`picker-name h-${qualityOf(item)}`}>{item.name}</span>
            <span class="picker-kind">{kindOf(item, slot)}</span>
          </button>
        ))}
      </div>
      <p class="picker-count dim small">
        {failed
          ? 'The items could not be read.'
          : !found || !answered
            ? 'Searching…'
            : found.total === 0
              ? 'Nothing by that name in this folder.'
              : more
                ? `The first ${items.length} of ${found.total.toLocaleString()} · type to narrow`
                : `${found.total.toLocaleString()} item${found.total === 1 ? '' : 's'}`}
        {' · ↑ ↓ Enter · Esc'}
      </p>
    </div>
  );
}
