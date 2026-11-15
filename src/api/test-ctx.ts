import { vi } from 'vitest';
import type { Ctx, Row, Traversal } from '../sdk/types';

export function traversalOf(rows: Row[], chunk = 2): Traversal {
  return {
    async *rowChunks() { for (let i = 0; i < rows.length; i += chunk) yield rows.slice(i, i + chunk); },
    cancel: vi.fn(async () => {}),
  };
}

export function stubCtx(overrides: Partial<{ [K in keyof Ctx['owox']]: unknown }> = {}): Ctx {
  const store = new Map<string, unknown>();
  return {
    projectId: 'p1',
    theme: 'light',
    signal: new AbortController().signal,
    ui: { openExternal: vi.fn(async () => {}) },
    collections: <T,>() => ({
      get: vi.fn(async (id: string) => (store.has(id) ? { document: store.get(id) as T } : null)),
      put: vi.fn(async (id: string, doc: T) => { store.set(id, doc); }),
    }),
    owox: {
      storages: { list: vi.fn(async () => []) },
      models: { getEdges: vi.fn(async () => []) },
      dataMarts: { list: vi.fn(async () => []), traverseData: vi.fn(async () => traversalOf([])) },
      getJson: vi.fn(async () => ({})),
      postJson: vi.fn(async () => ({})),
      ...overrides,
    } as Ctx['owox'],
  };
}
