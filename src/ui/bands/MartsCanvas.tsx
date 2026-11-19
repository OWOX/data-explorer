// The Data Marts canvas: the report as a tree of cards, with ghosts for what can still join under the hovered or pinned card.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { JoinedSource } from '../../api/blendable';
import type { DqSummary, Model } from '../../model/types';
import { buildJoinTree, ghostSources } from '../../state/join-tree';
import { closestTarget, dropTargets } from './canvas-drag';
import { CARD_H, CARD_W, layoutTree } from './canvas-layout';
import { MartCard, martElementId, type CountState } from './cards';
import { useCanvasDrag } from './useCanvasDrag';
import type { ClickOptions } from './useCardClick';
import { revisionOf, useWires, type Wire } from './wires';

type Over = { path: string | null; ghost: boolean };
const NONE: Over = { path: null, ghost: false };

const overOf = (target: EventTarget | null): Over => {
  const el = target instanceof Element ? target : null;
  if (el?.closest('[data-ghost-path]')) return { path: null, ghost: true };
  const path = el?.closest<HTMLElement>('[data-tree-path]')?.dataset.treePath;
  return path === undefined ? NONE : { path, ghost: false };
};

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
  const tree = useMemo(() => buildJoinTree(mainId ?? '', columns, sources ?? []), [mainId, columns, sources]);
  const [over, setOver] = useState<Over>(NONE);
  const [pinned, setPinned] = useState<string | null>(null);
  const drag = useCanvasDrag(
    treeRef,
    (p) => p !== '',
    (path, x, y) => {
      const pick = closestTarget(dropTargets(tree, sources ?? [], path), layout.placed, x, y);
      const node = tree.nodes.get(path);
      if (pick && node && pick.moves.size > 0) void click(node.martId, { moves: pick.moves });
    },
    mainId,
  );
  // The path whose ghosts show. It follows the hovered card; a hovered ghost keeps it, and leaving waits 400 ms, so the pointer can cross the gap to a ghost.
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (shownFor === null && over.path !== null) setShownFor(over.path);
  useEffect(() => {
    if (over.ghost || (over.path !== null && over.path === shownFor)) return;
    const t = setTimeout(() => setShownFor(over.path), 400);
    return () => clearTimeout(t);
  }, [over, shownFor]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPinned(null); setOver(NONE); setShownFor(null); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // A click anywhere in the scroll box that is not on a card is a click on the empty canvas.
  useEffect(() => {
    const box = treeRef.current?.parentElement;
    if (!box) return;
    const onClick = (e: MouseEvent) => { if (!(e.target as Element).closest('[data-tree-path], [data-ghost-path]')) setPinned(null); };
    box.addEventListener('click', onClick);
    return () => box.removeEventListener('click', onClick);
  }, [mainId]);

  // While a card is in hand no ghosts show and the hover and pin logic sits still.
  const ghostOf = drag ? null : pinned ?? shownFor;
  const ghosts = useMemo(
    () => (ghostOf !== null && sources ? ghostSources(tree, sources, ghostOf).filter((s) => model.marts.get(s.martId)?.accessible) : []),
    [ghostOf, sources, tree, model],
  );
  const layout = useMemo(() => layoutTree(tree, ghostOf !== null && ghosts.length ? { path: ghostOf, ids: ghosts.map((g) => g.aliasPath) } : undefined), [tree, ghostOf, ghosts]);

  const targets = useMemo(() => (drag ? dropTargets(tree, sources ?? [], drag.path) : []), [drag?.path, tree, sources]); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = new Set(targets.map((t) => t.target));
  const pick = drag ? closestTarget(targets, layout.placed, drag.x, drag.y) : null;
  const key = [...tree.nodes.keys(), '|', ghostOf ?? '', ...ghosts.map((g) => g.aliasPath)].join('>');
  const wires = useMemo<Wire[]>(() => {
    const title = (id: string) => model.marts.get(id)?.title ?? id;
    const out: Wire[] = [];
    for (const node of tree.nodes.values()) {
      if (node.parent === null) continue;
      const parent = tree.nodes.get(node.parent)!;
      out.push({ id: `tree:${node.path}`, from: martElementId(parent.martId), to: martElementId(node.martId), kind: 'relationship', title: `${title(parent.martId)} → ${title(node.martId)}` });
    }
    const from = ghostOf !== null ? tree.nodes.get(ghostOf) : undefined;
    if (from) for (const g of ghosts) out.push({ id: `ghost:${g.aliasPath}`, from: martElementId(from.martId), to: martElementId(g.martId), kind: 'relationship', title: `${title(from.martId)} → ${title(g.martId)}`, dashed: true });
    return out;
    // `key` stands for tree, ghostOf and ghosts: the memo must not rebuild on every hover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, model]);
  useWires(treeRef, wires, { pinned: null, hovered: null }, revisionOf(key), 'tree-wires');

  if (!mainId) return <p className="dm-muted text-sm">Select a data mart.</p>;
  const contextsOf = (ids: string[]) => model.contexts.filter((c) => ids.includes(c.id));
  const dragTitle = drag ? model.marts.get(tree.nodes.get(drag.path)?.martId ?? '')?.title : undefined;
  let line: string | null = null;
  const to = pick && layout.placed.find((p) => p.path === pick.target);
  if (drag && to) {
    const x2 = drag.x < to.x + CARD_W / 2 ? to.x : to.x + CARD_W;
    const y2 = to.y + CARD_H / 2;
    const pull = Math.max(40, Math.abs(x2 - drag.x) / 2);
    const dir = x2 >= drag.x ? 1 : -1;
    line = `M${drag.x} ${drag.y} C${drag.x + dir * pull} ${drag.y} ${x2 - dir * pull} ${y2} ${x2} ${y2}`;
  }
  const at = new Map(layout.placed.map((p) => [p.path, p] as const));
  return (
    <div
      ref={treeRef}
      className="dm-tree"
      style={{ width: layout.width, height: layout.height }}
      onPointerOver={(e) => setOver((cur) => { const next = overOf(e.target); return next.path === cur.path && next.ghost === cur.ghost ? cur : next; })}
      onPointerLeave={() => setOver(NONE)}
    >
      {[...tree.nodes.values()].flatMap((node) => {
        const mart = model.marts.get(node.martId);
        const pos = at.get(node.path);
        if (!mart || !pos) return [];
        return [
          <div key={node.path} className={`dm-tree-node${drag && node.path !== drag.path && !valid.has(node.path) ? ' dm-dimmed' : ''}`} data-tree-path={node.path} style={{ left: pos.x, top: pos.y, width: CARD_W }}>
            <MartCard
              mart={mart}
              contexts={contextsOf(mart.contextIds)}
              count={counts.get(mart.id) ?? { state: 'idle' }}
              quality={dq.get(mart.id)}
              freshness={mart.dataLastUpdatedAt}
              selected={node.path === ''}
              joined={node.path !== ''}
              lit={false}
              onSelect={() => setPinned(node.path)}
              onOpenApp={() => onOpenApp(mart.id)}
              onRetryCount={() => onRetryCount(mart.id)}
              onNeedCount={() => onRequestCount(mart.id)}
            />
          </div>,
        ];
      })}
      {line && <svg id="drag-line" aria-hidden><path d={line} /></svg>}
      {drag && dragTitle && <div className="dm-drag-ghost" style={{ left: drag.clientX + 8, top: drag.clientY + 8 }} aria-hidden>{dragTitle}</div>}
      {layout.ghosts.flatMap((spot) => {
        const g = ghosts.find((s) => s.aliasPath === spot.id);
        const mart = g && model.marts.get(g.martId);
        if (!g || !mart) return [];
        return [
          <div key={`ghost:${g.aliasPath}`} className="dm-tree-node" data-ghost-path={g.aliasPath} style={{ left: spot.x, top: spot.y, width: CARD_W }}>
            <MartCard
              mart={mart}
              ghost
              contexts={contextsOf(mart.contextIds)}
              count={{ state: 'idle' }}
              quality={dq.get(mart.id)}
              freshness={mart.dataLastUpdatedAt}
              selected={false}
              joined={false}
              lit={false}
              onSelect={() => { setPinned(null); void click(g.martId, { addAt: g.aliasPath }); }}
              onOpenApp={() => onOpenApp(mart.id)}
              onRetryCount={() => undefined}
              onNeedCount={() => undefined}
            />
          </div>,
        ];
      })}
    </div>
  );
}
