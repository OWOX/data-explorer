import { memo, useContext } from 'react';
import { Info } from 'lucide-react';
import type { Format } from '../../format/formats';
import { formatBucket, AGG_LABELS, type Output } from '../../model/aggregation';
import { columnTitle, fieldLabel } from '../../model/fieldLabel';
import type { SortKey } from '../../model/sort';
import type { Schema } from '../../model/types';
import type { Row } from '../../sdk/types';
import { OverflowTip, Tooltip } from '../Tooltip';
import { CellValue } from './CellValue';
import { ColumnControls, ColumnMenuEnvContext } from './ColumnMenu';

/** How wide a column may grow before its text is clipped: free text is allowed the most room. */
export const maxWidthOf = (field: Pick<Schema[number], 'category'>) => (field.category === 'string' || field.category === 'other' ? 'max-w-[24rem]' : field.category === 'number' || field.category === 'boolean' ? 'max-w-[12rem]' : 'max-w-[16rem]');

/** The blank row-number cell of a row that is not a data row (a message, the loading skeleton). */
export const Gutter = () => <th aria-hidden data-chrome className="dm-chrome" />;

const DIRECTION_NAME = { asc: 'ascending', desc: 'descending' } as const;
/** A grouped value of a date bucket: the bucket start, shown by the bucket. */
function BucketValue({ value, unit }: { value: unknown; unit: Output['bucket'] & string }) {
  const text = formatBucket(value, unit);
  return <span className="block truncate" title={value === null || value === undefined ? undefined : String(value)}>{text ?? ''}</span>;
}

export const sortOf = (sorts: SortKey[], field: string) => { const d = sorts.find((s) => s.field === field)?.direction; return d ? DIRECTION_NAME[d] : 'none'; };

/** What a grouped output is headed: the field, then the function ("Amount · Sum"). */
export const outputLabel = (field: Schema[number], o: Output) => (o.fn ? `${columnTitle(field)} · ${AGG_LABELS[o.fn]}` : columnTitle(field));

/** The column title as a button: none, ascending, descending, none. The arrow (and its precedence number) stays on screen while a sort is applied.
 * An extra function of an aggregated column has no sort (the backend sorts an aggregated column by its first function). */
function SortTitle({ field, output }: { field: Schema[number]; output: Output }) {
  const { sorts, toggleSort, sortable } = useContext(ColumnMenuEnvContext);
  const at = sorts.findIndex((s) => s.field === field.name);
  const current = at < 0 ? null : sorts[at]!.direction;
  const label = outputLabel(field, output);
  // Inside a data mart's group the group row names the mart, so the title is the field alone.
  const shown = output.fn ? `${fieldLabel(field)} · ${AGG_LABELS[output.fn]}` : fieldLabel(field);
  if (!output.sortable || !sortable) return <OverflowTip text={label} measure={(el) => el.querySelector('.truncate')}><span className="inline-flex min-w-0 items-center font-medium"><span className="truncate">{shown}</span></span></OverflowTip>;
  const button = (
    <button type="button" onClick={() => toggleSort(field.name)} aria-label={`Sort by ${label}, currently ${current ? DIRECTION_NAME[current] : 'not sorted'}${current && sorts.length > 1 ? `, sort ${at + 1} of ${sorts.length}` : ''}`}
      className="dm-sort inline-flex min-w-0 items-center gap-1 font-medium">
      <span className="truncate">{shown}</span>
    </button>
  );
  return <OverflowTip text={label} measure={(el) => el.querySelector('.truncate')}>{button}</OverflowTip>;
}

/** One shown column as the header and the cells read it: resolved once per column, not once per cell. */
export type ColumnView = { output: Output; field: Schema[number]; /** The menu and the info belong to the column: they sit on its first output only. */ lead: boolean; type: string; format: Format; maxWidth: string; numeric: boolean };

/** A column's title, its info button, and its menu. A module-level component, so a header keeps its identity (and an open menu stays open) whatever the grid rebuilds around it. */
export const HeaderCell = memo(function HeaderCell({ field, output, lead }: { field: Schema[number]; output: Output; lead: boolean }) {
  return (
    <div className="dm-hdr">
      <SortTitle field={field} output={output} />
      {lead && field.description?.trim() && (
        <Tooltip content={field.description}>
          <button type="button" aria-label={`About ${columnTitle(field)}`} className="dm-reveal dm-col-info">
            <Info className="dm-icon" />
          </button>
        </Tooltip>
      )}
      <span aria-hidden className="dm-hdr-spacer" />
      {lead && <ColumnControls field={field} output={output} />}
    </div>
  );
});

/** What a data cell shows: a date bucket by its unit, anything else as the field's type and the column's format say. */
function BodyCell({ row, column }: { row: Row; column: ColumnView }) {
  const { output } = column;
  return output.bucket ? <BucketValue value={row[output.key]} unit={output.bucket} /> : <CellValue row={row} field={output.key} type={column.type} format={column.format} />;
}

/** What a row's selection state is, as one short string, so a row the selection does not change gets the same props and does not render. */
export type RowMarks = { /** The row number's mark. */ head?: string; /** The one selected cell's column. */ cell?: number; /** The block's columns, and whether this row is its top and bottom edge. */ block?: [number, number, boolean, boolean]; /** The block's moving end, its active cell and its fill handle: their columns. */ moving?: number; active?: number; handle?: number };

export type RowActs = {
  startDrag: (row: number, col: number, e: React.MouseEvent) => void;
  dragOver: (row: number, col: number, e: React.MouseEvent) => void;
  pickCell: (row: number, col: number, e: React.MouseEvent) => void;
  pickRow: (row: number, e: React.MouseEvent) => void;
  open: (row: Row) => void;
};

/** One data row. Memoised: a selection change re-renders only the rows whose `marks` changed. */
export const GridRow = memo(function GridRow({ row, ri, columns, marks, acts, clickable }: { row: Row; ri: number; columns: ColumnView[]; marks: string; acts: RowActs; clickable: boolean }) {
  const m: RowMarks = marks ? JSON.parse(marks) : {};
  return (
    <tr onClick={clickable ? () => acts.open(row) : undefined} className={clickable ? 'cursor-pointer' : ''}>
      <th aria-hidden data-chrome data-selected={m.head} onClick={(e) => acts.pickRow(ri, e)} className="dm-chrome">{ri + 1}</th>
      {columns.map((c, ci) => {
        const inBlock = !!m.block && ci >= m.block[0] && ci <= m.block[1];
        const edge = inBlock ? [ci === m.block![0] && 'l', ci === m.block![1] && 'r', m.block![2] && 't', m.block![3] && 'b'].filter(Boolean).join(' ') : undefined;
        return (
          <td key={c.output.key} data-selected={m.cell === ci ? '' : undefined} data-moving={m.moving === ci ? '' : undefined} data-range={inBlock ? '' : undefined} data-active={m.active === ci ? '' : undefined} data-handle={m.handle === ci ? '' : undefined} data-edge={edge}
            onMouseDown={(e) => acts.startDrag(ri, ci, e)} onMouseEnter={(e) => acts.dragOver(ri, ci, e)} onClick={(e) => acts.pickCell(ri, ci, e)}
            className={`${c.maxWidth} overflow-hidden whitespace-nowrap${c.numeric ? ' text-right' : ''}`}>
            <BodyCell row={row} column={c} />
          </td>
        );
      })}
      <td aria-hidden className="p-0" />
    </tr>
  );
});
