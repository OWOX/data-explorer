import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  isPublishedSheetUrl, parseSheetUrl, sheetUrl,
  type Exporter, type ExportSource, type ReportEntry, type StoredReport,
} from '../../../api/exports';
import type { DestinationDto } from '../../../sdk/types';
import { Modal } from '../../Modal';

/** A report used within this long counts as recently used. */
const RECENT_MS = 60 * 24 * 60 * 60 * 1000;
const isRecent = (usedAt: string | undefined, now = Date.now()) => { const t = usedAt ? Date.parse(usedAt) : NaN; return Number.isFinite(t) && t <= now && now - t <= RECENT_MS; };

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

export function ExportDialog({ exporter, martId, destination, title, initialError, busy, onCancel, onExport, returnFocus }: {
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
