// The Sources and Data bands with the lines between their cards, and the hover that lights them.
// The Data and Row bands arrive as children and sit under the same canvas; they do not re-render on hover.
import { Box, LayoutGrid, Plug, Workflow } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DqSummary, Mart, Model, Source } from '../../model/types';
import { matchesSearch } from '../../graph/search';
import { storageOptions } from '../../graph/storages';
import { neighbours, type VisibleResult } from '../../graph/visible';
import { useRememberLeaving } from '../../state/leaving';
import { useServices, useStore } from '../../state/store';
import { storageMark } from '../storage-icons';
import { Band } from './Band';
import { ViewSwitch, type SwitchOption } from './ViewSwitch';
import { MultiSelect } from './MultiSelect';
import { ContextBadges } from './ContextBadges';
import { useSmartSearchScope } from './SmartSearchScope';
import { PointerTip } from '../Tooltip';
import { CardClickContext } from './CardClick';
import { MartCard, SourceCard, martElementId, sourceElementId, type CountState } from './cards';
import { useCardTransitions } from './transitions';
import { useCardClick } from './useCardClick';
import { useCardDrag } from './useCardDrag';
import { litIds, revisionOf, useWires, type Wire } from './wires';
import { MartsCanvas } from './MartsCanvas';
import { buildJoinTree } from '../../state/join-tree';
import type { JoinedSource } from '../../api/blendable';

export type MartsView = 'grid' | 'canvas';
const MARTS_VIEWS: SwitchOption<MartsView>[] = [
  { value: 'grid', label: 'Grid', icon: LayoutGrid },
  { value: 'canvas', label: 'Canvas', icon: Workflow },
];

const martId = (m: Mart) => m.id;
const sourceKey = (s: Source) => s.key;

const nodeIdOf = (target: EventTarget | null) => (target instanceof Element ? target.closest('[data-node]')?.id ?? null : null);

export function CardBands({
  model,
  visible,
  storageIds,
  joined: joinedProp,
  joinSources,
  mainColumns,
  counts,
  dq,
  foldedSources,
  foldedMarts,
  onFoldSources,
  onFoldMarts,
  onRetryCount,
  onRequestCount,
  onOpenApp,
  loading = null,
  children,
}: {
  model: Model;
  visible: VisibleResult;
  /** The storages the Data Marts band is narrowed to; null is all of them. */
  storageIds: string[] | null;
  /** The joined data marts selected with the main one, in the order they were added. */
  joined: string[];
  /** The main mart's joinable sources, or null while they load. */
  joinSources: JoinedSource[] | null;
  /** The main grid's columns. */
  mainColumns: string[];
  counts: Map<string, CountState>;
  dq: Map<string, DqSummary>;
  foldedSources: boolean;
  foldedMarts: boolean;
  onFoldSources: () => void;
  onFoldMarts: () => void;
  onRetryCount: (id: string) => void;
  onRequestCount: (id: string) => void;
  onOpenApp: (id: string) => void;
  /** While the page is still reading: the fraction done, drawn as a bar in each band instead of its cards. */
  loading?: number | null;
  children: ReactNode;
}) {
  const [{ selection, contextIds, found }, dispatch] = useStore();
  const { preferences } = useServices();
  const [view, setView] = useState<MartsView>('grid');
  // Set by a click, so a slow read of the saved choice never overrides it.
  const touched = useRef(false);
  useEffect(() => {
    let live = true;
    preferences.loadMartsView().then((v) => { if (live) setView((cur) => (touched.current ? cur : v)); });
    return () => { live = false; };
  }, [preferences]);
  const pickView = (v: MartsView) => { touched.current = true; setHovered(null); setView(v); preferences.saveMartsView(v); };
  const smart = useSmartSearchScope();
  const rememberLeaving = useRememberLeaving();
  const canvas = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [wireTip, setWireTip] = useState<{ text: string; x: number; y: number } | null>(null);
  // The mart whose hidden neighbours show as ghosts. It follows the hovered card; a ghost being hovered keeps it, and leaving
  // waits 400 ms, so the pointer can cross the gap to a ghost.
  const [ghostOf, setGhostOf] = useState<string | null>(null);
  const click = useCardClick(model);
  const drag = useCardDrag(canvas, selection.martId, (id) => model.marts.get(id)?.title ?? id, (id) => void click(id, { mode: 'makeMain' }), (id) => view === 'grid' && model.marts.get(id)?.accessible === true);

  // Escape lets go of the hovered card; what is selected only changes by clicks and Back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHovered(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const shownIds = useMemo(() => new Set(visible.ids), [visible.ids]);
  const ghostIds = useMemo(() => {
    if (!ghostOf || view !== 'grid') return [];
    const ticked = (id: string) => storageIds === null || storageIds.includes(model.marts.get(id)?.storageId ?? '');
    return neighbours(ghostOf, model.edges).filter((id) => !shownIds.has(id) && model.marts.get(id)?.accessible && ticked(id));
  }, [ghostOf, model, shownIds, storageIds, view]);
  // A mart card's element id is `dm-<id>` (see martElementId).
  const hoveredMart = hovered?.startsWith('dm-') ? hovered.slice(3) : null;
  const overGhost = hoveredMart !== null && ghostIds.includes(hoveredMart);
  const overShown = hoveredMart !== null && shownIds.has(hoveredMart);
  // With no ghosts showing, a hovered card shows its own at once (adjusted while rendering).
  if (ghostOf === null && overShown && view === 'grid') setGhostOf(hoveredMart);
  useEffect(() => {
    if (overGhost || (overShown && hoveredMart === ghostOf)) return;
    // Resting on another shown card switches the ghosts after 400 ms, so crossing it on the way to a ghost keeps them; leaving clears them after the same grace.
    const t = setTimeout(() => setGhostOf(overShown ? hoveredMart : null), 400);
    return () => clearTimeout(t);
  }, [hoveredMart, overGhost, overShown, ghostOf]);

  const idsKey = [...visible.ids, ...ghostIds].join('|');
  // Memoised: a new array rebuilds every path, and the lines would blink on each hover.
  const wires = useMemo<Wire[]>(() => {
    const ids = idsKey ? idsKey.split('|') : [];
    const shown = new Set(ids);
    const known = new Set(model.sources.map((s) => s.key));
    const out: Wire[] = [];
    for (const id of ids) {
      const mart = model.marts.get(id);
      if (mart?.sourceKey && known.has(mart.sourceKey)) {
        out.push({ id: `source:${mart.sourceKey}>${id}`, from: sourceElementId(mart.sourceKey), to: martElementId(id), kind: 'source', title: `${model.sources.find((s) => s.key === mart.sourceKey)?.name ?? mart.sourceKey} → ${mart.title}` });
      }
    }
    if (view === 'canvas') return out;
    for (const e of model.edges) {
      if (!shown.has(e.source) || !shown.has(e.target)) continue;
      out.push({ id: `edge:${e.id}`, from: martElementId(e.source), to: martElementId(e.target), kind: 'relationship', title: e.joins.map((j) => `${j.sourceField} → ${j.targetField}`).join(', ') });
    }
    return out;
  }, [idsKey, model, view]);

  const pinned = useMemo(() => {
    if (selection.martId && idsKey.split('|').includes(selection.martId)) return martElementId(selection.martId);
    if (!selection.martId && selection.sourceKey && model.sources.some((s) => s.key === selection.sourceKey)) return sourceElementId(selection.sourceKey);
    return null;
  }, [selection.martId, selection.sourceKey, idsKey, model.sources]);

  // The same array until the set or its order changes, so the memos below do not rebuild on every render.
  const joinedKey = joinedProp.join('|');
  const joined = useMemo(() => (joinedKey ? joinedKey.split('|') : []), [joinedKey]);
  useWires(canvas, wires, { pinned, hovered, also: joined }, useMemo(() => revisionOf(idsKey), [idsKey]));

  const { lit, aside } = useMemo(() => {
    // The cards of the selected joined marts light their own neighbours too, so a mart connected only to a joined one is not dimmed.
    const pinnedSet = pinned ? new Set([...litIds(wires, pinned), ...joined.flatMap((id) => [...litIds(wires, martElementId(id))])]) : null;
    const hoveredSet = hovered ? litIds(wires, hovered) : null;
    const lit = new Set([...(pinnedSet ?? []), ...(hoveredSet ?? [])]);
    // Lit only by the pointer while another card is pinned: drawn at half strength.
    const aside = new Set([...lit].filter((id) => pinnedSet !== null && !pinnedSet.has(id)));
    return { lit, aside };
  }, [wires, pinned, hovered, joined]);

  // Cards animate in and out as the set changes; a leaving card keeps its object, which the model may no longer hold.
  const shownMarts = useMemo(() => visible.ids.flatMap((id) => model.marts.get(id) ?? []), [visible.ids, model]);
  const martCards = useCardTransitions(shownMarts, martId);
  const sourceCards = useCardTransitions(model.sources, sourceKey);

  const storages = useMemo(() => storageOptions(model), [model]);
  // Offered from two storages up: with one there is nothing to choose between.
  const storageFilter = storages.length < 2 ? undefined : (
    <MultiSelect
      label="Storage"
      options={storages.map((s) => ({ value: s.id, label: s.title, count: s.count, icon: storageMark(s.type) }))}
      selected={storageIds ?? storages.map((s) => s.id)}
      onChange={(ids) => dispatch({ type: 'setStorages', ids: ids.length === storages.length ? null : ids })}
    />
  );

  // A badge per context, in the title row: click to select it. Offered once the project has a context.
  const contextBadges = model.contexts.length === 0 ? undefined : (
    <ContextBadges contexts={model.contexts} selectedIds={contextIds} onToggle={(id) => dispatch({ type: 'toggleContext', id })} />
  );

  // A search nothing answered and no title matches: the selected mart is still shown, so the band is not empty, but it says so.
  const noMatch = smart.applied !== '' && found.length === 0 && ![...model.marts.values()].some((m) => m.accessible && matchesSearch(m, smart.applied));

  // In Canvas the band counts the marts of the report tree.
  const mainFor = selection.martId;
  const reportSize = useMemo(() => (mainFor ? buildJoinTree(mainFor, mainColumns, joinSources ?? []).nodes.size : 0), [mainFor, mainColumns, joinSources]);

  const unjoinableFor = (id: string) => !!selection.martId && visible.joinable !== null && id !== selection.martId && !joined.includes(id) && !visible.joinable.has(id);
  const contextsOf = (ids: string[]) => model.contexts.filter((c) => ids.includes(c.id));

  return (
    <div
      ref={canvas}
      className={`dm-canvas${view === 'grid' && (pinned || hovered) ? ' focused' : ''}`}
      onPointerOver={(e) => setHovered(view === 'grid' ? nodeIdOf(e.target) : null)}
      onPointerMove={(e) => {
        const text = e.target instanceof Element ? e.target.closest<SVGPathElement>('#wires path, #tree-wires path')?.dataset.tip : undefined;
        setWireTip(text ? { text, x: e.clientX, y: e.clientY } : (cur) => (cur === null ? cur : null));
      }}
      onPointerLeave={() => { setHovered(null); setWireTip(null); }}
      onFocus={(e) => setHovered(view === 'grid' ? nodeIdOf(e.target) : null)}
      onBlur={(e) => { if (!canvas.current?.contains(e.relatedTarget as Node | null)) setHovered(null); }}
    >
      <Band id="band-sources" icon={<Plug size={18} />} title="Data Sources" total={model.sources.length} hint="Connectors that feed data marts. Select one to see the marts it feeds." folded={foldedSources} onFold={onFoldSources} loading={loading}>
        {model.sources.length === 0 && <p className="dm-muted text-sm" style={{ gridColumn: '1 / -1' }}>No connector-based data marts.</p>}
        {sourceCards.items.map((source) => {
          const id = sourceElementId(source.key);
          return <SourceCard key={source.key} source={source} transition={sourceCards.transitionOf(source)} selected={selection.sourceKey === source.key} lit={lit.has(id)} aside={aside.has(id)} onSelect={() => { rememberLeaving(null); dispatch({ type: 'selectSource', key: source.key }); }} />;
        })}
      </Band>
      <Band id="band-marts" icon={<Box size={18} />} title="Data Marts" total={view === 'canvas' ? reportSize : visible.ids.length} hint="The main data mart first, and every mart it can join; or what the search and the filters match. Drag a card onto the main one to make it main." afterHint={<>{view === 'grid' && contextBadges}<ViewSwitch label="Show data marts as" options={MARTS_VIEWS} value={view} onChange={pickView} /></>} toolbar={view === 'grid' ? storageFilter : undefined} grid={view === 'grid'} folded={foldedMarts} onFold={onFoldMarts} loading={loading}>
        {view === 'canvas' ? (
          <div
            className="dm-tree-scroll"
            data-testid="marts-canvas"
            // Scrolling this box moves its cards without resizing anything, so tell the page wires to look again.
            onScroll={(e) => e.currentTarget.dispatchEvent(new Event('animationend', { bubbles: true }))}
          >
            <MartsCanvas model={model} mainId={selection.martId} columns={mainColumns} sources={joinSources} counts={counts} dq={dq} onOpenApp={onOpenApp} onRetryCount={onRetryCount} onRequestCount={onRequestCount} click={click} />
          </div>
        ) : <>
        {(visible.ids.length === 0 || noMatch) && <p className="dm-muted text-sm" style={{ gridColumn: '1 / -1' }}>No data marts match.</p>}
        {martCards.items.map((mart) => {
          const id = mart.id;
          const el = martElementId(id);
          const mainId = selection.martId;
          return (
            <MartCard
              key={id}
              mart={mart}
              transition={martCards.transitionOf(mart)}
              contexts={contextsOf(mart.contextIds)}
              count={counts.get(id) ?? { state: 'idle' }}
              quality={dq.get(id)}
              freshness={mart.dataLastUpdatedAt}
              selected={selection.martId === id}
              joined={joined.includes(id)}
              lit={lit.has(el)}
              aside={aside.has(el)}
              unjoinable={unjoinableFor(id)}
              dropTarget={drag !== null && selection.martId === id}
              dropHot={drag !== null && drag.overMain && selection.martId === id}
              mainTitle={mainId ? model.marts.get(mainId)?.title : undefined}
              onMakeMain={mainId && id !== mainId && mart.accessible ? () => void click(id, { mode: 'makeMain' }) : undefined}
              onSelect={() => void click(id)}
              onOpenApp={() => onOpenApp(id)}
              onRetryCount={() => onRetryCount(id)}
              onNeedCount={() => onRequestCount(id)}
            />
          );
        })}
        {ghostIds.flatMap((id) => {
          const mart = model.marts.get(id);
          if (!mart) return [];
          const el = martElementId(id);
          const mainId = selection.martId;
          return [
            <MartCard
              key={`ghost-${id}`}
              mart={mart}
              ghost
              contexts={contextsOf(mart.contextIds)}
              count={{ state: 'idle' }}
              quality={dq.get(id)}
              freshness={mart.dataLastUpdatedAt}
              selected={false}
              joined={false}
              lit={lit.has(el)}
              aside={aside.has(el)}
              unjoinable={unjoinableFor(id)}
              mainTitle={mainId ? model.marts.get(mainId)?.title : undefined}
              onMakeMain={mainId && id !== mainId ? () => void click(id, { mode: 'makeMain' }) : undefined}
              onSelect={() => void click(id)}
              onOpenApp={() => onOpenApp(id)}
              onRetryCount={() => undefined}
              onNeedCount={() => undefined}
            />,
          ];
        })}
        </>}
      </Band>
      <CardClickContext.Provider value={click}>{children}</CardClickContext.Provider>
      {drag && <div className="dm-drag-ghost" style={{ left: drag.x + 8, top: drag.y + 8 }} aria-hidden>{drag.title}</div>}
      {wireTip && <PointerTip text={wireTip.text} x={wireTip.x} y={wireTip.y} />}
    </div>
  );
}
