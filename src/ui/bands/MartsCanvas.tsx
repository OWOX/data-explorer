// The Data Marts graph: the report as a tree of cards, with ghosts for what can still join under the card whose (+) is hovered or pinned, and a chain of ghosts from the (+) of a ghost.
import { flushSync } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JoinedSource } from '../../api/blendable';
import type { DqSummary, Model } from '../../model/types';
import { buildJoinTree, ghostLevels, joinableUnder, subtreePaths } from '../../state/join-tree';
import { pathTitle } from '../../state/join-plan';
import { closestTarget, dragLinePath, dropTargets } from './canvas-drag';
import { DragLines } from './DragLines';
import { scrollBoxOf, zoomedScale } from './canvas-zoom';
import { CARD_W, layoutTree } from './canvas-layout';
import { MartCard, contextsOf, martElementId, type CountState } from './cards';
import { useLatest } from '../useLatest';
import { usePressDrag } from './usePressDrag';
import { overOf, useGhostChain } from './useGhostChain';
import type { ClickOptions } from './useCardClick';
import { edgeOf, joinAlias, noteFields, relationshipNote } from './relationshipNote';
import { litIds, revisionOf, useWires, type Wire } from './wires';

export function MartsCanvas({ model, mainId, columns, emptyPaths, sources, counts, matched, matchedStale, dq, onOpenApp, onRetryCount, onRequestCount, click, onSelectedMart, own }: {
  model: Model;
  mainId: string | null;
  columns: string[];
  /** The alias paths of joined marts kept with no column. */
  emptyPaths?: string[];
  sources: JoinedSource[] | null;
  /** The Output Alias a joined mart's own settings give a path below it (`useOwnAliases`): lines under a joined mart read their names from it. */
  own: (martId: string, path: string) => string | undefined;
  counts: Map<string, CountState>;
  /** How many records of the mart at each alias path the grid's filters and slices keep. */
  matched?: ReadonlyMap<string, number>;
  /** The matched numbers are the previous filters', shown dimmed. */
  matchedStale?: boolean;
  dq: Map<string, DqSummary>;
  onOpenApp: (id: string) => void;
  onRetryCount: (id: string) => void;
  onRequestCount: (id: string) => void;
  click: (id: string, options?: ClickOptions) => Promise<void>;
  /** Told which mart the pinned (selected) card is, or null when none is. */
  onSelectedMart?: (martId: string | null) => void;
}) {
  const treeRef = useRef<HTMLDivElement>(null);
  // The element focus was on when the window lost it.
  const returning = useRef<EventTarget | null>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  // Zoom lives in memory only. The layout stays in unscaled pixels; the tree is drawn with a CSS scale.
  const [scale, setScale] = useState(1);
  const scaleRef = useLatest(scale);
  const tree = useMemo(() => buildJoinTree(mainId ?? '', columns, sources ?? [], emptyPaths), [mainId, columns, emptyPaths, sources]);
  // The card (mart and alias path) that takes focus once it renders: a ghost chosen with Enter vanishes under the keyboard.
  const [focusCard, setFocusCard] = useState<{ martId: string; path: string } | null>(null);
  // The tree and main mart of the latest render: a click that resolves later checks what its step left, not what it was started on.
  const latest = useLatest({ tree, mainId });
  // The drop handler runs after render, so it reads the latest layout through a ref (the layout is built further down).
  const placedRef = useRef<ReturnType<typeof layoutTree>['placed']>([]);
  // The tree is drawn scaled, so the client offset is divided by the scale to get layout pixels.
  const local = (e: PointerEvent, el: HTMLElement) => { const r = el.getBoundingClientRect(); return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }; };
  const drag = usePressDrag(treeRef, {
    pick: (t) => { const path = t.closest<HTMLElement>('[data-tree-path]')?.dataset.treePath; return path ? { path } : null; },
    canDrag: (p) => p !== '',
    // The whole scroll box counts as the canvas, so the margin around the tree is not a dead zone.
    over: (e, el) => e.target instanceof Node && scrollBoxOf(el).contains(e.target),
    view: (p, e, inside, el) => ({ path: p.path, ...local(e, el), clientX: e.clientX, clientY: e.clientY, inside }),
    drop: (p, e, el) => {
      const at = local(e, el);
      const pick = closestTarget(dropTargets(tree, sources ?? [], p.path), placedRef.current, at.x, at.y);
      const node = tree.nodes.get(p.path);
      if (pick && node && pick.moves.size > 0) void click(node.martId, { moves: pick.moves });
    },
  }, mainId);
  // The card whose ghosts a (+) opened, the chain of ghosts from it, and the selected card. What stands on a path the tree no longer has (a drag moved it, or Undo removed it), or was kept for another main mart, is let go.
  const hover = useGhostChain(mainId, tree);
  const { selected, chain: openChain, clear: clearGhosts } = hover;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') clearGhosts(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [clearGhosts]);

  useEffect(() => {
    if (focusCard === null) return;
    const card = treeRef.current?.querySelector<HTMLElement>(`#${CSS.escape(martElementId(focusCard.martId, focusCard.path))}:not([data-ghost])`);
    if (!card) return;
    card.focus();
    setFocusCard(null);
  }, [focusCard, tree]);

  // Ctrl or Cmd with the wheel, and a touchpad pinch (sent as a wheel event with ctrlKey), zoom around the pointer.
  // The listener is not passive so the browser does not zoom the page.
  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    const box = scrollBoxOf(tree);
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const from = scaleRef.current;
      const to = zoomedScale(from, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY);
      if (to === from) return;
      const r = tree.getBoundingClientRect();
      const lx = (e.clientX - r.left) / from;
      const ly = (e.clientY - r.top) / from;
      // The sizer's height transition is for ghosts only: a zoom must apply its new size at once, or the scroll offset below is clamped to the old height.
      const sizer = sizerRef.current;
      if (sizer) sizer.style.transition = 'none';
      scaleRef.current = to;
      flushSync(() => setScale(to));
      // Keep the layout point that was under the pointer under it.
      const n = tree.getBoundingClientRect();
      box.scrollLeft += n.left - (e.clientX - lx * to);
      box.scrollTop += n.top - (e.clientY - ly * to);
      if (sizer) requestAnimationFrame(() => { sizer.style.transition = ''; });
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, [mainId, scaleRef]);

  // A click anywhere in the scroll box that is not on a card is a click on the empty canvas.
  useEffect(() => {
    const box = treeRef.current ? scrollBoxOf(treeRef.current) : null;
    if (!box) return;
    const onClick = (e: MouseEvent) => { if (!(e.target as Element).closest('[data-tree-path], [data-ghost-path]')) clearGhosts(); };
    box.addEventListener('click', onClick);
    return () => box.removeEventListener('click', onClick);
  }, [mainId, clearGhosts]);

  // Only a click on a (+) opens or closes ghosts; a click on a card selects it, and the header offers to make a selected joined card the main one.
  const selectedMart = selected === null || selected === '' ? null : tree.nodes.get(selected)?.martId ?? null;
  useEffect(() => {
    onSelectedMart?.(selectedMart);
    return () => onSelectedMart?.(null);
  }, [selectedMart, onSelectedMart]);
  // While a card is in hand no ghosts show and the hover and pin logic sits still.
  const anchor = drag ? null : hover.anchor;
  // A source counts only when its mart can be read.
  const readable = useCallback((s: JoinedSource) => model.marts.get(s.martId)?.accessible === true, [model]);
  const { levels } = useMemo(
    () => (sources ? ghostLevels(tree, sources, anchor, hover.chain, readable) : { levels: [] }),
    [anchor, hover.chain, sources, tree, readable],
  );
  // The (+) shows when something readable can still join under the path.
  const joinableAt = (path: string) => sources !== null && joinableUnder(tree, sources, path).some(readable);
  const ghosts = useMemo(() => levels.flatMap((l) => l.ghosts), [levels]);
  const layout = useMemo(() => layoutTree(tree, levels.map((l) => ({ path: l.from, ids: l.ghosts.map((g) => g.aliasPath) }))), [tree, levels]);
  useEffect(() => { placedRef.current = layout.placed; }, [layout]);

  const targets = useMemo(() => (drag ? dropTargets(tree, sources ?? [], drag.path) : []), [drag?.path, tree, sources]); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = new Set(targets.map((t) => t.target));
  const pick = drag?.inside ? closestTarget(targets, layout.placed, drag.x, drag.y) : null;
  const key = [...tree.nodes.keys(), '|', ...levels.flatMap((l) => [l.from, ...l.ghosts.map((g) => g.aliasPath)])].join('>');
  // Released nearest the current parent, its tree wire is the closest line: it carries the stronger style the closest dashed line has.
  const heldParent = drag ? tree.nodes.get(drag.path)?.parent ?? null : null;
  const strongPath = drag && heldParent !== null && pick?.target === heldParent ? drag.path : null;
  const wires = useMemo<Wire[]>(() => {
    const title = (id: string) => model.marts.get(id)?.title ?? id;
    const out: Wire[] = [];
    for (const node of tree.nodes.values()) {
      if (node.parent === null) continue;
      const parent = tree.nodes.get(node.parent)!;
      // Each joined copy is its own node, keyed by its alias path: the line belongs to the one relationship that path names.
      const source = sources?.find((x) => x.aliasPath === node.path);
      const edge = edgeOf(model.edges, parent.martId, node.martId, node.path, source?.relationshipId);
      const note = relationshipNote(edge, title(node.martId), joinAlias(source?.outputAlias, title(node.martId), parent.martId, parent.path, node.path, own));
      out.push({ id: `tree:${node.path}`, from: martElementId(parent.martId, parent.path), to: martElementId(node.martId, node.path), kind: 'relationship', ...noteFields(note), sideways: true, joined: true, ...(node.path === strongPath ? { strong: true } : {}) });
    }
    for (const level of levels) {
      const fromPath = level.from;
      for (const g of level.ghosts) {
        // A dashed line names its join like a solid one: the Output Alias when set, else the parent mart's own alias, else the title.
        const note = relationshipNote(edgeOf(model.edges, level.fromMartId, g.martId, g.aliasPath, g.relationshipId), title(g.martId), joinAlias(g.outputAlias, title(g.martId), level.fromMartId, fromPath, g.aliasPath, own));
        out.push({ id: `ghost:${g.aliasPath}`, from: martElementId(level.fromMartId, fromPath), to: martElementId(g.martId, g.aliasPath), kind: 'relationship', ...noteFields(note), dashed: true, sideways: true });
      }
    }
    return out;
    // `key` stands for tree and the ghost levels: the memo must not rebuild on every hover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, model, strongPath, sources, own]);
  // The hovered card or ghost and what it touches (its path neighbours and the ghosts hanging from it): every other card fades to half.
  const hoverEl = (() => {
    const over = hover.at;
    if (!over || drag) return null;
    if (over.ghost !== null) { const g = ghosts.find((x) => x.aliasPath === over.ghost); return g ? martElementId(g.martId, g.aliasPath) : null; }
    const n = over.card === null ? undefined : tree.nodes.get(over.card);
    return n ? martElementId(n.martId, n.path) : null;
  })();
  const near = hoverEl === null ? null : litIds(wires, hoverEl);
  const fadedAt = (martId: string, path: string) => near !== null && !near.has(martElementId(martId, path));
  // A line dims with the card it arrives at, by the same rule as the card.
  const fadedTargets = new Set<string>();
  for (const w of wires) {
    const node = [...tree.nodes.values()].find((n) => martElementId(n.martId, n.path) === w.to);
    const ghost = node ? undefined : ghosts.find((g) => martElementId(g.martId, g.aliasPath) === w.to);
    const faded = drag ? (node ? node.path !== drag.path && !valid.has(node.path) : false) : near !== null && !near.has(w.to);
    if ((node || ghost) && faded) fadedTargets.add(w.to);
  }
  useWires(treeRef, wires, { pinned: null, hovered: null }, revisionOf(key), 'tree-wires', scale, fadedTargets);

  if (!mainId) return <p className="dm-muted text-sm">Select a data mart.</p>;
  // A card carries its path in its title only when the report reaches that mart through more than one path.
  const titleOf = (path: string) => {
    const source = sources?.find((x) => x.aliasPath === path);
    return path === '' || !source ? undefined : pathTitle(source, [...tree.nodes.keys()], sources ?? []);
  };
  const dragTitle = drag ? model.marts.get(tree.nodes.get(drag.path)?.martId ?? '')?.title : undefined;
  // While a card is held (also with the pointer outside the box, where a release does nothing), a line runs from it to every place it can be dropped: dashed to every target but its current parent (the tree wire to that one is already solid), the closest one stronger.
  const at = new Map(layout.placed.map((p) => [p.path, p] as const));
  const held = drag ? at.get(drag.path) : undefined;
  const lines = held ? targets.flatMap((t) => { const to = at.get(t.target); return to && t.moves.size > 0 ? [{ target: t.target, d: dragLinePath(held, to), current: false, closest: pick?.target === t.target }] : []; }) : [];
  return (
    <div ref={sizerRef} className="dm-tree-sizer" style={{ width: layout.width * scale, height: layout.height * scale }}>
    <div
      ref={treeRef}
      className="dm-tree"
      style={{ width: layout.width, height: layout.height, transform: scale === 1 ? undefined : `scale(${scale})` }}
      // A portaled title bubble bubbles its events here through React; it is not under the tree in the DOM, so it is not the pointer leaving the cards.
      onPointerOver={(e) => { if (!e.currentTarget.contains(e.target as Node)) return; const over = overOf(e.target); hover.onOver(over); }}
      onPointerLeave={() => hover.onLeave()}
      onFocus={(e) => {
        if (!e.currentTarget.contains(e.target as Node)) return;
        // The browser focuses the element the window left on when it comes back: that is no one asking for the ghosts.
        if (returning.current === e.target) { returning.current = null; return; }
        const over = overOf(e.target);
        if (over.plus || over.ghost !== null) hover.onFocus(over);
      }}
      onBlur={(e) => {
        const next = e.relatedTarget instanceof Element && e.currentTarget.contains(e.relatedTarget) ? overOf(e.relatedTarget) : null;
        if (!document.hasFocus()) returning.current = e.target;
        hover.onBlur(next);
      }}
    >
      {[...tree.nodes.values()].flatMap((node) => {
        const mart = model.marts.get(node.martId);
        const pos = at.get(node.path);
        if (!mart || !pos) return [];
        return [
          <div key={node.path} className="dm-tree-node" data-tree-path={node.path} style={{ left: pos.x, top: pos.y, width: CARD_W }}>
            <MartCard
              mart={mart}
              contexts={contextsOf(model.contexts, mart.contextIds)}
              count={counts.get(mart.id) ?? { state: 'idle' }}
              matched={matched?.get(node.path)} matchedStale={matchedStale}
              quality={dq.get(mart.id)}
              selected={node.path === ''}
              joined={node.path !== ''}
              focused={selected === node.path}
              faded={drag ? node.path !== drag.path && !valid.has(node.path) : fadedAt(node.martId, node.path)}
              path={node.path}
              title={titleOf(node.path)}
              onRemove={node.path === '' ? undefined : () => {
                const parent = tree.nodes.get(node.parent!)!;
                void click(node.martId, { removePaths: node.bare ? subtreePaths(tree, node.path) : [node.path] }).then(() => setFocusCard({ martId: parent.martId, path: parent.path }), () => undefined);
              }}
              join={joinableAt(node.path) ? { open: hover.anchor === node.path, onToggle: () => hover.togglePlus(node.path) } : undefined}
              lit={false}
              onSelect={() => hover.toggleCard(node.path)}
              onOpenApp={() => onOpenApp(mart.id)}
              onRetryCount={() => onRetryCount(mart.id)}
              onNeedCount={() => onRequestCount(mart.id)}
            />
          </div>,
        ];
      })}
      <DragLines lines={lines} />
      {layout.ghosts.flatMap((spot) => {
        const g = ghosts.find((s) => s.aliasPath === spot.id);
        const mart = g && model.marts.get(g.martId);
        if (!g || !mart) return [];
        return [
          <div key={`ghost:${g.aliasPath}`} className="dm-tree-node" data-ghost-path={g.aliasPath} style={{ left: spot.x, top: spot.y, width: CARD_W }}>
            <MartCard
              mart={mart}
              ghost
              faded={fadedAt(g.martId, g.aliasPath)}
              path={g.aliasPath}
              title={pathTitle(g, [...tree.nodes.keys()], sources ?? [])}
              contexts={contextsOf(model.contexts, mart.contextIds)}
              quality={dq.get(mart.id)}
              selected={false}
              joined={false}
              join={joinableAt(g.aliasPath) ? { open: openChain.includes(g.aliasPath), onToggle: () => hover.toggleGhostPlus(g.aliasPath) } : undefined}
              lit={false}
              onSelect={() => { clearGhosts();
                // The added card is selected; its own ghosts wait for its (+). A click that added nothing selects nothing.
                const main = mainId;
                click(g.martId, { addAt: g.aliasPath }).then(() => {
                  if (latest.current.mainId !== main || !latest.current.tree.nodes.has(g.aliasPath)) return;
                  hover.selectCard(g.aliasPath);
                  setFocusCard({ martId: g.martId, path: g.aliasPath });
                }, () => undefined);
              }}
              onOpenApp={() => onOpenApp(mart.id)}
            />
          </div>,
        ];
      })}
    </div>
    {/* Outside the scaled tree: a fixed box inside a transformed one is placed and scaled by it. */}
    {drag && dragTitle && <div className="dm-drag-ghost" style={{ left: drag.clientX + 8, top: drag.clientY + 8 }} aria-hidden>{dragTitle}</div>}
    </div>
  );
}
