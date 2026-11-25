import { Settings2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { hasCheck, ItemRow, ItemSubmenu, type MenuItem } from '../../charts/MenuItems';
import { DEFAULT_MART_ICON, PickedIcon } from '../bands/picked';
import { useOutsidePress } from '../outsidePress';
import { MartFields, type ConfigMart } from './MartFields';
import { Panel, Row, useSubmenu } from './MenuParts';

export type { ConfigMart } from './MartFields';

/** Whether a text box inside one of the menu's panels holds focus: a hover on another row then leaves the open panel alone. */
const typing = () => {
  const el = document.activeElement;
  return !!el && el.matches('input, textarea, select') && !!el.closest('[data-column-menu]');
};

/** One data mart as a row that opens its fields panel: its icon, its title and, with a description, a (?). */
function MartRow({ mart, expanded, tabbable, onOpen, onHover, onLeaveRow, slot }: {
  mart: ConfigMart; expanded: boolean; tabbable?: boolean; slot?: boolean;
  onOpen: (row: HTMLElement) => void; onHover: (row: HTMLElement) => void; onLeaveRow: () => void;
}) {
  return (
    <Row sub haspopup="dialog" tabbable={tabbable} slot={slot} expanded={expanded} label={mart.title} hint={mart.description?.trim() || undefined}
      glyph={<PickedIcon icon={mart.icon} fallback={DEFAULT_MART_ICON} size={16} />}
      onActivate={onOpen} onOpen={onOpen} onHover={onHover} onLeaveRow={onLeaveRow} />
  );
}

type Shared = {
  joinable: (path: string) => ConfigMart[];
  /** The mart as it is now: the one in the report when it has joined it, else the one the menu listed. */
  live: (m: ConfigMart) => ConfigMart;
  visible: string[];
  onChange: (cols: string[]) => void;
  /** Closes the whole menu. */
  close: () => void;
};

/**
 * The panel of one data mart: its fields, then the data marts that can join under it (each opening this same panel), then Remove from report.
 * What can join is taken when the panel opens, so a data mart that joins stays in the list it was in until the menu closes.
 */
function MartPanel({ entry, anchor, seq, onBack, shared }: { entry: ConfigMart; anchor: HTMLElement; seq: number; onBack: () => void; shared: Shared }) {
  const { joinable, live, visible, onChange, close } = shared;
  const mart = live(entry);
  const [listed] = useState(() => joinable(entry.path));
  const { sub, open, hoverRow, leaveRow, closeSub } = useSubmenu<string>({ isEditing: typing });
  const [placed, setPlaced] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const heading = useId();
  const picked = sub ? listed.find((m) => m.path === sub.key) : undefined;
  // Left closes the deepest panel from any row; a text box and a field's own menu button keep the key.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    const t = e.target as HTMLElement;
    if (e.key !== 'ArrowLeft' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || t.matches('input, textarea, select')) return;
    if (t.closest('[data-column-menu]') !== body.current?.closest('[data-column-menu]')) return;
    e.preventDefault();
    e.stopPropagation();
    if (sub) closeSub(); else onBack();
  };
  return (
    <>
      <Panel anchor={anchor} mode="beside" role="dialog" label={mart.title} onEscape={() => (sub ? closeSub() : onBack())} returnTo={anchor} onPlaced={() => setPlaced(true)} focusSeq={seq} className="dm-menu-sub">
        <div ref={body} onKeyDown={onKeyDown}>
          <div className="px-3"><MartFields mart={mart} visible={visible} onChange={onChange} /></div>
          {(listed.length > 0 || mart.remove) && (
            <div role="menu" aria-labelledby={listed.length > 0 ? heading : undefined} aria-label={listed.length > 0 ? undefined : 'Data mart'}>
              {listed.length > 0 && (
                <>
                  <div className="dm-menu-sep" role="separator" />
                  <div id={heading} className="dm-menu-heading">Joinable Data Marts</div>
                  {listed.map((m) => (
                    <MartRow key={m.path} mart={live(m)} tabbable expanded={sub?.key === m.path}
                      onOpen={(r) => open(m.path, r, true)} onHover={(r) => hoverRow(m.path, r)} onLeaveRow={leaveRow} />
                  ))}
                </>
              )}
              {mart.remove && (
                <>
                  <div className="dm-menu-sep" role="separator" />
                  <Row tabbable label="Remove from report" glyph={<Trash2 className="size-4" />} disabled={mart.remove.disabled}
                    onActivate={() => { const r = mart.remove!; close(); r.onRemove(); }} />
                </>
              )}
            </div>
          )}
        </div>
      </Panel>
      {placed && sub && picked && <MartPanel key={picked.path} entry={picked} anchor={sub.row} seq={sub.seq} onBack={closeSub} shared={shared} />}
    </>
  );
}

/**
 * The config button and its menu: the data marts of the report (and the ones on a path with no column), each opening its fields.
 * In Charts mode `chartItems` come first. What the menu lists is taken when it opens and stays until it closes, whatever the grid does meanwhile;
 * each row and panel shows its data mart's live state.
 */
export function ConfigMenu({ marts, joinable, visible, onChange, chartItems = [] }: {
  /** Shown data marts in grid order, then the ones on a path with no column. */
  marts: ConfigMart[];
  /** What can join under a path and is not in the report. */
  joinable: (path: string) => ConfigMart[];
  visible: string[];
  onChange: (cols: string[]) => void;
  /** Charts mode: rows before the data marts (Add chart, then Charts). */
  chartItems?: MenuItem[];
}): ReactNode {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [frozen, setFrozen] = useState<{ marts: ConfigMart[]; split: number } | null>(null);
  const [placed, setPlaced] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const holder = useRef<HTMLSpanElement>(null);
  const { sub, open, hoverRow, hoverOther, leaveRow, closeSub, dismiss } = useSubmenu<string>({ isEditing: typing });
  const close = useCallback((refocus = true) => { dismiss(); setAnchor(null); setFrozen(null); setPlaced(false); if (refocus) button.current?.focus(); }, [dismiss]);
  const openMenu = (a: HTMLElement) => {
    const set = new Set(visible);
    const unshown = marts.findIndex((m) => !m.main && !m.fields.some((f) => set.has(f.name)));
    setFrozen({ marts, split: unshown < 0 ? marts.length : unshown });
    setAnchor(a);
  };
  // A scroll of anything that holds the button closes the menu (a fixed menu would be left behind), as the chart menu does.
  useEffect(() => {
    if (!anchor) return;
    const away = (e: Event) => {
      const t = e.target;
      if (t instanceof Node && t !== document && (t as Element).closest?.('[data-column-menu]')) return;
      const h = holder.current;
      if (t === document || (t instanceof Node && h && t.contains(h))) close(false);
    };
    window.addEventListener('scroll', away, true);
    return () => window.removeEventListener('scroll', away, true);
  }, [anchor, close]);
  // A press outside the menu only closes it; a field's column menu is one of its panels.
  useOutsidePress(!!anchor, (t) => !!t.closest('[data-column-menu]') || !!holder.current?.contains(t), () => close(false));

  const live = (m: ConfigMart) => marts.find((x) => x.path === m.path) ?? m;
  const slot = hasCheck(chartItems);
  const shared: Shared = { joinable, live, visible, onChange, close };
  const item = sub?.key.startsWith('i:') ? chartItems[Number(sub.key.slice(2))] : undefined;
  const picked = sub?.key.startsWith('m:') ? frozen?.marts.find((m) => `m:${m.path}` === sub.key) : undefined;
  const row = (m: ConfigMart) => (
    <MartRow key={m.path} mart={live(m)} slot={slot} expanded={sub?.key === `m:${m.path}`}
      onOpen={(r) => open(`m:${m.path}`, r, true)} onHover={(r) => hoverRow(`m:${m.path}`, r)} onLeaveRow={leaveRow} />
  );
  return (
    <span ref={holder} className="inline-flex">
      <button ref={button} type="button" aria-label="Configure data" aria-haspopup="menu" aria-expanded={!!anchor} data-config-button
        onClick={(e) => (anchor ? close(false) : openMenu(e.currentTarget))}
        className="dm-menu-dots inline-flex size-7 items-center justify-center rounded-md hover:bg-accent">
        <Settings2 className="size-4" aria-hidden />
      </button>
      {anchor && frozen && (
        <Panel anchor={anchor} mode="below" role="menu" label="Configure data" onEscape={() => (sub ? closeSub() : close())} onTab={() => close()} onPlaced={() => setPlaced(true)} focusSeq={1} className="dm-menu-root">
          {chartItems.map((it, i) => (
            <ItemRow key={i} item={it} slot={slot} expanded={sub?.key === `i:${i}`} close={close} onOpen={(r) => open(`i:${i}`, r, true)} onHover={(r) => hoverRow(`i:${i}`, r)} hoverOther={hoverOther} leaveRow={leaveRow} />
          ))}
          {chartItems.length > 0 && frozen.marts.length > 0 && <div className="dm-menu-sep" role="separator" />}
          {frozen.marts.slice(0, frozen.split).map(row)}
          {frozen.split > 0 && frozen.split < frozen.marts.length && <div className="dm-menu-sep" role="separator" />}
          {frozen.marts.slice(frozen.split).map(row)}
        </Panel>
      )}
      {anchor && placed && sub && item && <ItemSubmenu item={item} anchor={sub.row} seq={sub.seq} close={close} onBack={closeSub} />}
      {anchor && placed && sub && picked && <MartPanel key={picked.path} entry={picked} anchor={sub.row} seq={sub.seq} onBack={closeSub} shared={shared} />}
    </span>
  );
}
