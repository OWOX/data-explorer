import { customLogo, groupSources, serviceKey, sourceKeyFor } from './sources';
import type { ConnectorSummaryDto } from '../sdk/types';
import type { Mart } from './types';

const mart = (id: string, sourceKey: string | null, extra: Partial<Mart> = {}): Mart => ({
  id, title: id, description: null, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey, ...extra,
});

test('groups accessible marts by connector key', () => {
  const sources = groupSources([mart('a', 'Shopify'), mart('b', 'Shopify'), mart('c', 'GA4')], []);
  expect(sources.map((s) => [s.key, s.martIds])).toEqual([['Shopify', ['a', 'b']], ['GA4', ['c']]]);
});

test('skips marts without a source and inaccessible marts', () => {
  const sources = groupSources([mart('a', null), mart('b', 'X', { accessible: false }), mart('c', 'Y')], []);
  expect(sources.map((s) => s.key)).toEqual(['Y']);
});

test('uses the connector title and string logo, falling back to the key and null', () => {
  const sources = groupSources(
    [mart('a', 'A'), mart('b', 'B'), mart('c', 'C')],
    [{ name: 'A', title: 'Alpha', logo: 'data:image/png;base64,xx' }, { name: 'B', title: null, logo: { svg: 1 } }],
  );
  const by = Object.fromEntries(sources.map((s) => [s.key, s]));
  expect(by.A).toMatchObject({ name: 'Alpha', logo: 'data:image/png;base64,xx' });
  expect(by.B).toMatchObject({ name: 'B', logo: null });
  expect(by.C).toMatchObject({ name: 'C', logo: null });
});

test('drops a remote logo URL and keeps a base64 data image', () => {
  const sources = groupSources(
    [mart('a', 'A'), mart('b', 'B')],
    [{ name: 'A', logo: 'https://evil.example/x.png' }, { name: 'B', logo: 'data:image/svg+xml;base64,PHN2Zz4=' }],
  );
  const by = Object.fromEntries(sources.map((s) => [s.key, s]));
  expect(by.A!.logo).toBeNull();
  expect(by.B!.logo).toBe('data:image/svg+xml;base64,PHN2Zz4=');
});

test('orders by mart count descending, then name', () => {
  const sources = groupSources(
    [mart('1', 'Zed'), mart('2', 'Beta'), mart('3', 'Alpha'), mart('4', 'Big'), mart('5', 'Big')],
    [],
  );
  expect(sources.map((s) => s.key)).toEqual(['Big', 'Alpha', 'Beta', 'Zed']);
});

const summary = (id: string, name: string, hosts: string[], extra: Partial<ConnectorSummaryDto> = {}): ConnectorSummaryDto => ({ id, name, title: name, logo: null, hosts, ...extra });
const custom = (id: string, key: string, name: string, extra: Partial<Mart> = {}) => mart(id, key, { connectorName: name, ...extra });

test('serviceKey: registered domain, auth hosts dropped, most frequent wins', () => {
  expect(serviceKey(['owox.fibery.io'], 'x')).toBe('service:fibery.io');
  expect(serviceKey(['oauth.fibery.io'], 'x')).toBe('x');
  expect(serviceKey(['oauth.other.com', 'api.fibery.io', 'owox.fibery.io', 'x.other.com'], 'x')).toBe('service:fibery.io');
  expect(serviceKey(['https://API.Shop.co.uk:8443/v1/'], 'x')).toBe('service:shop.co.uk');
  expect(serviceKey(['a.execute-api.amazonaws.com'], 'x')).toBe('service:a.execute-api.amazonaws.com');
  expect(serviceKey(['10.0.0.1:80', '[::1]:80'], 'x')).toBe('service:10.0.0.1');
  expect(serviceKey(['fibery.io.'], 'x')).toBe('service:fibery.io');
  expect(serviceKey([], 'Fallback')).toBe('Fallback');
});

test('customLogo keeps only inline images', () => {
  expect(customLogo('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
  expect(customLogo('https://x.test/a.png')).toBeNull();
  expect(customLogo(undefined)).toBeNull();
});

test('three custom connectors of one service fold into one source with all their marts', () => {
  const list = [summary('1', 'FiberyTasks', ['owox.fibery.io'], { title: 'Fibery Tasks' }), summary('2', 'FiberyPeople', ['owox.fibery.io'], { title: 'Fibery People', logo: 'data:image/png;base64,QQ' }), summary('3', 'FiberyDocs', ['owox.fibery.io'], { title: 'Fibery Docs' })];
  const key = sourceKeyFor('FiberyTasks', [], list);
  expect(key).toBe('service:fibery.io');
  const sources = groupSources([custom('a', key, 'FiberyTasks'), custom('b', key, 'FiberyPeople'), custom('c', key, 'FiberyDocs'), custom('d', key, 'FiberyTasks')], [], list);
  expect(sources).toEqual([{ key, name: 'Fibery', logo: 'data:image/png;base64,QQ', martIds: ['a', 'b', 'c', 'd'] }]);
});

test('a lone custom connector keeps its own title; no common words falls back to the domain label', () => {
  const list = [summary('1', 'A', ['api.brex.com'], { title: 'Brex Expenses' }), summary('2', 'B', ['x.fibery.io'], { title: 'Tasks' }), summary('3', 'C', ['x.fibery.io'], { title: 'People' })];
  const sources = groupSources([custom('a', 'service:brex.com', 'A'), custom('b', 'service:fibery.io', 'B'), custom('c', 'service:fibery.io', 'C')], [], list);
  expect(sources.map((s) => s.name).sort()).toEqual(['Brex Expenses', 'Fibery']);
});

test('a bundled name of the same case wins over a custom connector; a custom name matches case-insensitively', () => {
  const bundled = [{ name: 'Shopify', title: 'Shopify' }];
  const list = [summary('1', 'Shopify', ['x.fibery.io']), summary('2', 'MyConn', ['x.fibery.io'], { title: 'Mine' })];
  expect(sourceKeyFor('Shopify', bundled, list)).toBe('Shopify');
  expect(sourceKeyFor('myconn', bundled, list)).toBe('service:fibery.io');
  expect(sourceKeyFor('shopify', bundled, list)).toBe('service:fibery.io');
});

test('two spellings of one custom connector are one member and take its title', () => {
  const list = [summary('1', 'MyConn', ['x.fibery.io'], { title: 'Mine' })];
  const key = sourceKeyFor('MyConn', [], list);
  const sources = groupSources([custom('a', key, 'MyConn'), custom('b', key, 'myconn')], [], list);
  expect(sources).toEqual([{ key, name: 'Mine', logo: null, martIds: ['a', 'b'] }]);
});

test('a custom connector with no hosts is its own source, keyed by its name', () => {
  const list = [summary('1', 'Lone', [], { title: 'Lone One' })];
  const key = sourceKeyFor('lone', [], list);
  expect(key).toBe('Lone');
  expect(groupSources([custom('a', key, 'lone')], [], list)[0]).toMatchObject({ key: 'Lone', name: 'Lone One' });
});
