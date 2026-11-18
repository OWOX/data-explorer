// The Sources and Data bands with the lines between their cards, and the hover that lights them.
// The Data and Row bands arrive as children and sit under the same canvas; they do not re-render on hover.
import { Box, Plug } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DqSummary, Mart, Model, Source } from '../../model/types';
import { matchesSearch } from '../../graph/search';
import { storageOptions } from '../../graph/storages';
import type { VisibleResult } from '../../graph/visible';
import { useRememberLeaving } from '../../state/leaving';
import { useStore } from '../../state/store';
import { storageMark } from '../storage-icons';
import { Band } from './Band';
import { MultiSelect } from './MultiSelect';
import { ContextBadges } from './ContextBadges';
import { useSmartSearchScope } from './SmartSearchScope';
import { PointerTip } from '../Tooltip';
import { CardClickContext } from './CardClick';
import { MartCard, SourceCard, martElementId, sourceElementId, type CountState } from './cards';
import { useCardTransitions } from './transitions';
import { useCardClick } from './useCardClick';
import { litIds, useWires, type Wire } from './wires';

const martId = (m: Mart) => m.id;
const sourceKey = (s: Source) => s.key;

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
  storageIds,
  joined: joinedProp,
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
  const smart = useSmartSearchScope();
  const rememberLeaving = useRememberLeaving();
  const canvas = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [wireTip, setWireTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const click = useCardClick(model);

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

  const contextsOf = (ids: string[]) => model.contexts.filter((c) => ids.includes(c.id));

  return (
    <div
      ref={canvas}
      className={`dm-canvas${pinned || hovered ? ' focused' : ''}`}
      onPointerOver={(e) => setHovered(nodeIdOf(e.target))}
      onPointerMove={(e) => {
        const text = e.target instanceof Element ? e.target.closest<SVGPathElement>('#wires path')?.dataset.tip : undefined;
        setWireTip(text ? { text, x: e.clientX, y: e.clientY } : (cur) => (cur === null ? cur : null));
      }}
      onPointerLeave={() => { setHovered(null); setWireTip(null); }}
      onFocus={(e) => setHovered(nodeIdOf(e.target))}
      onBlur={(e) => { if (!canvas.current?.contains(e.relatedTarget as Node | null)) setHovered(null); }}
    >
      <Band id="band-sources" icon={<Plug size={18} />} title="Data Sources" total={model.sources.length} hint="Connectors that feed data marts. Select one to see the marts it feeds." folded={foldedSources} onFold={onFoldSources} loading={loading}>
        {model.sources.length === 0 && <p className="dm-muted text-sm" style={{ gridColumn: '1 / -1' }}>No connector-based data marts.</p>}
        {sourceCards.items.map((source) => {
          const id = sourceElementId(source.key);
          return <SourceCard key={source.key} source={source} transition={sourceCards.transitionOf(source)} selected={selection.sourceKey === source.key} lit={lit.has(id)} aside={aside.has(id)} onSelect={() => { rememberLeaving(null); dispatch({ type: 'selectSource', key: source.key }); }} />;
        })}
      </Band>
      <Band id="band-marts" icon={<Box size={18} />} title="Data Marts" total={visible.ids.length} hint="The selected data mart and every mart joined to it, or what the search and the filters match." afterHint={contextBadges} toolbar={storageFilter} folded={foldedMarts} onFold={onFoldMarts} loading={loading}>
        {(visible.ids.length === 0 || noMatch) && <p className="dm-muted text-sm" style={{ gridColumn: '1 / -1' }}>No data marts match.</p>}
        {martCards.items.map((mart) => {
          const id = mart.id;
          const el = martElementId(id);
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
              onSelect={() => void click(id)}
              onOpenApp={() => onOpenApp(id)}
              onRetryCount={() => onRetryCount(id)}
              onNeedCount={() => onRequestCount(id)}
            />
          );
        })}
      </Band>
      <CardClickContext.Provider value={click}>{children}</CardClickContext.Provider>
      {wireTip && <PointerTip text={wireTip.text} x={wireTip.x} y={wireTip.y} />}
    </div>
  );
}
