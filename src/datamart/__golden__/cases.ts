// The engine-parity cases, written once in the plugin's shape. The test builds the plugin SQL from them, and
// scripts/engine-golden.cts derives the engine's shape from the same list to capture __golden__/engine-sql.json.
import type { ColumnFilter } from '../../filters/build';
import type { Aggregation } from '../../model/aggregation';
import { categorizeFieldType } from '../../model/field-category';
import type { SortKey } from '../../model/sort';
import type { Edge, Field } from '../../model/types';

export type PField = { name: string; alias: string; fn: string; raw: string; type?: string };
export type PMart = { path: string; martId: string; label: string; edgeId: string; fields: PField[] };
export type PCase = { id: string; marts: PMart[]; visible: string[]; filters: ColumnFilter[]; /** Pre-join slices; the engine takes them as filters with `placement: 'pre-join'`. */ slices?: ColumnFilter[]; sorts?: SortKey[]; main: Field[]; aggregation?: Aggregation; /** Captured through the flat composer: a main-only grid. */ flat?: boolean };

const f = (name: string, type: string, joined?: Field['joined']): Field => ({ name, alias: null, type, category: categorizeFieldType(type), description: null, isPrimaryKey: false, ...(joined ? { joined } : {}) });
const MAIN = [f('id', 'INTEGER'), f('status', 'STRING'), f('customer_id', 'INTEGER')];
const MAIN_TYPES: Record<string, string> = { id: 'INTEGER', status: 'STRING', amount: 'INTEGER', created_at: 'TIMESTAMP', name: 'STRING', score: 'FLOAT', ts_a: 'TIMESTAMP', dt_b: 'DATETIME', d_c: 'DATE', ts_d: 'TIMESTAMP' };
/** Main fields in the order the case shows them, which is the schema order the grid sends. */
const mains = (...names: string[]): Field[] => names.map((n) => f(n, MAIN_TYPES[n]!));
export const edges: Edge[] = [
  { id: 'e1', source: 'ord1', target: 'cus1', joins: [{ sourceField: 'customer_id', targetField: 'id' }] },
  { id: 'e2', source: 'cus1', target: 'reg1', joins: [{ sourceField: 'region_id', targetField: 'id' }, { sourceField: 'country', targetField: 'country' }] },
  { id: 'e3', source: 'ord1', target: 'itm1', joins: [{ sourceField: 'id', targetField: 'order_id' }] },
  { id: 'ra', source: 'ord1', target: 'a1', joins: [{ sourceField: 'k', targetField: 'k' }] },
  { id: 'rb', source: 'a1', target: 'b1', joins: [{ sourceField: 'k', targetField: 'k' }] },
  { id: 'rc', source: 'b1', target: 'c1', joins: [{ sourceField: 'k', targetField: 'k' }] },
];
const cus = (fields: PField[]): PMart => ({ path: 'customers', martId: 'cus1', label: 'Customers', edgeId: 'e1', fields });
const itm = (fields: PField[]): PMart => ({ path: 'order_items', martId: 'itm1', label: 'Order Items', edgeId: 'e3', fields });
const reg = (fields: PField[]): PMart => ({ path: 'customers.region', martId: 'reg1', label: 'Region', edgeId: 'e2', fields });
const city: PField = { name: 'city', alias: 'customers__city', fn: 'STRING_AGG', raw: 'STRING' };
const sku: PField = { name: 'sku', alias: 'order_items__sku', fn: 'STRING_AGG', raw: 'STRING' };
const qty: PField = { name: 'quantity', alias: 'order_items__quantity', fn: 'SUM', raw: 'INTEGER' };
const rname: PField = { name: 'name', alias: 'customers_region__name', fn: 'STRING_AGG', raw: 'STRING' };

export const cases: PCase[] = [
  { id: 'G1', marts: [], main: MAIN, visible: ['id'], filters: [{ field: 'status', op: 'eq', value: 'paid' }], sorts: [{ field: 'id', direction: 'asc' }] },
  {
    id: 'G2', marts: [cus([city]), itm([sku])], main: MAIN, visible: ['id', 'status', 'customers__city', 'order_items__sku'],
    filters: [{ field: 'customers__city', op: 'eq', value: 'Paris' }, { field: 'order_items__sku', op: 'is_blank' }, { field: 'customers__city', op: 'neq', value: 'Rome' }, { field: 'customers__city', op: 'not_contains', value: 'ar' }],
  },
  { id: 'G3', marts: [cus([city]), reg([rname])], main: MAIN, visible: ['customers__city', 'customers_region__name'], filters: [{ field: 'customers_region__name', op: 'eq', value: 'EU' }] },
  {
    id: 'G4',
    marts: [cus([
      { name: 'n', alias: 'customers__n', fn: 'COUNT', raw: 'STRING', type: 'INTEGER' },
      { name: 'cd', alias: 'customers__cd', fn: 'COUNT_DISTINCT', raw: 'STRING', type: 'INTEGER' },
      { name: 'av', alias: 'customers__av', fn: 'AVG', raw: 'INTEGER', type: 'FLOAT' },
      { name: 'as_', alias: 'customers__as', fn: 'ANY_VALUE', raw: 'STRING' },
      { name: 'ab', alias: 'customers__ab', fn: 'ANY_VALUE', raw: 'BOOLEAN' },
      { name: 'signup', alias: 'customers__signup', fn: 'MAX', raw: 'DATE' },
    ])],
    main: MAIN, visible: ['id', 'customers__n', 'customers__cd', 'customers__av', 'customers__as', 'customers__ab', 'customers__signup'],
    filters: [{ field: 'customers__signup', op: 'between', value: { from: '2026-01-01', to: '2026-01-31' } }, { field: 'customers__signup', op: 'relative', value: { kind: 'last_n_days', n: 7 } }, { field: 'customers__n', op: 'gt', value: 3 }],
  },
  { id: 'G5', marts: [cus([city]), itm([sku])], main: MAIN, visible: ['id'], filters: [{ field: 'customers__city', op: 'eq', value: 'Paris' }], sorts: [{ field: 'order_items__sku', direction: 'desc' }] },
  {
    id: 'G6',
    marts: [
      { path: 'a', martId: 'a1', label: 'A', edgeId: 'ra', fields: [] },
      { path: 'a.b', martId: 'b1', label: 'B', edgeId: 'rb', fields: [] },
      { path: 'a.b.c', martId: 'c1', label: 'C', edgeId: 'rc', fields: [{ name: 'n', alias: 'a_b_c__n', fn: 'COUNT', raw: 'INTEGER' }, { name: 'flag', alias: 'a_b_c__flag', fn: 'ANY_VALUE', raw: 'BOOLEAN' }] },
    ],
    main: MAIN, visible: ['a_b_c__n', 'a_b_c__flag'], filters: [{ field: 'a_b_c__n', op: 'gt', value: 1 }],
  },
  {
    id: 'G7', marts: [cus([city]), itm([sku, qty])], main: mains('status', 'amount', 'created_at'),
    visible: ['status', 'amount', 'created_at', 'customers__city', 'order_items__sku', 'order_items__quantity'],
    filters: [{ field: 'customers__city', op: 'eq', value: 'Paris' }],
    aggregation: {
      aggregations: [{ column: 'amount', function: 'SUM' }, { column: 'order_items__sku', function: 'COUNT_DISTINCT' }, { column: 'order_items__quantity', function: 'SUM' }],
      dateTrunc: [{ column: 'created_at', unit: 'MONTH', timeZone: 'Europe/Berlin' }],
    },
  },
  {
    id: 'G8', marts: [], main: mains('status', 'amount', 'name'), visible: ['status', 'amount', 'name'], filters: [],
    aggregation: {
      aggregations: [...['SUM', 'AVG', 'MIN', 'MAX', 'ANY_VALUE', 'P25', 'P50', 'P75', 'P95'].map((fn) => ({ column: 'amount', function: fn })), ...['COUNT', 'COUNT_DISTINCT', 'STRING_AGG', 'MIN'].map((fn) => ({ column: 'name', function: fn }))] as Aggregation['aggregations'],
      dateTrunc: [],
    },
    sorts: [{ field: 'status', direction: 'asc' }, { field: 'amount', direction: 'desc' }],
  },
  {
    id: 'G9', marts: [cus([{ name: 'signup', alias: 'customers__signup', fn: 'MAX', raw: 'DATE' }])], main: mains('ts_a', 'dt_b', 'd_c', 'ts_d', 'amount'),
    visible: ['ts_a', 'dt_b', 'd_c', 'ts_d', 'customers__signup', 'amount'], filters: [],
    aggregation: {
      aggregations: [{ column: 'amount', function: 'SUM' }],
      dateTrunc: [
        { column: 'ts_a', unit: 'MONTH', timeZone: 'Europe/Berlin' }, { column: 'dt_b', unit: 'DAY', timeZone: 'America/New_York' },
        { column: 'd_c', unit: 'WEEK' }, { column: 'ts_d', unit: 'YEAR' }, { column: 'customers__signup', unit: 'QUARTER' },
      ],
    },
  },
  {
    id: 'G10',
    marts: [
      cus([city, { name: 'n', alias: 'customers__n', fn: 'COUNT', raw: 'STRING', type: 'INTEGER' }, { name: 'tag', alias: 'customers__tag', fn: 'STRING_AGG', raw: 'STRING' }]),
      reg([{ name: 'code', alias: 'customers_region__code', fn: 'COUNT_DISTINCT', raw: 'STRING', type: 'INTEGER' }, { name: 'pop', alias: 'customers_region__pop', fn: 'SUM', raw: 'INTEGER' }]),
      itm([qty]),
    ],
    main: mains('status', 'score'),
    visible: ['status', 'score', 'customers__city', 'customers__n', 'customers__tag', 'customers_region__code', 'customers_region__pop', 'order_items__quantity'],
    filters: [{ field: 'customers_region__pop', op: 'eq', value: 5 }],
    aggregation: {
      aggregations: [
        { column: 'customers__n', function: 'COUNT' }, { column: 'customers__tag', function: 'STRING_AGG' }, { column: 'customers__tag', function: 'ANY_VALUE' },
        { column: 'customers_region__code', function: 'COUNT_DISTINCT' }, { column: 'customers_region__pop', function: 'SUM' },
        { column: 'order_items__quantity', function: 'P50' }, { column: 'order_items__quantity', function: 'AVG' },
      ],
      dateTrunc: [],
    },
    sorts: [{ field: 'status', direction: 'asc' }, { field: 'customers_region__pop', direction: 'desc' }],
  },
  {
    id: 'G11', marts: [itm([sku, qty])], main: mains('amount'), visible: ['amount', 'order_items__sku', 'order_items__quantity'], filters: [],
    aggregation: { aggregations: [{ column: 'amount', function: 'SUM' }, { column: 'order_items__sku', function: 'COUNT_DISTINCT' }, { column: 'order_items__quantity', function: 'MAX' }], dateTrunc: [] },
  },
  { id: 'S1', marts: [cus([city, { name: 'n', alias: 'customers__n', fn: 'COUNT', raw: 'STRING', type: 'INTEGER' }])], main: MAIN, visible: ['id', 'customers__city', 'customers__n'], filters: [{ field: 'customers__n', op: 'gt', value: 1 }], slices: [{ field: 'customers__city', op: 'eq', value: 'Paris' }] },
  {
    id: 'S2', marts: [cus([city]), reg([rname, { name: 'code', alias: 'customers_region__code', fn: 'COUNT_DISTINCT', raw: 'STRING', type: 'INTEGER' }])], main: mains('status'),
    visible: ['status', 'customers__city', 'customers_region__name', 'customers_region__code'], filters: [],
    slices: [{ field: 'customers_region__name', op: 'eq', value: 'EU' }, { field: 'customers__city', op: 'neq', value: 'Rome' }],
    aggregation: { aggregations: [{ column: 'customers_region__code', function: 'COUNT_DISTINCT' }], dateTrunc: [] },
  },
  {
    id: 'H1', marts: [cus([{ name: 'n', alias: 'customers__n', fn: 'COUNT', raw: 'STRING', type: 'INTEGER' }])], main: mains('status', 'amount'), visible: ['status', 'amount', 'customers__n'],
    filters: [{ field: 'amount', op: 'gt', value: 100, fn: 'SUM' }, { field: 'customers__n', op: 'lte', value: 5, fn: 'COUNT' }],
    aggregation: { aggregations: [{ column: 'amount', function: 'SUM' }, { column: 'customers__n', function: 'COUNT' }], dateTrunc: [] },
  },
  { id: 'M1', flat: true, marts: [], main: mains('id', 'status'), visible: ['id', 'status'], filters: [{ field: 'status', op: 'eq', value: 'paid' }, { field: 'status', op: 'is_blank' }], sorts: [{ field: 'id', direction: 'desc' }] },
  {
    id: 'M2', flat: true, marts: [], main: mains('status', 'amount', 'created_at', 'name'), visible: ['status', 'amount', 'created_at', 'name'], filters: [{ field: 'status', op: 'eq', value: 'paid' }],
    aggregation: {
      aggregations: [{ column: 'amount', function: 'SUM' }, { column: 'amount', function: 'P50' }, { column: 'name', function: 'COUNT_DISTINCT' }, { column: 'name', function: 'STRING_AGG' }],
      dateTrunc: [{ column: 'created_at', unit: 'MONTH', timeZone: 'Europe/Berlin' }],
    },
    sorts: [{ field: 'amount', direction: 'desc' }],
  },
];

/** A case's joined fields, as the schema holds them. */
export const joinedFieldsOf = (c: PCase): Field[] => c.marts.flatMap((m) => m.fields.map((x) => f(x.alias, x.type ?? x.raw, { martId: m.martId, label: m.label, aliasPath: m.path, originalName: x.name, aggregateFunction: x.fn, sourceType: x.raw })));
/** A case's schema: its main fields, then the joined ones. */
export const schemaOf = (c: PCase): Field[] => [...c.main, ...joinedFieldsOf(c)];
