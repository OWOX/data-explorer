import { type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_MART_ICON, PickedIcon } from '../ui/bands/picked';
import { Panel, Row, useSubmenu } from '../ui/explorer/MenuParts';

/** One choice of a submenu. */
export type MenuOption = { value: string; label: string; icon?: LucideIcon };
/** A row that ends a radio's submenu, after its options and groups and below a divider: it runs its action and closes the menu, like an action row. */
export type MenuTrailing = { label: string; icon: LucideIcon; onPick: () => void };
/** The choices that belong to one data mart: a header with the mart's icon and title, then the options. */
export type MenuGroup = { title: string; /** The mart's picked icon; the default mart icon when none. */ icon?: string | null; options: MenuOption[] };

/**
 * A tick row (stays open: several can be changed in a row), an action row (closes the menu, then runs), a row opening a submenu of radio choices (closes on a choice)
 * or a row opening a submenu of other rows (a group: its check rows keep the menu open).
 * Every row has an icon. A radio's `options` come first without a header (Off, No stacking); its `groups` follow, each under its data mart's header.
 */
export type MenuItem =
  | { kind: 'check'; label: string; icon: LucideIcon; checked: boolean; onToggle: () => void }
  | { kind: 'radio'; label: string; icon: LucideIcon; value: string; options: MenuOption[]; groups?: MenuGroup[]; /** Ends the submenu: a Sankey column's Remove column. */ trailing?: MenuTrailing; onPick: (value: string) => void }
  | { kind: 'action'; label: string; icon: LucideIcon; onPick: () => void }
  | { kind: 'group'; label: string; icon: LucideIcon; items: MenuItem[] };

/** A menu with a check row gives every row the check column, so labels line up. */
export const hasCheck = (items: MenuItem[]) => items.some((it) => it.kind === 'check');

/** One row of a menu level. A submenu row opens its panel through `onOpen` (a click or Right) and `onHover`; the other rows only tell the level that the pointer left the open row. */
export function ItemRow({ item, slot, expanded, close, onOpen, onHover, hoverOther, leaveRow }: {
  item: MenuItem;
  slot: boolean;
  expanded: boolean;
  /** Closes the whole menu. */
  close: () => void;
  onOpen: (row: HTMLElement) => void;
  onHover: (row: HTMLElement) => void;
  hoverOther: () => void;
  leaveRow: () => void;
}) {
  const glyph = <item.icon className="size-4" />;
  if (item.kind === 'check') return <Row check checkbox checked={item.checked} label={item.label} glyph={glyph} onActivate={item.onToggle} onHover={hoverOther} onLeaveRow={leaveRow} />;
  if (item.kind === 'action') return <Row slot={slot} label={item.label} glyph={glyph} onActivate={() => { close(); item.onPick(); }} onHover={hoverOther} onLeaveRow={leaveRow} />;
  return <Row sub slot={slot} expanded={expanded} label={item.label} glyph={glyph} onActivate={onOpen} onOpen={onOpen} onHover={onHover} onLeaveRow={leaveRow} />;
}

/** The submenu a radio or group row opens, beside its row. `onBack` closes just this level (Escape, Left); `close` closes the whole menu. */
export function ItemSubmenu({ item, anchor, seq, close, onBack }: { item: MenuItem; anchor: HTMLElement; seq: number; close: () => void; onBack: () => void }) {
  if (item.kind === 'radio') return <RadioSubmenu item={item} anchor={anchor} seq={seq} close={close} onBack={onBack} />;
  if (item.kind === 'group') return <GroupSubmenu item={item} anchor={anchor} seq={seq} close={close} onBack={onBack} />;
  return null;
}

function RadioSubmenu({ item, anchor, seq, close, onBack }: { item: Extract<MenuItem, { kind: 'radio' }>; anchor: HTMLElement; seq: number; close: () => void; onBack: () => void }) {
  // The data marts of the submenu: a third level, one mart's options. It closes with the submenu it hangs off.
  const marts = useSubmenu<number>();
  const groups = item.groups ?? [];
  const choice = (o: MenuOption, hover?: () => void) => (
    <Row key={o.value} check checked={o.value === item.value} label={o.label} glyph={o.icon && <o.icon className="size-4" />} onActivate={() => { item.onPick(o.value); close(); }} onHover={hover} />
  );
  return (
    <>
      <Panel anchor={anchor} mode="beside" role="menu" label={item.label} onEscape={() => (marts.sub ? marts.closeSub() : onBack())} onLeave={onBack} onTab={close} focusSeq={seq}>
        {item.options.map((o) => choice(o, marts.hoverOther))}
        {/* One mart with options needs no level of its own: its options are listed here. */}
        {groups.length === 1 && groups[0]!.options.map((o) => choice(o, marts.hoverOther))}
        {groups.length > 1 && groups.map((g, gi) => (
          <Row key={gi} sub tick checked={g.options.some((o) => o.value === item.value)} expanded={marts.sub?.key === gi} label={g.title}
            glyph={<PickedIcon icon={g.icon} fallback={DEFAULT_MART_ICON} size={16} />}
            onActivate={(r) => marts.open(gi, r, true)} onOpen={(r) => marts.open(gi, r, true)} onHover={(r) => marts.hoverRow(gi, r)} onLeaveRow={marts.leaveRow} />
        ))}
        {item.trailing && (
          <>
            <div className="dm-menu-sep" role="separator" />
            <Row label={item.trailing.label} glyph={<item.trailing.icon className="size-4" />} onActivate={() => { const t = item.trailing!; close(); t.onPick(); }} onHover={marts.hoverOther} />
          </>
        )}
      </Panel>
      {marts.sub && groups.length > 1 && groups[marts.sub.key] && (
        <Panel anchor={marts.sub.row} mode="beside" role="menu" label={groups[marts.sub.key]!.title} onEscape={marts.closeSub} onLeave={marts.closeSub} onTab={close} focusSeq={marts.sub.seq}>
          {groups[marts.sub.key]!.options.map((o) => choice(o))}
        </Panel>
      )}
    </>
  );
}

function GroupSubmenu({ item, anchor, seq, close, onBack }: { item: Extract<MenuItem, { kind: 'group' }>; anchor: HTMLElement; seq: number; close: () => void; onBack: () => void }) {
  const { sub, open, hoverRow, hoverOther, leaveRow, closeSub } = useSubmenu<number>();
  const [placed, setPlaced] = useState(false);
  const slot = hasCheck(item.items);
  const picked = sub ? item.items[sub.key] : undefined;
  return (
    <>
      <Panel anchor={anchor} mode="beside" role="menu" label={item.label} onEscape={() => (sub ? closeSub() : onBack())} onLeave={onBack} onTab={close} onPlaced={() => setPlaced(true)} focusSeq={seq}>
        {item.items.map((it, i) => (
          <ItemRow key={i} item={it} slot={slot} expanded={sub?.key === i} close={close} onOpen={(r) => open(i, r, true)} onHover={(r) => hoverRow(i, r)} hoverOther={hoverOther} leaveRow={leaveRow} />
        ))}
      </Panel>
      {placed && sub && picked && <ItemSubmenu item={picked} anchor={sub.row} seq={sub.seq} close={close} onBack={closeSub} />}
    </>
  );
}
