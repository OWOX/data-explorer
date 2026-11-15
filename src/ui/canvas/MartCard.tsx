import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ExternalLink, Info, LoaderCircle } from 'lucide-react';
import type { Context, DqSummary, Mart } from '../../model/types';
import { compactNumber } from '../format';
import { ContextIcon, DqIcon, FreshnessIcon, MartIcon } from '../icons';
import { Tooltip } from '../Tooltip';

export const CARD_SIZE = { width: 260, height: 132 };

export type CardData = {
  mart: Mart;
  contexts: Context[];
  count: { state: 'loading' } | { state: 'ok'; value: number | null } | { state: 'error'; message: string };
  dq?: DqSummary;
  fieldHit?: string;
  selected: boolean;
  direction?: 'LR' | 'TB';
  onOpenApp: () => void;
  onRetryCount: () => void;
};

function CountBadge({ count, onRetry }: { count: CardData['count']; onRetry: () => void }) {
  const cls = 'inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground';
  if (count.state === 'loading') return <span className={cls} aria-label="Counting rows"><LoaderCircle className="size-3 animate-spin" /></span>;
  if (count.state === 'error') return <Tooltip content={`${count.message}. Click to retry.`}><button type="button" className={cls} onClick={(e) => { e.stopPropagation(); onRetry(); }}>—</button></Tooltip>;
  if (count.value === null) return null;
  return <Tooltip content={`${count.value.toLocaleString()} rows`}><span className={cls}>{compactNumber(count.value)}</span></Tooltip>;
}

export function MartCardView({ data }: { data: CardData }) {
  const { mart } = data;
  const ctx = data.contexts.filter((c) => mart.contextIds.includes(c.id));
  return (
    <div
      style={{ width: CARD_SIZE.width }}
      className={`bg-background rounded-xl border shadow-sm transition-shadow ${data.selected ? 'ring-2 ring-primary' : 'hover:shadow-md'} ${mart.accessible ? '' : 'opacity-60'}`}
    >
      <div className="flex items-start gap-2 p-3 pb-2">
        <div className="bg-muted text-foreground flex size-8 shrink-0 items-center justify-center rounded-md"><MartIcon icon={mart.icon} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={mart.title}>{mart.title}</span>
            <button type="button" aria-label="Open in OWOX" onClick={(e) => { e.stopPropagation(); data.onOpenApp(); }} className="nodrag text-muted-foreground hover:text-foreground">
              <ExternalLink className="size-3.5" />
            </button>
            {mart.description && (
              <Tooltip content={mart.description}>
                <span aria-label="Description" className="text-muted-foreground"><Info className="size-3.5" /></span>
              </Tooltip>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            {mart.accessible ? <CountBadge count={data.count} onRetry={data.onRetryCount} /> : <span className="text-[11px] text-muted-foreground">No access</span>}
            <DqIcon summary={data.dq} />
            <FreshnessIcon at={mart.dataLastUpdatedAt} />
          </div>
        </div>
      </div>
      {(ctx.length > 0 || data.fieldHit) && (
        <div className="flex flex-wrap gap-1 border-t px-3 py-2">
          {ctx.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"><ContextIcon icon={c.icon} />{c.name}</span>
          ))}
          {data.fieldHit && <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary">{data.fieldHit}</span>}
        </div>
      )}
    </div>
  );
}

export function MartCard({ data }: NodeProps) {
  const card = data as unknown as CardData;
  const tb = card.direction === 'TB';
  return (
    <>
      <Handle type="target" position={tb ? Position.Top : Position.Left} className="!bg-border" />
      <MartCardView data={card} />
      <Handle type="source" position={tb ? Position.Bottom : Position.Right} className="!bg-border" />
    </>
  );
}
