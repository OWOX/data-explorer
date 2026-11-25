import { Settings2, Trash2 } from 'lucide-react';
import { useCallback, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { hasCheck, ItemRow, ItemSubmenu, type MenuItem } from '../../charts/MenuItems';
import { DEFAULT_MART_ICON, PickedIcon } from '../bands/picked';
import { useLatest } from '../useLatest';
import { useMenuDismiss } from './ColumnMenu';
import { MartFields, PendingEmptiesContext, type ConfigMart, type PendingEmpties } from './MartFields';
import { Panel, Row, useSubmenu } from './MenuParts';

export type { ConfigMart } from './MartFields';

/** Whether a text box inside one of the menu's panels, or in a field menu opened from one, holds focus: a hover on another row then leaves the open panel alone. */
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
  /** The mart as it is now: the one in the report when it has joined it, else a fresh lookup, else the one the menu listed. A mart that is not in the report cannot be removed. */
  live: (m: ConfigMart) => ConfigMart;
  /** Leaves a pending empty commit of this path out of the menu's closing change (the mart is removed instead). */
  release: (path: string) => void;
  visible: string[];
  onChange: (cols: string[]) => void;
  /** Closes the whole menu. */
  close: () => void;
};

/**
 * The panel of one data mart: its fields, then the data marts that can join under it (each opening this same panel), then Remove from report.
 * What can join is taken when the panel opens, so a data mart that joins stays in the list it was in until the menu closes. So are its rows: a Remove it did not have does not appear, and one it had stays, disabled while the data mart cannot be removed.
 */
function MartPanel({ entry, anchor, seq, onBack, shared }: { entry: ConfigMart; anchor: HTMLElement; seq: number; onBack: () => void; shared: Shared }) {
  const { joinable, live, release, visible, onChange, close } = shared;
  const mart = live(entry);
  const [listed] = useState(() => joinable(entry.path));
  // The rows are decided when the panel opens: ticking a field brings a Remove row to a data mart that had none, and nothing below the pointer may move.
  const [hasRemove] = useState(() => !!mart.remove);
  const { sub, open, hoverRow, hoverOther, leaveRow, closeSub } = useSubmenu<string>({ isEditing: typing });
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
      <Panel anchor={anchor} mode="beside" role="dialog" config label={mart.title} onEscape={() => (sub ? closeSub() : onBack())} returnTo={anchor} onPlaced={() => setPlaced(true)} focusSeq={seq} className="dm-menu-sub">
        <div ref={body} onKeyDown={onKeyDown}>
          <div className="px-3"><MartFields mart={mart} visible={visible} onChange={onChange} /></div>
          {(listed.length > 0 || hasRemove) && (
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
              {hasRemove && (
                <>
                  <div className="dm-menu-sep" role="separator" />
                  <Row tabbable label="Remove from report" glyph={<Trash2 className="size-4" />} disabled={!mart.remove || mart.remove.disabled}
                    onHover={hoverOther} onLeaveRow={leaveRow} onActivate={() => { const r = mart.remove; if (!r) return; release(entry.path); close(); r.onRemove(); }} />
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
  // What can join under each path, taken the first time a panel asks and kept until the menu closes.
  const [joinCache] = useState(() => new Map<string, ConfigMart[]>());
  // The empty commits that wait for their panels, and the latest grid they are made against.
  const [pending] = useState(() => new Map<string, string[]>());
  // The fields of panels that went without the menu closing: all that go in one commit leave as one change.
  const queued = useRef({ names: new Set<string>(), scheduled: false });
  const latest = useLatest({ visible, onChange });
  const [placed, setPlaced] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const holderEl = useRef<HTMLSpanElement>(null);
  const { sub, open, hoverRow, hoverOther, leaveRow, closeSub, dismiss } = useSubmenu<string>({ isEditing: typing });
  const take = useCallback((paths?: string[]) => {
    for (const p of paths ?? [...pending.keys()]) { pending.get(p)?.forEach((n) => queued.current.names.add(n)); pending.delete(p); }
  }, [pending, queued]);
  // Takes what is queued off the grid in one change.
  const flush = useCallback(() => {
    const q = queued.current;
    q.scheduled = false;
    if (q.names.size === 0) return;
    const names = new Set(q.names);
    q.names.clear();
    const { visible: now, onChange: change } = latest.current;
    let next = now.filter((c) => !names.has(c));
    if (next.length === now.length) return;
    // Clear never leaves the grid without a column.
    if (next.length === 0) next = now.slice(0, 1);
    change(next);
  }, [queued, latest]);
  // Panels that go together (a subtree closing) clean up one after the other: the flush waits until they have all queued.
  const settleSoon = useCallback((path: string) => {
    take([path]);
    if (!queued.current.scheduled) { queued.current.scheduled = true; queueMicrotask(flush); }
  }, [take, queued, flush]);
  const [holder] = useState<PendingEmpties>(() => ({
    hold: (path, names) => { pending.set(path, names); },
    release: (path) => { pending.delete(path); },
    settle: settleSoon,
  }));
  const close = useCallback((refocus = true) => { take(); flush(); joinCache.clear(); dismiss(); setAnchor(null); setFrozen(null); setPlaced(false); if (refocus) button.current?.focus(); }, [dismiss, take, flush, joinCache]);
  const openMenu = (a: HTMLElement) => {
    const unshown = marts.findIndex((m) => !m.shown);
    setFrozen({ marts, split: unshown < 0 ? marts.length : unshown });
    setAnchor(a);
  };
  // A press outside the menu only closes it, and so does a scroll of anything that holds the button (a fixed menu would be left behind). A field's column menu is one of its panels.
  useMenuDismiss(!!anchor, holderEl, () => close(false), '[data-column-menu]');

  const live = (m: ConfigMart) => {
    const now = marts.find((x) => x.path === m.path);
    if (now) return now;
    // Not in the report: what can join now, when it still can; the listed one otherwise. Its Remove is never offered.
    // It can only join under the main mart or a path before its own, so those are asked, whatever panels were opened.
    const parents = new Set(['', ...m.path.split('.').slice(0, -1).map((_, i, all) => all.slice(0, i + 1).join('.')), ...rootPaths, ...joinCache.keys()]);
    const fresh = [...parents].flatMap((p) => joinable(p)).find((x) => x.path === m.path);
    return { ...(fresh ?? m), remove: undefined };
  };
  const rootPaths = new Set(frozen?.marts.map((m) => m.path));
  const joinableOf = (path: string) => {
    let list = joinCache.get(path);
    if (!list) { list = joinable(path).filter((m) => !rootPaths.has(m.path)); joinCache.set(path, list); }
    return list;
  };
  const slot = hasCheck(chartItems);
  const shared: Shared = { joinable: joinableOf, live, release: holder.release, visible, onChange, close };
  // Chart rows are found by their label, not their place: the list may change while a row is open.
  const item = sub?.key.startsWith('i:') ? chartItems.find((it) => `i:${it.label}` === sub.key) : undefined;
  const picked = sub?.key.startsWith('m:') ? frozen?.marts.find((m) => `m:${m.path}` === sub.key) : undefined;
  const row = (m: ConfigMart) => (
    <MartRow key={m.path} mart={live(m)} slot={slot} expanded={sub?.key === `m:${m.path}`}
      onOpen={(r) => open(`m:${m.path}`, r, true)} onHover={(r) => hoverRow(`m:${m.path}`, r)} onLeaveRow={leaveRow} />
  );
  return (
    <PendingEmptiesContext.Provider value={holder}>
    <span ref={holderEl} className="inline-flex">
      <button ref={button} type="button" aria-label="Configure data" aria-haspopup="menu" aria-expanded={!!anchor} data-config-button
        onClick={(e) => (anchor ? close(false) : openMenu(e.currentTarget))}
        className="dm-band-btn">
        <Settings2 size={14} aria-hidden />Configure
      </button>
      {anchor && frozen && (
        <Panel anchor={anchor} mode="below" role="menu" config pinned label="Configure data" onEscape={() => (sub ? closeSub() : close())} onTab={() => close()} onPlaced={() => setPlaced(true)} focusSeq={1} className="dm-menu-root">
          {chartItems.map((it) => (
            <ItemRow key={it.label} item={it} slot={slot} expanded={sub?.key === `i:${it.label}`} close={close} onOpen={(r) => open(`i:${it.label}`, r, true)} onHover={(r) => hoverRow(`i:${it.label}`, r)} hoverOther={hoverOther} leaveRow={leaveRow} />
          ))}
          {chartItems.length > 0 && frozen.marts.length > 0 && <div className="dm-menu-sep" role="separator" />}
          {frozen.marts.slice(0, frozen.split).map(row)}
          {frozen.split > 0 && frozen.split < frozen.marts.length && <div className="dm-menu-sep" role="separator" />}
          {frozen.marts.slice(frozen.split).map(row)}
        </Panel>
      )}
      {anchor && placed && sub && item && <ItemSubmenu key={sub.key} item={item} anchor={sub.row} seq={sub.seq} close={close} onBack={closeSub} />}
      {anchor && placed && sub && picked && <MartPanel key={picked.path} entry={picked} anchor={sub.row} seq={sub.seq} onBack={closeSub} shared={shared} />}
    </span>
    </PendingEmptiesContext.Provider>
  );
}
