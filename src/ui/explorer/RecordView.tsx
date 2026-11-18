import { Box, RefreshCw } from 'lucide-react';
import { useContext, useEffect, useState } from 'react';
import { useColumnFormats } from '../../format/useColumnFormats';
import { readRows } from '../../api/rows';
import type { Model, Schema } from '../../model/types';
import { joinFilters } from '../../records/relationships';
import { useIncomingLinks } from '../../records/useIncomingLinks';
import type { Row } from '../../sdk/types';
import { useRememberLeaving } from '../../state/leaving';
import { sourceOfModel, useServices, useStore } from '../../state/store';
import { ErrorBox } from '../ErrorBox';
import { BandTools, BandToolsSlot } from '../bands/BandTools';
import { PickedIcon } from '../bands/picked';
import { Skeleton } from '../Skeleton';
import { CellValue } from './CellValue';
import { FieldLabel } from './FieldLabel';

/** One record of a mart, read by primary key. Key it by mart and key so a new record starts clean. */
export function RecordView({ martId, pk, model }: { martId: string; pk: Record<string, unknown>; model: Model }) {
  const { ctx, schemas } = useServices();
  const slot = useContext(BandToolsSlot);
  const [{ modelVersion }, dispatch] = useStore();
  const rememberLeaving = useRememberLeaving();
  const sourceOf = sourceOfModel(model);
  const [ownVersion, setVersion] = useState(0);
  // A model reload re-reads the record too: its counter joins this view's own, and each only ever goes up.
  const version = ownVersion + modelVersion;
  const [state, setState] = useState<{ ver: number; schema: Schema | null; row: Row | null | undefined; error: unknown }>({ ver: -1, schema: null, row: undefined, error: null });
  const [relSchemas, setRelSchemas] = useState(new Map<string, Schema>());
  const incoming = useIncomingLinks(martId, model.edges);
  const { formatOf } = useColumnFormats(martId, state.schema ?? undefined, model.marts.get(martId)?.title);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      const schema = await schemas.get(martId);
      const filter = Object.entries(pk).map(([column, v]) => {
        const isNum = schema.find((f) => f.name === column)?.category === 'number';
        return { column, operator: 'eq' as const, value: isNum ? Number(v) : String(v) };
      });
      const [row] = await readRows(ctx, martId, { column: schema.map((f) => f.name), filter, limit: 1 }, { signal: ac.signal });
      if (ac.signal.aborted) return;
      setState({ ver: version, schema, row: row ?? null, error: null });
      for (const link of incoming) {
        try {
          const rs = await schemas.get(link.sourceMartId);
          setRelSchemas((m) => new Map(m).set(link.sourceMartId, rs));
        } catch { /* the entry stays disabled */ }
      }
    })().catch((error) => { if (!ac.signal.aborted) setState((s) => ({ ...s, ver: version, error })); });
    return () => ac.abort();
  }, [ctx, schemas, martId, pk, incoming, version]);

  const header = (
    <BandTools slot={slot}>
      <button type="button" onClick={() => setVersion((v) => v + 1)} className="inline-flex h-8 items-center gap-1 rounded-md border bg-card px-2.5 text-sm hover:bg-accent"><RefreshCw className="size-4" />Refresh</button>
    </BandTools>
  );

  const loaded = state.ver === version;
  if (loaded && state.error) return <div className="flex flex-col">{header}<div className="p-4"><ErrorBox error={state.error} onRetry={() => setVersion((v) => v + 1)} /></div></div>;
  if (state.row === undefined || !state.schema || (!loaded && state.row === null)) return <div className="flex flex-col">{header}<Skeleton rows={8} /></div>;
  if (state.row === null) return <div className="flex flex-col">{header}<p className="p-4 text-sm text-muted-foreground">Record not found</p></div>;
  const row = state.row;
  // A join on a field hidden for reporting (on either side) cannot be followed: the backend rejects the filter.
  const links = incoming.filter((link) => link.joins.every((j) => state.schema!.some((f) => f.name === j.targetField) && (!relSchemas.get(link.sourceMartId) || relSchemas.get(link.sourceMartId)!.some((f) => f.name === j.sourceField))));

  return (
    <div className="flex max-h-[32rem] min-h-0 flex-col">
      {header}
      {!loaded && <div role="progressbar" aria-label="Loading record" className="dm-progress" />}
      <div className="min-h-0 flex-1 overflow-auto">
      <dl className="grid grid-cols-[minmax(10rem,16rem)_1fr] content-start gap-x-4 gap-y-2 p-4 text-sm">
        {state.schema.map((f) => (
          <div key={f.name} className="contents">
            <dt className="dm-reveal-host flex min-w-0 items-start text-muted-foreground"><FieldLabel field={f} wrap /></dt>
            <dd className="min-w-0 break-words"><CellValue row={row} field={f.name} type={f.type} format={formatOf(f.name, f.type)} wrap /></dd>
          </div>
        ))}
      </dl>
      {links.length > 0 && (
        <section aria-label="Referenced by" className="border-t p-4 text-sm">
          <h3 className="mb-2 text-xs font-medium uppercase text-muted-foreground">Referenced by</h3>
          <ul className="flex flex-col gap-1">
            {links.map((link) => {
              const source = model.marts.get(link.sourceMartId);
              const sourceSchema = relSchemas.get(link.sourceMartId);
              // This record's join values filter the referencing mart: sourceField = record[targetField].
              const filters = sourceSchema ? joinFilters(link.joins.map((j) => ({ sourceField: j.targetField, targetField: j.sourceField })), row, sourceSchema) : null;
              return (
                <li key={link.edgeId}>
                  <button type="button" disabled={!filters} onClick={() => { if (!filters) return; rememberLeaving(link.sourceMartId); dispatch({ type: 'follow', target: { kind: 'mart', martId: link.sourceMartId, filters }, sourceOf }); }}
                    className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent disabled:opacity-60 disabled:hover:bg-transparent">
                    <PickedIcon icon={source?.icon} fallback={Box} />
                    <span className="font-medium">{source?.title ?? link.sourceMartId}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      </div>
    </div>
  );
}
