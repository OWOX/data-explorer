// The cards themselves, ported from Data Flow: a source card and a data mart card.
import { CirclePlus, CircleX, ExternalLink, History, LoaderCircle, Plug } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Context, DqSummary, Mart, Source } from '../../model/types';
import { COUNT_CONCURRENCY } from '../../config';
import { compactNumber, count as plural, num, rowCountLabel, relativeTime } from '../format';
import { dqCardTone, dqVisual } from '../icons';
import { Hint, TipLines, Tooltip } from '../Tooltip';
import { whenInView } from './inview';
import type { CardTransition } from './transitions';
import { DEFAULT_CONTEXT_ICON, DEFAULT_MART_ICON, PickedIcon } from './picked';
import { useLatest } from '../useLatest';

/** The element id the lines look cards up by: Data Flow's `src-` prefix and key sanitising. */
export const sourceElementId = (key: string) => `src-${key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
/** A joined mart is a card per alias path, so the path is part of its id; the main mart and the band cards have none. */
export const martElementId = (martId: string, path?: string) => (path ? `dm-${martId}@${path}` : `dm-${martId}`);

/** The × and the (+) on a graph card are the same size (px). */
const CARD_CONTROL = 19.2;

export type CountState =
  | { state: 'idle' }
  | { state: 'queued' }
  | { state: 'loading' }
  /** `stale`: a recount is under way and the value is the previous one, shown dimmed until the new one arrives. */
  | { state: 'ok'; value: number | null; stale?: boolean }
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

const cardClass = (lit: boolean, aside: boolean, extra?: string, faded = false) => ['dm-node', lit ? 'lit' : '', aside ? 'aside' : '', faded ? 'dm-faded' : '', extra ?? ''].filter(Boolean).join(' ');

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

const PARTIAL_NOTE = 'Filters on calculated fields are not counted.';

/**
 * The row count of a card. The unfiltered `count` is shown unless `filtered` carries a state: then the badge shows the rows the card's
 * own rules keep, and its tooltip gives them out of the total. `partial` adds a note that some rules could not be counted.
 */
function CountBadge({ count, filtered, countable, onRetry, onRetryFiltered }: { count: CountState; filtered?: { state?: CountState; partial: boolean }; countable: boolean; onRetry: () => void; onRetryFiltered: () => void }) {
  // A card that is never counted (a ghost) shows no badge, or it would wait for ever.
  if (!countable) return null;
  // A card with a rule that cannot be counted shows its unfiltered count, whatever state it was handed: a number filtered by only some of its rules would be wrong.
  const own = filtered?.partial ? undefined : filtered?.state;
  const shown = own ?? count;
  const tip = (text: string) => (filtered?.partial ? `${text.replace(/[.…]$/, '')}. ${PARTIAL_NOTE}` : text);
  // The row reserves one badge's height (bands.css), so the count arriving or turning out empty does not move the bands below.
  if (shown.state === 'idle' || shown.state === 'queued') {
    return (
      <Tooltip content={tip(`Waiting to count rows. Up to ${COUNT_CONCURRENCY} data marts count at a time.`)}>
        <span className="dm-badge" aria-label="Waiting to count rows">—</span>
      </Tooltip>
    );
  }
  if (shown.state === 'loading') {
    return <Tooltip content={tip('Counting rows…')}><span className="dm-badge" aria-label="Counting rows"><LoaderCircle className="dm-spin" size={12} /></span></Tooltip>;
  }
  if (shown.state === 'error') {
    return (
      <Tooltip content={tip(`${shown.message.replace(/\.$/, '')}. Click to retry.`)}>
        <button
          type="button"
          className="dm-badge dm-badge-button"
          onClick={(e) => { e.stopPropagation(); (own ? onRetryFiltered : onRetry)(); }}
        >—</button>
      </Tooltip>
    );
  }
  if (shown.value === null) {
    return <Tooltip content={tip("Can't count rows: this data mart has no field that can be read.")}><span className="dm-badge">—</span></Tooltip>;
  }
  const text = !own
    ? rowCountLabel(num(shown.value))
    : count.state === 'ok' && count.value !== null && shown.value <= count.value
      ? `${num(shown.value)} of ${num(count.value)} rows match this data mart's filters`
      : `${num(shown.value)} rows match this data mart's filters`;
  return <Tooltip content={tip(text)}><span className={`dm-badge${shown.stale ? ' dm-stale' : ''}`} aria-busy={shown.stale || undefined}>{rowCountLabel(compactNumber(shown.value))}</span></Tooltip>;
}

/** The contexts of a mart, in the project's order. */
export const contextsOf = (all: Context[], ids: string[]) => all.filter((c) => ids.includes(c.id));

const IDLE_COUNT: CountState = { state: 'idle' };
const NOOP = () => undefined;

export function MartCard({
  mart,
  contexts,
  count = IDLE_COUNT,
  quality,
  selected,
  joined = false,
  lit,
  aside = false,
  faded = false,
  transition,
  offPath = false,
  ghost = false,
  path,
  title,
  focused = false,
  filtered,
  filteredRetry,
  onRemove,
  join,
  onSelect,
  onOpenApp,
  onRetryCount,
  onNeedCount,
}: {
  mart: Mart;
  contexts: Context[];
  /** The row count's state; a ghost asks for no count, so it may leave this out. Defaults to idle. */
  count?: CountState;
  quality: DqSummary | undefined;
  selected: boolean;
  /** A joined data mart of the selected one: its fields are columns of the main grid. */
  joined?: boolean;
  lit: boolean;
  /** Lit by a card other than the pinned one: drawn at half strength. */
  aside?: boolean;
  transition?: CardTransition;
  /** Another card is hovered and this one is not among the marts it touches: drawn at half strength. */
  faded?: boolean;
  /** The mart is not in the report but can join it: the border is dashed (a hover ghost always is). */
  offPath?: boolean;
  /** The card is a ghost: a mart that can join under a card whose (+) is hovered or pinned, drawn dashed while it shows. It asks for no count and cannot be dragged. */
  ghost?: boolean;
  /** The alias path this card stands for, when the mart is joined at one. */
  path?: string;
  /** What the card is called when that is not the mart's title: a joined source's label, which carries the alias path when two joins reach the mart. */
  title?: string;
  /** The Grid view's focused card: its joinable marts are shown. */
  focused?: boolean;
  /** The rows this card's own rules keep, read by the page (`useFilteredCounts`). `partial`: some rules are not counted. */
  filtered?: { state?: CountState; partial: boolean };
  /** Reads `filtered` again after an error. */
  filteredRetry?: () => void;
  /** Takes this joined mart out of the report; when absent the card has no ×. */
  onRemove?: () => void;
  /** Graph only: the (+) on the right edge that shows the marts that can join under this card. Absent when none can, and in the Grid. */
  join?: { open: boolean; onToggle: () => void };
  onSelect: () => void;
  onOpenApp: () => void;
  /** Not needed on a ghost, which shows no count. */
  onRetryCount?: () => void;
  /** Called once the card is on screen: only then is its row count requested. Not needed on a ghost. */
  onNeedCount?: () => void;
}) {
  const el = useRef<HTMLElement>(null);
  usePinWhenLeaving(el, transition);
  const need = useLatest(onNeedCount);
  useEffect(() => {
    if (!mart.accessible || ghost || !el.current) return;
    return whenInView(el.current, () => need.current?.());
  }, [mart.accessible, ghost, need]);
  const name = title ?? mart.title;
  // A press that began on a control and ended on the card sends its click to the card: that is not a select.
  const fromControl = useRef(false);
  const select = selectable(onSelect);
  return (
    <article
      ref={el}
      id={martElementId(mart.id, path)}
      data-mart-id={mart.id}
      {...(path ? { 'data-path': path } : {})}
      {...(focused ? { 'data-focused': '' } : {})}
      data-node
      data-tone={dqCardTone(quality)}
      aria-pressed={selected || joined}
      className={cardClass(lit, aside, [selected || joined || lit ? 'dm-in-path' : '', mart.accessible ? '' : 'dm-noaccess', offPath ? 'dm-offpath' : '', ghost ? 'dm-ghost' : '', transition?.className ?? ''].filter(Boolean).join(' '), faded)}
      {...(transition?.leaving ? { 'data-leaving': '' } : {})}
      {...(ghost ? { 'data-ghost': '' } : {})}
      {...select}
      onPointerDownCapture={(e) => { fromControl.current = e.target instanceof Element && e.target.closest('button, a, input') !== null; }}
      onClickCapture={(e) => { if (e.target instanceof Element && e.target.closest('button, a, input') !== null) fromControl.current = false; }}
      onClick={() => { if (fromControl.current) fromControl.current = false; else onSelect(); }}
    >
      {onRemove && (
        <button type="button" aria-label={`Remove ${name} from the report`} className="dm-card-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <CircleX size={CARD_CONTROL} />
        </button>
      )}
      {join && (
        <button type="button" className="dm-card-join" data-join-plus aria-label={`Show data marts ${name} can join`} aria-expanded={join.open} onClick={(e) => { e.stopPropagation(); join.onToggle(); }}>
          <CirclePlus size={CARD_CONTROL} />
        </button>
      )}
      <div className="dm-node-head">
        {/* The icon picked for the mart, or the host's default one, so every title has one before it. */}
        <PickedIcon icon={mart.icon} fallback={DEFAULT_MART_ICON} wrap="dm-logo" />
        <Tooltip content={name}><span className="dm-node-title">{name}</span></Tooltip>
        {/* From the right edge: the link, then the (i) to its left. */}
        <span className="dm-node-actions">
          {mart.description && <span className="dm-card-reveal"><Hint text={mart.description} label="Description" /></span>}
          <span className="dm-card-reveal"><Tooltip content="Open this data mart">
            <button type="button" aria-label="Open in OWOX" className="dm-link" onClick={(e) => { e.stopPropagation(); onOpenApp(); }}>
              <ExternalLink size={14} />
            </button>
          </Tooltip></span>
        </span>
      </div>
      <div className="dm-badges dm-badges-row">
        {mart.accessible ? <CountBadge count={count} filtered={filtered} countable={!ghost} onRetry={onRetryCount ?? NOOP} onRetryFiltered={filteredRetry ?? NOOP} /> : <span className="dm-badge">No access</span>}
      </div>
      <div className="dm-node-foot">
        <QualityMark summary={quality} />
        {/* Nothing when the update time is unknown: an unknown freshness is not worth an icon. */}
        {mart.dataLastUpdatedAt && <Mark tone="idle" lines={[`Data updated ${relativeTime(mart.dataLastUpdatedAt)}`]}><History size={14} /></Mark>}
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
  // The callers build a new array on each render, so the effect follows what the contexts say, not the array.
  const content = contexts.map((c) => `${c.id}\u0000${c.name}\u0000${c.icon ?? ''}`).join('\u0001');
  useLayoutEffect(() => {
    const el = row.current;
    const copy = named.current;
    if (!el || !copy) return;
    const judge = () => setBare(copy.offsetWidth > el.clientWidth);
    judge();
    const watch = new ResizeObserver(judge);
    watch.observe(el);
    return () => watch.disconnect();
  }, [shown, content]);
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
