import type { ChartFields } from '../fields';
import type { ChartKind } from '../settings';
import { pie } from './pie';
import { heatmap } from './heatmap';
import { line } from './line';
import { rankedBar } from './rankedBar';
import { scatter } from './scatter';
import { spread } from './spread';
import { timeSeries } from './timeSeries';
import type { ChartKindDef } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each kind resolves to its own shape; the body only passes it back to that kind's Panel
type AnyKind = ChartKindDef<any>;
/** Every chart type, in "Add chart" order. */
export const KINDS: Record<ChartKind, AnyKind> = { timeSeries, pie, rankedBar, line, heatmap, scatter, spread };
export const eligibleKinds = (cf: ChartFields): AnyKind[] => Object.values(KINDS).filter((k) => k.eligible(cf));
