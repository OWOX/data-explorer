// The cards themselves, ported from Data Flow: a source card and a data mart card.
import { ExternalLink, Info, LoaderCircle, Plug } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Context, DqSummary, Mart, Source } from '../../model/types';
import { compactNumber, count as plural, num } from '../format';
import { DqIcon, dqCardTone, FreshnessIcon } from '../icons';
import { Tooltip } from '../Tooltip';
import { DEFAULT_CONTEXT_ICON, PickedIcon } from './picked';

/** The element id Task 3's lines look cards up by: Data Flow's `src-` prefix and key sanitising. */
export const sourceElementId = (key: string) => `src-${key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
export const martElementId = (id: string) => `dm-${id}`;

export type CountState =
  | { state: 'loading' }
  | { state: 'ok'; value: number | null }
  | { state: 'error'; message: string };

/** A card selects on click and on Enter, but not when the key or click came from a control inside it. */
function selectable(onSelect: () => void) {
  return {
    tabIndex: 0,
    onClick: onSelect,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.target === e.currentTarget) onSelect();
    },
  };
}

const cardClass = (lit: boolean, extra?: string) => ['dm-node', lit ? 'lit' : '', extra ?? ''].filter(Boolean).join(' ');

export function SourceCard({
  source,
  selected,
  lit,
  onSelect,
}: {
  source: Source;
  selected: boolean;
  lit: boolean;
  onSelect: () => void;
}) {
  return (
    <article
      id={sourceElementId(source.key)}
      data-node
      aria-pressed={selected}
      className={cardClass(lit)}
      {...selectable(onSelect)}
    >
      <div className="dm-node-head">
        {source.logo
          ? <img className="dm-logo" src={source.logo} alt="" width={24} height={24} />
          : <span className="dm-logo" aria-hidden="true"><Plug size={16} /></span>}
        <span className="dm-node-title" title={source.name}>{source.name}</span>
      </div>
      <div className="dm-badges">
        <span className="dm-badge">{plural(source.martIds.length, 'data mart')}</span>
      </div>
    </article>
  );
}

function CountBadge({ count, onRetry }: { count: CountState; onRetry: () => void }) {
  if (count.state === 'loading') {
    return <span className="dm-badge" aria-label="Counting rows"><LoaderCircle className="dm-spin" size={12} /></span>;
  }
  if (count.state === 'error') {
    return (
      <Tooltip content={`${count.message}. Click to retry.`}>
        <button
          type="button"
          className="dm-badge dm-badge-button"
          onClick={(e) => { e.stopPropagation(); onRetry(); }}
        >—</button>
      </Tooltip>
    );
  }
  if (count.value === null) return null;
  return <Tooltip content={`${num(count.value)} rows`}><span className="dm-badge">{compactNumber(count.value)}</span></Tooltip>;
}

export function MartCard({
  mart,
  contexts,
  count,
  quality,
  freshness,
  fieldHit,
  selected,
  lit,
  onSelect,
  onOpenApp,
  onRetryCount,
}: {
  mart: Mart;
  contexts: Context[];
  count: CountState;
  quality: DqSummary | undefined;
  /** When the data was last updated (ISO), or null when unknown. */
  freshness: string | null;
  /** The field the search matched, when it matched a field rather than the title. */
  fieldHit?: string;
  selected: boolean;
  lit: boolean;
  onSelect: () => void;
  onOpenApp: () => void;
  onRetryCount: () => void;
}) {
  return (
    <article
      id={martElementId(mart.id)}
      data-node
      data-tone={dqCardTone(quality)}
      aria-pressed={selected}
      className={cardClass(lit, mart.accessible ? undefined : 'dm-noaccess')}
      {...selectable(onSelect)}
    >
      <div className="dm-node-head">
        {/* Only an icon someone picked: the default box on every card would say nothing. */}
        <PickedIcon icon={mart.icon} wrap="dm-logo" />
        <span className="dm-node-title" title={mart.title}>{mart.title}</span>
        <button
          type="button"
          aria-label="Open in OWOX"
          title="Open this data mart"
          className="dm-link"
          onClick={(e) => { e.stopPropagation(); onOpenApp(); }}
        >
          <ExternalLink size={14} />
        </button>
        {mart.description && (
          <span className="dm-hint" tabIndex={0} role="note" aria-label="Description">
            <Info size={14} />
            <span className="dm-hint-body">{mart.description}</span>
          </span>
        )}
      </div>
      <div className="dm-badges dm-badges-row">
        {mart.accessible ? <CountBadge count={count} onRetry={onRetryCount} /> : <span className="dm-badge">No access</span>}
        {fieldHit && <span className="dm-badge dm-badge-shrink font-mono" title={fieldHit}>{fieldHit}</span>}
      </div>
      <div className="dm-node-foot">
        <DqIcon summary={quality} toned />
        <FreshnessIcon at={freshness} />
        <Contexts contexts={contexts} />
      </div>
    </article>
  );
}

/**
 * A mart's contexts on one line, each under the icon picked for it.
 *
 * Named while the names fit. Once they would spill, they fold into one chip, a count beside the
 * context icon, whose bubble names them all; a lone context folds to its icon alone. Whether they
 * fit is read off an invisible named copy laid beside the row, so the answer never depends on which
 * form happens to be drawn: it is judged before the browser paints, and again whenever the row
 * changes width or the contexts change.
 */
function Contexts({ contexts }: { contexts: Context[] }) {
  const row = useRef<HTMLSpanElement>(null);
  const named = useRef<HTMLSpanElement>(null);
  const [bare, setBare] = useState(false);
  const shown = contexts.length > 0;
  useLayoutEffect(() => {
    const el = row.current;
    const copy = named.current;
    if (!el || !copy) return;
    const judge = () => setBare(copy.offsetWidth > el.clientWidth);
    judge();
    const watch = new ResizeObserver(judge);
    watch.observe(el);
    return () => watch.disconnect();
  }, [shown, contexts]);
  if (!shown) return null;
  const chip = (context: Context): ReactNode => (
    <span key={context.id} className="dm-badge" title={`Context: ${context.name}`}>
      <PickedIcon icon={context.icon} fallback={DEFAULT_CONTEXT_ICON} size={12} /> {context.name}
    </span>
  );
  // The folded chip wears the icon they all share, and the plain context icon when they differ.
  const first = contexts[0]?.icon;
  const shared = contexts.every((context) => context.icon === first) ? first : undefined;
  const names = contexts.map((context) => context.name);
  return (
    <span ref={row} className={`dm-contexts${bare ? ' dm-contexts-bare' : ''}`}>
      <span className="dm-contexts-probe" aria-hidden>
        <span ref={named} className="dm-contexts-measure">{contexts.map(chip)}</span>
      </span>
      {bare ? (
        <span
          className="dm-badge dm-mark dm-contexts-count"
          tabIndex={0}
          role="note"
          aria-label={`${plural(contexts.length, 'context')}: ${names.join(', ')}`}
        >
          {contexts.length > 1 && num(contexts.length)}
          <PickedIcon icon={shared} fallback={DEFAULT_CONTEXT_ICON} size={12} />
          <span className="dm-hint-body dm-mark-body">
            <span>{plural(contexts.length, 'context')}</span>
            {contexts.map((context) => (
              <span key={context.id} className="dm-contexts-line">
                <PickedIcon icon={context.icon} fallback={DEFAULT_CONTEXT_ICON} size={12} />
                {context.name}
              </span>
            ))}
          </span>
        </span>
      ) : (
        contexts.map(chip)
      )}
    </span>
  );
}
