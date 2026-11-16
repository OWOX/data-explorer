import { describe, expect, it } from 'vitest';
import { PAGE_SIZE } from '../config';
import type { Mart, Model, Schema } from '../model/types';
import { resolveView, skippedMessage, type Skipped } from './view-link-resolve';
import type { DecodedView } from './view-link';

const mart = (id: string, patch: Partial<Mart> = {}): Mart => ({ id, title: id, description: null, icon: null, storageId: 's1', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: 'src1', ...patch });
const model: Model = {
  marts: new Map([['m1', mart('m1')], ['m2', mart('m2', { accessible: false })], ['m3', mart('m3', { sourceKey: 'src2' })]]),
  sources: [{ key: 'src1', name: 'S1', logo: null, martIds: ['m1'] }, { key: 'src2', name: 'S2', logo: null, martIds: ['m3'] }],
  edges: [],
  contexts: [{ id: 'c1', name: 'C1', icon: null }],
  storages: [{ id: 's1', title: 'S1', type: 'BQ' }, { id: 's2', title: 'S2', type: 'BQ' }],
  failedStorages: [],
};
const field = (name: string) => ({ name, alias: null, type: 'STRING', category: 'string', description: null, isPrimaryKey: false }) as Schema[number];
const schema: Schema = ['id', 'total', 'customer__name'].map(field);
const folded = { sources: false, marts: false, data: false, row: false };
const view = (patch: Partial<DecodedView> = {}): DecodedView => ({
  sourceKey: 'src1', martId: 'm1', record: { id: 1 }, search: 'q', contextIds: ['c1'], storageIds: ['s1'], folded, dropped: 0,
  grid: { columns: ['id', 'total'], filters: { id: { field: 'id', op: 'eq', value: 1 } }, sorts: [{ field: 'id', direction: 'asc' }], limit: 400 },
  ...patch,
});
const read = async () => schema;
const none: Skipped = { mart: false, source: false, columns: 0, filters: 0, sorts: 0, contexts: 0, storages: 0 };

describe('resolveView', () => {
  it('keeps a fully valid view as is', async () => {
    const { apply, skipped } = await resolveView(view(), model, read);
    expect(skipped).toEqual(none);
    expect(apply.selection).toEqual({ sourceKey: 'src1', martId: 'm1', record: { martId: 'm1', pk: { id: 1 } } });
    expect(apply.grid).toEqual(view().grid);
    expect(apply.search).toBe('q');
    expect(apply.contextIds).toEqual(['c1']);
    expect(apply.storageIds).toEqual(['s1']);
    expect(apply.folded).toEqual(folded);
  });

  it('drops a mart that is unknown or not accessible, with its record and grid', async () => {
    for (const id of ['nope', 'm2']) {
      const { apply, skipped } = await resolveView(view({ martId: id }), model, read);
      expect(skipped.mart).toBe(true);
      expect(apply.selection).toEqual({ sourceKey: 'src1', martId: null, record: null });
      expect(apply.grid).toBeNull();
    }
  });

  it('drops an unknown source, and a source that does not feed the kept mart', async () => {
    const a = await resolveView(view({ sourceKey: 'zzz' }), model, read);
    expect(a.skipped.source).toBe(true);
    expect(a.apply.selection.sourceKey).toBeNull();
    const b = await resolveView(view({ sourceKey: 'src2' }), model, read);
    expect(b.skipped.source).toBe(true);
    expect(b.apply.selection).toMatchObject({ sourceKey: null, martId: 'm1' });
  });

  it('an empty selection stays plain, without cleared', async () => {
    const { apply } = await resolveView(view({ sourceKey: null, martId: 'nope', record: null, grid: null }), model, read);
    expect(apply.selection).toEqual({ sourceKey: null, martId: null, record: null });
    expect('cleared' in apply.selection).toBe(false);
  });

  it('drops unknown contexts and storages; an empty storage list becomes null', async () => {
    const a = await resolveView(view({ contextIds: ['c1', 'cx'], storageIds: ['s1', 'sx', 's2'] }), model, read);
    expect(a.apply.contextIds).toEqual(['c1']);
    expect(a.apply.storageIds).toEqual(['s1', 's2']);
    expect(a.skipped).toMatchObject({ contexts: 1, storages: 1 });
    const b = await resolveView(view({ storageIds: ['sx'] }), model, read);
    expect(b.apply.storageIds).toBeNull();
    expect(b.skipped.storages).toBe(1);
    const c = await resolveView(view({ storageIds: [] }), model, read);
    expect(c.apply.storageIds).toBeNull();
    expect(c.skipped.storages).toBe(0);
    const d = await resolveView(view({ storageIds: null }), model, read);
    expect(d.apply.storageIds).toBeNull();
  });

  it('prunes columns, filters and sorts the schema does not offer', async () => {
    const grid = {
      columns: ['id', 'gone', 'customer__name'],
      filters: { id: { field: 'id', op: 'eq' as const, value: 1 }, gone: { field: 'gone', op: 'eq' as const, value: 2 } },
      sorts: [{ field: 'id', direction: 'asc' as const }, { field: 'gone2', direction: 'desc' as const }],
      limit: 200,
    };
    const { apply, skipped } = await resolveView(view({ grid }), model, read);
    expect(apply.grid).toEqual({ columns: ['id', 'customer__name'], filters: { id: grid.filters.id }, sorts: [grid.sorts[0]], limit: 200 });
    expect(skipped).toMatchObject({ columns: 1, filters: 1, sorts: 1 });
  });

  it('counts the codec dropped entries under columns', async () => {
    const { skipped } = await resolveView(view({ dropped: 3 }), model, read);
    expect(skipped.columns).toBe(3);
  });

  it('sorts: null stays null, empty stays empty, pruned to empty becomes null', async () => {
    const g = (sorts: never) => view({ grid: { ...view().grid!, sorts } });
    expect((await resolveView(g(null as never), model, read)).apply.grid!.sorts).toBeNull();
    expect((await resolveView(g([] as never), model, read)).apply.grid!.sorts).toEqual([]);
    const pruned = await resolveView(g([{ field: 'gone', direction: 'asc' }] as never), model, read);
    expect(pruned.apply.grid!.sorts).toBeNull();
    expect(pruned.skipped.sorts).toBe(1);
  });

  it('all columns dropped gives a null grid', async () => {
    const { apply, skipped } = await resolveView(view({ grid: { ...view().grid!, columns: ['x', 'y'] } }), model, read);
    expect(apply.grid).toBeNull();
    expect(skipped.columns).toBe(2);
  });

  it('counts filters and sorts on unoffered fields when all columns are dropped', async () => {
    const grid = { columns: ['x', 'y'], filters: { gone: { field: 'gone', op: 'eq' as const, value: 1 } }, sorts: [{ field: 'gone', direction: 'asc' as const }], limit: 200 };
    const { apply, skipped } = await resolveView(view({ grid }), model, read);
    expect(apply.grid).toBeNull();
    expect(skipped).toMatchObject({ columns: 2, filters: 1, sorts: 1 });
  });

  it('passes the grid through unpruned when readGrid gives null or rejects', async () => {
    const grid = { columns: ['x'], filters: { x: { field: 'x', op: 'eq' as const, value: 1 } }, sorts: [{ field: 'x', direction: 'asc' as const }], limit: 200 };
    for (const r of [async () => null, async () => { throw new Error('boom'); }]) {
      const { apply, skipped } = await resolveView(view({ grid }), model, r);
      expect(apply.grid).toEqual(grid);
      expect(skipped).toEqual(none);
    }
  });

  it('clamps and rounds the row limit', async () => {
    const lim = async (limit: number) => (await resolveView(view({ grid: { ...view().grid!, limit } }), model, read)).apply.grid!.limit;
    expect(await lim(1)).toBe(PAGE_SIZE);
    expect(await lim(PAGE_SIZE * 50)).toBe(PAGE_SIZE * 10);
    expect(await lim(PAGE_SIZE * 2 + 30)).toBe(PAGE_SIZE * 2);
    expect(await lim(PAGE_SIZE * 2 + 130)).toBe(PAGE_SIZE * 3);
  });

  it('keeps the record only for a kept mart', async () => {
    expect((await resolveView(view({ martId: 'nope' }), model, read)).apply.selection.record).toBeNull();
    expect((await resolveView(view({ record: null }), model, read)).apply.selection.record).toBeNull();
  });

  it('does not read the grid when there is no mart', async () => {
    let called = 0;
    await resolveView(view({ martId: null, grid: null }), model, async () => { called++; return schema; });
    expect(called).toBe(0);
  });
});

describe('skippedMessage', () => {
  it('is null when nothing was skipped', () => expect(skippedMessage(none)).toBeNull());
  it('uses singular for 1', () => {
    expect(skippedMessage({ ...none, columns: 1, filters: 1, sorts: 1, contexts: 1, storages: 1 }))
      .toBe("Some parts of this link aren't available to you: 1 column, 1 filter, 1 sort, 1 context, 1 storage.");
  });
  it('uses plural and keeps the order', () => {
    expect(skippedMessage({ mart: true, source: true, columns: 2, filters: 3, sorts: 4, contexts: 5, storages: 6 }))
      .toBe("Some parts of this link aren't available to you: the data mart, the source, 2 columns, 3 filters, 4 sorts, 5 contexts, 6 storages.");
  });
  it('lists only what was skipped', () => {
    expect(skippedMessage({ ...none, source: true, sorts: 2 })).toBe("Some parts of this link aren't available to you: the source, 2 sorts.");
  });
});
