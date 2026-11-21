import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, ArchiveRestore, Check, ChevronDown, Box, Code, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { buildReportPayload, exportTitle, sheetUrl, type ExportSource } from '../../api/exports';
import type { ColumnFilter } from '../../filters/build';
import type { SortKey } from '../../model/sort';
import type { Edge, Schema } from '../../model/types';
import type { JoinedSource } from '../../api/blendable';
import { buildMartSql } from '../../datamart/build-sql';
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
import { rovingTarget } from '../roving';
import { Tooltip } from '../Tooltip';
import { CreateMartDialog, type MartVariant, type MartVariants } from './export/CreateMartDialog';
import { ExportDialog } from './export/ExportDialog';
import { TextDialog } from './export/TextDialog';
import { UNRECOGNISED, useExportFlight, type Result } from './export/useExportFlight';
import { copyText } from './clipboard';
import type { GridRun } from './useMartRows';
import { useOutsidePress } from '../outsidePress';

type Props = { martId: string; martTitle: string; schema: Schema; visible: string[]; /** The functions and date buckets on the columns; any of them groups the rows. */ aggregation?: Aggregation; filters: ColumnFilter[]; /** Pre-join filters on joined fields. */ slices?: ColumnFilter[]; sorts: SortKey[]; /** Only the sorts the member set; Create Data Mart never adds the grid's implicit order. */ ownSorts?: SortKey[]; /** The rows the grid has loaded, in grid order; null until the first read. */ rows: Row[] | null; /** The mart has more rows than are loaded. */ hasMore: boolean; /** A read is in flight, so `rows` may be out of date. */ loading?: boolean; /** The query behind the grid's rows, for Copy SQL. */ run?: GridRun;
  /** The main mart's storage, for Create Data Mart. */ storage?: { id: string; type: string; title?: string };
  /** Reading the main mart's joined sources failed. */ joinsFailed?: boolean;
  /** The joined data marts the grid selects, as the Data Marts band shows them. */ joinedMarts?: { id: string; title: string }[];
  /** The main mart's joined sources, the model's edges and the mart titles, for the SQL; `sources` is undefined until the joins are read. */ sources?: JoinedSource[]; edges?: Edge[]; titles?: Map<string, string> };
type Assistant = 'Claude' | 'ChatGPT';
/** Where each assistant lists the OWOX app (the links owox.com uses). */
const PROVIDER_LISTING: Record<Assistant, string> = {
  Claude: 'https://claude.ai/directory/owox-data-marts',
  ChatGPT: 'https://chatgpt.com/plugins/plugin_asdk_app_6a3e81be8f8481918e1e2cd1d7ea09c4?q=owox',
};
/** What one of the three copy items copied (the prompt, the rows or the SQL), whether it reached the clipboard, and how the toast and the by-hand dialog speak of it. */
type Copy = {
  text: string; ok: boolean;
  /** The toast's text. */ message: string;
  /** The toast's button that opens the dialog; null when it only shows up after a failed copy. */ show: string;
  /** Whether the toast offers that button even when the copy worked. */ showWhenOk: boolean;
  dialog: { name: string; heading?: string; note: string; areaLabel: string };
};

/** "Export" in the Data band header: a menu of Claude and ChatGPT (each copies a prompt), then the Google Sheets destinations, then "Copy to clipboard" and "Copy SQL" (the SQL the grid ran), and last "Create Data Mart", which saves the grid as a published SQL data mart. */
export function ExportMenu(p: Props) {
  const { ctx, exporter } = useServices();
  const [{ modelVersion }] = useStore();
  const [destinations, setDestinations] = useState<DestinationDto[]>([]);
  const { busy, result, setResult, dialog, setDialog, follow, generation, nextSeq } = useExportFlight(p.martId);
  // The three copy items are one thing at a time: the last copy, and whether its dialog is open.
  const [copy, setCopy] = useState<Copy | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  // A copied prompt belongs to the mart it was built from (adjust state during render).
  const [copiedFor, setCopiedFor] = useState(p.martId);
  if (copiedFor !== p.martId) { setCopiedFor(p.martId); setCopy(null); setCopyOpen(false); }
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
    if (!p.storage) return { reason: "The data mart's storage isn't available to you" };
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
  }, [p.storage, p.sources, p.joinsFailed, p.edges, p.titles, p.martId, p.martTitle, p.schema, p.visible, p.aggregation, p.filters, p.slices, p.ownSorts]);
  const [martDialog, setMartDialog] = useState<{ variants: MartVariants; grouped: boolean; having: boolean; joinedMarts: { id: string; title: string }[]; storage: { id: string; type: string; title?: string }; seq: number } | null>(null);
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
    const away = () => { if (menu.current?.open) menu.current.open = false; };
    window.addEventListener('blur', away);
    return () => window.removeEventListener('blur', away);
  }, []);
  // A press outside an open menu only closes it. The listener is always on: `open` is the native details state, not React's.
  useOutsidePress(true, (t) => !menu.current?.open || menu.current.contains(t), () => { if (menu.current) menu.current.open = false; });

  const closeMenu = () => { if (menu.current) menu.current.open = false; };
  const focusSummary = () => menu.current?.querySelector<HTMLElement>('summary')?.focus();

  function start(destination: DestinationDto, wanted: ExportSource, title: string, fromDialog = false) {
    if (exporter.inFlight(p.martId)) return;
    // A spreadsheet an earlier attempt made and left unused is reused, also after the menu was remounted.
    const left = exporter.made(p.martId, destination.id);
    const source: ExportSource = wanted.kind === 'new' && left ? { kind: 'existing', target: left } : wanted;
    const { payload, notes } = buildReportPayload(p.schema, p.visible, p.filters, p.sorts, p.aggregation, p.slices);
    setResult(null);
    setCopy(null);
    if (source.kind === 'update' && !sheetUrl(source.report)) { setResult({ kind: 'error', text: UNRECOGNISED }); return; }
    setDialog((cur) => (cur ? { ...cur, error: undefined } : cur));
    void exporter.run({ martId: p.martId, destination, title, source, payload, notes, signal: ctx.signal }).catch(() => undefined);
    follow(exporter.inFlight(p.martId)!, { fromDialog, destination, openWhenDone: true });
  }

  /** Copies `text` and shows the outcome; neither way of copying may work (the sandbox may block both), and then the text is shown to be copied by hand. */
  async function copyOut(text: string, ok: (copied: boolean) => Omit<Copy, 'text' | 'ok'>) {
    closeMenu();
    const home = generation();
    const copied = await copyText(text);
    if (generation() !== home) return;
    setResult(null);
    setCopy({ text, ok: copied, ...ok(copied) });
    setCopyOpen(!copied);
  }

  function copyPrompt(assistant: Assistant) {
    const prompt = buildAiPrompt({ projectId: ctx.projectId, martId: p.martId, martTitle: p.martTitle, schema: p.schema, visible: p.visible, aggregation: p.aggregation, filters: p.filters, slices: p.slices, sorts: p.sorts });
    return copyOut(prompt, (ok) => ({
      message: ok ? `Prompt copied. Paste it into ${assistant}` : `Could not copy. Copy the prompt, then paste it into ${assistant}`,
      show: 'Show prompt', showWhenOk: true,
      dialog: { name: 'Prompt', heading: `Prompt for ${assistant}`, note: `Paste it into ${assistant} with the OWOX Data Marts connector turned on. Copying writes nothing to OWOX.`, areaLabel: 'Prompt text' },
    }));
  }

  /** The loaded rows as tab-separated text, through the same clipboard path as the prompt. Nothing is queried and nothing is written. */
  function copyData() {
    if (!p.rows?.length || p.loading) { closeMenu(); return; }
    const fields = p.visible.flatMap((name) => p.schema.find((f) => f.name === name) ?? []);
    const tsv = buildTsv(tsvColumns(fields, p.aggregation), p.rows);
    const count = `${p.rows.length} ${p.rows.length === 1 ? 'row' : 'rows'}`;
    return copyOut(tsv, (ok) => ({
      message: !ok ? 'Could not copy. Copy the data by hand' : p.hasMore ? `Copied the first ${count}. Load more to copy more.` : `Copied ${count}`,
      show: 'Show data', showWhenOk: false,
      dialog: { name: 'Copy the data', note: 'Select the text and copy it, then paste it into a sheet. Copying writes nothing to OWOX.', areaLabel: 'Data text' },
    }));
  }

  const noRows = !p.rows?.length;
  const copyOff = noRows ? 'No rows to copy' : p.loading ? 'Rows are loading' : null;
  const label = busy ? <><Loader2 className="size-4 animate-spin" />Exporting…</> : <><ArchiveRestore className="size-4" />Export</>;

  /** Copies the SQL the grid ran. Nothing is queried and nothing is written. */
  const copySql = (sql: string) => copyOut(sql, (ok) => ({
    message: ok ? 'SQL copied. It is the query the grid ran, with its page LIMIT.' : 'Could not copy. Copy the SQL by hand',
    show: 'Show SQL', showWhenOk: false,
    dialog: { name: 'SQL', note: 'Select the SQL and copy it. Copying writes nothing to OWOX.', areaLabel: 'SQL text' },
  }));

  function openMenu(open: boolean) {
    setMenuOpen(open);
    if (!open) return;
    setOpening((n) => n + 1);
    // The live reads of this mart's reports start on its first opening and stay for the session.
    exporter.load(p.martId);
  }

  // One toast: an export outcome (it stays until dismissed), else the last copy (it hides itself).
  const note = busy ? null : result ?? copy;
  const dismissNote = () => { if (result) setResult(null); else { setCopy(null); setCopyOpen(false); } };
  const tone = !note ? undefined : result ? ({ ok: 'success', error: 'error', timeout: 'info' } as const)[result.kind] : copy!.ok ? 'success' : 'error';
  const noteBody = !note ? null : result ? <ExportResultText result={result} /> : <CopiedText copy={copy!} />;
  const noteAction = !note ? undefined : result ? <ExportResultLink result={result} /> : copy!.ok && !copy!.showWhenOk ? undefined : <button type="button" onClick={() => setCopyOpen(true)} className="shrink-0 underline">{copy!.show}</button>;

  return (
    <>
      <span role="status" className="empty:absolute text-xs text-muted-foreground">{busy}</span>
      <Toast tone={tone} onDismiss={dismissNote} returnTo={() => menu.current?.querySelector('summary')} action={noteAction} persistent={!busy && !!result} hold={copyOpen} stamp={note}>{noteBody}</Toast>
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
                    <button key={d.id} type="button" role="menuitem" data-lvl="1" data-dest={d.id} className="dm-export-item" onClick={() => { closeMenu(); setDialog({ destination: d, seq: nextSeq() }); }}>
                      <GoogleSheetsIcon size={16} />
                      <span className="dm-filter-label">{d.title}</span>
                    </button>
                  ))}
                </div>
                <div role="separator" className="dm-menu-sep" />
              </>
            )}
            <div role="group" aria-label="Copy" className="dm-export-copy">
              <ExportItem action="copy" icon={Copy} label="Copy to clipboard" off={copyOff} onClick={() => void copyData()} />
              <ExportItem action="sql" icon={Code} label="Copy SQL" off={sqlOff} tip="The SQL the grid ran, with its page LIMIT" onClick={() => void copySql(sqlReady!)} />
            </div>
            <div role="separator" className="dm-menu-sep" />
            <div role="group" aria-label="Data mart" className="dm-export-mart">
              <ExportItem
                action="create-mart" icon={Box} label="Create Data Mart" off={'reason' in martSql ? martSql.reason : null}
                onClick={() => { if (!('reason' in martSql)) { closeMenu(); setMartDialog({ variants: martSql.variants, grouped: martSql.grouped, having: p.filters.some((f) => !!f.fn), joinedMarts: p.joinedMarts ?? [], storage: p.storage!, seq: nextSeq() }); } }}
              />
            </div>
          </div>
        </details>
      {copyOpen && copy && <TextDialog {...copy.dialog} text={copy.text} onClose={() => setCopyOpen(false)} returnFocus={focusSummary} />}
      {martDialog && <CreateMartDialog key={martDialog.seq} returnFocus={focusSummary} martTitle={p.martTitle} variants={martDialog.variants} grouped={martDialog.grouped} having={martDialog.having} joinedMarts={martDialog.joinedMarts} storage={martDialog.storage} onClose={() => setMartDialog(null)} />}
      {dialog && <ExportDialog key={dialog.seq} returnFocus={focusSummary} exporter={exporter} martId={p.martId} destination={dialog.destination} initialError={dialog.error} title={exportTitle(p.martTitle)} busy={!!busy} onCancel={() => setDialog(null)} onExport={(title, source) => start(dialog.destination, source, title, true)} />}
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
      else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); focusSummary(); }
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
    const to = rovingTarget(e.key, at, items.length);
    if (to !== null) { e.preventDefault(); items[to]?.focus(); }
    else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
      focusSummary();
    }
  }
}

/** One row of the menu that does something: a button, or, with a reason in `off`, a disabled one whose tooltip says why. */
function ExportItem({ action, icon: Icon, label, off, tip, onClick }: { action: string; icon: LucideIcon; label: string; off: string | null; tip?: string; onClick: () => void }) {
  if (off) {
    return (
      <Tooltip content={off}>
        <span className="block">
          <button type="button" role="menuitem" data-lvl="1" data-action={action} data-reason={off} disabled className="dm-export-item w-full"><Icon size={16} /><span className="dm-filter-label">{label}</span></button>
        </span>
      </Tooltip>
    );
  }
  const button = (
    <button type="button" role="menuitem" data-lvl="1" data-action={action} className="dm-export-item" onClick={onClick}>
      <Icon size={16} />
      <span className="dm-filter-label">{label}</span>
    </button>
  );
  return tip ? <Tooltip content={tip}>{button}</Tooltip> : button;
}

/** The toast's text for a copy: a tick, or a warning when the clipboard was out of reach and the text is in the dialog instead. */
function CopiedText({ copy }: { copy: Copy }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {copy.ok ? <Check className="size-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="size-3.5 shrink-0" aria-hidden />}
      {copy.message}
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
