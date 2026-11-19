// The cards themselves, ported from Data Flow: a source card and a data mart card.
import { CircleX, Crown, ExternalLink, History, LoaderCircle, Plug } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Context, DqSummary, Mart, Source } from '../../model/types';
import { COUNT_CONCURRENCY } from '../../config';
import { compactNumber, count as plural, num, recordsLabel, relativeTime } from '../format';
import { dqCardTone, dqVisual } from '../icons';
import { Hint, TipLines, Tooltip } from '../Tooltip';
import { whenInView } from './inview';
import type { CardTransition } from './transitions';
import { DEFAULT_CONTEXT_ICON, PickedIcon } from './picked';

/** The element id Task 3's lines look cards up by: Data Flow's `src-` prefix and key sanitising. */
export const sourceElementId = (key: string) => `src-${key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
/** A joined mart is a card per alias path, so the path is part of its id; the main mart and the band cards have none. */
export const martElementId = (martId: string, path?: string) => (path ? `dm-${martId}@${path}` : `dm-${martId}`);

export type CountState =
  | { state: 'idle' }
  | { state: 'queued' }
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
        <Tooltip content={source.name}><span className="dm-node-title">{source.name}</span></Tooltip>
      </div>
      <div className="dm-badges">
        <span className="dm-badge">{plural(source.martIds.length, 'data mart')}</span>
      </div>
    </article>
  );
}

function CountBadge({ count, countable, onRetry }: { count: CountState; countable: boolean; onRetry: () => void }) {
  // A card that is never counted (a ghost) shows no badge, or it would wait for ever.
  if (!countable) return null;
  // The row reserves one badge's height (bands.css), so the count arriving or turning out empty does not move the bands below.
  if (count.state === 'idle' || count.state === 'queued') {
    return (
      <Tooltip content={`Waiting to count records. Up to ${COUNT_CONCURRENCY} data marts count at a time.`}>
        <span className="dm-badge" aria-label="Waiting to count records">—</span>
      </Tooltip>
    );
  }
  if (count.state === 'loading') {
    return <Tooltip content="Counting records…"><span className="dm-badge" aria-label="Counting records"><LoaderCircle className="dm-spin" size={12} /></span></Tooltip>;
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
  if (count.value === null) {
    return <Tooltip content="Can't count records: this data mart has no primary key and no text or boolean field."><span className="dm-badge">—</span></Tooltip>;
  }
  return <Tooltip content={recordsLabel(num(count.value))}><span className="dm-badge">{recordsLabel(compactNumber(count.value))}</span></Tooltip>;
}

export function MartCard({
  mart,
  contexts,
  count,
  quality,
  freshness,
  selected,
  joined = false,
  lit,
  aside = false,
  transition,
  unjoinable = false,
  mainTitle,
  ghost = false,
  dropTarget = false,
  dropHot = false,
  path,
  onMakeMain,
  onRemove,
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
  selected: boolean;
  /** A joined data mart of the selected one: its fields are columns of the main grid. */
  joined?: boolean;
  lit: boolean;
  /** Lit by a card other than the pinned one: drawn at half strength. */
  aside?: boolean;
  transition?: CardTransition;
  /** The main mart cannot join this one: the card is dimmed, and a click explains instead of selecting. */
  unjoinable?: boolean;
  /** The title of the main mart, named in the unjoinable hint. */
  mainTitle?: string;
  /** The card is a hover ghost: a neighbour of the hovered card that is not in the band, drawn dashed while that card is hovered. It asks for no count and cannot be dragged. */
  ghost?: boolean;
  /** A drag is under way and this card accepts a drop. */
  dropTarget?: boolean;
  /** The dragged card is over this one. */
  dropHot?: boolean;
  /** Makes this mart the main one; when absent the card has no make-main button. */
  onMakeMain?: () => void;
  /** The alias path this card stands for, when the mart is joined at one. */
  path?: string;
  /** Takes this joined mart out of the report; when absent the card has no ×. */
  onRemove?: () => void;
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
    if (!mart.accessible || ghost || !el.current) return;
    return whenInView(el.current, () => need.current());
  }, [mart.accessible, ghost]);
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(false), 3000);
    return () => clearTimeout(t);
  }, [hint]);
  const choose = unjoinable ? () => setHint(true) : onSelect;
  return (
    <article
      ref={el}
      id={martElementId(mart.id, path)}
      data-mart-id={mart.id}
      {...(path ? { 'data-path': path } : {})}
      data-node
      data-tone={dqCardTone(quality)}
      aria-pressed={selected || joined}
      className={cardClass(lit, aside, [mart.accessible ? '' : 'dm-noaccess', unjoinable ? 'dm-unjoinable' : '', ghost ? 'dm-ghost' : '', dropTarget ? 'dm-drop-target' : '', dropHot ? 'dm-drop-hot' : '', transition?.className ?? ''].filter(Boolean).join(' '))}
      {...(transition?.leaving ? { 'data-leaving': '' } : {})}
      {...(ghost ? { 'data-ghost': '' } : {})}
      {...selectable(choose)}
    >
      {onRemove && (
        <button type="button" aria-label={`Remove ${mart.title} from the report`} className="dm-card-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <CircleX size={16} />
        </button>
      )}
      <div className="dm-node-head">
        {/* Only an icon someone picked: the default box on every card would say nothing. */}
        <PickedIcon icon={mart.icon} wrap="dm-logo" />
        <Tooltip content={mart.title}><span className="dm-node-title">{mart.title}</span></Tooltip>
        {onMakeMain && (
          <span className="dm-card-reveal ml-auto"><Tooltip content="Make main data mart">
            <button type="button" aria-label="Make main data mart" className="dm-link" onClick={(e) => { e.stopPropagation(); onMakeMain(); }}>
              <Crown size={14} />
            </button>
          </Tooltip></span>
        )}
        <span className={`dm-card-reveal${onMakeMain ? '' : ' ml-auto'}`}><Tooltip content="Open this data mart">
          <button
            type="button"
            aria-label="Open in OWOX"
            className="dm-link"
            onClick={(e) => { e.stopPropagation(); onOpenApp(); }}
          >
            <ExternalLink size={14} />
          </button>
        </Tooltip></span>
        {mart.description && <span className="dm-card-reveal"><Hint text={mart.description} label="Description" /></span>}
      </div>
      <div className="dm-badges dm-badges-row">
        {mart.accessible ? <CountBadge count={count} countable={!ghost} onRetry={onRetryCount} /> : <span className="dm-badge">No access</span>}
      </div>
      <div className="dm-node-foot">
        <QualityMark summary={quality} />
        {/* Nothing when the update time is unknown: an unknown freshness is not worth an icon. */}
        {freshness && <Mark tone="idle" lines={[`Data updated ${relativeTime(freshness)}`]}><History size={14} /></Mark>}
        <Contexts contexts={contexts} />
      </div>
      {/* The live region stays mounted so a screen reader announces the hint when it appears. */}
      <span aria-live="polite" className="dm-card-live">
        {hint && unjoinable && mainTitle && <span role="status" className="dm-card-hint">{ghost ? `Can't join ${mainTitle}. Use Make main data mart to make it the main data mart.` : `Can't join ${mainTitle}. Drag it onto ${mainTitle} to make it the main data mart.`}</span>}
      </span>
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
  const chip = (context: Context, tip = true): ReactNode => {
    const badge = (
      <span key={context.id} className="dm-badge">
        <PickedIcon icon={context.icon} fallback={DEFAULT_CONTEXT_ICON} size={12} /> {context.name}
      </span>
    );
    return tip ? <Tooltip key={context.id} content={`Context: ${context.name}`}>{badge}</Tooltip> : badge;
  };
  // The folded chip wears the icon they all share, and the plain context icon when they differ.
  const first = contexts[0]?.icon;
  const shared = contexts.every((context) => context.icon === first) ? first : undefined;
  return (
    <span ref={row} className={`dm-contexts${bare ? ' dm-contexts-bare' : ''}`}>
      <span className="dm-contexts-probe" aria-hidden>
        <span ref={named} className="dm-contexts-measure">{contexts.map((c) => chip(c, false))}</span>
      </span>
      {bare ? (
        <Tooltip
          content={(
            <TipLines lines={[
              plural(contexts.length, 'context'),
              ...contexts.map((context) => (
                <span key={context.id} className="dm-contexts-line">
                  <PickedIcon icon={context.icon} fallback={DEFAULT_CONTEXT_ICON} size={12} />
                  {context.name}
                </span>
              )),
            ]} />
          )}
        >
          <span
            className="dm-badge dm-mark dm-contexts-count"
            tabIndex={0}
            role="note"
            aria-label={plural(contexts.length, 'context')}
          >
            {contexts.length > 1 && num(contexts.length)}
            <PickedIcon icon={shared} fallback={DEFAULT_CONTEXT_ICON} size={12} />
          </span>
        </Tooltip>
      ) : (
        contexts.map((c) => chip(c))
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
    <Tooltip content={<TipLines lines={lines} />}>
      <span className={`dm-status dm-mark dm-${tone}`} tabIndex={0} role="note" aria-label={lines[0]}>{children}</span>
    </Tooltip>
  );
}
