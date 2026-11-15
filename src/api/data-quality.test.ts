import { vi } from 'vitest';
import { loadDqSummaries } from './data-quality';
import { stubCtx } from './test-ctx';

test('posts ids and maps the response by data mart id', async () => {
  const postJson = vi.fn(async () => ({ items: [{ dataMartId: 'a', summary: { state: 'PASSED' } }] }));
  const res = await loadDqSummaries(stubCtx({ postJson }), ['a', 'b']);
  expect(postJson).toHaveBeenCalledWith('/api/data-marts/data-quality/summaries', { dataMartIds: ['a', 'b'] });
  expect(res.get('a')).toEqual({ state: 'PASSED' });
  expect(res.has('b')).toBe(false);
});

test('no ids, no request', async () => {
  const postJson = vi.fn();
  expect((await loadDqSummaries(stubCtx({ postJson }), [])).size).toBe(0);
  expect(postJson).not.toHaveBeenCalled();
});
