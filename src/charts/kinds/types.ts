import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ColumnFilter } from '../../filters/build';
import type { TraverseFilter } from '../../sdk/types';
import type { MenuItem } from '../ChartMenu';
import type { ChartFields } from '../fields';
import type { Formatter } from '../Scorecards';
import type { ChartKind, ChartSpec, Spark } from '../settings';

export type PanelProps<R> = {
  martId: string; cf: ChartFields; spec: ChartSpec; r: R; spark: Spark; filter: TraverseFilter[]; version: number; idle: boolean;
  hasFilters: boolean; formatOf: Formatter; ready: boolean;
  /** Rows every panel menu ends with (Chart type, Remove), built by ChartsBody. */
  tail: MenuItem[];
  onChange: (patch: Partial<ChartSpec>) => void; onFilter: (add: ColumnFilter[]) => void;
};

export type ChartKindDef<R> = {
  kind: ChartKind;
  /** Shown in "Add chart" and "Chart type", and as the panel menu's name ("Pie options"). */
  label: string;
  /** The type's glyph in the Charts list and the type submenus. */
  icon: LucideIcon;
  /** Whether the shown columns can draw it. */
  eligible(cf: ChartFields): boolean;
  /** A new chart's saved fields; on a type switch, `from` is the chart being switched and its usable fields are kept. */
  create(cf: ChartFields, from?: ChartSpec): Omit<ChartSpec, 'id' | 'hidden'>;
  /** Saved names to shown fields, falling back per field; null when it cannot draw with what is shown. */
  resolve(spec: ChartSpec, cf: ChartFields): R | null;
  /** The chart's name in the header list. */
  title(r: R, cf: ChartFields): string;
  Panel: (p: PanelProps<R>) => ReactNode;
};

/** The fields of `from` named in `keys` that are set: what a type switch keeps. */
export const carry = (from: ChartSpec | undefined, keys: (keyof ChartSpec)[]): Partial<ChartSpec> =>
  Object.fromEntries(keys.filter((k) => from?.[k] !== undefined).map((k) => [k, from![k]]));

/** A date chart's width: 28px per bucket plus the axis, at least 20rem, at most the band. Unknown bucket count: 20rem. */
export const seriesWidth = (buckets: number | null): string => `clamp(20rem, ${(buckets ?? 0) * 28 + 64}px, 100%)`;
export const BOX_WIDTH = 'min(100%, 26rem)';
