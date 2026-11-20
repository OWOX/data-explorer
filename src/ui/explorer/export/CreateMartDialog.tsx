import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { martAppUrl } from '../../../config';
import { createDataMart, deleteDraft, CreateMartError, CREATE_STAGE_LABEL, type CreateStage } from '../../../datamart/create';
import { exportTitle } from '../../../api/exports';
import { errorMessage } from '../../../model/guards';
import { useServices } from '../../../state/store';
import { Modal } from '../../Modal';

/** The link to a data mart in OWOX: it opens through the host, since the plugin runs in a frame. */
const MartLink = ({ url, children, linkRef }: { url: string; children: React.ReactNode; linkRef?: React.Ref<HTMLAnchorElement> }) => {
  const { ctx } = useServices();
  return <a ref={linkRef} href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); void ctx.ui.openExternal(url).catch(() => undefined); }} className="underline">{children}</a>;
};

/** The SQL of one grouping choice: plain, and with the grid's ORDER BY; each may be a reason instead. */
export type MartVariant = { plain: { sql: string } | { reason: string }; sorted: { sql: string } | { reason: string } };
export type MartVariants = { off: MartVariant; on: MartVariant };

/** The dialog behind Create Data Mart: names the mart, shows its SQL, runs the create steps, then links to the result. */
export function CreateMartDialog({ martTitle, variants, grouped, having, joinedMarts, storage, onClose, returnFocus }: { martTitle: string; variants: MartVariants; /** The grid groups its rows. */ grouped: boolean; /** The grid has filters on aggregates, which only a grouped data mart can keep. */ having: boolean; /** The joined data marts selected when the dialog opened. */ joinedMarts: { id: string; title: string }[]; storage: { id: string; type: string; title?: string }; onClose: () => void; returnFocus: () => void }) {
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
