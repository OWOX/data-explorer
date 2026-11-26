import { vi } from 'vitest';
import { readRows } from './rows';
import { stubCtx, traversalOf } from './test-ctx';

test('collects chunks and passes options', async () => {
  const t = traversalOf([{ a: 1 }, { a: 2 }, { a: 3 }]);
  const traverseData = vi.fn(async () => t);
  const rows = await readRows(stubCtx({ dataMarts: { list: vi.fn(), traverseData } }), 'm', { column: ['a'], limit: 3 });
  expect(traverseData).toHaveBeenCalledWith('m', { column: ['a'], limit: 3 });
  expect(rows).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
});

test('an aborted signal cancels the stream and rejects with AbortError', async () => {
  const t = traversalOf([{ a: 1 }, { a: 2 }, { a: 3 }], 1);
  const ac = new AbortController();
  const traverseData = vi.fn(async () => t);
  const p = readRows(stubCtx({ dataMarts: { list: vi.fn(), traverseData } }), 'm', {}, { signal: ac.signal, onTotalRowCount: () => ac.abort() });
  await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  expect(t.cancel).toHaveBeenCalled();
});

test('reports the total row count and undefined when OWOX sent none', async () => {
  const seen: string[] = [];
  const run = (total?: number) => readRows(
    stubCtx({ dataMarts: { list: vi.fn(), traverseData: vi.fn(async () => ({ ...traversalOf([{ a: 1 }]), totalRowCount: total })) } }),
    'm', { includeTotalRowCount: true },
    { onTotalRowCount: (n) => seen.push(`count:${n}`) },
  );
  await run(12345);
  await run();
  expect(seen).toEqual(['count:12345', 'count:undefined']);
});
