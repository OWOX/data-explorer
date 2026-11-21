import type { ChartFields } from '../fields';
import type { ChartKind } from '../settings';
import { pie } from './pie';
import { line } from './line';
import { rankedBar } from './rankedBar';
import { timeSeries } from './timeSeries';
import type { ChartKindDef } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each kind resolves to its own shape; the body only passes it back to that kind's Panel
type AnyKind = ChartKindDef<any>;
/** Every chart type, in "Add chart" order. Tasks 5 to 9 add the rest. */
export const KINDS: Partial<Record<ChartKind, AnyKind>> = { timeSeries, pie, rankedBar, line };
export const eligibleKinds = (cf: ChartFields): AnyKind[] => Object.values(KINDS).filter((k): k is AnyKind => !!k && k.eligible(cf));
