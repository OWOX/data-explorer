import { renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import type { Field } from '../model/types';
import type { Row, TraverseOptions } from '../sdk/types';
import { TOP_N } from './queries';
import { useTopValues } from './useTopValues';

const reads = vi.hoisted(() => ({ blank: null as Row[] | null }));
vi.mock('./useChartQuery', () => ({
  // The top read answers at once (a full list of real values); the blank read answers as the test says; the Other read is never answered here.
  useChartQuery: (_m: string, o: TraverseOptions | null) => {
    if (!o) return { rows: null, error: null, loading: false, retry: () => {} };
    if (o.sort && o.limit === TOP_N) return { rows: Array.from({ length: TOP_N }, (_, i) => ({ city: `c${i}`, 'Unique Count': i })), error: null, loading: false, retry: () => {} };
    return { rows: o.filter?.some((f) => f.operator === 'is_blank') ? reads.blank : null, error: null, loading: false, retry: () => {} };
  },
}));

const dim = { name: 'city', category: 'string' } as Field;
const run = (withOther: boolean) => renderHook(() => useTopValues({ martId: 'm', cf: { counter: 'Count' } as never, dim, measure: { kind: 'records', aliasPath: '', recordsId: 'm' }, filter: [], version: 0, idle: false, withOther })).result.current;

test('without Other, a full top list still waits for the blank read', () => {
  reads.blank = null;
  expect(run(false).loading).toBe(true);
  reads.blank = [{ 'Unique Count': 3 }];
  expect(run(false).loading).toBe(false);
});
