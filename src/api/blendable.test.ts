import { vi } from 'vitest';
import { createBlendableLoader, joinedSources, keyAliasOf, sourceOfField, type JoinedSource } from './blendable';
import { pathTitle } from '../state/join-plan';
import { stubCtx } from './test-ctx';
import type { Edge, Schema } from '../model/types';
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

test('joinedSources keeps the relationship id of a source', () => {
  const sources = joinedSources({ availableSources: [{ aliasPath: 'a', title: 'A', depth: 1, dataMartId: 'a', isIncluded: true, isAccessibleForReporting: true, relationshipId: 'r1' }], blendedFields: [{ name: 'a__x', aliasPath: 'a', sourceDataMartId: 'a', originalFieldName: 'x', type: 'STRING' }] });
  expect(sources[0]!.relationshipId).toBe('r1');
});

test('joinedSources offers included, readable sources only, with no hidden or calculated field, shallow ones first', () => {
  const sources = joinedSources(dto);
  expect(sources.map((s) => s.aliasPath)).toEqual(['customers', 'customers.countries', 'stores.countries']);
  expect(sources[0]!.fields.map((f) => f.name)).toEqual(['customers__email']);
});

test('a source is named by its display prefix, and by the titles of the marts it is reached through too when two joins reach the same mart', () => {
  const sources = joinedSources(dto);
  expect(sources.map((s) => s.label)).toEqual(['Buyers', 'Buyers > Countries', 'Stores > Countries']);
});

test('a deeper duplicate is told apart by the titles of the marts above it, never by an alias path', () => {
  const ok = { isIncluded: true, isAccessibleForReporting: true };
  const fld = (aliasPath: string) => ({ name: `${aliasPath}__n`, aliasPath, sourceDataMartId: 'c', originalFieldName: 'n', type: 'STRING' });
  const sources = joinedSources({
    availableSources: [
      { aliasPath: 'visitor_entity', title: 'Contact', depth: 1, dataMartId: 'k', ...ok },
      { aliasPath: 'visitor_entity.session_entity_new_sql', title: 'Organization', depth: 2, dataMartId: 'o', ...ok },
      { aliasPath: 'visitor_entity.session_entity_new_sql.country', title: 'Country', depth: 3, dataMartId: 'c', ...ok },
      { aliasPath: 'org', title: 'Organization', depth: 1, dataMartId: 'o', ...ok },
      { aliasPath: 'org.country', title: 'Country', depth: 2, dataMartId: 'c', ...ok },
    ],
    blendedFields: ['visitor_entity.session_entity_new_sql.country', 'org.country'].map(fld),
  });
  expect(sources.map((s) => s.label)).toEqual(['Organization > Country', 'Contact > Organization > Country']);
  expect(sources.some((s) => s.label.includes('_'))).toBe(false);
});

const twice = (...paths: string[]) => {
  const ok = { isIncluded: true, isAccessibleForReporting: true };
  return {
    availableSources: paths.map((aliasPath, i) => ({ aliasPath, title: aliasPath.includes('.') ? 'Country' : 'Organization', depth: aliasPath.split('.').length, dataMartId: aliasPath.includes('.') ? 'c' : 'o', relationshipId: `r${i}`, ...ok })),
    blendedFields: paths.map((aliasPath) => ({ name: `${aliasPath}__n`, aliasPath, sourceDataMartId: 'o', originalFieldName: 'n', type: 'STRING' })),
  };
};

test('two depth-1 joins to one mart are told apart by the alias of their key, else by an ordinal', () => {
  const dto = twice('billing_org', 'shipping_org');
  expect(joinedSources(dto, (s) => (s.aliasPath === 'billing_org' ? 'Billing org' : 'Shipping org')).map((s) => s.label)).toEqual(['Organization (by Billing org)', 'Organization (by Shipping org)']);
  expect(joinedSources(dto).map((s) => s.label)).toEqual(['Organization', 'Organization 2']);
  // One key alias is not enough to separate them.
  expect(joinedSources(dto, (s) => (s.aliasPath === 'billing_org' ? 'Billing org' : undefined)).map((s) => s.label)).toEqual(['Organization', 'Organization 2']);
});

test('a deeper collision under parents with one title is told apart the same way, and a card keeps its plain name when only one path is in use', () => {
  const dto = twice('a.x', 'b.x');
  dto.availableSources.push(
    { aliasPath: 'a', title: 'Contact', depth: 1, dataMartId: 'k', isIncluded: true, isAccessibleForReporting: true } as never,
    { aliasPath: 'b', title: 'Contact', depth: 1, dataMartId: 'k', isIncluded: true, isAccessibleForReporting: true } as never,
  );
  const sources = joinedSources(dto);
  expect(sources.map((s) => s.label)).toEqual(['Contact > Country', 'Contact > Country 2']);
  expect(joinedSources(dto, (s) => `Key of ${s.aliasPath}`).map((s) => s.label)).toEqual(['Contact > Country (by Key of a.x)', 'Contact > Country (by Key of b.x)']);
  expect(pathTitle(sources[0]!, ['a.x'], sources)).toBe('Country');
  expect(pathTitle(sources[1]!, ['a.x', 'b.x'], sources)).toBe('Contact > Country 2');
});

test('a joined field is a column: the blended name, its own type, its label, and where it came from', () => {
  const [buyers, countries] = joinedSources(dto);
  expect(buyers!.fields[0]).toEqual({ name: 'customers__email', alias: 'email', type: 'STRING', category: 'string', description: 'Where we write.', isPrimaryKey: false, joined: { martId: 'u', label: 'Buyers', aliasPath: 'customers', originalName: 'email' } });
  expect(countries!.fields[0]!.alias).toBe('Country name');
});

test('a joined field whose source type is an array only offers the blank filters', () => {
  const [s] = joinedSources({
    availableSources: [{ aliasPath: 'a', title: 'A', depth: 1, dataMartId: 'a', isIncluded: true, isAccessibleForReporting: true }],
    blendedFields: [
      { name: 'a__tags', aliasPath: 'a', sourceDataMartId: 'a', originalFieldName: 'tags', type: 'STRING', sourceFieldType: 'ARRAY<STRING>' },
      { name: 'a__n', aliasPath: 'a', sourceDataMartId: 'a', originalFieldName: 'n', type: 'STRING', sourceFieldType: 'STRING' },
    ],
  });
  expect(s!.fields.map((f) => f.category)).toEqual(['other', 'string']);
});

test('a joined field keeps its raw source type next to its effective type', () => {
  const [s] = joinedSources({
    availableSources: [{ aliasPath: 'a', title: 'A', depth: 1, dataMartId: 'a', isIncluded: true, isAccessibleForReporting: true }],
    blendedFields: [{ name: 'a__n', aliasPath: 'a', sourceDataMartId: 'a', originalFieldName: 'n', type: 'INTEGER', sourceFieldType: 'STRING' }],
  });
  expect(s!.fields[0]!.joined).toMatchObject({ sourceType: 'STRING' });
  expect(s!.fields[0]!.type).toBe('INTEGER');
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

test('a joined field carries the join\'s post-join aggregations ([] means none), else its own allowed ones', () => {
  const sources = joinedSources({
    availableSources: [{ aliasPath: 'c', title: 'C', depth: 1, dataMartId: 'u', isIncluded: true, isAccessibleForReporting: true }],
    blendedFields: [
      { name: 'c__a', aliasPath: 'c', sourceDataMartId: 'u', originalFieldName: 'a', type: 'NUMERIC', postJoinAggregations: ['MAX', 'NOPE'] },
      { name: 'c__b', aliasPath: 'c', sourceDataMartId: 'u', originalFieldName: 'b', type: 'NUMERIC', postJoinAggregations: [] },
      { name: 'c__d', aliasPath: 'c', sourceDataMartId: 'u', originalFieldName: 'd', type: 'NUMERIC', allowedAggregations: ['SUM'] },
      { name: 'c__e', aliasPath: 'c', sourceDataMartId: 'u', originalFieldName: 'e', type: 'NUMERIC' },
    ],
  });
  const [a, b, d, e] = sources[0]!.fields;
  expect(a!.postJoinAggregations).toEqual(['MAX']);
  expect(b!.postJoinAggregations).toEqual([]);
  // The backend's blended field has no own list: one that arrives anyway is not read.
  expect('allowedAggregations' in d!).toBe(false);
  expect('postJoinAggregations' in e! || 'allowedAggregations' in e!).toBe(false);
});

test('a null post-join list is read as no list, not a crash', () => {
  const sources = joinedSources({
    availableSources: [{ aliasPath: 'c', title: 'C', depth: 1, dataMartId: 'u', isIncluded: true, isAccessibleForReporting: true }],
    blendedFields: [{ name: 'c__a', aliasPath: 'c', sourceDataMartId: 'u', originalFieldName: 'a', type: 'NUMERIC', postJoinAggregations: null as unknown as string[] }],
  });
  expect(sources).toHaveLength(1);
  expect('postJoinAggregations' in sources[0]!.fields[0]!).toBe(false);
});

const oneSource = { availableSources: [{ aliasPath: 'c', title: 'C', depth: 1, dataMartId: 'u', isIncluded: true, isAccessibleForReporting: true }], blendedFields: [{ name: 'c__a', aliasPath: 'c', sourceDataMartId: 'u', originalFieldName: 'a', type: 'STRING' }] };

test('invalidate forgets a mart, so the next get reads again, and tells subscribers', async () => {
  const getJson = vi.fn(async () => oneSource);
  const loader = createBlendableLoader(stubCtx({ getJson }));
  const told = vi.fn();
  loader.subscribe(told);
  await loader.get('m');
  await loader.get('m');
  expect(getJson).toHaveBeenCalledTimes(1);
  loader.invalidate('m');
  expect(loader.peek('m')).toBeUndefined();
  expect(told).toHaveBeenCalledTimes(1);
  await loader.get('m');
  expect(getJson).toHaveBeenCalledTimes(2);
});

test('a read that was in flight when the mart was invalidated is not remembered', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const getJson = vi.fn(async () => { if (getJson.mock.calls.length === 1) await gate; return oneSource; });
  const loader = createBlendableLoader(stubCtx({ getJson }));
  const stale = loader.get('m');
  loader.invalidate('m');
  release();
  await stale;
  expect(loader.peek('m')).toBeUndefined();
  await loader.get('m');
  expect(getJson).toHaveBeenCalledTimes(2);
});

test('a joined field keeps the join-level aggregateFunction, and has none when the backend sends none', () => {
  const [s] = joinedSources({
    availableSources: [{ aliasPath: 'a', title: 'A', depth: 1, dataMartId: 'a', isIncluded: true, isAccessibleForReporting: true }],
    blendedFields: [
      { name: 'a__n', aliasPath: 'a', sourceDataMartId: 'a', originalFieldName: 'n', type: 'INTEGER', aggregateFunction: 'SUM' },
      { name: 'a__m', aliasPath: 'a', sourceDataMartId: 'a', originalFieldName: 'm', type: 'INTEGER', aggregateFunction: '' },
      { name: 'a__k', aliasPath: 'a', sourceDataMartId: 'a', originalFieldName: 'k', type: 'INTEGER' },
    ],
  });
  expect(s!.fields.map((x) => x.joined!.aggregateFunction)).toEqual(['SUM', undefined, undefined]);
  expect('aggregateFunction' in s!.fields[2]!.joined!).toBe(false);
});

test('a read in flight before clear() is not served after it', async () => {
  const resolvers: Array<(v: unknown) => void> = [];
  const getJson = vi.fn(() => new Promise((res) => { resolvers.push(res); }));
  const loader = createBlendableLoader(stubCtx({ getJson }));
  const before = loader.get('m');
  loader.clear();
  const after = loader.get('m');
  expect(getJson).toHaveBeenCalledTimes(2);
  resolvers[0]!(dto);
  await before;
  expect(loader.peek('m')).toBeUndefined();
  resolvers[1]!({ availableSources: [], blendedFields: [] });
  expect(await after).toEqual([]);
  expect(loader.peek('m')).toEqual([]);
});

test('sourceOfField maps each field name to its first source and builds the map once per sources array', () => {
  const field = (name: string) => ({ name, alias: null, type: 'STRING', category: 'string' as const, description: null, isPrimaryKey: false });
  const a: JoinedSource = { aliasPath: 'a', martId: 'ma', label: 'A', depth: 1, fields: [field('x'), field('y')], uniqueCount: false, mainGrainCollapse: 'collapses', mainGrainMultiplication: 'unknown' };
  const b: JoinedSource = { aliasPath: 'b', martId: 'mb', label: 'B', depth: 1, fields: [field('x'), field('z')], uniqueCount: false, mainGrainCollapse: 'collapses', mainGrainMultiplication: 'unknown' };
  const sources = [a, b];
  const map = sourceOfField(sources);
  expect(map.get('x')).toBe(a);
  expect(map.get('z')).toBe(b);
  expect(map.get('nope')).toBeUndefined();
  expect(sourceOfField(sources)).toBe(map);
  expect(sourceOfField([a, b])).not.toBe(map);
});

describe('the key alias of a join', () => {
  const fld = (name: string, alias: string | null) => ({ name, alias, type: 'STRING', category: 'string' as const, description: null, isPrimaryKey: false });
  const edge = (id: string, sourceField: string): Edge => ({ id, source: 'm', target: 'o', joins: [{ sourceField, targetField: 'id' }] });
  const two = twice('billing_org', 'shipping_org');
  const main: Schema = [fld('billing_id', 'Billing org'), fld('shipping_id', 'shipping_id')];
  const edges = [edge('r0', 'billing_id'), edge('r1', 'shipping_id')];
  const labels = (dtoIn: BlendableSchemaDto, ctx: Parameters<typeof keyAliasOf>[2]) => joinedSources(dtoIn, keyAliasOf('m', dtoIn, ctx)).map((x) => x.label);

  test('relationship -> first join condition -> the parent field alias, for a mart the main one joins', () => {
    const alt: Schema = [fld('billing_id', 'Billing org'), fld('shipping_id', 'Shipping org')];
    expect(labels(two, { edges, schemaOf: () => alt })).toEqual(['Organization (by Billing org)', 'Organization (by Shipping org)']);
  });

  test('a missing alias (unset, or the raw name), a missing edge or a missing schema falls back to ordinals', () => {
    expect(labels(two, { edges, schemaOf: () => main })).toEqual(['Organization', 'Organization 2']);
    expect(labels(two, { edges: [], schemaOf: () => [fld('billing_id', 'Billing org'), fld('shipping_id', 'Shipping org')] })).toEqual(['Organization', 'Organization 2']);
    expect(labels(two, { edges, schemaOf: () => undefined })).toEqual(['Organization', 'Organization 2']);
  });

  test('a deeper path reads the alias of the key from its parent path\'s own blended fields', () => {
    const deep = twice('a.x', 'b.x') as { availableSources: unknown[]; blendedFields: unknown[] } & BlendableSchemaDto;
    deep.availableSources.push({ aliasPath: 'a', title: 'Contact', depth: 1, dataMartId: 'k', isIncluded: true, isAccessibleForReporting: true } as never, { aliasPath: 'b', title: 'Contact', depth: 1, dataMartId: 'k', isIncluded: true, isAccessibleForReporting: true } as never);
    deep.blendedFields.push(
      { name: 'a__org', aliasPath: 'a', sourceDataMartId: 'k', originalFieldName: 'org_id', type: 'STRING', alias: 'Home org' },
      { name: 'b__org', aliasPath: 'b', sourceDataMartId: 'k', originalFieldName: 'org_id', type: 'STRING', alias: 'Work org' },
    );
    const got = joinedSources(deep, keyAliasOf('m', deep, { edges: [edge('r0', 'org_id'), edge('r1', 'org_id')], schemaOf: () => undefined }));
    expect(got.filter((x) => x.depth === 2).map((x) => x.label)).toEqual(['Contact > Country (by Home org)', 'Contact > Country (by Work org)']);
  });

  test('relabelling by key never reorders the sources: they are ordered by the mart\'s own title', () => {
    const three = twice('billing_org', 'shipping_org') as { availableSources: unknown[]; blendedFields: unknown[] } & BlendableSchemaDto;
    three.availableSources.push({ aliasPath: 'other', title: 'Organization 1', depth: 1, dataMartId: 'p', isIncluded: true, isAccessibleForReporting: true } as never);
    three.blendedFields.push({ name: 'other__n', aliasPath: 'other', sourceDataMartId: 'p', originalFieldName: 'n', type: 'STRING' });
    const alt: Schema = [fld('billing_id', 'Billing org'), fld('shipping_id', 'Shipping org')];
    const paths = (alias?: Parameters<typeof joinedSources>[1]) => joinedSources(three, alias).map((x) => x.aliasPath);
    expect(paths(keyAliasOf('m', three, { edges, schemaOf: () => alt }))).toEqual(paths());
    expect(paths()).toEqual(['billing_org', 'shipping_org', 'other']);
  });

  test('the loader labels by ordinal first, then again once it is given the edges and schemas, and tells subscribers', async () => {
    const loader = createBlendableLoader(stubCtx({ getJson: vi.fn(async () => two) }));
    const told = vi.fn();
    loader.subscribe(told);
    expect((await loader.get('m')).map((x) => x.label)).toEqual(['Organization', 'Organization 2']);
    loader.useKeys({ edges, schemaOf: () => [fld('billing_id', 'Billing org'), fld('shipping_id', 'Shipping org')] });
    expect(loader.peek('m')!.map((x) => x.label)).toEqual(['Organization (by Billing org)', 'Organization (by Shipping org)']);
    expect(told).toHaveBeenCalledTimes(1);
  });
});
