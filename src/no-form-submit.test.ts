import { expect, test } from 'vitest';

const sources = import.meta.glob(['./**/*.tsx', '!./**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

test('no component submits a form', () => {
  expect(Object.keys(sources).length).toBeGreaterThan(10);
  const bad = Object.entries(sources).filter(([, src]) => /onSubmit=|type="submit"|<form[\s>]/.test(src)).map(([f]) => f);
  expect(bad, 'The host iframe is sandboxed without allow-forms, so the browser blocks form submission before the submit event fires. Use ActionForm with type="button" buttons instead (src/ui/ActionForm.tsx).').toEqual([]);
});
