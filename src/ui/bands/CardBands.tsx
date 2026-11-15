// The Sources and Data Marts bands with the lines between their cards, and the hover that lights them.
// The Data and Row bands arrive as children and sit under the same canvas; they do not re-render on hover.
import { Database, Plug } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DqSummary, Model } from '../../model/types';
import type { VisibleResult } from '../../graph/visible';
import { sourceOfModel, useStore } from '../../state/store';
import { Band } from './Band';
import { MartCard, SourceCard, martElementId, sourceElementId, type CountState } from './cards';
import { litIds, useWires, type Wire } from './wires';

const nodeIdOf = (target: EventTarget | null) => (target instanceof Element ? target.closest('[data-node]')?.id ?? null : null);

/** A small stable number for a string: it changes when the set of cards on the page does. */
const revisionOf = (key: string) => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return h;
};

export function CardBands({
  model,
  visible,
  counts,
  dq,
  foldedSources,
  foldedMarts,
  onFoldSources,
  onFoldMarts,
  onRetryCount,
  onRequestCount,
  onOpenApp,
  children,
}: {
  model: Model;
  visible: VisibleResult;
  counts: Map<string, CountState>;
  dq: Map<string, DqSummary>;
  foldedSources: boolean;
  foldedMarts: boolean;
  onFoldSources: () => void;
  onFoldMarts: () => void;
  onRetryCount: (id: string) => void;
  onRequestCount: (id: string) => void;
  onOpenApp: (id: string) => void;
  children: ReactNode;
}) {
  const [{ selection }, dispatch] = useStore();
  const canvas = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const sourceOf = useMemo(() => sourceOfModel(model), [model]);

  // Escape lets go of the hovered card; what is selected only changes by clicks and Back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHovered(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const idsKey = visible.ids.join('|');
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
    for (const e of model.edges) {
      if (!shown.has(e.source) || !shown.has(e.target)) continue;
      out.push({ id: `edge:${e.id}`, from: martElementId(e.source), to: martElementId(e.target), kind: 'relationship', title: e.joins.map((j) => `${j.sourceField} → ${j.targetField}`).join(', ') });
    }
    return out;
  }, [idsKey, model]);

  const pinned = useMemo(() => {
    if (selection.martId && idsKey.split('|').includes(selection.martId)) return martElementId(selection.martId);
    if (!selection.martId && selection.sourceKey && model.sources.some((s) => s.key === selection.sourceKey)) return sourceElementId(selection.sourceKey);
    return null;
  }, [selection.martId, selection.sourceKey, idsKey, model.sources]);

  useWires(canvas, wires, { pinned, hovered }, useMemo(() => revisionOf(idsKey), [idsKey]));

  const { lit, aside } = useMemo(() => {
    const pinnedSet = pinned ? litIds(wires, pinned) : null;
    const hoveredSet = hovered ? litIds(wires, hovered) : null;
    const lit = new Set([...(pinnedSet ?? []), ...(hoveredSet ?? [])]);
    // Lit only by the pointer while another card is pinned: drawn at half strength.
    const aside = new Set([...lit].filter((id) => pinnedSet !== null && !pinnedSet.has(id)));
    return { lit, aside };
  }, [wires, pinned, hovered]);

  const contextsOf = (ids: string[]) => model.contexts.filter((c) => ids.includes(c.id));

  return (
    <div
      ref={canvas}
      className={`dm-canvas${pinned || hovered ? ' focused' : ''}`}
      onPointerOver={(e) => setHovered(nodeIdOf(e.target))}
      onPointerLeave={() => setHovered(null)}
      onFocus={(e) => setHovered(nodeIdOf(e.target))}
      onBlur={(e) => { if (!canvas.current?.contains(e.relatedTarget as Node | null)) setHovered(null); }}
    >
      <Band id="band-sources" icon={Plug} title="Data Sources" total={model.sources.length} hint="Connectors that feed data marts. Select one to see the marts it feeds." folded={foldedSources} onFold={onFoldSources}>
        {model.sources.length === 0 && <p className="dm-muted text-sm" style={{ gridColumn: '1 / -1' }}>No connector-based data marts.</p>}
        {model.sources.map((source) => {
          const id = sourceElementId(source.key);
          return <SourceCard key={source.key} source={source} selected={selection.sourceKey === source.key} lit={lit.has(id)} aside={aside.has(id)} onSelect={() => dispatch({ type: 'selectSource', key: source.key })} />;
        })}
      </Band>
      <Band id="band-marts" icon={Database} title="Data Marts" total={visible.ids.length} hint="The selected data mart and every mart joined to it, or what the search matches." folded={foldedMarts} onFold={onFoldMarts}>
        {visible.ids.length === 0 && <p className="dm-muted text-sm" style={{ gridColumn: '1 / -1' }}>No data marts match.</p>}
        {visible.ids.map((id) => {
          const mart = model.marts.get(id)!;
          const el = martElementId(id);
          return (
            <MartCard
              key={id}
              mart={mart}
              contexts={contextsOf(mart.contextIds)}
              count={counts.get(id) ?? { state: 'idle' }}
              quality={dq.get(id)}
              freshness={mart.dataLastUpdatedAt}
              fieldHit={visible.fieldHits.get(id)}
              selected={selection.martId === id}
              lit={lit.has(el)}
              aside={aside.has(el)}
              onSelect={() => dispatch({ type: 'selectMart', id, sourceOf })}
              onOpenApp={() => onOpenApp(id)}
              onRetryCount={() => onRetryCount(id)}
              onNeedCount={() => onRequestCount(id)}
            />
          );
        })}
      </Band>
      {children}
    </div>
  );
}
