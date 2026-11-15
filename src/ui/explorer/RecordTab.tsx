import { RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { readRows } from '../../api/rows';
import type { Model, Schema } from '../../model/types';
import { clickTarget, relationshipColumns } from '../../records/relationships';
import { lookupTitles } from '../../records/titles';
import type { Row } from '../../sdk/types';
import { useServices, useStore, type Tab } from '../../state/store';
import { ErrorBox } from '../ErrorBox';
import { MartIcon } from '../icons';
import { Skeleton } from '../Skeleton';
import { CellValue } from './CellValue';

export function RecordTab({ tab, model }: { tab: Extract<Tab, { kind: 'record' }>; model: Model }) {
  const { ctx, schemas } = useServices();
  const [, dispatch] = useStore();
  const mart = model.marts.get(tab.martId)!;
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ ver: number; schema: Schema | null; row: Row | null | undefined; error: unknown }>({ ver: -1, schema: null, row: undefined, error: null });
  const [titles, setTitles] = useState(new Map<string, string>());
  const [relSchemas, setRelSchemas] = useState(new Map<string, Schema>());
  const rels = useMemo(() => relationshipColumns(tab.martId, model.edges), [tab.martId, model.edges]);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      const schema = await schemas.get(tab.martId);
      const filter = Object.entries(tab.pk).map(([column, v]) => {
        const isNum = schema.find((f) => f.name === column)?.category === 'number';
        return { column, operator: 'eq' as const, value: isNum ? Number(v) : String(v) };
      });
      const [row] = await readRows(ctx, tab.martId, { columns: '*', filter, limit: 1 }, { signal: ac.signal });
      setState({ ver: version, schema, row: row ?? null, error: null });
      for (const rel of rels.values()) {
        const rs = await schemas.get(rel.relatedMartId);
        setRelSchemas((m) => new Map(m).set(rel.relatedMartId, rs));
        if (!row) continue;
        const t = await lookupTitles(ctx, rel, [row[rel.field]], rs, ac.signal);
        const title = t.get(String(row[rel.field]));
        if (title) setTitles((m) => new Map(m).set(rel.field, title));
      }
    })().catch((error) => { if (!ac.signal.aborted) setState((s) => ({ ...s, ver: version, error })); });
    return () => ac.abort();
  }, [ctx, schemas, tab.martId, tab.pk, rels, version]);

  const header = (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <MartIcon icon={mart.icon} />
      <span className="font-semibold">{mart.title}</span>
      <span className="font-mono text-xs text-muted-foreground">{Object.values(tab.pk).map(String).join(', ')}</span>
      <div className="flex-1" />
      <button type="button" onClick={() => { setTitles(new Map()); setVersion((v) => v + 1); }} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent"><RefreshCw className="size-4" />Refresh</button>
    </div>
  );

  const loaded = state.ver === version;
  if (loaded && state.error) return <div className="flex h-full flex-col">{header}<div className="p-4"><ErrorBox error={state.error} onRetry={() => setVersion((v) => v + 1)} /></div></div>;
  if (state.row === undefined || !state.schema || (!loaded && state.row === null)) return <div className="flex h-full flex-col">{header}<Skeleton rows={8} /></div>;
  if (state.row === null) return <div className="flex h-full flex-col">{header}<p className="p-4 text-sm text-muted-foreground">Record not found</p></div>;
  const row = state.row;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <dl className="grid min-h-0 flex-1 grid-cols-[minmax(10rem,16rem)_1fr] content-start gap-x-4 gap-y-2 overflow-auto p-4 text-sm">
        {state.schema.map((f) => {
          const rel = rels.get(f.name);
          const target = rel ? clickTarget(rel, row, relSchemas.get(rel.relatedMartId) ?? []) : null;
          return (
            <div key={f.name} className="contents">
              <dt className="text-muted-foreground">{f.alias ?? f.name}{f.alias && <span className="ml-1 font-mono text-[11px]">{f.name}</span>}</dt>
              <dd className="min-w-0 break-words">
                <CellValue row={row} field={f.name} title={titles.get(f.name)}
                  onOpen={target ? () => dispatch(target.kind === 'record' ? { type: 'openRecord', martId: target.martId, pk: target.pk } : { type: 'openMart', martId: target.martId, filters: target.filters }) : undefined} />
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
