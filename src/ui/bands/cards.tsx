// The cards themselves, ported from Data Flow: a source card and a data mart card.
import { ExternalLink, History, Info, LoaderCircle, Plug } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Context, DqSummary, Mart, Source } from '../../model/types';
import { compactNumber, count as plural, num, relativeTime } from '../format';
import { dqCardTone, dqVisual } from '../icons';
import { Tooltip } from '../Tooltip';
import { whenInView } from './inview';
import type { CardTransition } from './transitions';
import { DEFAULT_CONTEXT_ICON, PickedIcon } from './picked';

/** The element id Task 3's lines look cards up by: Data Flow's `src-` prefix and key sanitising. */
export const sourceElementId = (key: string) => `src-${key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
export const martElementId = (id: string) => `dm-${id}`;

export type CountState =
  | { state: 'idle' }
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

/**
 * A card on its way out steps out of the grid and stays where it stood. Left in the flow it keeps
 * its cell for the whole collapse and everything after it jumps when it goes; pinned, the grid
 * closes up at once and the card shrinks over the space it held. Measured in a layout effect, in the
 * commit that marked it leaving, so it is read before the browser draws anything.
 */
function usePinWhenLeaving(card: React.RefObject<HTMLElement | null>, transition: CardTransition | undefined) {
  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !transition?.leaving) return;
    const { offsetLeft, offsetTop, offsetWidth, offsetHeight } = el;
    Object.assign(el.style, { position: 'absolute', left: `${offsetLeft}px`, top: `${offsetTop}px`, width: `${offsetWidth}px`, height: `${offsetHeight}px` });
  }, [card, transition?.leaving]);
}

const cardClass = (lit: boolean, aside: boolean, extra?: string) => ['dm-node', lit ? 'lit' : '', aside ? 'aside' : '', extra ?? ''].filter(Boolean).join(' ');

export function SourceCard({
  source,
  selected,
  lit,
  aside = false,
  transition,
  onSelect,
}: {
  source: Source;
  selected: boolean;
  lit: boolean;
  /** Lit by a card other than the pinned one: drawn at half strength. */
  aside?: boolean;
  transition?: CardTransition;
  onSelect: () => void;
}) {
  const card = useRef<HTMLElement>(null);
  usePinWhenLeaving(card, transition);
  return (
    <article
      ref={card}
      id={sourceElementId(source.key)}
      data-node
      aria-pressed={selected}
      className={cardClass(lit, aside, transition?.className)}
      {...(transition?.leaving ? { 'data-leaving': '' } : {})}
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
  if (count.state === 'idle') return null;
  if (count.state === 'loading') {
    return <span className="dm-badge" aria-label="Counting rows"><LoaderCircle className="dm-spin" size={12} /></span>;
  }
  if (count.state === 'error') {
    return (
      <Tooltip content={`${count.message.replace(/\.$/, '')}. Click to retry.`}>
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
  aside = false,
  transition,
  onSelect,
  onOpenApp,
  onRetryCount,
  onNeedCount,
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
  /** Lit by a card other than the pinned one: drawn at half strength. */
  aside?: boolean;
  transition?: CardTransition;
  onSelect: () => void;
  onOpenApp: () => void;
  onRetryCount: () => void;
  /** Called once the card is on screen: only then is its row count requested. */
  onNeedCount: () => void;
}) {
  const el = useRef<HTMLElement>(null);
  usePinWhenLeaving(el, transition);
  const need = useRef(onNeedCount);
  useEffect(() => { need.current = onNeedCount; });
  useEffect(() => {
    if (!mart.accessible || !el.current) return;
    return whenInView(el.current, () => need.current());
  }, [mart.accessible]);
  return (
    <article
      ref={el}
      id={martElementId(mart.id)}
      data-node
      data-tone={dqCardTone(quality)}
      aria-pressed={selected}
      className={cardClass(lit, aside, [mart.accessible ? '' : 'dm-noaccess', transition?.className ?? ''].filter(Boolean).join(' '))}
      {...(transition?.leaving ? { 'data-leaving': '' } : {})}
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
        <QualityMark summary={quality} />
        {/* Nothing when the update time is unknown: an unknown freshness is not worth an icon. */}
        {freshness && <Mark tone="idle" lines={[`Data updated ${relativeTime(freshness)}`]}><History size={14} /></Mark>}
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

const TONE_CLASS = { neutral: 'idle', progress: 'progress', success: 'ok', warning: 'warn', error: 'bad', notice: 'notice' } as const;

/** The host's own sentence for each quality state, keyed by the label its icon already carries. */
const QUALITY_LINE: Record<string, string> = {
  'Never run': 'Data Quality has not been checked yet',
  'All checks disabled': 'Data Quality checks are disabled',
  'No applicable checks': 'No applicable Data Quality checks',
  Queued: 'Data Quality check queued',
  Running: 'Data Quality check running',
  Passed: 'Data Quality checks passed',
  'Issues found': 'Data Quality issues found',
  'Run failed': 'Data Quality check failed',
  Restricted: 'Data Quality run restricted',
  Cancelled: 'Data Quality check cancelled',
};

/** What the summary says beyond its state: how many checks, how many findings, when it last ran. */
function qualityDetails(s: DqSummary | undefined): string[] {
  if (!s) return [];
  const lines: string[] = [];
  if ((s.totalChecks ?? 0) > 0) {
    const notApplicable = s.notApplicableChecks ?? 0;
    lines.push(`${plural(s.totalChecks ?? 0, 'check')}${notApplicable > 0 ? `, ${notApplicable} not applicable` : ''}`);
  }
  const findings = [
    [s.errorFindings, 'error'],
    [s.warningFindings, 'warning'],
    [s.noticeFindings, 'notice'],
  ].flatMap(([n, noun]) => (typeof n === 'number' && n > 0 ? [plural(n, noun as string)] : []));
  if (findings.length > 0) lines.push(`Findings: ${findings.join(', ')}`);
  if (s.lastRunAt) lines.push(`Last run ${relativeTime(s.lastRunAt)}`);
  return lines;
}

function QualityMark({ summary }: { summary: DqSummary | undefined }) {
  const { Icon, label, tone } = dqVisual(summary);
  return (
    <Mark tone={TONE_CLASS[tone]} lines={[label, ...(QUALITY_LINE[label] ? [QUALITY_LINE[label]] : []), ...qualityDetails(summary)]}>
      <Icon size={14} className={tone === 'progress' ? 'dm-spin' : undefined} />
    </Mark>
  );
}

/** A status glyph that says what it means on hover, and does nothing when clicked. */
function Mark({ tone, lines, children }: { tone: string; lines: string[]; children: ReactNode }) {
  return (
    <span className={`dm-status dm-mark dm-${tone}`} tabIndex={0} role="note" aria-label={lines.join('. ')}>
      {children}
      <span className="dm-hint-body dm-mark-body">
        {lines.map((line) => <span key={line}>{line}</span>)}
      </span>
    </span>
  );
}
