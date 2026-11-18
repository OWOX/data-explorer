import { AlertTriangle, ArchiveRestore, Check, ChevronDown, Code, Copy, ChevronRight, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  buildReportPayload, exportTitle, ExportError, isPublishedSheetUrl, parseSheetUrl, reportMayExist, sheetUrl,
  type ExportedReport, type ExportSource, type Flight, type Stage,
} from '../../api/exports';
import type { ColumnFilter } from '../../filters/build';
import type { SortKey } from '../../model/sort';
import type { Schema } from '../../model/types';
import type { Row } from '../../sdk/types';
import { buildTsv, tsvColumns } from '../../export/tsv';
import type { Aggregation } from '../../model/aggregation';
import type { DestinationDto } from '../../sdk/types';
import { buildAiPrompt } from '../../api/ai-prompt';
import { readRunSql, type RunSql } from '../../api/run-sql';
import { useServices, useStore } from '../../state/store';
import { ChatGptIcon } from '../chatgpt-icon';
import { ClaudeIcon } from '../claude-icon';
import { GoogleSheetsIcon } from '../google-sheets-icon';
import { Toast } from '../Toast';
import { ActionForm } from '../ActionForm';
import { Tooltip } from '../Tooltip';
import { copyText } from './clipboard';
import type { GridRun } from './useMartRows';

type Props = { martId: string; martTitle: string; schema: Schema; visible: string[]; /** The functions and date buckets on the columns; any of them groups the rows. */ aggregation?: Aggregation; filters: ColumnFilter[]; sorts: SortKey[]; /** The rows the grid has loaded, in grid order; null until the first read. */ rows: Row[] | null; /** The mart has more rows than are loaded. */ hasMore: boolean; /** A read is in flight, so `rows` may be out of date. */ loading?: boolean; /** The query behind the grid's rows, for Copy SQL. */ run?: GridRun };
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
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "Export" in the Data band header: a menu of one "Copy to clipboard" item, the Google Sheets destinations, then Claude and ChatGPT, each of which copies a prompt, and last "Copy SQL", which copies the SQL the grid ran. */
export function ExportMenu(p: Props) {
  const { ctx, exporter } = useServices();
  const [{ modelVersion }] = useStore();
  const [destinations, setDestinations] = useState<DestinationDto[]>([]);
  const [loaded, setReports] = useState<{ martId: string; list: ExportedReport[] } | null>(null);
  const reports = loaded?.martId === p.martId ? loaded.list : null;
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
  const seq = useRef(0);
  // Bumped when the mart changes or the menu goes away: an export finishing later is no longer in front of the member.
  const gen = useRef(0);
  useEffect(() => { gen.current += 1; return () => { gen.current += 1; }; }, [p.martId]);
  const [openDest, setOpenDest] = useState<string | null>(null);
  // Which way the open flyout goes, and whether the keyboard (not the pointer) opened it, so its first row takes focus.
  const [flyout, setFlyout] = useState<{ side: 'right' | 'left'; focus: boolean; tick: number }>({ side: 'right', focus: false, tick: 0 });
  // False until the live check of the remembered reports has ended since the menu opened: until then their titles and targets may be stale.
  const [verified, setVerified] = useState(false);
  const checks = useRef(0);
  const menu = useRef<HTMLDetailsElement>(null);

  // Listed once per session; a model reload (Retry on a failed storage) lists them again.
  const seenVersion = useRef(modelVersion);
  useEffect(() => {
    let live = true;
    if (seenVersion.current !== modelVersion) { seenVersion.current = modelVersion; exporter.invalidate(); }
    exporter.destinations().then((d) => live && setDestinations(d), (e) => { if (live) { console.warn('Listing the Google Sheets destinations failed', e); setDestinations([]); } });
    return () => { live = false; };
  }, [exporter, modelVersion]);
  useEffect(() => {
    let live = true;
    exporter.reports(p.martId).then((list) => live && setReports({ martId: p.martId, list }));
    return () => { live = false; };
  }, [exporter, p.martId]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (menu.current?.open && !menu.current.contains(e.target as Node)) menu.current.open = false; };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  // An export this mart already has under way (it outlives the menu): pick it up, with the outcome of one that finished while away.
  useEffect(() => {
    const flight = exporter.inFlight(p.martId);
    if (flight) follow(flight, { openWhenDone: !flight.settled });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exporter, p.martId]);

  // To the right of the row; to the left when it would leave the window. Judged before paint. A flyout the keyboard opened takes focus.
  useLayoutEffect(() => {
    const sub = menu.current?.querySelector<HTMLElement>('.dm-cascade-sub');
    if (!openDest || !sub) return;
    const box = sub.getBoundingClientRect();
    const row = sub.parentElement!.getBoundingClientRect();
    const side = row.right + box.width + 8 > window.innerWidth && row.left - box.width >= 8 ? 'left' : 'right';
    setFlyout((f) => (f.side === side ? f : { ...f, side }));
    if (flyout.focus) sub.querySelector<HTMLElement>('[data-lvl="2"]:not([disabled])')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDest, flyout.tick]);

  const closeMenu = () => { if (menu.current) menu.current.open = false; };
  const forDestination = (d: DestinationDto) => (reports ?? []).filter((r) => r.destinationId === d.id);

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
      setReports({ martId, list: await exporter.reports(martId) });
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
      const text = messageOf(e);
      const { destination, fromDialog } = o;
      if (destination && e instanceof ExportError && e.stage === 'sheet') {
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
        const list = await exporter.reports(martId).catch(() => []);
        if (here()) setReports({ martId, list });
      }
    }).finally(() => { if (here()) setBusy(null); });
  }

  function start(destination: DestinationDto, wanted: ExportSource, title: string, fromDialog = false) {
    if (exporter.inFlight(p.martId)) return;
    // A spreadsheet an earlier attempt made and left unused is reused, also after the menu was remounted.
    const left = exporter.made(p.martId, destination.id);
    const source: ExportSource = wanted.kind === 'new' && left ? { kind: 'existing', target: left } : wanted;
    const { payload, notes } = buildReportPayload(p.schema, p.visible, p.filters, p.sorts, p.aggregation);
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
    const prompt = buildAiPrompt({ projectId: ctx.projectId, martId: p.martId, martTitle: p.martTitle, schema: p.schema, visible: p.visible, aggregation: p.aggregation, filters: p.filters, sorts: p.sorts });
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

  async function openMenu(open: boolean) {
    setMenuOpen(open);
    if (open) setOpening((n) => n + 1);
    if (!open) { checks.current += 1; setVerified(false); return; }
    setOpenDest(null);
    // Reports OWOX no longer has are dropped before they are offered.
    const check = ++checks.current;
    try { setReports({ martId: p.martId, list: await exporter.reports(p.martId, true) }); } catch { /* the remembered list stays */ }
    finally { if (check === checks.current) setVerified(true); }
  }

  // One toast: an export outcome (it stays until dismissed), else the copied data or prompt (it hides itself).
  const note = busy ? null : result ?? copied ?? data ?? sqlCopied;
  const dismissNote = () => { if (result) setResult(null); else if (copied) { setCopied(null); setPromptOpen(false); } else if (data) { setData(null); setDataOpen(false); } else { setSqlCopied(null); setSqlOpen(false); } };
  const noteBody = !note ? null : result ? <ExportResultText result={result} /> : copied ? <CopiedNoteText copied={copied} /> : data ? <CopiedDataText data={data} /> : sqlCopied ? <CopiedSqlText sqlCopied={sqlCopied} /> : null;
  const noteAction = !note ? undefined : result ? <ExportResultLink result={result} /> : copied ? <button type="button" onClick={() => setPromptOpen(true)} className="shrink-0 underline">Show prompt</button> : data && !data.ok ? <button type="button" onClick={() => setDataOpen(true)} className="shrink-0 underline">Show data</button> : sqlCopied && !sqlCopied.ok ? <button type="button" onClick={() => setSqlOpen(true)} className="shrink-0 underline">Show SQL</button> : undefined;

  return (
    <>
      <span role="status" className="text-xs text-muted-foreground">{busy}</span>
      <Toast onDismiss={dismissNote} returnTo={() => menu.current?.querySelector('summary')} action={noteAction} persistent={!busy && !!result} hold={promptOpen || dataOpen || sqlOpen} stamp={note}>{noteBody}</Toast>
      <details ref={menu} className="dm-filter dm-export" name="dm-filter" onToggle={(e) => openMenu(e.currentTarget.open)} {...(busy ? { 'aria-disabled': true } : {})}>
          <summary onClick={(e) => { if (busy) e.preventDefault(); }} onKeyDown={onSummaryKey}>{label}<ChevronDown size={14} /></summary>
          <div className="dm-filter-menu dm-cascade" role="menu" data-level="1" onKeyDown={onMenuKey}>
            <div role="group" aria-label="Copy" className="dm-export-copy">
              {copyOff ? (
                <Tooltip content={copyOff}>
                  <span className="block" onMouseEnter={() => setOpenDest(null)}>
                    <button type="button" role="menuitem" data-lvl="1" data-action="copy" disabled className="dm-export-item w-full"><Copy size={16} /><span className="dm-filter-label">Copy to clipboard</span></button>
                  </span>
                </Tooltip>
              ) : (
                <button type="button" role="menuitem" data-lvl="1" data-action="copy" className="dm-export-item" onMouseEnter={() => setOpenDest(null)} onClick={() => void copyData()}>
                  <Copy size={16} />
                  <span className="dm-filter-label">Copy to clipboard</span>
                </button>
              )}
            </div>
            {destinations.map((d) => (
              <div key={d.id} data-dest={d.id} className="dm-cascade-row" onMouseEnter={() => openFlyout(d.id, false)}>
                <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={openDest === d.id} data-lvl="1" className="dm-export-item"
                  onClick={() => openFlyout(d.id, false)}>
                  <GoogleSheetsIcon size={16} />
                  <span className="dm-filter-label">{d.title}</span>
                  <ChevronRight size={14} />
                </button>
                {openDest === d.id && flyoutOf(d, forDestination(d))}
              </div>
            ))}
            <div role="group" aria-label="Assistants" className="dm-export-ai">
              {([['Claude', ClaudeIcon], ['ChatGPT', ChatGptIcon]] as const).map(([name, Icon]) => (
                <div key={name} role="none" className="dm-export-ai-row" onMouseEnter={() => setOpenDest(null)}>
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
            <div role="group" aria-label="SQL" className="dm-export-sql">
              {sqlOff ? (
                <Tooltip content={sqlOff}>
                  <span className="block" onMouseEnter={() => setOpenDest(null)}>
                    <button type="button" role="menuitem" data-lvl="1" data-action="sql" data-reason={sqlOff} disabled className="dm-export-item w-full"><Code size={16} /><span className="dm-filter-label">Copy SQL</span></button>
                  </span>
                </Tooltip>
              ) : (
                <Tooltip content="The SQL the grid ran, with its page LIMIT">
                  <button type="button" role="menuitem" data-lvl="1" data-action="sql" className="dm-export-item" onMouseEnter={() => setOpenDest(null)} onClick={() => void copySql(sqlReady!)}>
                    <Code size={16} />
                    <span className="dm-filter-label">Copy SQL</span>
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
        </details>
      {promptOpen && copied && <TextDialog name="Prompt" heading={`Prompt for ${copied.assistant}`} note={`Paste it into ${copied.assistant} with the OWOX Data Marts connector turned on. Copying writes nothing to OWOX.`} areaLabel="Prompt text" text={copied.prompt} onClose={() => { setPromptOpen(false); menu.current?.querySelector<HTMLElement>('summary')?.focus(); }} />}
      {dataOpen && data && <TextDialog name="Copy the data" note="Select the text and copy it, then paste it into a sheet. Copying writes nothing to OWOX." areaLabel="Data text" text={data.tsv} onClose={() => { setDataOpen(false); menu.current?.querySelector<HTMLElement>('summary')?.focus(); }} />}
      {sqlOpen && sqlCopied && <TextDialog name="SQL" note="Select the SQL and copy it. Copying writes nothing to OWOX." areaLabel="SQL text" text={sqlCopied.sql} onClose={() => { setSqlOpen(false); menu.current?.querySelector<HTMLElement>('summary')?.focus(); }} />}
      {dialog && <NewReportDialog key={dialog.seq} destination={dialog.destination} initialError={dialog.error} title={exportTitle(p.martTitle)} busy={!!busy} onCancel={() => setDialog(null)} onExport={(title, source) => start(dialog.destination, source, title, true)} />}
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

  function openFlyout(id: string, focus: boolean) {
    // The tick re-runs the focus effect when the pointer had already opened this very flyout.
    setFlyout((f) => ({ ...f, focus, tick: focus ? f.tick + 1 : f.tick }));
    setOpenDest(id);
  }

  /** Arrow keys walk a level; Right or Enter opens a destination's flyout, Left or Escape closes it, Escape again closes the menu. */
  function onMenuKey(e: ReactKeyboardEvent<HTMLElement>) {
    const target = e.target as HTMLElement;
    // The external-link button at the end of an assistant row: ArrowLeft goes back to its item, Escape closes the menu.
    if (target.dataset.link) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); target.parentElement?.querySelector<HTMLElement>('[data-lvl="1"]')?.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); menu.current?.querySelector<HTMLElement>('summary')?.focus(); }
      return;
    }
    const lvl = target.dataset.lvl;
    if (!lvl) return;
    if (lvl === '1' && e.key === 'ArrowRight' && target.dataset.action && target.dataset.action !== 'copy') {
      e.preventDefault();
      target.parentElement?.querySelector<HTMLElement>('[data-link]')?.focus();
      return;
    }
    const items = [...(target.closest(lvl === '1' ? '[data-level="1"]' : '[data-level="2"]')!.querySelectorAll<HTMLElement>(`[role="menuitem"][data-lvl="${lvl}"]:not([disabled])`))];
    const at = items.indexOf(target);
    const move = (to: number) => { e.preventDefault(); items[(to + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(items.length - 1);
    else if (lvl === '1' && target.dataset.action === undefined && (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      const row = target.closest('.dm-cascade-row')!;
      const id = (row as HTMLElement).dataset.dest;
      if (id) openFlyout(id, true);
    } else if (lvl === '2' && e.key === 'ArrowLeft') {
      e.preventDefault();
      target.closest('.dm-cascade-row')?.querySelector<HTMLElement>('[data-lvl="1"]')?.focus();
      setOpenDest(null);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (lvl === '2') {
        target.closest('.dm-cascade-row')?.querySelector<HTMLElement>('[data-lvl="1"]')?.focus();
        setOpenDest(null);
      } else {
        closeMenu();
        menu.current?.querySelector<HTMLElement>('summary')?.focus();
      }
    }
  }

  function flyoutOf(d: DestinationDto, rs: ExportedReport[]) {
    return (
      <div className={`dm-cascade-sub dm-cascade-${flyout.side}`} role="menu" data-level="2" aria-label={d.title}>
        {rs.map((r) => (
          <button key={r.reportId} type="button" role="menuitem" data-lvl="2" disabled={!verified} className="dm-export-item" onClick={() => { closeMenu(); start(d, { kind: 'update', report: r }, r.title); }}>
            <span className="dm-filter-label">Update “{r.title}”</span>
            {!verified && <span className="dm-export-kind inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" />Checking…</span>}
          </button>
        ))}
        <button type="button" role="menuitem" data-lvl="2" className="dm-export-item" onClick={() => { closeMenu(); setDialog({ destination: d, seq: ++seq.current }); }}>
          <span className="dm-filter-label">New report…</span>
        </button>
      </div>
    );
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

function TextDialog({ name, heading = name, note, areaLabel, text, onClose }: { name: string; heading?: string; note: string; areaLabel: string; text: string; onClose: () => void }) {
  const [again, setAgain] = useState<'idle' | 'copied' | 'failed'>('idle');
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  useEffect(() => { area.current?.focus(); }, []);
  // Tab cycles textarea, Close, Copy and back: focus never leaves the dialog behind the backdrop.
  const trap = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('textarea, button')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at < 0 || at === items.length - 1 ? 0 : at + 1);
    e.preventDefault();
    items[next]?.focus();
  };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={name} onKeyDown={trap} onClick={(e) => e.stopPropagation()} className="flex w-[34rem] max-w-[92vw] flex-col gap-3 rounded-lg border bg-background p-4 text-sm shadow-lg">
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
      </div>
    </div>,
    document.body,
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
    <span className={`inline-flex items-start gap-1.5 ${result.kind === 'error' ? 'text-destructive' : ''}`}>
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden /><span className="min-w-0 break-words">{result.text}</span>
    </span>
  );
}

function ExportResultLink({ result }: { result: Result }) {
  if (!result.url) return null;
  return <a href={result.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-0.5 underline">{result.kind === 'timeout' ? 'Still running — open the sheet' : 'Open the sheet'}<ExternalLink className="size-3" /></a>;
}

function NewReportDialog({ destination, title, initialError, busy, onCancel, onExport }: {
  destination: DestinationDto; title: string; initialError?: string; busy: boolean; onCancel: () => void; onExport: (title: string, source: ExportSource) => void;
}) {
  const [name, setName] = useState(title);
  const [existing, setExisting] = useState(false);
  const [url, setUrl] = useState('');
  // A message from a failed attempt comes down from the parent; a form mistake is the dialog's own.
  const [local, setError] = useState<string | null>(null);
  const error = local ?? initialError ?? null;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onCancel]);

  function submit() {
    if (busy) return;
    if (!name.trim()) return setError('Give the report a title.');
    if (!existing) { setError(null); return onExport(name.trim(), { kind: 'new' }); }
    if (isPublishedSheetUrl(url)) return setError('That is a published-to-web link. Open the spreadsheet itself and paste its address bar link.');
    const target = parseSheetUrl(url);
    if (!target) return setError('Paste the link of a Google spreadsheet (docs.google.com/spreadsheets/d/…).');
    setError(null);
    onExport(name.trim(), { kind: 'existing', target });
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <ActionForm role="dialog" aria-modal="true" aria-label="New report" onAction={submit} onClick={(e) => e.stopPropagation()} className="flex w-[28rem] max-w-[92vw] flex-col gap-3 rounded-lg border bg-background p-4 text-sm shadow-lg">
        <h2 className="text-base font-semibold">New report in {destination.title}</h2>
        <label className="flex flex-col gap-1">Report title
          <input value={name} onChange={(e) => setName(e.target.value)} className="h-8 rounded-md border bg-background px-2" />
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1">Spreadsheet</legend>
          <label className="flex items-center gap-2"><input type="radio" name="dm-export-target" checked={!existing} onChange={() => setExisting(false)} />New spreadsheet</label>
          <label className="flex items-center gap-2"><input type="radio" name="dm-export-target" checked={existing} onChange={() => setExisting(true)} />Existing spreadsheet</label>
        </fieldset>
        {existing && (
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1">Spreadsheet link
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0" className="h-8 rounded-md border bg-background px-2" />
            </label>
            <span className="text-xs text-muted-foreground">Share it with the destination’s account as Editor. Without a #gid the first tab is used.</span>
          </div>
        )}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-8 rounded-md border px-3 hover:bg-accent">Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-primary-foreground disabled:opacity-50">{busy && <Loader2 className="size-4 animate-spin" />}Export</button>
        </div>
      </ActionForm>
    </div>,
    document.body,
  );
}
