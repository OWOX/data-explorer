import type { ReactNode } from 'react';
import { ErrorBox } from '../ui/ErrorBox';
import { Skeleton } from '../ui/Skeleton';
import { Hint } from '../ui/Tooltip';

export function ChartPanel({ title, actions, loading, error, onRetry, empty, note, children }: { title: string; actions?: ReactNode; loading: boolean; error: unknown; onRetry: () => void; empty?: string | null; note?: string; children: ReactNode }) {
  return (
    <section className="dm-chart">
      <header className="dm-chart-head">
        <div className="dm-chart-titlegroup">
          <h3 className="dm-chart-title">{title}</h3>
          {note && <Hint text={note} label={`About ${title}`} />}
        </div>
        {actions && <div className="dm-chart-actions">{actions}</div>}
      </header>
      {error ? <ErrorBox error={error} onRetry={onRetry} />
        : loading ? <Skeleton rows={4} />
        : empty ? <p className="dm-muted dm-chart-empty">{empty}</p>
        : children}
    </section>
  );
}
