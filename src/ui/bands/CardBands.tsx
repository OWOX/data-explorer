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
import { edgeOf, edgeOutputAlias, joinAlias, noteFields, relationshipNote } from './relationshipNote';
import { useOwnAliases } from './useOwnAliases';
import { litIds, revisionOf, useWires, type Wire } from './wires';
import { MartsCanvas } from './MartsCanvas';
import { buildJoinTree, ghostSources, subtreePaths, type TreeNode } from '../../state/join-tree';
import { closestGridTarget, gridTargets, measureGridDrag } from './useGridDrag';
import { DragLines } from './DragLines';
import { parentPath, pathTitle, shortestSource } from '../../state/join-plan';
import { useGridFocus } from './useGridFocus';
import { useLatest } from '../useLatest';
import type { JoinedSource } from '../../api/blendable';

type MartsView = 'grid' | 'canvas';
export const MARTS_HINT =
  'The main data mart first, and every mart it can join; or what the search and the filters match. Drag a joined card near another to join it there.';

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
 * The tip over a line of `canvas`. It keeps its own state, so a pointer move re-renders this layer and not every card in the bands.
 * A plain tip follows the pointer. One with a description stays where it opened, and stays open a moment after the pointer leaves the line,
 * so the pointer can reach its "More" link.
 */
export function WireTipLayer({ canvas }: { canvas: RefObject<HTMLElement | null> }) {
  const [tip, setTip] = useState<{ line: string; text: string; more?: string; x: number; y: number } | null>(null);
  // The tip as the handlers last set it: they run outside render, so they read it here and not from a stale closure.
  const tipRef = useRef(tip);
  const put = (next: typeof tip) => { tipRef.current = next; setTip(next); };
  const hideTimer = useRef<number | undefined>(undefined);
  const keep = () => { window.clearTimeout(hideTimer.current); hideTimer.current = undefined; };
  const hideSoon = () => { if (hideTimer.current === undefined) hideTimer.current = window.setTimeout(() => { hideTimer.current = undefined; put(null); }, 300); };
  useEffect(() => {
    const root = canvas.current;
    if (!root) return;
    const off = () => { if (tipRef.current?.more) hideSoon(); else { keep(); if (tipRef.current) put(null); } };
    // One listener on the document: the bubble is drawn on the body, outside the canvas, and the pointer on it keeps it open.
    const move = (e: PointerEvent) => {
      const at = e.target instanceof Element ? e.target : null;
      if (at?.closest('.dm-tip-interactive')) { keep(); return; }
      // A pressed pointer is dragging a card: a bubble in its way would take the drop.
      if (e.buttons) { keep(); if (tipRef.current) put(null); return; }
      const el = at && root.contains(at) ? at.closest<SVGElement>('#wires :is(path, circle), #tree-wires :is(path, circle)') : null;
      const text = el?.dataset.tip;
      if (!el || !text) { off(); return; }
      keep();
      // A line is its two cards, not its element: the path and its dot are one line, and a redrawn path is the same line.
      const line = el.dataset.line ?? text;
      const cur = tipRef.current;
      if (cur?.line === line && cur.more) return;
      const more = el.dataset.more;
      put({ line, text, ...(more ? { more } : {}), x: e.clientX, y: e.clientY });
    };
    document.addEventListener('pointermove', move);
    root.addEventListener('pointerleave', off);
    document.documentElement.addEventListener('pointerleave', off);
    return () => { document.removeEventListener('pointermove', move); root.removeEventListener('pointerleave', off); document.documentElement.removeEventListener('pointerleave', off); keep(); };
  // `put`, `keep` and `hideSoon` touch only refs and the state setter: the listeners need not be swapped when they are made again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas]);
  return tip && <PointerTip key={tip.line} text={tip.text} more={tip.more} x={tip.x} y={tip.y} />;
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

  // The report tree: a joined mart is a node per alias path, in Graph and in Grid, and a source line reaches each of them.
  const mainFor = selection.martId;
  const canvasTree = useMemo(() => (mainFor ? buildJoinTree(mainFor, mainColumns, joinSources ?? []) : null), [mainFor, mainColumns, joinSources]);
  const { focus, toggle: toggleFocus, clear: clearFocus, show: showFocus } = useGridFocus(mainFor, canvasTree, view === 'grid');
  // Marts joined below the main one name their own joins: the lines under them read those names.
  const own = useOwnAliases();
  // Only joined cards are dragged: dropped near another mart they are rejoined under it. Making a mart main is the header's button.
  const drag = useCardDrag(
    canvas,
    (id) => model.marts.get(id)?.title ?? id,
    (path, x, y) => {
      const node = canvasTree?.nodes.get(path);
      const pick = closestGridTarget(gridTargets(canvas.current, canvasTree, joinSources, path), x, y);
      if (node && pick && pick.moves.size > 0) void click(node.martId, { moves: pick.moves });
    },
    (path) => view === 'grid' && canvasTree?.nodes.has(path) === true && path !== '',
    (path, x, y, inside) => measureGridDrag(canvas.current, canvasTree, joinSources, path, x, y, inside),
  );
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
  const dragging = drag !== null;
  // A card in hand ignores the hover: the lines and the dim are the drag's.
  const liveHover = dragging ? null : hovered;
  const ghostIds = useMemo(() => {
    if (view !== 'grid') return [];
    if (!ghostOf || focus !== null || dragging) return [];
    const ticked = (id: string) => storageTicked(model, storageIds, id);
    // With a main mart only what it can join is offered, as in the band.
    const reachable = (id: string) => visible.joinable === null || visible.joinable.has(id);
    return neighbours(ghostOf, model.edges).filter((id) => !shownIds.has(id) && model.marts.get(id)?.accessible && ticked(id) && reachable(id));
  }, [ghostOf, model, shownIds, storageIds, view, focus, visible.joinable, dragging]);
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
    if (focus === null || !canvasTree || !joinSources || dragging) return [];
    const ticked = (id: string) => storageTicked(model, storageIds, id);
    return ghostSources(canvasTree, joinSources, focus).filter((s) => model.marts.get(s.martId)?.accessible && ticked(s.martId));
  }, [focus, canvasTree, joinSources, model, storageIds, dragging]);
  const inBand = (id: string) => shownIds.has(id) && !reportMarts.has(id);
  const joinableAt = new Map<string, JoinedSource>();
  for (const s of focusSources) if (inBand(s.martId) && !joinableAt.has(s.martId)) joinableAt.set(s.martId, s);
  const focusGhosts = focusSources.filter((s) => !inBand(s.martId));
  const focusKey = focusGhosts.map((s) => s.aliasPath).join('|');
  const idsKey = [...visible.ids, ...ghostIds].join('|');
  // The focused card and the band cards it can take are part of the lines drawn, so they are part of the key.
  const focusLinks = focus === null ? '' : `|${focus}:${[...joinableAt].map(([id, s]) => `${id}@${s.aliasPath}`).join(',')}`;
  const treeKey = (canvasTree ? [...canvasTree.nodes.keys()].join('>') : '') + (focusKey ? `|${focusKey}` : '') + focusLinks;
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
      const src = joinSources?.find((x) => x.aliasPath === n.path);
      const edge = edgeOf(model.edges, parent.martId, n.martId, n.path, src?.relationshipId);
      const note = relationshipNote(edge, model.marts.get(n.martId)?.title ?? '', joinAlias(src?.outputAlias, model.marts.get(n.martId)?.title ?? '', parent.martId, parent.path, n.path, own));
      out.push({ id: `tree:${n.path}`, from: martElementId(parent.martId, parent.path || undefined), to: martElementId(n.martId, n.path), kind: 'relationship', ...noteFields(note), joined: true });
    }
    // The relationships a dashed line already stands for, per pair of cards: the plain edge between the same two cards would name one a second time.
    const claimed = new Set<string>();
    const claimKey = (edgeId: string, from: string, to: string) => `${edgeId}|${from}|${to}`;
    const claim = (edge: { id: string } | undefined, from: string, to: string) => { if (edge) claimed.add(claimKey(edge.id, from, to)); };
    // The focused card offers the marts it can take: a dashed line to each, the band cards and the ghosts alike.
    const focusNode = focus === null ? undefined : canvasTree?.nodes.get(focus);
    if (focusNode && shown.has(focusNode.martId)) {
      const from = martElementId(focusNode.martId, focusNode.path || undefined);
      const name = (id: string) => model.marts.get(id)?.title ?? id;
      // A dashed line names its relationship like a solid one, so the second relationship to a mart gets its own dot.
      const noteOfGhost = (parentId: string, source: JoinedSource, to: string) => {
        const edge = edgeOf(model.edges, parentId, source.martId, source.aliasPath, source.relationshipId);
        claim(edge, from, to);
        return relationshipNote(edge, name(source.martId), joinAlias(source.outputAlias, name(source.martId), parentId, focusNode.path, source.aliasPath, own));
      };
      for (const [id, source] of joinableAt) { const note = noteOfGhost(focusNode.martId, source, martElementId(id)); out.push({ id: `ghost:${id}@${source.aliasPath}`, from, to: martElementId(id), kind: 'relationship', ...noteFields(note), dashed: true }); }
      for (const source of focusGhosts) { const note = noteOfGhost(focusNode.martId, source, martElementId(source.martId, source.aliasPath)); out.push({ id: `ghost:${source.aliasPath}`, from, to: martElementId(source.martId, source.aliasPath), kind: 'relationship', ...noteFields(note), dashed: true }); }
    }
    // A report mart's own card: the main one, or the first path it is joined at.
    const cardOf = (id: string) => { const n = nodes.find((x) => x.martId === id); return n ? martElementId(id, n.path || undefined) : martElementId(id); };
    // Every shown mart outside the report gets one dashed line, drawn at once: from the last hop of its shortest chain to the report,
    // which is a card of the report or another outside mart. A band card the focused card can take has its line from that card instead.
    if (joinSources) {
      const inUse = new Set(nodes.map((n) => n.path));
      const outside = (path: string) => { const id = joinSources.find((x) => x.aliasPath === path)?.martId; return id !== undefined && shown.has(id) && !inReport.has(id) ? id : null; };
      const hopCard = (path: string): string => {
        for (let p = path; ; p = parentPath(p)) {
          const node = canvasTree!.nodes.get(p);
          if (node) return martElementId(node.martId, node.path || undefined);
          const id = p === '' ? null : outside(p);
          if (id !== null) return martElementId(id);
          if (p === '') return martElementId(canvasTree!.nodes.get('')!.martId);
        }
      };
      const name = (id: string) => model.marts.get(id)?.title ?? id;
      for (const id of ids) {
        if (inReport.has(id) || (focus !== null && joinableAt.has(id)) || !model.marts.get(id)?.accessible) continue;
        const source = shortestSource(joinSources, id, inUse);
        if (!source) continue;
        const parent = parentPath(source.aliasPath);
        const parentMart = canvasTree!.nodes.get(parent)?.martId ?? joinSources.find((x) => x.aliasPath === parent)?.martId;
        // These lines are drawn for every band card at once, so they say the main mart's alias (or the title) and read no other mart's settings.
        const edge = parentMart ? edgeOf(model.edges, parentMart, id, source.aliasPath, source.relationshipId) : undefined;
        const from = hopCard(parent);
        claim(edge, from, martElementId(id));
        const note = relationshipNote(edge, name(id), source.outputAlias);
        out.push({ id: `ghost:${source.aliasPath}@band`, from, to: martElementId(id), kind: 'relationship', ...noteFields(note), dashed: true });
      }
    }
    // The other edges between marts stay plain: dashed, and drawn when a card on one is lit.
    for (const e of model.edges) {
      if (!shown.has(e.source) || !shown.has(e.target) || (inReport.has(e.source) && inReport.has(e.target))) continue;
      if (claimed.has(claimKey(e.id, cardOf(e.source), cardOf(e.target)))) continue;
      const fromPath = inReport.has(e.source) ? nodes.find((x) => x.martId === e.source)?.path : undefined;
      // A band card has no path of its own: the line follows the dashed line to the target, which uses the shortest source.
      const band = fromPath === undefined && !inReport.has(e.target) && joinSources ? shortestSource(joinSources, e.target, new Set(nodes.map((n) => n.path))) : undefined;
      const outputAlias = edgeOutputAlias(e, model.marts.get(e.target)?.title ?? '', joinSources ?? [], fromPath, band);
      const note = relationshipNote(e, model.marts.get(e.target)?.title ?? '', outputAlias);
      out.push({ id: `edge:${e.id}`, from: cardOf(e.source), to: cardOf(e.target), kind: 'relationship', ...noteFields(note) });
    }
    return out;
  // `treeKey` stands for canvasTree.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, treeKey, model, view, joinSources, own]);

  const pinned = useMemo(() => {
    if (selection.martId && idsKey.split('|').includes(selection.martId)) return martElementId(selection.martId);
    if (!selection.martId && selection.sourceKey && model.sources.some((s) => s.key === selection.sourceKey)) return sourceElementId(selection.sourceKey);
    return null;
  }, [selection.martId, selection.sourceKey, idsKey, model.sources]);

  // In Grid a joined card is one per alias path, and each line to the main card is raised with it.
  const joinedEls = useMemo(() => (canvasTree ? [...canvasTree.nodes.values()].filter((n) => n.path !== '').map((n) => martElementId(n.martId, n.path)) : []), [canvasTree]);

  // The hovered card as `reach` reads it: set at once, and let go 400 ms after the pointer leaves, so crossing the gap between cards
  // (or to a ghost) does not blink the cards outside the report.
  const [laggedHover, setLaggedHover] = useState<string | null>(null);
  // Adjusted while rendering: a hover is taken at once.
  if (liveHover !== null && laggedHover !== liveHover) setLaggedHover(liveHover);
  useEffect(() => {
    if (liveHover !== null) return;
    const t = setTimeout(() => setLaggedHover(null), 400);
    return () => clearTimeout(t);
  }, [liveHover]);
  const { lit, aside, near, reach } = useMemo(() => {
    // The cards of the selected joined marts light their own neighbours too, so a mart connected only to a joined one is not dimmed.
    const pinnedSet = pinned ? new Set([...litIds(wires, pinned), ...joinedEls.flatMap((el) => [...litIds(wires, el)])]) : null;
    const hoveredSet = liveHover ? litIds(wires, liveHover) : null;
    const lit = new Set([...(pinnedSet ?? []), ...(hoveredSet ?? [])]);
    // Lit only by the pointer while another card is pinned: drawn at half strength.
    const aside = new Set([...lit].filter((id) => pinnedSet !== null && !pinnedSet.has(id)));
    // While a card is hovered, the cards that are not it or on a line with it fade to half.
    // With a main mart, a mart outside the report stays full strength only while it can join the hovered or the focused card.
    const focusNode = focus === null ? undefined : canvasTree?.nodes.get(focus);
    const focusSet = focusNode ? litIds(wires, martElementId(focusNode.martId, focusNode.path || undefined)) : null;
    const reachSet = laggedHover ? litIds(wires, laggedHover) : null;
    return { lit, aside, near: hoveredSet, reach: new Set([...(reachSet ?? []), ...(focusSet ?? [])]) };
  }, [wires, pinned, liveHover, laggedHover, joinedEls, focus, canvasTree]);
  // A card in hand dims every card that is not a place to drop it (the same half dim as a hover); the targets and the card itself stay.
  const dragView = drag?.view;
  // A card in the report fades only with a hover (it is not on a line with the hovered card). A card outside it, with a main mart set,
  // is faded at rest, except the marts the hovered or focused card can join. The drag rule wins over both.
  const fadedOf = (el: string, outside = false) => {
    if (dragView) return el !== dragView.held && !dragView.els.has(el);
    if (outside && mainFor !== null) return !reach.has(el);
    return near !== null && !near.has(el);
  };
  // A line dims with the card it arrives at. The cards in the report are the tree's; every other one on a wire is outside it.
  const fadedTargets = new Set<string>();
  {
    const reportEls = new Set(canvasTree ? [...canvasTree.nodes.values()].map((n) => martElementId(n.martId, n.path || undefined)) : []);
    for (const w of wires) if (fadedOf(w.to, !reportEls.has(w.to))) fadedTargets.add(w.to);
  }
  useWires(canvas, wires, { pinned, hovered: liveHover, also: joinedEls }, useMemo(() => revisionOf(idsKey + treeKey), [idsKey, treeKey]), 'wires', 1, fadedTargets);

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
      className={`dm-canvas${pinned ? ' sources-focused' : ''}`}
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
      <Band id="band-marts" icon={<Box size={18} />} title="Data Marts" total={view === 'canvas' ? reportSize : visible.ids.length} hint={MARTS_HINT} afterHint={<><ViewSwitch label="Show data marts as" options={MARTS_VIEWS} value={view} onChange={pickView} />{makeMainId !== null && <MakeMainButton title={model.marts.get(makeMainId)?.title ?? 'it'} onClick={() => { void click(makeMainId, { mode: 'makeMain' }); }} />}</>} toolbar={view === 'grid' ? <>{contextBadges}{storageFilter}</> : undefined} grid={view === 'grid'} folded={foldedMarts} onFold={onFoldMarts} loading={loading}>
        {view === 'canvas' ? (
          <div
            className="dm-tree-scroll"
            data-testid="marts-canvas"
            // Scrolling this box moves its cards without resizing anything, so tell the page wires to look again.
            onScroll={(e) => e.currentTarget.dispatchEvent(new Event('animationend', { bubbles: true }))}
          >
            <MartsCanvas model={model} mainId={selection.martId} columns={mainColumns} sources={joinSources} counts={counts} dq={dq} onOpenApp={onOpenApp} onRetryCount={onRetryCount} onRequestCount={onRequestCount} click={click} onSelectedMart={setGraphSelected} own={own} />
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
                faded={fadedOf(el)}
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
                  faded={fadedOf(el, true)}
                  offPath={mainFor !== null}
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
              const el = martElementId(s.martId, s.aliasPath);
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
                  lit={lit.has(el)}
                  faded={fadedOf(el, true)}
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
              faded={fadedOf(el, true)}
              onSelect={() => addFromBand(id)}
              onOpenApp={() => onOpenApp(id)}
            />,
          ];
        })}
        </>}
      </Band>
      <CardClickContext.Provider value={click}>{children}</CardClickContext.Provider>
      {drag && <div className="dm-drag-ghost" style={{ left: drag.x + 8, top: drag.y + 8 }} aria-hidden>{drag.title}</div>}
      <DragLines lines={dragView?.lines ?? []} />
      <WireTipLayer canvas={canvas} />
    </div>
  );
}
