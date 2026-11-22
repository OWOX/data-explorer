// The Sources and Data bands with the lines between their cards, and the hover that lights them.
// The Data and Row bands arrive as children and sit under the same canvas; they do not re-render on hover.
import { Box, LayoutGrid, Network, Plug } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { DqSummary, Mart, Model, Source } from '../../model/types';
import { matchesSearch } from '../../graph/search';
import { storageOptions } from '../../graph/storages';
import { neighbours, type VisibleResult } from '../../graph/visible';
import { useRememberLeaving } from '../../state/leaving';
import { useServices, useStore } from '../../state/store';
import { storageMark } from '../storage-icons';
import { Band } from './Band';
import { MakeMainButton, ViewSwitch, type SwitchOption } from './ViewSwitch';
import { MultiSelect } from './MultiSelect';
import { ContextBadges } from './ContextBadges';
import { useSmartSearchScope } from './SmartSearchScope';
import { PointerTip } from '../Tooltip';
import { CardClickContext } from './CardClick';
import { MartCard, SourceCard, contextsOf, martElementId, sourceElementId, type CountState } from './cards';
import { useCardTransitions } from './transitions';
import { useCardClick } from './useCardClick';
import { useCardDrag } from './useCardDrag';
import { litIds, revisionOf, useWires, type Wire } from './wires';
import { MartsCanvas } from './MartsCanvas';
import { buildJoinTree, ghostSources, subtreePaths, type TreeNode } from '../../state/join-tree';
import { pathTitle } from '../../state/join-plan';
import { useGridFocus } from './useGridFocus';
import { useLatest } from '../useLatest';
import type { JoinedSource } from '../../api/blendable';

type MartsView = 'grid' | 'canvas';
const MARTS_VIEWS: SwitchOption<MartsView>[] = [
  { value: 'grid', label: 'Grid', icon: LayoutGrid },
  { value: 'canvas', label: 'Graph', icon: Network },
];

const martId = (m: Mart) => m.id;
const sourceKey = (s: Source) => s.key;

/** Whether the mart sits in a storage the band is narrowed to. */
const storageTicked = (model: Model, storageIds: string[] | null, id: string) => storageIds === null || storageIds.includes(model.marts.get(id)?.storageId ?? '');

const nodeIdOf = (target: EventTarget | null) => (target instanceof Element ? target.closest('[data-node]')?.id ?? null : null);

/**
 * The tip that follows the pointer over a line. It listens on the canvas itself and keeps its own state, so a pointer move
 * re-renders this layer and not every card in the bands.
 */
export function WireTipLayer({ canvas }: { canvas: RefObject<HTMLElement | null> }) {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const root = canvas.current;
    if (!root) return;
    const move = (e: PointerEvent) => {
      const text = e.target instanceof Element ? e.target.closest<SVGPathElement>('#wires path, #tree-wires path')?.dataset.tip : undefined;
      setTip(text ? { text, x: e.clientX, y: e.clientY } : (cur) => (cur === null ? cur : null));
    };
    const leave = () => setTip(null);
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerleave', leave);
    return () => { root.removeEventListener('pointermove', move); root.removeEventListener('pointerleave', leave); };
  }, [canvas]);
  return tip && <PointerTip text={tip.text} x={tip.x} y={tip.y} />;
}

export function CardBands({
  model,
  visible,
  storageIds,
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
  // The mart whose hidden neighbours show as ghosts. It follows the hovered card; a ghost being hovered keeps it, and leaving
  // waits 400 ms, so the pointer can cross the gap to a ghost.
  const [ghostOf, setGhostOf] = useState<string | null>(null);
  const click = useCardClick(model);
  // The Graph's pinned card, when it is a joined one (the Grid's own is `focus`, below).
  const [graphSelected, setGraphSelected] = useState<string | null>(null);
  const drag = useCardDrag(canvas, selection.martId, (id) => model.marts.get(id)?.title ?? id, (id) => void click(id, { mode: 'makeMain' }), (id) => view === 'grid' && model.marts.get(id)?.accessible === true);

  // The report tree: a joined mart is a node per alias path, in Graph and in Grid, and a source line reaches each of them.
  const mainFor = selection.martId;
  const canvasTree = useMemo(() => (mainFor ? buildJoinTree(mainFor, mainColumns, joinSources ?? []) : null), [mainFor, mainColumns, joinSources]);
  const { focus, toggle: toggleFocus, clear: clearFocus, show: showFocus } = useGridFocus(mainFor, canvasTree, view === 'grid');
  // The tree and main mart of the latest render: a click that resolves later checks what its step left, not what it was started on.
  const latestTree = useLatest({ main: mainFor, tree: canvasTree });
  // A card added from the band moves from the outside list to the report list, so React remounts it and focus would drop to the page:
  // the new report card takes it once it renders. `path` is null when the click did not say where; the new node of that mart is it then.
  const [focusAdded, setFocusAdded] = useState<{ martId: string; path: string | null; before: Set<string> } | null>(null);
  useEffect(() => {
    if (focusAdded === null || !canvasTree) return;
    const path = focusAdded.path ?? [...canvasTree.nodes.values()].find((n) => n.martId === focusAdded.martId && !focusAdded.before.has(n.path))?.path;
    if (path === undefined) return;
    const card = canvas.current?.querySelector<HTMLElement>(`#${CSS.escape(martElementId(focusAdded.martId, path || undefined))}:not([data-ghost])`);
    if (!card) return;
    card.focus();
    setFocusAdded(null);
  }, [focusAdded, canvasTree]);
  const addFromBand = (id: string, options?: { addAt?: string }) => {
    const before = new Set(canvasTree?.nodes.keys());
    // Only when focus is on the card being added: a click with the pointer elsewhere moves nothing.
    const hadFocus = document.activeElement?.closest('article')?.getAttribute('data-mart-id') === id;
    const main = mainFor;
    void click(id, options).then(() => {
      // The added card is focused, so what joins under it shows at once. A click that added nothing, or made another mart the main one, focuses nothing.
      const now = latestTree.current;
      if (now.main === main && now.tree) {
        const added = options?.addAt ?? [...now.tree.nodes.values()].find((n) => n.martId === id && !before.has(n.path))?.path;
        if (added !== undefined && !before.has(added) && now.tree.nodes.has(added)) showFocus(added);
      }
      if (!hadFocus) return;
      setFocusAdded({ martId: id, path: options?.addAt ?? null, before });
      // A click that changed nothing must not take focus from whatever the member moves to next.
      setTimeout(() => setFocusAdded((cur) => (cur?.before === before ? null : cur)), 1000);
    }, () => undefined);
  };

  // Escape lets go of the hovered card; what is selected only changes by clicks and Back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHovered(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const shownIds = useMemo(() => new Set(visible.ids), [visible.ids]);
  const ghostIds = useMemo(() => {
    if (view !== 'grid') return [];
    if (!ghostOf || focus !== null) return [];
    const ticked = (id: string) => storageTicked(model, storageIds, id);
    // With a main mart only what it can join is offered, as in the band.
    const reachable = (id: string) => visible.joinable === null || visible.joinable.has(id);
    return neighbours(ghostOf, model.edges).filter((id) => !shownIds.has(id) && model.marts.get(id)?.accessible && ticked(id) && reachable(id));
  }, [ghostOf, model, shownIds, storageIds, view, focus, visible.joinable]);
  // A mart card's element id is `dm-<id>`, or `dm-<id>@<alias path>` for a joined card (see martElementId).
  const hoveredMart = hovered?.startsWith('dm-') ? hovered.slice(3).split('@')[0]! : null;
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

  // What a focused card offers: the sources one hop under its path that are not in use. A mart that is a card of the band outside
  // the report keeps that card (a click on it adds at the source's path); the others show as ghost cards, one per source.
  // A card is titled with its path only when the report reaches that mart through more than one path.
  const sourceTitle = (path: string) => {
    const source = joinSources?.find((x) => x.aliasPath === path);
    return source ? pathTitle(source, [...(canvasTree?.nodes.keys() ?? [])], joinSources ?? []) : undefined;
  };
  const reportMarts = useMemo(() => new Set(canvasTree ? [...canvasTree.nodes.values()].map((n) => n.martId) : []), [canvasTree]);
  const focusSources = useMemo(() => {
    if (focus === null || !canvasTree || !joinSources) return [];
    const ticked = (id: string) => storageTicked(model, storageIds, id);
    return ghostSources(canvasTree, joinSources, focus).filter((s) => model.marts.get(s.martId)?.accessible && ticked(s.martId));
  }, [focus, canvasTree, joinSources, model, storageIds]);
  const inBand = (id: string) => shownIds.has(id) && !reportMarts.has(id);
  const joinableAt = new Map<string, JoinedSource>();
  for (const s of focusSources) if (inBand(s.martId) && !joinableAt.has(s.martId)) joinableAt.set(s.martId, s);
  const focusGhosts = focusSources.filter((s) => !inBand(s.martId));
  const focusKey = focusGhosts.map((s) => s.aliasPath).join('|');
  const idsKey = [...visible.ids, ...ghostIds].join('|');
  const treeKey = (canvasTree ? [...canvasTree.nodes.keys()].join('>') : '') + (focusKey ? `|${focusKey}` : '');
  // Memoised: a new array rebuilds every path, and the lines would blink on each hover.
  const wires = useMemo<Wire[]>(() => {
    const ids = idsKey ? idsKey.split('|') : [];
    const shown = new Set(ids);
    const known = new Set(model.sources.map((s) => s.key));
    const out: Wire[] = [];
    const nodes = canvasTree ? [...canvasTree.nodes.values()] : [];
    const inReport = new Set(nodes.map((n) => n.martId));
    const targets = view === 'canvas' ? nodes.map((n) => ({ id: n.martId, path: n.path })) : [
      ...nodes.filter((n) => shown.has(n.martId)).map((n) => ({ id: n.martId, path: n.path })),
      ...ids.filter((id) => !inReport.has(id)).map((id) => ({ id, path: '' })),
      ...focusGhosts.map((s) => ({ id: s.martId, path: s.aliasPath })),
    ];
    for (const { id, path } of targets) {
      const mart = model.marts.get(id);
      if (mart?.sourceKey && known.has(mart.sourceKey)) {
        out.push({ id: `source:${mart.sourceKey}>${id}${path ? `@${path}` : ''}`, from: sourceElementId(mart.sourceKey), to: martElementId(id, path || undefined), kind: 'source', title: `${model.sources.find((s) => s.key === mart.sourceKey)?.name ?? mart.sourceKey} → ${mart.title}` });
      }
    }
    if (view === 'canvas') return out;
    // Report cards are joined parent to child along the paths in use; the other edges stay between the marts.
    for (const n of nodes) {
      if (n.parent === null || !shown.has(n.martId)) continue;
      const parent = canvasTree!.nodes.get(n.parent)!;
      if (!shown.has(parent.martId)) continue;
      // The join fields when the source's relationship is known, the two titles otherwise.
      const edge = model.edges.find((e) => e.id === joinSources?.find((x) => x.aliasPath === n.path)?.relationshipId && e.source === parent.martId && e.target === n.martId);
      const title = edge && edge.joins.length > 0 ? edge.joins.map((j) => `${j.sourceField} → ${j.targetField}`).join(', ') : `${model.marts.get(parent.martId)?.title ?? parent.martId} → ${model.marts.get(n.martId)?.title ?? n.martId}`;
      out.push({ id: `tree:${n.path}`, from: martElementId(parent.martId, parent.path || undefined), to: martElementId(n.martId, n.path), kind: 'relationship', title });
    }
    // A report mart's own card: the main one, or the first path it is joined at.
    const cardOf = (id: string) => { const n = nodes.find((x) => x.martId === id); return n ? martElementId(id, n.path || undefined) : martElementId(id); };
    for (const e of model.edges) {
      if (!shown.has(e.source) || !shown.has(e.target) || (inReport.has(e.source) && inReport.has(e.target))) continue;
      out.push({ id: `edge:${e.id}`, from: cardOf(e.source), to: cardOf(e.target), kind: 'relationship', title: e.joins.map((j) => `${j.sourceField} → ${j.targetField}`).join(', ') });
    }
    return out;
  // `treeKey` stands for canvasTree.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, treeKey, model, view]);

  const pinned = useMemo(() => {
    if (selection.martId && idsKey.split('|').includes(selection.martId)) return martElementId(selection.martId);
    if (!selection.martId && selection.sourceKey && model.sources.some((s) => s.key === selection.sourceKey)) return sourceElementId(selection.sourceKey);
    return null;
  }, [selection.martId, selection.sourceKey, idsKey, model.sources]);

  // In Grid a joined card is one per alias path, and each line to the main card is raised with it.
  const joinedEls = useMemo(() => (canvasTree ? [...canvasTree.nodes.values()].filter((n) => n.path !== '').map((n) => martElementId(n.martId, n.path)) : []), [canvasTree]);
  useWires(canvas, wires, { pinned, hovered, also: joinedEls }, useMemo(() => revisionOf(idsKey + treeKey), [idsKey, treeKey]));

  const { lit, aside } = useMemo(() => {
    // The cards of the selected joined marts light their own neighbours too, so a mart connected only to a joined one is not dimmed.
    const pinnedSet = pinned ? new Set([...litIds(wires, pinned), ...joinedEls.flatMap((el) => [...litIds(wires, el)])]) : null;
    const hoveredSet = hovered ? litIds(wires, hovered) : null;
    const lit = new Set([...(pinnedSet ?? []), ...(hoveredSet ?? [])]);
    // Lit only by the pointer while another card is pinned: drawn at half strength.
    const aside = new Set([...lit].filter((id) => pinnedSet !== null && !pinnedSet.has(id)));
    return { lit, aside };
  }, [wires, pinned, hovered, joinedEls]);

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

  // A badge per context, in the toolbar left of the Storage filter: click to select it. Offered once the project has a context.
  const contextBadges = model.contexts.length === 0 ? undefined : (
    <ContextBadges contexts={model.contexts} selectedIds={contextIds} onToggle={(id) => dispatch({ type: 'toggleContext', id })} />
  );

  // A search nothing answered and no title matches: the selected mart is still shown, so the band is not empty, but it says so.
  const noMatch = smart.applied !== '' && found.length === 0 && ![...model.marts.values()].some((m) => m.accessible && matchesSearch(m, smart.applied));

  // In Graph the band counts the marts of the report tree.
  const reportSize = canvasTree ? canvasTree.nodes.size : 0;

  // The selected card (a joined one), when the member can open it: the header offers to make it the main one.
  const selectedJoined = view === 'canvas' ? graphSelected : focus ? canvasTree?.nodes.get(focus)?.martId ?? null : null;
  const makeMainId = selectedJoined !== null && selectedJoined !== mainFor && model.marts.get(selectedJoined)?.accessible === true ? selectedJoined : null;

  return (
    <div
      ref={canvas}
      className={`dm-canvas${view === 'grid' && (pinned || hovered) ? ' focused' : ''}${view === 'canvas' && pinned ? ' sources-focused' : ''}`}
      onClick={(e) => { if (e.target instanceof Element && e.target.closest('#band-marts .dm-band-body') && !e.target.closest('article, button, a')) { if (focus !== null) clearFocus(); } }}
      // A portaled title bubble bubbles its events through React; it is not in the canvas in the DOM, so it changes no hover.
      onPointerOver={(e) => { if (e.currentTarget.contains(e.target as Node)) setHovered(view === 'grid' ? nodeIdOf(e.target) : null); }}
      onPointerLeave={() => setHovered(null)}
      onFocus={(e) => { if (e.currentTarget.contains(e.target as Node)) setHovered(view === 'grid' ? nodeIdOf(e.target) : null); }}
      onBlur={(e) => { if (!canvas.current?.contains(e.relatedTarget as Node | null)) setHovered(null); }}
    >
      <Band id="band-sources" icon={<Plug size={18} />} title="Data Sources" total={model.sources.length} hint="Connectors that feed data marts. Select one to see the marts it feeds." folded={foldedSources} onFold={onFoldSources} loading={loading}>
        {model.sources.length === 0 && <p className="dm-muted text-sm" style={{ gridColumn: '1 / -1' }}>No connector-based data marts.</p>}
        {sourceCards.items.map((source) => {
          const id = sourceElementId(source.key);
          return <SourceCard key={source.key} source={source} transition={sourceCards.transitionOf(source)} selected={selection.sourceKey === source.key} lit={lit.has(id)} aside={aside.has(id)} onSelect={() => { rememberLeaving(null); dispatch({ type: 'selectSource', key: source.key }); if (view === 'canvas') pickView('grid'); }} />;
        })}
      </Band>
      <Band id="band-marts" icon={<Box size={18} />} title="Data Marts" total={view === 'canvas' ? reportSize : visible.ids.length} hint="The main data mart first, and every mart it can join; or what the search and the filters match. Drag a card onto the main one to make it main." afterHint={<><ViewSwitch label="Show data marts as" options={MARTS_VIEWS} value={view} onChange={pickView} />{makeMainId !== null && <MakeMainButton title={model.marts.get(makeMainId)?.title ?? 'it'} onClick={() => { void click(makeMainId, { mode: 'makeMain' }); }} />}</>} toolbar={view === 'grid' ? <>{contextBadges}{storageFilter}</> : undefined} grid={view === 'grid'} folded={foldedMarts} onFold={onFoldMarts} loading={loading}>
        {view === 'canvas' ? (
          <div
            className="dm-tree-scroll"
            data-testid="marts-canvas"
            // Scrolling this box moves its cards without resizing anything, so tell the page wires to look again.
            onScroll={(e) => e.currentTarget.dispatchEvent(new Event('animationend', { bubbles: true }))}
          >
            <MartsCanvas model={model} mainId={selection.martId} columns={mainColumns} sources={joinSources} counts={counts} dq={dq} onOpenApp={onOpenApp} onRetryCount={onRetryCount} onRequestCount={onRequestCount} click={click} onSelectedMart={setGraphSelected} />
          </div>
        ) : <>
        {(visible.ids.length === 0 || noMatch) && <p className="dm-muted text-sm" style={{ gridColumn: '1 / -1' }}>No data marts match.</p>}
        {(() => {
          const nodes = canvasTree ? [...canvasTree.nodes.values()] : [];
          const reportCard = (node: TreeNode) => {
            const mart = model.marts.get(node.martId);
            if (!mart || !shownIds.has(mart.id)) return [];
            const id = mart.id;
            const path = node.path;
            const el = martElementId(id, path || undefined);
            const isMain = path === '';
            return [
              <MartCard
                key={isMain ? id : `${id}@${path}`}
                mart={mart}
                transition={martCards.transitionOf(mart)}
                contexts={contextsOf(model.contexts, mart.contextIds)}
                count={counts.get(id) ?? { state: 'idle' }}
                quality={dq.get(id)}
                selected={isMain}
                joined={!isMain}
                path={path || undefined}
                title={isMain ? undefined : sourceTitle(path)}
                focused={focus === path}
                lit={lit.has(el)}
                aside={aside.has(el)}
                dropTarget={isMain && drag !== null}
                dropHot={isMain && drag !== null && drag.overMain}
                onRemove={isMain ? undefined : () => {
                  const parent = canvasTree!.nodes.get(node.parent!)!;
                  void click(id, { removePaths: node.bare ? subtreePaths(canvasTree!, path) : [path] }).then(() => document.getElementById(martElementId(parent.martId, parent.path || undefined))?.focus(), () => undefined);
                }}
                onSelect={() => { toggleFocus(path); }}
                onOpenApp={() => onOpenApp(id)}
                onRetryCount={() => onRetryCount(id)}
                onNeedCount={() => onRequestCount(id)}
              />,
            ];
          };
          return <>
            {/* Tree order, not column order: a joined card sits after its parent. */}
            {nodes.flatMap(reportCard)}
            {martCards.items.filter((mart) => !reportMarts.has(mart.id)).map((mart) => {
              const id = mart.id;
              const el = martElementId(id);
              const at = joinableAt.get(id);
              return (
                <MartCard
                  key={id}
                  mart={mart}
                  transition={martCards.transitionOf(mart)}
                  contexts={contextsOf(model.contexts, mart.contextIds)}
                  count={counts.get(id) ?? { state: 'idle' }}
                  quality={dq.get(id)}
                  selected={false}
                  joined={false}
                  lit={lit.has(el)}
                  aside={aside.has(el)}
                  unjoinable={focus !== null && !at}
                  onSelect={() => (at ? addFromBand(id, { addAt: at.aliasPath }) : addFromBand(id))}
                  onOpenApp={() => onOpenApp(id)}
                  onRetryCount={() => onRetryCount(id)}
                  onNeedCount={() => onRequestCount(id)}
                />
              );
            })}
            {focusGhosts.flatMap((s) => {
              const mart = model.marts.get(s.martId);
              if (!mart) return [];
              return [
                <MartCard
                  key={`focus-ghost-${s.aliasPath}`}
                  mart={mart}
                  ghost
                  path={s.aliasPath}
                  title={pathTitle(s, [...(canvasTree?.nodes.keys() ?? [])], joinSources ?? [])}
                  contexts={contextsOf(model.contexts, mart.contextIds)}
                  quality={dq.get(mart.id)}
                  selected={false}
                  joined={false}
                  lit={false}
                  onSelect={() => addFromBand(mart.id, { addAt: s.aliasPath })}
                  onOpenApp={() => onOpenApp(mart.id)}
                />,
              ];
            })}
          </>;
        })()}
        {ghostIds.flatMap((id) => {
          const mart = model.marts.get(id);
          if (!mart) return [];
          const el = martElementId(id);
          return [
            <MartCard
              key={`ghost-${id}`}
              mart={mart}
              ghost
              contexts={contextsOf(model.contexts, mart.contextIds)}
              quality={dq.get(id)}
              selected={false}
              joined={false}
              lit={lit.has(el)}
              aside={aside.has(el)}
              onSelect={() => addFromBand(id)}
              onOpenApp={() => onOpenApp(id)}
            />,
          ];
        })}
        </>}
      </Band>
      <CardClickContext.Provider value={click}>{children}</CardClickContext.Provider>
      {drag && <div className="dm-drag-ghost" style={{ left: drag.x + 8, top: drag.y + 8 }} aria-hidden>{drag.title}</div>}
      <WireTipLayer canvas={canvas} />
    </div>
  );
}
