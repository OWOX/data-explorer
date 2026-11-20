import { AlertTriangle, ArchiveRestore, Check, ChevronDown, Code, Copy, DatabaseZap, ExternalLink, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  buildReportPayload, exportTitle, ExportError, isGone, isPublishedSheetUrl, parseSheetUrl, reportMayExist, REPORT_GONE, sheetUrl,
  type Exporter, type ExportSource, type Flight, type ReportEntry, type Stage, type StoredReport,
} from '../../api/exports';
import { martAppUrl } from '../../config';
import type { ColumnFilter } from '../../filters/build';
import type { SortKey } from '../../model/sort';
import type { Edge, Schema } from '../../model/types';
import type { JoinedSource } from '../../api/blendable';
import { buildMartSql } from '../../datamart/build-sql';
import { createDataMart, deleteDraft, CreateMartError, CREATE_STAGE_LABEL, type CreateStage } from '../../datamart/create';
import { dialectFor } from '../../datamart/dialect';
import type { Row } from '../../sdk/types';
import { buildTsv, tsvColumns } from '../../export/tsv';
import type { Aggregation } from '../../model/aggregation';
import { isGrouped, keepVisible } from '../../model/aggregation';
import type { DestinationDto } from '../../sdk/types';
import { buildAiPrompt } from '../../api/ai-prompt';
import { readRunSql, type RunSql } from '../../api/run-sql';
import { useServices, useStore } from '../../state/store';
import { ChatGptIcon } from '../chatgpt-icon';
import { ClaudeIcon } from '../claude-icon';
import { GoogleSheetsIcon } from '../google-sheets-icon';
import { Toast } from '../Toast';
import { Modal } from '../Modal';
import { Tooltip } from '../Tooltip';
import { copyText } from './clipboard';
import type { GridRun } from './useMartRows';
import { errorMessage } from '../../model/guards';

type Props = { martId: string; martTitle: string; schema: Schema; visible: string[]; /** The functions and date buckets on the columns; any of them groups the rows. */ aggregation?: Aggregation; filters: ColumnFilter[]; /** Pre-join filters on joined fields. */ slices?: ColumnFilter[]; sorts: SortKey[]; /** Only the sorts the member set; Create Data Mart never adds the grid's implicit order. */ ownSorts?: SortKey[]; /** The rows the grid has loaded, in grid order; null until the first read. */ rows: Row[] | null; /** The mart has more rows than are loaded. */ hasMore: boolean; /** A read is in flight, so `rows` may be out of date. */ loading?: boolean; /** The query behind the grid's rows, for Copy SQL. */ run?: GridRun;
  /** The main mart's storage, for Create Data Mart. */ storage?: { id: string; type: string; title?: string }; /** The model is loaded and the member can't see this mart's storage. */ storageUnavailable?: boolean;
  /** Reading the main mart's joined sources failed. */ joinsFailed?: boolean;
  /** The joined data marts the grid selects, as the Data Marts band shows them. */ joinedMarts?: { id: string; title: string }[];
  /** The main mart's joined sources, the model's edges and the mart titles, for the SQL; `sources` is undefined until the joins are read. */ sources?: JoinedSource[]; edges?: Edge[]; titles?: Map<string, string> };
type Result = { kind: 'ok' | 'timeout' | 'error'; text: string; url?: string };

type Assistant = 'Claude' | 'ChatGPT';
/** Where each assistant lists the OWOX app (the links owox.com uses). */
const PROVIDER_LISTING: Record<Assistant, string> = {
  Claude: 'https://claude.ai/directory/owox-data-marts',
  ChatGPT: 'https://chatgpt.com/plugins/plugin_asdk_app_6a3e81be8f8481918e1e2cd1d7ea09c4?q=owox',
};
/** The prompt an assistant item copied, and whether it reached the clipboard. */
type Copied = { assistant: Assistant; prompt: string; ok: boolean };
/** The grid's rows as TSV, and whether they reached the clipboard. */
type CopiedData = { tsv: string; count: number; more: boolean; ok: boolean };
/** The SQL Copy SQL copied, and whether it reached the clipboard. */
type CopiedSql = { sql: string; ok: boolean };

const STAGE_LABEL: Record<Stage, string> = { sheet: 'Creating the spreadsheet…', report: 'Saving the report…', run: 'Running the report…' };
const MAYBE_CREATED = 'The report may have been created; check OWOX before trying again.';
const UNRECOGNISED = 'This report targets an unrecognised spreadsheet.';
/** A report used within this long counts as recently used. */
export const RECENT_MS = 60 * 24 * 60 * 60 * 1000;
const isRecent = (usedAt: string | undefined, now = Date.now()) => { const t = usedAt ? Date.parse(usedAt) : NaN; return Number.isFinite(t) && t <= now && now - t <= RECENT_MS; };

/** "Export" in the Data band header: a menu of Claude and ChatGPT (each copies a prompt), then the Google Sheets destinations, then "Copy to clipboard" and "Copy SQL" (the SQL the grid ran), and last "Create Data Mart", which saves the grid as a published SQL data mart. */
export function ExportMenu(p: Props) {
  const { ctx, exporter } = useServices();
  const [{ modelVersion }] = useStore();
  const [destinations, setDestinations] = useState<DestinationDto[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [dialog, setDialog] = useState<{ destination: DestinationDto; error?: string; seq: number } | null>(null);
  const [copied, setCopied] = useState<Copied | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [data, setData] = useState<CopiedData | null>(null);
  const [dataOpen, setDataOpen] = useState(false);
  const [sqlCopied, setSqlCopied] = useState<CopiedSql | null>(null);
  const [sqlOpen, setSqlOpen] = useState(false);
  // A copied prompt belongs to the mart it was built from (adjust state during render).
  const [copiedFor, setCopiedFor] = useState(p.martId);
  if (copiedFor !== p.martId) { setCopiedFor(p.martId); setCopied(null); setPromptOpen(false); setData(null); setDataOpen(false); setSqlCopied(null); setSqlOpen(false); }
  const run = p.run ?? { state: 'none' as const };
  const runId = run.state === 'done' ? run.runId : null;
  const [menuOpen, setMenuOpen] = useState(false);
  // What was read of each run's SQL, by run id, and in which opening of the menu; a late read of an older run never hides a newer one.
  const [sqls, setSqls] = useState<Record<string, { result: RunSql; opening: number }>>({});
  const [opening, setOpening] = useState(0);
  // The SQL is read once the menu is open and the grid's query has a run; a failed read is tried again on the next opening.
  const reading = useRef<string | null>(null);
  useEffect(() => {
    if (!menuOpen || !runId) return;
    const have = sqls[runId];
    if (have && ('sql' in have.result || have.opening === opening)) return;
    const key = `${runId}/${opening}`;
    if (reading.current === key) return;
    reading.current = key;
    void readRunSql(ctx, p.martId, runId).then((result) => {
      if (reading.current === key) reading.current = null;
      // SQL that was read stays whatever a later read says, and a result of an older opening never replaces a newer one's.
      setSqls((cur) => {
        const old = cur[runId];
        if (old && ('sql' in old.result || old.opening > opening)) return cur;
        return { ...cur, [runId]: { result, opening } };
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, runId, opening]);
  const sqlHave = runId ? sqls[runId] : undefined;
  const sqlReady = sqlHave && 'sql' in sqlHave.result ? sqlHave.result.sql : null;
  const sqlOff = sqlReady ? null
    : run.state === 'none' ? 'The grid has not run a query yet'
    : run.state === 'paused' ? 'Switch to Table to copy its SQL'
    : run.state === 'running' ? "The grid's query is still running"
    : run.state === 'failed' ? "The grid's query failed"
    : !runId ? 'OWOX did not report a run for this query'
    : sqlHave && 'reason' in sqlHave.result && sqlHave.opening === opening ? sqlHave.result.reason
    : 'Reading the SQL from OWOX…';
  // Create Data Mart: why it is off, else the SQL of each variant (grouping on or off, sorting on or off), built from the props as they are now.
  const martSql = useMemo((): { reason: string } | { variants: MartVariants; grouped: boolean } => {
    if (!p.storage) return { reason: p.storageUnavailable ? "The data mart's storage isn't available to you" : "The data mart's storage isn't loaded" };
    if (!p.sources) return { reason: p.joinsFailed ? "The data mart's joins couldn't be read" : "Loading the data mart's joins…" };
    const d = dialectFor(p.storage.type);
    if ('reason' in d) return d;
    const base = { dialect: d.dialect, main: { id: p.martId, title: p.martTitle }, schema: p.schema, visible: p.visible, filters: p.filters, ...(p.slices ? { slices: p.slices } : {}), sources: p.sources, edges: p.edges ?? [], titles: p.titles ?? new Map() };
    const kept = p.aggregation && keepVisible(p.aggregation, p.visible);
    const grouped = isGrouped(kept);
    const own = p.ownSorts ?? [];
    const variant = (grouping: boolean): MartVariant => {
      // A sort on an aggregated output has no meaning on raw rows.
      const aggregated = new Set(kept?.aggregations.map((r) => r.column));
      const sorts = grouping ? own : own.filter((s) => !aggregated.has(s.field));
      const input = { ...base, ...(grouping && p.aggregation ? { aggregation: p.aggregation } : {}) };
      const plain = buildMartSql(input);
      if ('reason' in plain) return { plain, sorted: plain };
      return { plain, sorted: !own.length ? { reason: "You haven't set a sort" } : !sorts.length ? { reason: 'Your sorts are on grouped columns' } : buildMartSql({ ...input, sorts }) };
    };
    const off = variant(false);
    if ('reason' in off.plain) return off.plain;
    return { variants: { off, on: grouped ? variant(true) : off }, grouped };
  }, [p.storage, p.storageUnavailable, p.sources, p.joinsFailed, p.edges, p.titles, p.martId, p.martTitle, p.schema, p.visible, p.aggregation, p.filters, p.slices, p.ownSorts]);
  const [martDialog, setMartDialog] = useState<{ variants: MartVariants; grouped: boolean; having: boolean; joinedMarts: { id: string; title: string }[]; storage: { id: string; type: string; title?: string }; seq: number } | null>(null);
  const seq = useRef(0);
  // Bumped when the mart changes or the menu goes away: an export finishing later is no longer in front of the member.
  const gen = useRef(0);
  useEffect(() => { gen.current += 1; return () => { gen.current += 1; }; }, [p.martId]);
  const menu = useRef<HTMLDetailsElement>(null);

  // Listed once per session; a model reload (Retry on a failed storage) lists them again.
  const seenVersion = useRef(modelVersion);
  useEffect(() => {
    let live = true;
    if (seenVersion.current !== modelVersion) {
      seenVersion.current = modelVersion;
      exporter.invalidate();
    }
    exporter.destinations().then((d) => live && setDestinations(d), (e) => { if (live) { console.warn('Listing the Google Sheets destinations failed', e); setDestinations([]); } });
    return () => { live = false; };
  }, [exporter, modelVersion]);
  // The menu closes on a press anywhere outside it, and when the host page outside the plugin frame is clicked (the window loses focus).
  useEffect(() => {
    const outside = (e: Event) => { if (menu.current?.open && !menu.current.contains(e.target as Node)) menu.current.open = false; };
    const away = () => { if (menu.current?.open) menu.current.open = false; };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', away);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('blur', away); };
  }, []);

  // An export this mart already has under way (it outlives the menu): pick it up, with the outcome of one that finished while away.
  useEffect(() => {
    const flight = exporter.inFlight(p.martId);
    if (flight) follow(flight, { openWhenDone: !flight.settled });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exporter, p.martId]);

  const closeMenu = () => { if (menu.current) menu.current.open = false; };

  /** Shows the outcome of an export, whoever started it. Only a menu still on the mart acts on it; the sheet is opened only when the member was there to see it finish. */
  function follow(flight: Flight, o: { fromDialog?: boolean; destination?: DestinationDto; openWhenDone: boolean }) {
    const home = gen.current;
    const here = () => gen.current === home;
    const { notes, sourceKind } = flight;
    const martId = p.martId;
    setBusy(STAGE_LABEL[flight.stage]);
    const unsubscribe = flight.subscribe((s) => { if (here()) setBusy(STAGE_LABEL[s]); });
    flight.promise.then(async ({ report, outcome }) => {
      unsubscribe();
      if (!here()) return;
      exporter.acknowledge(martId);
      const url = sheetUrl(report) ?? undefined;
      const note = notes.length ? ` ${notes.join(' ')}` : '';
      setDialog(null);
      if (outcome.state === 'success') {
        setResult({ kind: 'ok', text: url ? `Exported to "${report.title}".${note}` : `Exported to "${report.title}", but ${UNRECOGNISED.toLowerCase()}${note}`, url });
        if (url && o.openWhenDone && here()) await ctx.ui.openExternal(url).catch(() => undefined);
      } else if (outcome.state === 'busy') {
        setResult({ kind: 'error', text: sourceKind === 'update' ? 'This report is already running. The new settings were saved but not run; try again when it finishes.' : 'This report is already running; try again when it finishes.', url });
      } else if (outcome.state === 'failed') {
        setResult({ kind: 'error', text: `The run failed: ${outcome.error}${note}`, url });
      } else {
        setResult({ kind: 'timeout', text: `Still running.${note}`, url });
      }
    }, async (e) => {
      unsubscribe();
      if (!here()) return;
      exporter.acknowledge(martId);
      const text = errorMessage(e);
      const { destination, fromDialog } = o;
      if (isGone(e)) {
        // The exporter already dropped the report from its list; the dialog, if open, stays for another choice.
        setResult({ kind: 'error', text: REPORT_GONE });
      } else if (destination && e instanceof ExportError && e.stage === 'sheet') {
        // The spreadsheet could not be made: offer the pasted-URL way instead.
        setDialog((cur) => ({ destination, error: `Could not create a spreadsheet: ${text}`, seq: cur?.seq ?? ++seq.current }));
      } else if (destination && fromDialog && e instanceof ExportError && e.stage === 'report' && !reportMayExist(e)) {
        // The spreadsheet stays: a retry reuses it instead of leaving an orphan behind.
        setDialog((cur) => ({ destination, error: text, seq: cur?.seq ?? ++seq.current }));
      } else if (reportMayExist(e)) {
        // The request may have reached OWOX: a retry could make a second report.
        setDialog(null);
        setResult({ kind: 'error', text: MAYBE_CREATED });
      } else {
        // Past this point the report exists (and may be running): a retry from the dialog would make a second one.
        setDialog(null);
        setResult({ kind: 'error', text: e instanceof ExportError && e.stage === 'run' ? `The run could not be followed: ${text}` : text });
      }
    }).finally(() => { if (here()) setBusy(null); });
  }

  function start(destination: DestinationDto, wanted: ExportSource, title: string, fromDialog = false) {
    if (exporter.inFlight(p.martId)) return;
    // A spreadsheet an earlier attempt made and left unused is reused, also after the menu was remounted.
    const left = exporter.made(p.martId, destination.id);
    const source: ExportSource = wanted.kind === 'new' && left ? { kind: 'existing', target: left } : wanted;
    const { payload, notes } = buildReportPayload(p.schema, p.visible, p.filters, p.sorts, p.aggregation, p.slices);
    setResult(null);
    setCopied(null);
    setData(null);
    setSqlCopied(null);
    if (source.kind === 'update' && !sheetUrl(source.report)) { setResult({ kind: 'error', text: UNRECOGNISED }); return; }
    setDialog((cur) => (cur ? { ...cur, error: undefined } : cur));
    void exporter.run({ martId: p.martId, destination, title, source, payload, notes, signal: ctx.signal }).catch(() => undefined);
    follow(exporter.inFlight(p.martId)!, { fromDialog, destination, openWhenDone: true });
  }

  async function copyPrompt(assistant: Assistant) {
    closeMenu();
    const prompt = buildAiPrompt({ projectId: ctx.projectId, martId: p.martId, martTitle: p.martTitle, schema: p.schema, visible: p.visible, aggregation: p.aggregation, filters: p.filters, slices: p.slices, sorts: p.sorts });
    const home = gen.current;
    const ok = await copyText(prompt);
    if (gen.current !== home) return;
    setResult(null);
    setData(null);
    setSqlCopied(null);
    setCopied({ assistant, prompt, ok });
    // Neither way of copying worked (the sandbox may block both): the prompt is shown to be copied by hand.
    if (!ok) setPromptOpen(true);
  }

  /** The loaded rows as tab-separated text, through the same clipboard path as the prompt. Nothing is queried and nothing is written. */
  async function copyData() {
    closeMenu();
    if (!p.rows?.length || p.loading) return;
    const fields = p.visible.flatMap((name) => p.schema.find((f) => f.name === name) ?? []);
    const tsv = buildTsv(tsvColumns(fields, p.aggregation), p.rows);
    const home = gen.current;
    const ok = await copyText(tsv);
    if (gen.current !== home) return;
    setResult(null);
    setCopied(null);
    setSqlCopied(null);
    setData({ tsv, count: p.rows.length, more: p.hasMore, ok });
    if (!ok) setDataOpen(true);
  }

  const noRows = !p.rows?.length;
  const copyOff = noRows ? 'No rows to copy' : p.loading ? 'Rows are loading' : null;
  const label = busy ? <><Loader2 className="size-4 animate-spin" />Exporting…</> : <><ArchiveRestore className="size-4" />Export</>;

  /** Copies the SQL the grid ran. Nothing is queried and nothing is written. */
  async function copySql(sql: string) {
    closeMenu();
    const home = gen.current;
    const ok = await copyText(sql);
    if (gen.current !== home) return;
    setResult(null);
    setCopied(null);
    setData(null);
    setSqlCopied({ sql, ok });
    // Neither way of copying worked: the SQL is shown to be copied by hand.
    if (!ok) setSqlOpen(true);
  }

  function openMenu(open: boolean) {
    setMenuOpen(open);
    if (!open) return;
    setOpening((n) => n + 1);
    // The live reads of this mart's reports start on its first opening and stay for the session.
    exporter.load(p.martId);
  }

  // One toast: an export outcome (it stays until dismissed), else the copied data or prompt (it hides itself).
  const note = busy ? null : result ?? copied ?? data ?? sqlCopied;
  const dismissNote = () => { if (result) setResult(null); else if (copied) { setCopied(null); setPromptOpen(false); } else if (data) { setData(null); setDataOpen(false); } else { setSqlCopied(null); setSqlOpen(false); } };
  const tone = !note ? undefined : result ? ({ ok: 'success', error: 'error', timeout: 'info' } as const)[result.kind] : (copied ?? data ?? sqlCopied)!.ok ? 'success' : 'error';
  const noteBody = !note ? null : result ? <ExportResultText result={result} /> : copied ? <CopiedNoteText copied={copied} /> : data ? <CopiedDataText data={data} /> : sqlCopied ? <CopiedSqlText sqlCopied={sqlCopied} /> : null;
  const noteAction = !note ? undefined : result ? <ExportResultLink result={result} /> : copied ? <button type="button" onClick={() => setPromptOpen(true)} className="shrink-0 underline">Show prompt</button> : data && !data.ok ? <button type="button" onClick={() => setDataOpen(true)} className="shrink-0 underline">Show data</button> : sqlCopied && !sqlCopied.ok ? <button type="button" onClick={() => setSqlOpen(true)} className="shrink-0 underline">Show SQL</button> : undefined;

  return (
    <>
      <span role="status" className="empty:absolute text-xs text-muted-foreground">{busy}</span>
      <Toast tone={tone} onDismiss={dismissNote} returnTo={() => menu.current?.querySelector('summary')} action={noteAction} persistent={!busy && !!result} hold={promptOpen || dataOpen || sqlOpen} stamp={note}>{noteBody}</Toast>
      <details ref={menu} className="dm-filter dm-export" name="dm-filter" onToggle={(e) => openMenu(e.currentTarget.open)} {...(busy ? { 'aria-disabled': true } : {})}>
          <summary onClick={(e) => { if (busy) e.preventDefault(); }} onKeyDown={onSummaryKey}>{label}<ChevronDown size={14} /></summary>
          <div className="dm-filter-menu dm-export-menu" role="menu" data-level="1" onKeyDown={onMenuKey}>
            <div role="group" aria-label="Assistants" className="dm-export-ai">
              {([['Claude', ClaudeIcon], ['ChatGPT', ChatGptIcon]] as const).map(([name, Icon]) => (
                <div key={name} role="none" className="dm-export-ai-row">
                  <button type="button" role="menuitem" data-lvl="1" data-action={name} className="dm-export-item" onClick={() => void copyPrompt(name)}>
                    <Icon size={16} />
                    <span className="dm-filter-label">{name}</span>
                  </button>
                  <Tooltip content={`Open OWOX in ${name}`}>
                    <button type="button" role="menuitem" data-link={name} className="dm-export-link" aria-label={`Open OWOX in ${name}`} onClick={() => void ctx.ui.openExternal(PROVIDER_LISTING[name]).catch(() => undefined)}>
                      <ExternalLink size={14} />
                    </button>
                  </Tooltip>
                </div>
              ))}
            </div>
            <div role="separator" className="dm-menu-sep" />
            {destinations.length > 0 && (
              <>
                <div role="group" aria-label="Destinations" className="dm-export-dest">
                  {destinations.map((d) => (
                    <button key={d.id} type="button" role="menuitem" data-lvl="1" data-dest={d.id} className="dm-export-item" onClick={() => { closeMenu(); setDialog({ destination: d, seq: ++seq.current }); }}>
                      <GoogleSheetsIcon size={16} />
                      <span className="dm-filter-label">{d.title}</span>
                    </button>
                  ))}
                </div>
                <div role="separator" className="dm-menu-sep" />
              </>
            )}
            <div role="group" aria-label="Copy" className="dm-export-copy">
              {copyOff ? (
                <Tooltip content={copyOff}>
                  <span className="block">
                    <button type="button" role="menuitem" data-lvl="1" data-action="copy" disabled className="dm-export-item w-full"><Copy size={16} /><span className="dm-filter-label">Copy to clipboard</span></button>
                  </span>
                </Tooltip>
              ) : (
                <button type="button" role="menuitem" data-lvl="1" data-action="copy" className="dm-export-item" onClick={() => void copyData()}>
                  <Copy size={16} />
                  <span className="dm-filter-label">Copy to clipboard</span>
                </button>
              )}
              {sqlOff ? (
                <Tooltip content={sqlOff}>
                  <span className="block">
                    <button type="button" role="menuitem" data-lvl="1" data-action="sql" data-reason={sqlOff} disabled className="dm-export-item w-full"><Code size={16} /><span className="dm-filter-label">Copy SQL</span></button>
                  </span>
                </Tooltip>
              ) : (
                <Tooltip content="The SQL the grid ran, with its page LIMIT">
                  <button type="button" role="menuitem" data-lvl="1" data-action="sql" className="dm-export-item" onClick={() => void copySql(sqlReady!)}>
                    <Code size={16} />
                    <span className="dm-filter-label">Copy SQL</span>
                  </button>
                </Tooltip>
              )}
            </div>
            <div role="separator" className="dm-menu-sep" />
            <div role="group" aria-label="Data mart" className="dm-export-mart">
              {'reason' in martSql ? (
                <Tooltip content={martSql.reason}>
                  <span className="block">
                    <button type="button" role="menuitem" data-lvl="1" data-action="create-mart" data-reason={martSql.reason} disabled className="dm-export-item w-full"><DatabaseZap size={16} /><span className="dm-filter-label">Create Data Mart</span></button>
                  </span>
                </Tooltip>
              ) : (
                <button type="button" role="menuitem" data-lvl="1" data-action="create-mart" className="dm-export-item" onClick={() => { closeMenu(); setMartDialog({ variants: martSql.variants, grouped: martSql.grouped, having: p.filters.some((f) => !!f.fn), joinedMarts: p.joinedMarts ?? [], storage: p.storage!, seq: ++seq.current }); }}>
                  <DatabaseZap size={16} />
                  <span className="dm-filter-label">Create Data Mart</span>
                </button>
              )}
            </div>
          </div>
        </details>
      {promptOpen && copied && <TextDialog name="Prompt" heading={`Prompt for ${copied.assistant}`} note={`Paste it into ${copied.assistant} with the OWOX Data Marts connector turned on. Copying writes nothing to OWOX.`} areaLabel="Prompt text" text={copied.prompt} onClose={() => setPromptOpen(false)} returnFocus={() => menu.current?.querySelector<HTMLElement>('summary')?.focus()} />}
      {dataOpen && data && <TextDialog name="Copy the data" note="Select the text and copy it, then paste it into a sheet. Copying writes nothing to OWOX." areaLabel="Data text" text={data.tsv} onClose={() => setDataOpen(false)} returnFocus={() => menu.current?.querySelector<HTMLElement>('summary')?.focus()} />}
      {sqlOpen && sqlCopied && <TextDialog name="SQL" note="Select the SQL and copy it. Copying writes nothing to OWOX." areaLabel="SQL text" text={sqlCopied.sql} onClose={() => setSqlOpen(false)} returnFocus={() => menu.current?.querySelector<HTMLElement>('summary')?.focus()} />}
      {martDialog && <CreateMartDialog key={martDialog.seq} returnFocus={() => menu.current?.querySelector<HTMLElement>('summary')?.focus()} martTitle={p.martTitle} variants={martDialog.variants} grouped={martDialog.grouped} having={martDialog.having} joinedMarts={martDialog.joinedMarts} storage={martDialog.storage} onClose={() => setMartDialog(null)} />}
      {dialog && <ExportDialog key={dialog.seq} returnFocus={() => menu.current?.querySelector<HTMLElement>('summary')?.focus()} exporter={exporter} martId={p.martId} destination={dialog.destination} initialError={dialog.error} title={exportTitle(p.martTitle)} busy={!!busy} onCancel={() => setDialog(null)} onExport={(title, source) => start(dialog.destination, source, title, true)} />}
    </>
  );

  /** On the button: ArrowDown or Enter opens the menu and focuses its first row; Escape closes it. */
  function onSummaryKey(e: ReactKeyboardEvent<HTMLElement>) {
    if (busy) return;
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      if (menu.current) menu.current.open = true;
      menu.current?.querySelector<HTMLElement>('[data-lvl="1"]:not([disabled])')?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
    }
  }

  /** Arrow keys walk the menu. Enter and Space activate a row as a button does; on an assistant row ArrowRight reaches its link; Escape closes the menu. */
  function onMenuKey(e: ReactKeyboardEvent<HTMLElement>) {
    const target = e.target as HTMLElement;
    // The external-link button at the end of an assistant row: ArrowLeft goes back to its item, Escape closes the menu.
    if (target.dataset.link) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); target.parentElement?.querySelector<HTMLElement>('[data-lvl="1"]')?.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); menu.current?.querySelector<HTMLElement>('summary')?.focus(); }
      return;
    }
    if (!target.dataset.lvl) return;
    if (e.key === 'ArrowRight' && target.dataset.action && target.dataset.action !== 'copy' && target.dataset.action !== 'sql' && target.dataset.action !== 'create-mart') {
      e.preventDefault();
      target.parentElement?.querySelector<HTMLElement>('[data-link]')?.focus();
      return;
    }
    const items = [...target.closest('[data-level="1"]')!.querySelectorAll<HTMLElement>('[role="menuitem"][data-lvl="1"]:not([disabled])')];
    const at = items.indexOf(target);
    const move = (to: number) => { e.preventDefault(); items[(to + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(items.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
      menu.current?.querySelector<HTMLElement>('summary')?.focus();
    }
  }
}

/** "Prompt copied. Paste it into Claude". When the clipboard was out of reach the prompt is in the dialog instead. */
function CopiedNoteText({ copied }: { copied: Copied }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {copied.ok ? <Check className="size-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="size-3.5 shrink-0" aria-hidden />}
      {copied.ok ? `Prompt copied. Paste it into ${copied.assistant}` : `Could not copy. Copy the prompt, then paste it into ${copied.assistant}`}
    </span>
  );
}

function TextDialog({ name, heading = name, note, areaLabel, text, onClose, returnFocus }: { name: string; heading?: string; note: string; areaLabel: string; text: string; onClose: () => void; returnFocus: () => void }) {
  const [again, setAgain] = useState<'idle' | 'copied' | 'failed'>('idle');
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { area.current?.focus(); }, []);
  return (
    <Modal label={name} onClose={onClose} width="w-[34rem]" returnFocus={returnFocus}>
        <h2 className="text-base font-semibold">{heading}</h2>
        <p className="text-xs text-muted-foreground">{note}</p>
        <textarea ref={area} readOnly aria-label={areaLabel} rows={13} value={text} onFocus={(e) => e.currentTarget.select()} className="dm-input w-full resize-none rounded-md border bg-background p-2 font-mono text-xs" />
        <div className="flex items-center justify-end gap-2">
          {again === 'failed' && <span role="alert" className="mr-auto text-xs text-destructive">Could not copy. Select the text and copy it by hand.</span>}
          <button type="button" onClick={onClose} className="h-8 rounded-md border px-3 hover:bg-accent">Close</button>
          <button type="button" onClick={async () => { const ok = await copyText(text); setAgain(ok ? 'copied' : 'failed'); if (!ok) { area.current?.focus(); area.current?.select(); } }} className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-primary-foreground">
            {again === 'copied' ? <><Check className="size-4" />Copied</> : 'Copy'}
          </button>
        </div>
    </Modal>
  );
}

/** "SQL copied", or what is left to do when the clipboard was out of reach. */
function CopiedSqlText({ sqlCopied }: { sqlCopied: CopiedSql }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {sqlCopied.ok ? <Check className="size-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="size-3.5 shrink-0" aria-hidden />}
      {sqlCopied.ok ? 'SQL copied. It is the query the grid ran, with its page LIMIT.' : 'Could not copy. Copy the SQL by hand'}
    </span>
  );
}

/** "Copied N rows", or what is left to do when the clipboard was out of reach. */
function CopiedDataText({ data }: { data: CopiedData }) {
  const rows = `${data.count} ${data.count === 1 ? 'row' : 'rows'}`;
  return (
    <span className="inline-flex items-center gap-1.5">
      {data.ok ? <Check className="size-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="size-3.5 shrink-0" aria-hidden />}
      {!data.ok ? 'Could not copy. Copy the data by hand' : data.more ? `Copied the first ${rows}. Load more to copy more.` : `Copied ${rows}`}
    </span>
  );
}

/** The outcome of a Google Sheets export, as the toast's text. */
function ExportResultText({ result }: { result: Result }) {
  const Icon = result.kind === 'ok' ? Check : AlertTriangle;
  return (
    <span className="inline-flex items-start gap-1.5">
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden /><span className="min-w-0 break-words">{result.text}</span>
    </span>
  );
}

function ExportResultLink({ result }: { result: Result }) {
  if (!result.url) return null;
  return <a href={result.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-0.5 underline">{result.kind === 'timeout' ? 'Still running — open the sheet' : 'Open the sheet'}<ExternalLink className="size-3" /></a>;
}

/** What the dialog knows of this mart's reports, filling in as the live reads return. */
function useMartReports(exporter: Exporter, martId: string) {
  const subscribe = useCallback((cb: () => void) => exporter.subscribe(martId, cb), [exporter, martId]);
  const entries = useSyncExternalStore(subscribe, () => exporter.entries(martId));
  // The remembered ids and usedAt are known without OWOX; read again whenever the entries change so a dropped report leaves them too.
  const [stored, setStored] = useState<StoredReport[] | null>(() => exporter.storedNow(martId) ?? null);
  useEffect(() => {
    let live = true;
    void exporter.stored(martId).then((l) => { if (live) setStored(l); });
    return () => { live = false; };
  }, [exporter, martId, entries]);
  // A remembered report with no entry means the reads were dropped (a model reload) or never started: start them. Idempotent while a cache exists.
  const missing = stored !== null && stored.some((r) => !entries.some((e) => e.reportId === r.reportId));
  useEffect(() => { if (missing) exporter.load(martId); }, [missing, exporter, martId, entries]);
  return { entries, stored, pending: stored === null || missing };
}

/** Most recent first, never-used last; ties keep their order. */
const byUsedAt = (a: { usedAt?: string }, b: { usedAt?: string }) => (b.usedAt ? Date.parse(b.usedAt) : -Infinity) - (a.usedAt ? Date.parse(a.usedAt) : -Infinity);

type Option = 1 | 2 | 3;

function ExportDialog({ exporter, martId, destination, title, initialError, busy, onCancel, onExport, returnFocus }: {
  returnFocus: () => void; exporter: Exporter; martId: string; destination: DestinationDto; title: string; initialError?: string; busy: boolean; onCancel: () => void; onExport: (title: string, source: ExportSource) => void;
}) {
  const [name, setName] = useState(title);
  const [url, setUrl] = useState('');
  // What the member chose in the dialog; null until they click a radio or a report, so the dialog may still move option 3 around.
  // `first` keeps the order the member saw when they chose, so the options do not move under them.
  const [picked, setPicked] = useState<{ option: Option; reportId?: string; first: boolean } | null>(null);
  // A message from a failed attempt comes down from the parent; a form mistake is the dialog's own.
  const [local, setError] = useState<string | null>(null);
  const error = local ?? initialError ?? null;
  const { entries, stored, pending } = useMartReports(exporter, martId);
  // The checked radio takes focus when the dialog opens.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.querySelector<HTMLElement>('input[type="radio"]:checked')?.focus(); }, []);

  const loadingCount = entries.filter((e) => e.state === 'loading').length;
  const loading = pending || loadingCount > 0;
  // Reports that are here, or whose read failed (their destination is unknown); each in most-recent order.
  const listed: ReportEntry[] = entries.filter((e) => e.state === 'failed' || (e.state === 'ready' && e.report!.destinationId === destination.id)).sort(byUsedAt);
  const readable = (e: ReportEntry) => e.state === 'ready' && sheetUrl(e.report!) !== null;
  const recentHere = listed.find((e) => readable(e) && isRecent(e.usedAt));
  // Until its live read has finished (a failed read counts as finished), a recently used report anywhere in the mart may be in this destination.
  const recentUnknown = (stored ?? []).some((r) => isRecent(r.usedAt) && !entries.some((e) => e.reportId === r.reportId && e.state !== 'loading'));
  const leading = !!recentHere || recentUnknown;
  const option: Option = picked?.option ?? (leading ? 3 : 1);
  const chosenId = picked?.reportId ?? recentHere?.reportId;
  const chosen = option === 3 ? listed.find((e) => e.reportId === chosenId && readable(e)) : undefined;
  const noReports = !loading && listed.length === 0;
  // An untouched dialog whose option 3 moves back takes the focus with it, so it is not left on a radio that is gone or on the page body.
  const wasLeading = useRef(leading);
  useEffect(() => {
    if (wasLeading.current && !leading && !picked) {
      const at = document.activeElement;
      if (!at || at === document.body || box.current?.contains(at)) box.current?.querySelector<HTMLElement>('input[name="dm-export-target"]:checked')?.focus();
    }
    wasLeading.current = leading;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leading]);
  const order: Option[] = (picked ? picked.first : leading) ? [3, 1, 2] : [1, 2, 3];

  /** Exporting fixes the member's choice and the order, so the list changing during the run does not move the dialog. */
  function go(title: string, source: ExportSource) {
    setPicked((cur) => cur ?? { option, reportId: chosenId, first: leading });
    onExport(title, source);
  }
  function submit() {
    if (busy) return;
    if (option === 3) {
      if (!chosen?.report) return setError('Pick a report to update.');
      setError(null);
      return go(chosen.report.title, { kind: 'update', report: chosen.report });
    }
    if (!name.trim()) return setError('Give the report a title.');
    if (option === 1) { setError(null); return go(name.trim(), { kind: 'new' }); }
    if (isPublishedSheetUrl(url)) return setError('That is a published-to-web link. Open the spreadsheet itself and paste its address bar link.');
    const target = parseSheetUrl(url);
    if (!target) return setError('Paste the link of a Google spreadsheet (docs.google.com/spreadsheets/d/…).');
    setError(null);
    go(name.trim(), { kind: 'existing', target });
  }

  const radio = (n: Option, label: string, disabled = false) => (
    <label key={n} className={`flex items-center gap-2 ${disabled ? 'opacity-60' : ''}`}>
      <input type="radio" name="dm-export-target" checked={option === n} disabled={disabled} onChange={() => setPicked((cur) => ({ option: n, reportId: cur?.reportId, first: cur?.first ?? leading }))} />{label}
    </label>
  );
  const details: Record<Option, React.ReactNode> = {
    1: null,
    2: option === 2 && (
      <div className="ml-6 flex flex-col gap-1">
        <label className="flex flex-col gap-1">Spreadsheet link
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0" className="h-8 rounded-md border bg-background px-2" />
        </label>
        <span className="text-xs text-muted-foreground">Share it with the destination’s account as Editor. Without a #gid the first tab is used.</span>
      </div>
    ),
    3: option === 3 && (
      <div className="ml-6 flex flex-col gap-1" role="radiogroup" aria-label="Report to update">
        {listed.map((e) => e.state === 'failed' ? (
          <div key={e.reportId} className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Couldn’t load</span>
            <button type="button" onClick={() => exporter.retry(martId, e.reportId)} className="rounded border px-2 py-0.5 hover:bg-accent">Retry</button>
          </div>
        ) : (
          <label key={e.reportId} className={`flex items-center gap-2 ${readable(e) ? '' : 'opacity-60'}`}>
            <input type="radio" name="dm-export-report" checked={chosen?.reportId === e.reportId} disabled={!readable(e)} onChange={() => setPicked((cur) => ({ option: 3, reportId: e.reportId, first: cur?.first ?? leading }))} />
            <span className="min-w-0 flex-1 truncate">{e.report!.title}</span>
            {!readable(e) && <span className="text-xs text-muted-foreground">Unrecognised spreadsheet</span>}
            {e.reportId === recentHere?.reportId && <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Recently used</span>}
          </label>
        ))}
        {loading && (
          <div role="status" className="flex flex-col gap-1.5" aria-label="Loading reports">
            <span className="text-xs text-muted-foreground">Loading reports…</span>
            {Array.from({ length: Math.max(1, loadingCount) }, (_, i) => <div key={i} data-skeleton className="h-4 w-full animate-pulse rounded bg-muted" />)}
          </div>
        )}
        {noReports && <span className="text-xs text-muted-foreground">No reports of this data mart in this destination yet.</span>}
      </div>
    ),
  };

  return (
    <Modal label={`Export to ${destination.title}`} onClose={onCancel} width="w-[28rem]" returnFocus={returnFocus} onAction={submit} dialogRef={box}>
        <h2 className="text-base font-semibold">Export to {destination.title}</h2>
        {option !== 3 && (
          <label className="flex flex-col gap-1">Report title
            <input value={name} onChange={(e) => setName(e.target.value)} className="h-8 rounded-md border bg-background px-2" />
          </label>
        )}
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1">Export into</legend>
          {order.map((n) => (
            <div key={n} className="flex flex-col gap-1">
              {radio(n, n === 1 ? 'New spreadsheet' : n === 2 ? 'Existing spreadsheet' : 'Update existing report', n === 3 && noReports)}
              {details[n]}
            </div>
          ))}
        </fieldset>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-8 rounded-md border px-3 hover:bg-accent">Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-primary-foreground disabled:opacity-50">{busy && <Loader2 className="size-4 animate-spin" />}Export</button>
        </div>
    </Modal>
  );
}

/** The link to a data mart in OWOX: it opens through the host, since the plugin runs in a frame. */
const MartLink = ({ url, children, linkRef }: { url: string; children: React.ReactNode; linkRef?: React.Ref<HTMLAnchorElement> }) => {
  const { ctx } = useServices();
  return <a ref={linkRef} href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); void ctx.ui.openExternal(url).catch(() => undefined); }} className="underline">{children}</a>;
};

/** The SQL of one grouping choice: plain, and with the grid's ORDER BY; each may be a reason instead. */
type MartVariant = { plain: { sql: string } | { reason: string }; sorted: { sql: string } | { reason: string } };
type MartVariants = { off: MartVariant; on: MartVariant };

/** The dialog behind Create Data Mart: names the mart, shows its SQL, runs the create steps, then links to the result. */
function CreateMartDialog({ martTitle, variants, grouped, having, joinedMarts, storage, onClose, returnFocus }: { martTitle: string; variants: MartVariants; /** The grid groups its rows. */ grouped: boolean; /** The grid has filters on aggregates, which only a grouped data mart can keep. */ having: boolean; /** The joined data marts selected when the dialog opened. */ joinedMarts: { id: string; title: string }[]; storage: { id: string; type: string; title?: string }; onClose: () => void; returnFocus: () => void }) {
  const { ctx } = useServices();
  const [name, setName] = useState(exportTitle(martTitle));
  const [grouping, setGrouping] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [stage, setStage] = useState<CreateStage | null>(null);
  const [failure, setFailure] = useState<CreateMartError | { message: string; stage?: undefined; martId?: undefined } | null>(null);
  const [made, setMade] = useState<{ id: string; url: string } | null>(null);
  const [local, setLocal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const running = stage !== null || deleting;
  const field = useRef<HTMLInputElement>(null);
  const link = useRef<HTMLAnchorElement>(null);
  const live = useRef(true);
  const abort = useRef(new AbortController());
  const groupOff = !grouped ? "The grid isn't grouped" : 'reason' in variants.on.plain ? variants.on.plain.reason : null;
  const groupOn = grouping && !groupOff;
  const { plain, sorted } = groupOn ? variants.on : variants.off;
  const sortOn = sorting && 'sql' in sorted;
  const sql = sortOn ? sorted.sql : 'sql' in plain ? plain.sql : '';
  const joined = joinedMarts.length;
  useEffect(() => { field.current?.focus(); field.current?.select(); }, []);
  useEffect(() => () => { live.current = false; abort.current.abort(); }, []);
  useEffect(() => { if (made) link.current?.focus(); }, [made]);

  async function submit() {
    if (running) return;
    // A draft that already exists is resumed from the step that failed; without one the run starts over.
    const resume = failure?.martId ? { martId: failure.martId, from: failure.stage } : {};
    if (!resume.martId && !name.trim()) return setLocal('Give the data mart a name.');
    setLocal(null);
    setNotice(null);
    setFailure(null);
    setStage('create');
    try {
      const r = await createDataMart(ctx, { title: name.trim(), storageId: storage.id, sql, signal: abort.current.signal, ...resume }, (s) => { if (live.current) setStage(s); });
      if (live.current) setMade(r);
    } catch (e) {
      if (live.current) setFailure(e instanceof CreateMartError ? e : { message: errorMessage(e) });
    } finally {
      if (live.current) setStage(null);
    }
  }
  // Define or schema failed: the draft can't be published as it is, so the member may delete it and start over.
  async function discard() {
    if (running || !failure?.martId) return;
    setLocal(null);
    setDeleting(true);
    try {
      await deleteDraft(ctx, failure.martId);
      if (live.current) { setFailure(null); setNotice('The draft was deleted. Edit the name or the options and create again.'); }
    } catch (e) {
      if (live.current) setLocal(`The draft could not be deleted: ${errorMessage(e)}`);
    } finally {
      if (live.current) setDeleting(false);
    }
  }
  const error = local ?? failure?.message ?? null;
  const draft = failure?.martId ? martAppUrl(ctx.projectId, failure.martId) : null;
  const published = failure?.stage === 'share';
  const deletable = !!failure?.martId && (failure.stage === 'define' || failure.stage === 'schema');
  const where = storage.title ?? storage.type;

  // Escape and the backdrop close the dialog unless a run is in flight.
  return (
    <Modal label="Create Data Mart" onClose={onClose} canClose={!running} width="w-[34rem]" returnFocus={returnFocus} onAction={() => void submit()}>
        <h2 className="text-base font-semibold">Create Data Mart</h2>
        {made ? (
          <>
            <p>Created {name.trim() || made.id}.</p>
            <p><MartLink url={made.url} linkRef={link}>Open {name.trim() || made.id}</MartLink></p>
            <div className="flex justify-end"><button type="button" onClick={onClose} className="h-8 rounded-md border px-3 hover:bg-accent">Close</button></div>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">An SQL data mart in {where} that references {martTitle}{joined > 0 ? ` and ${joined === 1 ? 'the joined data mart' : `the ${joined} joined data marts`} the grid uses` : ''}, with its columns and filters. It is published and available for reporting.</p>
            <label className="flex flex-col gap-1">Name
              <input ref={field} value={name} disabled={running || !!failure?.martId} onChange={(e) => setName(e.target.value)} className="h-8 rounded-md border bg-background px-2 disabled:opacity-60" />
            </label>
            {grouped && !groupOn && <p className="text-xs text-muted-foreground">The grid groups its rows; the data mart keeps them ungrouped, so the tool that reads it can group them.</p>}
            {grouped && !groupOn && having && <p className="text-xs text-muted-foreground">Filters on aggregates are left out when the data mart is not grouped.</p>}
            <label className="flex flex-col gap-0.5">
              <span className="inline-flex items-center gap-2">
                <input type="checkbox" checked={groupOn} disabled={running || !!failure?.martId || !!groupOff} onChange={(e) => { setGrouping(e.target.checked); if ('reason' in (e.target.checked ? variants.on : variants.off).sorted) setSorting(false); }} />
                Include grouping
              </span>
              {groupOff && <span className="pl-6 text-xs text-muted-foreground">{groupOff}</span>}
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="inline-flex items-center gap-2">
                <input type="checkbox" checked={sortOn} disabled={running || !!failure?.martId || 'reason' in sorted} onChange={(e) => setSorting(e.target.checked)} />
                Include sorting
              </span>
              {'reason' in sorted && <span className="pl-6 text-xs text-muted-foreground">{sorted.reason}</span>}
            </label>
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">SQL</summary>
              <textarea readOnly aria-label="SQL" rows={10} value={sql} className="dm-input mt-1 w-full resize-none rounded-md border bg-background p-2 font-mono text-xs" />
            </details>
            {error && (
              <div role="alert" className="flex flex-col gap-1 text-xs text-destructive">
                <p>{error}</p>
                {draft && (published
                  ? <p>The data mart is published but not yet available for reporting: <MartLink url={draft}>Open the data mart</MartLink></p>
                  : <p>The data mart was created as a draft: <MartLink url={draft}>Open the draft</MartLink></p>)}
                {deletable && <p><button type="button" disabled={running} onClick={() => void discard()} className="underline disabled:opacity-50">Delete the draft</button></p>}
              </div>
            )}
            {notice && !error && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
            <div className="flex items-center justify-end gap-2">
              <button type="button" disabled={running} onClick={onClose} className="h-8 rounded-md border px-3 hover:bg-accent disabled:opacity-50">Cancel</button>
              <button type="button" onClick={() => void submit()} disabled={running} className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-primary-foreground disabled:opacity-50">
                {running ? <><Loader2 className="size-4 animate-spin" />{stage ? CREATE_STAGE_LABEL[stage] : 'Deleting the draft…'}</> : failure ? 'Retry' : 'Create'}
              </button>
            </div>
          </>
        )}
    </Modal>
  );
}
