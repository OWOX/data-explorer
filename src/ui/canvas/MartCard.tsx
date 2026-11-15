import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ExternalLink, Info, LoaderCircle } from 'lucide-react';
import type { DqSummary, Mart } from '../../model/types';
import { compactNumber } from '../format';
import { DqIcon, dqCardTone, FreshnessIcon, MartIcon } from '../icons';
import { Tooltip } from '../Tooltip';

const MUTED_OPACITY = 0.6;

export const CARD_SIZE = { width: 260, height: 104 };

export type CardData = {
  mart: Mart;
  count: { state: 'loading' } | { state: 'ok'; value: number | null } | { state: 'error'; message: string };
  dq?: DqSummary;
  fieldHit?: string;
  selected: boolean;
  direction?: 'LR' | 'TB';
  onOpenApp: () => void;
  onRetryCount: () => void;
};

function CountBadge({ count, onRetry }: { count: CardData['count']; onRetry: () => void }) {
  const cls = 'dm-badge';
  if (count.state === 'loading') return <span className={cls} aria-label="Counting rows"><LoaderCircle className="size-3 animate-spin" /></span>;
  if (count.state === 'error') return <Tooltip content={`${count.message}. Click to retry.`}><button type="button" className={`${cls} cursor-pointer`} onClick={(e) => { e.stopPropagation(); onRetry(); }}>—</button></Tooltip>;
  if (count.value === null) return null;
  return <Tooltip content={`${count.value.toLocaleString()} rows`}><span className={cls}>{compactNumber(count.value)}</span></Tooltip>;
}

export function MartCardView({ data }: { data: CardData }) {
  const { mart } = data;
  return (
    <div
      className="dm-node"
      data-tone={dqCardTone(data.dq)}
      aria-pressed={data.selected}
      style={{
        width: CARD_SIZE.width,
        opacity: mart.accessible ? 1 : MUTED_OPACITY,
        filter: mart.accessible ? undefined : 'grayscale(0.8)',
      }}
    >
      <div className="dm-node-head">
        <span className="dm-logo" aria-hidden="true"><MartIcon icon={mart.icon} /></span>
        <span className="dm-node-title" title={mart.title}>{mart.title}</span>
        <button type="button" aria-label="Open in OWOX" onClick={(e) => { e.stopPropagation(); data.onOpenApp(); }} className="dm-link nodrag">
          <ExternalLink size={14} />
        </button>
        {mart.description && (
          <Tooltip content={mart.description}>
            <span aria-label="Description" className="dm-link"><Info size={14} /></span>
          </Tooltip>
        )}
      </div>
      <div className="dm-badges dm-badges-row">
        {mart.accessible ? <CountBadge count={data.count} onRetry={data.onRetryCount} /> : <span className="dm-badge">No access</span>}
        {data.fieldHit && <span className="dm-badge dm-badge-shrink font-mono" title={data.fieldHit}>{data.fieldHit}</span>}
      </div>
      <div className="dm-node-foot">
        <DqIcon summary={data.dq} toned />
        <FreshnessIcon at={mart.dataLastUpdatedAt} />
      </div>
    </div>
  );
}

export function MartCard({ data }: NodeProps) {
  const card = data as unknown as CardData;
  const tb = card.direction === 'TB';
  return (
    <>
      {tb ? (
        <>
          <Handle id="in" type="target" position={Position.Right} className="!bg-border" />
          <Handle id="out" type="source" position={Position.Right} className="!bg-border" />
        </>
      ) : (
        <Handle type="target" position={Position.Left} className="!bg-border" />
      )}
      <MartCardView data={card} />
      {!tb && <Handle type="source" position={Position.Right} className="!bg-border" />}
    </>
  );
}
