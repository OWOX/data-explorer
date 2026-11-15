import { AlertTriangle, Check, ChevronDown, ChevronRight, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  buildReportPayload, exportTitle, ExportError, isPublishedSheetUrl, parseSheetUrl, reportMayExist, sheetUrl,
  type ExportedReport, type ExportSource, type Flight, type Stage,
} from '../../api/exports';
import type { ColumnFilter } from '../../filters/build';
import type { SortKey } from '../../model/sort';
import type { Schema } from '../../model/types';
import type { DestinationDto } from '../../sdk/types';
import { useServices, useStore } from '../../state/store';
import { GoogleSheetsIcon } from '../google-sheets-icon';
import { Tooltip } from '../Tooltip';

type Props = { martId: string; martTitle: string; schema: Schema; visible: string[]; filters: ColumnFilter[]; sorts: SortKey[] };
type Result = { kind: 'ok' | 'timeout' | 'error'; text: string; url?: string };

const STAGE_LABEL: Record<Stage, string> = { sheet: 'Creating the spreadsheet…', report: 'Saving the report…', run: 'Running the report…' };
const MAYBE_CREATED = 'The report may have been created; check OWOX before trying again.';
const UNRECOGNISED = 'This report targets an unrecognised spreadsheet.';
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "Export" in the Data band header: a button when one click is enough, else a menu. Hidden without a Google Sheets destination. */
export function ExportMenu(p: Props) {
  const { ctx, exporter } = useServices();
  const [{ modelVersion }] = useStore();
  const [destinations, setDestinations] = useState<DestinationDto[]>([]);
  const [loaded, setReports] = useState<{ martId: string; list: ExportedReport[] } | null>(null);
  const reports = loaded?.martId === p.martId ? loaded.list : null;
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [dialog, setDialog] = useState<{ destination: DestinationDto; error?: string; seq: number } | null>(null);
  const seq = useRef(0);
  // Bumped when the mart changes or the menu goes away: an export finishing later is no longer in front of the member.
  const gen = useRef(0);
  useEffect(() => { gen.current += 1; return () => { gen.current += 1; }; }, [p.martId]);
  const [openDest, setOpenDest] = useState<string | null>(null);
  // Which way the open flyout goes, and whether the keyboard (not the pointer) opened it, so its first row takes focus.
  const [flyout, setFlyout] = useState<{ side: 'right' | 'left'; focus: boolean }>({ side: 'right', focus: false });
  const [menuOpen, setMenuOpen] = useState(false);
  // False until the live check of the remembered reports has ended since the menu opened: until then their titles and targets may be stale.
  const [verified, setVerified] = useState(false);
  const checks = useRef(0);
  const menu = useRef<HTMLDetailsElement>(null);

  // Listed once per session; the header's Refresh lists them again.
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
  }, [openDest]);

  if (destinations.length === 0) return null;

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
    const { payload, notes } = buildReportPayload(p.schema, p.visible, p.filters, p.sorts);
    setResult(null);
    if (source.kind === 'update' && !sheetUrl(source.report)) { setResult({ kind: 'error', text: UNRECOGNISED }); return; }
    setDialog((cur) => (cur ? { ...cur, error: undefined } : cur));
    void exporter.run({ martId: p.martId, destination, title, source, payload, notes, signal: ctx.signal }).catch(() => undefined);
    follow(exporter.inFlight(p.martId)!, { fromDialog, destination, openWhenDone: true });
  }

  // An open menu stays a menu when the check drops its last report, so it does not vanish under the pointer.
  const single = destinations.length === 1 && reports !== null && forDestination(destinations[0]!).length === 0 && !menuOpen;
  const button = 'inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent disabled:opacity-50';
  const label = busy ? <><Loader2 className="size-4 animate-spin" />Exporting…</> : <><GoogleSheetsIcon size={16} />Export</>;

  async function openMenu(open: boolean) {
    setMenuOpen(open);
    if (!open) { checks.current += 1; setVerified(false); return; }
    setOpenDest(null);
    // Reports OWOX no longer has are dropped before they are offered.
    const check = ++checks.current;
    try { setReports({ martId: p.martId, list: await exporter.reports(p.martId, true) }); } catch { /* the remembered list stays */ }
    finally { if (check === checks.current) setVerified(true); }
  }

  return (
    <>
      {busy && <span role="status" className="text-xs text-muted-foreground">{busy}</span>}
      {!busy && result && <ExportResult result={result} onDismiss={() => setResult(null)} />}
      {single ? (
        <button type="button" disabled={!!busy} aria-label="Export to Google Sheets" onClick={() => start(destinations[0]!, { kind: 'new' }, exportTitle(p.martTitle))} className={button}>{label}</button>
      ) : (
        <details ref={menu} className="dm-filter dm-export" name="dm-filter" onToggle={(e) => openMenu(e.currentTarget.open)} {...(busy ? { 'aria-disabled': true } : {})}>
          <summary aria-label="Export to Google Sheets" onClick={(e) => { if (busy) e.preventDefault(); }}>{label}<ChevronDown size={14} /></summary>
          <div className="dm-filter-menu dm-cascade" role="menu" data-level="1" onKeyDown={onMenuKey}>
            {destinations.map((d) => (
              <div key={d.id} className="dm-cascade-row" onMouseEnter={() => openFlyout(d.id, false)}>
                <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={openDest === d.id} data-lvl="1" className="dm-export-item"
                  onClick={() => openFlyout(d.id, false)}>
                  <GoogleSheetsIcon size={16} />
                  <span className="dm-filter-label">{d.title}</span>
                  <ChevronRight size={14} />
                </button>
                {openDest === d.id && flyoutOf(d, forDestination(d))}
              </div>
            ))}
          </div>
        </details>
      )}
      {dialog && <NewReportDialog key={dialog.seq} destination={dialog.destination} initialError={dialog.error} title={exportTitle(p.martTitle)} busy={!!busy} onCancel={() => setDialog(null)} onExport={(title, source) => start(dialog.destination, source, title, true)} />}
    </>
  );

  function openFlyout(id: string, focus: boolean) {
    setFlyout((f) => ({ ...f, focus }));
    setOpenDest(id);
  }

  /** Arrow keys walk a level; Right or Enter opens a destination's flyout, Left or Escape closes it, Escape again closes the menu. */
  function onMenuKey(e: ReactKeyboardEvent<HTMLElement>) {
    const target = e.target as HTMLElement;
    const lvl = target.dataset.lvl;
    if (!lvl) return;
    const items = [...(target.closest(lvl === '1' ? '[data-level="1"]' : '[data-level="2"]')!.querySelectorAll<HTMLElement>(`[role="menuitem"][data-lvl="${lvl}"]:not([disabled])`))];
    const at = items.indexOf(target);
    const move = (to: number) => { e.preventDefault(); items[(to + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(items.length - 1);
    else if (lvl === '1' && (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      const row = target.closest('.dm-cascade-row')!;
      const id = destinations[[...row.parentElement!.children].indexOf(row)]?.id;
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

function ExportResult({ result, onDismiss }: { result: Result; onDismiss: () => void }) {
  const Icon = result.kind === 'ok' ? Check : AlertTriangle;
  return (
    <span role="status" className={`inline-flex max-w-96 items-center gap-1 text-xs ${result.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
      <Icon className="size-3.5 shrink-0" /><Tooltip content={result.text}><span className="truncate">{result.text}</span></Tooltip>
      {result.url && <a href={result.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-0.5 underline">{result.kind === 'timeout' ? 'Still running — open the sheet' : 'Open the sheet'}<ExternalLink className="size-3" /></a>}
      <button type="button" aria-label="Dismiss" onClick={onDismiss} className="shrink-0 px-1">×</button>
    </span>
  );
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

  function submit(e: React.FormEvent) {
    e.preventDefault();
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
      <form role="dialog" aria-modal="true" aria-label="New report" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="flex w-[28rem] max-w-[92vw] flex-col gap-3 rounded-lg border bg-background p-4 text-sm shadow-lg">
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
          <button type="submit" disabled={busy} className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-primary-foreground disabled:opacity-50">{busy && <Loader2 className="size-4 animate-spin" />}Export</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
