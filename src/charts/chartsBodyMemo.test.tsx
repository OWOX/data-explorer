import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { createMockCtx } from '../sdk/mock/ctx';
import { demoFixtures } from '../sdk/mock/fixtures';
import type { Field } from '../model/types';
import { AppServices, StoreProvider } from '../state/store';
import { ChartsBody } from './ChartsBody';
import * as fields from './fields';
import { KINDS } from './kinds';

vi.mock('./fields', async (importOriginal) => {
  const real = await importOriginal<typeof import('./fields')>();
  return { ...real, chartFields: vi.fn(real.chartFields) };
});

const f = (name: string, category: Field['category']): Field => ({ name, alias: null, type: category === 'number' ? 'FLOAT' : 'STRING', category, description: null, isPrimaryKey: false });

test('a resize (only scrollerWidth changes) rebuilds neither the chart fields nor the resolved choices', () => {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const props = {
    martId: 'orders', schema: [f('amount', 'number')], shown: ['amount'], agg: { aggregations: [], dateTrunc: [] }, filter: [], groups: [{ id: 'orders', path: '', span: 1, title: 'Orders' }],
    version: 0, paused: true, hasFilters: false, sources: [], formatOf: () => ({ kind: 'auto' }) as never, onFilter: () => {}, renderConfig: () => null,
  };
  const ui = (w: number) => <AppServices ctx={ctx}><StoreProvider><table><ChartsBody {...props} scrollerWidth={w} /></table></StoreProvider></AppServices>;
  const resolve = vi.spyOn(KINDS.timeSeries!, 'resolve');
  const { rerender } = render(ui(500));
  const spy = vi.mocked(fields.chartFields);
  const after = spy.mock.calls.length;
  expect(after).toBe(2); // the shown columns, and every column for the menus
  const resolved = resolve.mock.calls.length;
  expect(resolved).toBeGreaterThanOrEqual(1);
  rerender(ui(600));
  rerender(ui(700));
  expect(spy.mock.calls.length).toBe(after);
  expect(resolve.mock.calls.length).toBe(resolved);
});
