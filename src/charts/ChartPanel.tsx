import type { ReactNode } from 'react';
import { ErrorBox } from '../ui/ErrorBox';
import { Skeleton } from '../ui/Skeleton';
import { Hint } from '../ui/Tooltip';
import { ChartMenu, type MenuItem } from './ChartMenu';

/** One chart's frame: title, extra buttons, its ⋮ menu (null before the saved settings load) and the width its content needs. */
export function ChartPanel({ title, name, items, extra, width, loading, error, onRetry, empty, note, children }: {
  title: string; name: string; items: MenuItem[] | null; extra?: ReactNode; width: string;
  loading: boolean; error: unknown; onRetry: () => void; empty?: string | null; note?: string; children: ReactNode;
}) {
  return (
    <section className="dm-chart" data-chart-kind={name} style={{ width }}>
      <header className="dm-chart-head">
        <div className="dm-chart-titlegroup">
          <h3 className="dm-chart-title">{title}</h3>
          {note && <Hint text={note} label={`About ${title}`} />}
        </div>
        {items && <div className="dm-chart-actions">{extra}<ChartMenu name={name} items={items} /></div>}
      </header>
      {error ? <ErrorBox error={error} onRetry={onRetry} />
        : loading ? <Skeleton rows={4} />
        : empty ? <p className="dm-muted dm-chart-empty">{empty}</p>
        : children}
    </section>
  );
}
