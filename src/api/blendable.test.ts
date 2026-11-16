import { vi } from 'vitest';
import { createBlendableLoader, joinedSources } from './blendable';
import { stubCtx } from './test-ctx';
import type { BlendableSchemaDto } from '../sdk/types';

const dto: BlendableSchemaDto = {
  availableSources: [
    { aliasPath: 'customers.countries', title: 'Countries', depth: 2, dataMartId: 'c', isIncluded: true, isAccessibleForReporting: true },
    { aliasPath: 'customers', title: 'Customers', defaultAlias: 'Buyers', depth: 1, dataMartId: 'u', isIncluded: true, isAccessibleForReporting: true },
    { aliasPath: 'stores', title: 'Stores', depth: 1, dataMartId: 's', isIncluded: false, isAccessibleForReporting: true },
    { aliasPath: 'secret', title: 'Secret', depth: 1, dataMartId: 'x', isIncluded: true, isAccessibleForReporting: false },
    { aliasPath: 'stores.countries', title: 'Countries', depth: 2, dataMartId: 'c', isIncluded: true, isAccessibleForReporting: true },
  ],
  blendedFields: [
    { name: 'customers__email', aliasPath: 'customers', sourceDataMartId: 'u', originalFieldName: 'email', type: 'STRING', alias: '', description: 'Where we write.' },
    { name: 'customers__flag', aliasPath: 'customers', sourceDataMartId: 'u', originalFieldName: 'flag', type: 'STRING', isHidden: true },
    { name: 'customers__margin', aliasPath: 'customers', sourceDataMartId: 'u', originalFieldName: 'margin', type: 'NUMERIC', isCalculated: true },
    { name: 'customers__countries__name', aliasPath: 'customers.countries', sourceDataMartId: 'c', originalFieldName: 'name', type: 'STRING', alias: 'Country name' },
    { name: 'stores__name', aliasPath: 'stores', sourceDataMartId: 's', originalFieldName: 'name', type: 'STRING' },
    { name: 'secret__x', aliasPath: 'secret', sourceDataMartId: 'x', originalFieldName: 'x', type: 'STRING' },
    { name: 'stores__countries__name', aliasPath: 'stores.countries', sourceDataMartId: 'c', originalFieldName: 'name', type: 'STRING' },
  ],
};

test('joinedSources offers included, readable sources only, with no hidden or calculated field, shallow ones first', () => {
  const sources = joinedSources(dto);
  expect(sources.map((s) => s.aliasPath)).toEqual(['customers', 'customers.countries', 'stores.countries']);
  expect(sources[0]!.fields.map((f) => f.name)).toEqual(['customers__email']);
});

test('a source is named by its display prefix, and by its alias path too when two joins reach the same mart', () => {
  const sources = joinedSources(dto);
  expect(sources.map((s) => s.label)).toEqual(['Buyers', 'Countries (customers.countries)', 'Countries (stores.countries)']);
});

test('a joined field is a column: the blended name, its own type, its label, and where it came from', () => {
  const [buyers, countries] = joinedSources(dto);
  expect(buyers!.fields[0]).toEqual({ name: 'customers__email', alias: 'email', type: 'STRING', category: 'string', description: 'Where we write.', isPrimaryKey: false, joined: { martId: 'u', label: 'Buyers', aliasPath: 'customers' } });
  expect(countries!.fields[0]!.alias).toBe('Country name');
});

test('a source with no field left to offer is left out', () => {
  expect(joinedSources({ availableSources: dto.availableSources!.slice(1, 2), blendedFields: [dto.blendedFields![1]!] })).toEqual([]);
});

test('the loader reads once per mart, shares a read in flight, and does not remember a failure', async () => {
  const getJson = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(dto);
  const loader = createBlendableLoader(stubCtx({ getJson }));
  await expect(loader.get('orders')).rejects.toThrow('boom');
  expect(loader.peek('orders')).toBeUndefined();
  const [a, b] = await Promise.all([loader.get('orders'), loader.get('orders')]);
  expect(a).toBe(b);
  await loader.get('orders');
  expect(getJson).toHaveBeenCalledTimes(2);
  expect(getJson).toHaveBeenLastCalledWith('/api/data-marts/orders/blendable-schema');
  loader.clear();
  expect(loader.peek('orders')).toBeUndefined();
});
