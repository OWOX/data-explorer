// The Data Marts graph: the report as a tree of cards, with ghosts for what can still join under the hovered or pinned card, and a chain of ghosts from a hovered ghost.
import { flushSync } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JoinedSource } from '../../api/blendable';
import type { DqSummary, Model } from '../../model/types';
import { buildJoinTree, ghostLevels, subtreePaths } from '../../state/join-tree';
import { pathTitle } from '../../state/join-plan';
import { closestTarget, dragLinePath, dropTargets } from './canvas-drag';
import { scrollBoxOf, zoomedScale } from './canvas-zoom';
import { CARD_W, layoutTree } from './canvas-layout';
import { MartCard, contextsOf, martElementId, type CountState } from './cards';
import { useLatest } from '../useLatest';
import { useCanvasDrag } from './useCanvasDrag';
import { overOf, useGhostChain } from './useGhostChain';
import type { ClickOptions } from './useCardClick';
import { revisionOf, useWires, type Wire } from './wires';

export function MartsCanvas({ model, mainId, columns, sources, counts, dq, onOpenApp, onRetryCount, onRequestCount, click }: {
  model: Model;
  mainId: string | null;
  columns: string[];
  sources: JoinedSource[] | null;
  counts: Map<string, CountState>;
  dq: Map<string, DqSummary>;
  onOpenApp: (id: string) => void;
  onRetryCount: (id: string) => void;
  onRequestCount: (id: string) => void;
  click: (id: string, options?: ClickOptions) => Promise<void>;
}) {
  const treeRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  // Zoom lives in memory only. The layout stays in unscaled pixels; the tree is drawn with a CSS scale.
  const [scale, setScale] = useState(1);
  const scaleRef = useLatest(scale);
  const tree = useMemo(() => buildJoinTree(mainId ?? '', columns, sources ?? []), [mainId, columns, sources]);
  // The card (mart and alias path) that takes focus once it renders: a ghost chosen with Enter vanishes under the keyboard.
  const [focusCard, setFocusCard] = useState<{ martId: string; path: string } | null>(null);
  // A pin belongs to one main mart, as in the Grid.
  const [pinState, setPinState] = useState<{ main: string | null; path: string } | null>(null);
  const pinned = pinState !== null && pinState.main === mainId ? pinState.path : null;
  const setPinned = useCallback((path: string | null) => setPinState(path === null ? null : { main: mainId, path }), [mainId]);
  // The tree and main mart of the latest render: a click that resolves later checks what its step left, not what it was started on.
  const latest = useLatest({ tree, mainId });
  // The drop handler runs after render, so it reads the latest layout through a ref (the layout is built further down).
  const placedRef = useRef<ReturnType<typeof layoutTree>['placed']>([]);
  const drag = useCanvasDrag(
    treeRef,
    (p) => p !== '',
    (path, x, y) => {
      const pick = closestTarget(dropTargets(tree, sources ?? [], path), placedRef.current, x, y);
      const node = tree.nodes.get(path);
      if (pick && node && pick.moves.size > 0) void click(node.martId, { moves: pick.moves });
    },
    mainId,
    scale,
  );
  // The hover side: the card whose ghosts show and the chain of ghosts from it. 
  const hover = useGhostChain(pinned);
  const { clear: clearHover, mute: muteHover } = hover;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPinned(null); clearHover(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [clearHover, setPinned]);

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
    const onClick = (e: MouseEvent) => { if (!(e.target as Element).closest('[data-tree-path], [data-ghost-path]')) setPinned(null); };
    box.addEventListener('click', onClick);
    return () => box.removeEventListener('click', onClick);
  }, [mainId, setPinned]);

  // While a card is in hand no ghosts show and the hover and pin logic sits still.
  // A pin on a path the tree no longer has (a drag moved it, or Undo removed it) is let go.
  const pin = pinned !== null && tree.nodes.has(pinned) ? pinned : null;
  // A pin on a path the tree lost, or one kept for another main mart, is dropped now so it does not come back (main A, B, A).
  if (pinState !== null && pin === null) setPinState(null);
  // A pinned card keeps its ghosts while another card is hovered, as in the Grid; hovered ghosts still extend the chain from it.
  const anchor = drag ? null : pin ?? hover.anchor;
  const { levels } = useMemo(
    () => (sources ? ghostLevels(tree, sources, anchor, hover.chain, (s) => model.marts.get(s.martId)?.accessible === true) : { levels: [], chain: [] }),
    [anchor, hover.chain, sources, tree, model],
  );
  const ghosts = useMemo(() => levels.flatMap((l) => l.ghosts), [levels]);
  const layout = useMemo(() => layoutTree(tree, levels.map((l) => ({ path: l.from, ids: l.ghosts.map((g) => g.aliasPath) }))), [tree, levels]);
  useEffect(() => { placedRef.current = layout.placed; }, [layout]);

  const targets = useMemo(() => (drag ? dropTargets(tree, sources ?? [], drag.path) : []), [drag?.path, tree, sources]); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = new Set(targets.map((t) => t.target));
  const pick = drag?.inside ? closestTarget(targets, layout.placed, drag.x, drag.y) : null;
  const key = [...tree.nodes.keys(), '|', ...levels.flatMap((l) => [l.from, ...l.ghosts.map((g) => g.aliasPath)])].join('>');
  const wires = useMemo<Wire[]>(() => {
    const title = (id: string) => model.marts.get(id)?.title ?? id;
    const out: Wire[] = [];
    for (const node of tree.nodes.values()) {
      if (node.parent === null) continue;
      const parent = tree.nodes.get(node.parent)!;
      out.push({ id: `tree:${node.path}`, from: martElementId(parent.martId, parent.path), to: martElementId(node.martId, node.path), kind: 'relationship', title: `${title(parent.martId)} → ${title(node.martId)}`, sideways: true });
    }
    for (const level of levels) {
      const fromPath = level.from;
      for (const g of level.ghosts) out.push({ id: `ghost:${g.aliasPath}`, from: martElementId(level.fromMartId, fromPath), to: martElementId(g.martId, g.aliasPath), kind: 'relationship', title: `${title(level.fromMartId)} → ${title(g.martId)}`, dashed: true, sideways: true });
    }
    return out;
    // `key` stands for tree and the ghost levels: the memo must not rebuild on every hover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, model]);
  useWires(treeRef, wires, { pinned: null, hovered: null }, revisionOf(key), 'tree-wires', scale);

  if (!mainId) return <p className="dm-muted text-sm">Select a data mart.</p>;
  // A card carries its path in its title only when the report reaches that mart through more than one path.
  const titleOf = (path: string) => {
    const source = sources?.find((x) => x.aliasPath === path);
    return path === '' || !source ? undefined : pathTitle(source, [...tree.nodes.keys()], sources ?? []);
  };
  const dragTitle = drag ? model.marts.get(tree.nodes.get(drag.path)?.martId ?? '')?.title : undefined;
  // While a card is held (also with the pointer outside the box, where a release does nothing), a dashed line runs from it to every place it can be dropped; the closest one is drawn stronger.
  const at = new Map(layout.placed.map((p) => [p.path, p] as const));
  const held = drag ? at.get(drag.path) : undefined;
  const lines = held ? targets.flatMap((t) => { const to = at.get(t.target); return to ? [{ path: t.target, d: dragLinePath(held, to) }] : []; }) : [];
  return (
    <div ref={sizerRef} className="dm-tree-sizer" style={{ width: layout.width * scale, height: layout.height * scale }}>
    <div
      ref={treeRef}
      className="dm-tree"
      style={{ width: layout.width, height: layout.height, transform: scale === 1 ? undefined : `scale(${scale})` }}
      // A portaled title bubble bubbles its events here through React; it is not under the tree in the DOM, so it is not the pointer leaving the cards.
      onPointerOver={(e) => { if (e.currentTarget.contains(e.target as Node)) hover.onOver(overOf(e.target)); }}
      onPointerLeave={hover.onLeave}
      onFocus={(e) => { if (!e.currentTarget.contains(e.target as Node)) return; const over = overOf(e.target); if (over.ghost !== null) hover.onOver(over); }}
    >
      {[...tree.nodes.values()].flatMap((node) => {
        const mart = model.marts.get(node.martId);
        const pos = at.get(node.path);
        if (!mart || !pos) return [];
        return [
          <div key={node.path} className={`dm-tree-node${drag && node.path !== drag.path && (pick ? pick.target !== node.path : !valid.has(node.path)) ? ' dm-dimmed' : ''}`} data-tree-path={node.path} style={{ left: pos.x, top: pos.y, width: CARD_W }}>
            <MartCard
              mart={mart}
              contexts={contextsOf(model.contexts, mart.contextIds)}
              count={counts.get(mart.id) ?? { state: 'idle' }}
              quality={dq.get(mart.id)}
              selected={node.path === ''}
              joined={node.path !== ''}
              path={node.path}
              title={titleOf(node.path)}
              onRemove={node.path === '' ? undefined : () => {
                const parent = tree.nodes.get(node.parent!)!;
                void click(node.martId, { removePaths: node.bare ? subtreePaths(tree, node.path) : [node.path] }).then(() => setFocusCard({ martId: parent.martId, path: parent.path }), () => undefined);
              }}
              lit={false}
              onSelect={() => {
                // A second click on the pinned card lets its ghosts go, and its own hover does not bring them back until the pointer has left it.
                if (pin === node.path) { setPinned(null); muteHover(node.path); } else setPinned(node.path);
              }}
              onOpenApp={() => onOpenApp(mart.id)}
              onRetryCount={() => onRetryCount(mart.id)}
              onNeedCount={() => onRequestCount(mart.id)}
            />
          </div>,
        ];
      })}
      {lines.length > 0 && <svg id="drag-line" aria-hidden>{lines.map((l) => <path key={l.path} d={l.d} data-target={l.path} className={pick?.target === l.path ? 'closest' : undefined} />)}</svg>}
      {layout.ghosts.flatMap((spot) => {
        const g = ghosts.find((s) => s.aliasPath === spot.id);
        const mart = g && model.marts.get(g.martId);
        if (!g || !mart) return [];
        return [
          <div key={`ghost:${g.aliasPath}`} className="dm-tree-node" data-ghost-path={g.aliasPath} style={{ left: spot.x, top: spot.y, width: CARD_W }}>
            <MartCard
              mart={mart}
              ghost
              path={g.aliasPath}
              title={pathTitle(g, [...tree.nodes.keys()], sources ?? [])}
              contexts={contextsOf(model.contexts, mart.contextIds)}
              quality={dq.get(mart.id)}
              selected={false}
              joined={false}
              lit={false}
              onSelect={() => { setPinned(null); clearHover(); 
                // The added card is pinned, so what joins under it shows at once. A click that added nothing pins nothing.
                const main = mainId;
                click(g.martId, { addAt: g.aliasPath }).then(() => {
                  if (latest.current.mainId !== main || !latest.current.tree.nodes.has(g.aliasPath)) return;
                  setPinned(g.aliasPath);
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
