import { expect, test } from 'vitest';
import type { Field } from '../model/types';
import { sparkLead } from './chartSets';
import type { ChartFields } from './fields';

const date = (name: string): Field => ({ name, alias: null, type: 'TIMESTAMP', category: 'date', description: null, isPrimaryKey: false });
const created = date('created_at');
const ordered = date('order_date');
// The shown columns hold order_date only; created_at is a field of the mart the grid hides.
const cf = { marts: [], dimensions: [], dates: [ordered] } as unknown as ChartFields;

test('a chart on a hidden date does not lead the sparklines: the first chart on a shown date does, with its bucket', () => {
  const hidden = { date: created, bucket: 'YEAR' };
  const shown = { date: ordered, bucket: 'DAY' };
  expect(sparkLead([hidden, shown], cf)).toBe(shown);
});

test('with no chart on a shown date there is no lead, so the sparklines fall back to the first shown date by Auto', () => {
  expect(sparkLead([{ date: created, bucket: 'YEAR' }, null, { metric: 'x' }], cf)).toBeUndefined();
});

test('a hidden chart (resolved to null) is skipped', () => {
  const shown = { date: ordered };
  expect(sparkLead([null, shown], cf)).toBe(shown);
});
