import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeVisible } from '../../graph/visible';
import type { Edge, Mart, Model } from '../../model/types';
import { litIds, paintPlan, planLines, useWires, type Box, type Selection, type Wire } from './wires';

const wire = (id: string, from: string, to: string, kind: Wire['kind'] = 'relationship'): Wire => ({
  id,
  from,
  to,
  kind,
  title: id,
});
const box = (left: number, top: number): Box => ({ left, top, right: left + 100, bottom: top + 40, width: 100, height: 40 });

describe('planLines', () => {
  const boxes = new Map([
    ['src-a', box(0, 0)],
    ['dm-1', box(0, 200)],
    ['dm-2', box(150, 200)],
  ]);

  it('draws one path per pair of boxes and maps every follower to it', () => {
    const wires = [wire('w1', 'src-a', 'dm-1', 'source'), wire('w2', 'src-a', 'dm-1', 'source'), wire('w3', 'src-a', 'dm-2', 'source')];
    const { d, lead } = planLines(wires, boxes);
    expect(d[0]).toMatch(/^M/);
    expect(d[1]).toBeNull();
    expect(d[2]).toMatch(/^M/);
    expect(lead).toEqual([0, 0, 2]);
  });

  it('keeps direction: a wire the other way round is its own line', () => {
    const { d, lead } = planLines([wire('w1', 'dm-1', 'dm-2'), wire('w2', 'dm-2', 'dm-1')], boxes);
    expect(d.every(Boolean)).toBe(true);
    expect(lead).toEqual([0, 1]);
  });

  it('skips a wire whose end is not on the page', () => {
    const { d, lead } = planLines([wire('w1', 'src-a', 'dm-gone', 'source'), wire('w2', 'src-a', 'dm-1', 'source')], boxes);
    expect(d[0]).toBeNull();
    expect(lead[0]).toBe(-1);
    expect(lead[1]).toBe(1);
  });

  it('skips a self-join', () => {
    const { d, lead } = planLines([wire('w1', 'dm-1', 'dm-1')], boxes);
    expect(d[0]).toBeNull();
    expect(lead[0]).toBe(-1);
  });

  it('leaves from the facing side: down across bands, sideways within one', () => {
    const { d } = planLines([wire('a', 'src-a', 'dm-1', 'source'), wire('b', 'dm-1', 'dm-2')], boxes);
    expect(d[0]).toBe('M50 40 C50 110 50 130 50 200');
    expect(d[1]).toBe('M100 220 C130 220 120 220 150 220');
  });
});

describe('litIds', () => {
  const wires = [wire('w1', 'src-a', 'dm-1', 'source'), wire('w2', 'dm-1', 'dm-2'), wire('w3', 'src-b', 'dm-3', 'source')];
  it('lights the id and the ends of its wires', () => {
    expect([...litIds(wires, 'dm-1')].sort()).toEqual(['dm-1', 'dm-2', 'src-a']);
  });
  it('lights only itself when it has no wires', () => {
    expect([...litIds(wires, 'dm-9')]).toEqual(['dm-9']);
  });
});

describe('paintPlan', () => {
  const wires = [wire('w1', 'dm-1', 'dm-2'), wire('w2', 'dm-3', 'dm-1'), wire('w3', 'dm-4', 'dm-5')];

  it('marks leaving and arriving from the card in hand', () => {
    const plan = paintPlan(wires, { pinned: 'dm-1', hovered: null });
    expect(plan.get(0)).toEqual({ aside: false, direction: 'outbound' });
    expect(plan.get(1)).toEqual({ aside: false, direction: 'inbound' });
    expect(plan.has(2)).toBe(false);
  });

  it('draws a hovered card at full strength when nothing is pinned', () => {
    expect(paintPlan(wires, { pinned: null, hovered: 'dm-4' }).get(2)).toEqual({ aside: false, direction: 'outbound' });
  });

  it('fades the hovered card beside a pinned one, and keeps the pinned card\'s own weight on shared lines', () => {
    const plan = paintPlan(wires, { pinned: 'dm-1', hovered: 'dm-2' });
    expect(plan.get(0)).toEqual({ aside: false, direction: 'outbound' });
    expect(paintPlan(wires, { pinned: 'dm-1', hovered: 'dm-4' }).get(2)).toEqual({ aside: true, direction: 'outbound' });
  });

  it('lights nothing with no selection', () => {
    expect(paintPlan(wires, { pinned: null, hovered: null }).size).toBe(0);
  });
});

describe('useWires', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('draws one path per pair, lights after measuring, and puts lines out when the selection moves', () => {
    let measure: () => void = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          measure = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    const rect = (left: number, top: number) => () =>
      ({ left, top, right: left + 100, bottom: top + 40, width: 100, height: 40 }) as DOMRect;
    const canvas = document.createElement('div');
    canvas.innerHTML = '<div id="src-a"></div><div id="dm-1"></div><div id="dm-2"></div>';
    document.body.append(canvas);
    canvas.getBoundingClientRect = rect(0, 0);
    canvas.querySelector('#src-a')!.getBoundingClientRect = rect(0, 0);
    canvas.querySelector('#dm-1')!.getBoundingClientRect = rect(0, 200);
    canvas.querySelector('#dm-2')!.getBoundingClientRect = rect(150, 200);
    const wires = [wire('w1', 'src-a', 'dm-1', 'source'), wire('w2', 'src-a', 'dm-1', 'source'), wire('w3', 'dm-1', 'dm-2')];
    const ref = { current: canvas };
    const { rerender, unmount } = renderHook(({ sel }) => useWires(ref, wires, sel, 0), {
      initialProps: { sel: { pinned: 'dm-1', hovered: null } as Selection },
    });
    act(() => measure());
    const paths = () => [...canvas.querySelectorAll('#wires > path')];
    expect(paths()).toHaveLength(3);
    expect(paths().map((p) => p.hasAttribute('d'))).toEqual([true, false, true]);
    // The follower w2 has no line of its own; its leader w1 is lit, and w3 leaves dm-1.
    expect(paths().map((p) => p.classList.contains('lit'))).toEqual([true, false, true]);
    expect(paths()[2]!.classList.contains('outbound')).toBe(true);
    rerender({ sel: { pinned: 'dm-2', hovered: null } });
    expect(paths().map((p) => p.classList.contains('lit'))).toEqual([false, false, true]);
    expect(paths()[2]!.classList.contains('inbound')).toBe(true);
    rerender({ sel: { pinned: null, hovered: null } });
    expect(canvas.querySelectorAll('#wires > path.lit')).toHaveLength(0);
    unmount();
    expect(canvas.querySelector('#wires')).toBeNull();
  });

  it('re-measures one frame after an animation ends', () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const canvas = document.createElement('div');
    canvas.innerHTML = '<div id="a"></div><div id="b"></div>';
    document.body.append(canvas);
    const a = canvas.querySelector('#a')!;
    a.getBoundingClientRect = () => {
      calls++;
      return { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 } as DOMRect;
    };
    const wires = [wire('w', 'a', 'b')];
    renderHook(() => useWires({ current: canvas }, wires, { pinned: null, hovered: null }, 0));
    act(() => {
      a.dispatchEvent(new Event('animationend', { bubbles: true }));
      a.dispatchEvent(new Event('animationend', { bubbles: true }));
      vi.advanceTimersByTime(50);
    });
    expect(calls).toBe(1);
  });
});

describe('a hub with many neighbours', () => {
  const N = 35;
  const ids = Array.from({ length: N }, (_, i) => `n${String(i).padStart(2, '0')}`);
  const mart = (id: string): Mart => ({ id, title: id, description: null, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null });
  const edges: Edge[] = ids.map((id, i) => ({ id: `e${i}`, source: id, target: 'hub', joins: [] }));
  const model: Model = { marts: new Map(['hub', ...ids].map((id) => [id, mart(id)])), sources: [], edges, contexts: [], storages: [], failedStorages: [] };

  it('shows every neighbour and draws one path per pair', () => {
    const { ids: shown } = computeVisible({ model, selection: { sourceKey: null, martId: 'hub', record: null }, search: '', contextIds: [], schemas: () => undefined });
    expect(shown).toHaveLength(N + 1);
    expect(new Set(shown)).toEqual(new Set(['hub', ...ids]));
    const wires = edges.filter((e) => shown.includes(e.source) && shown.includes(e.target)).map((e) => wire(e.id, `dm-${e.source}`, `dm-${e.target}`));
    const boxes = new Map<string, Box>([['dm-hub', box(0, 0)], ...ids.map((id, i) => [`dm-${id}`, box((i % 6) * 150, 100 + Math.floor(i / 6) * 100)] as const)]);
    const { d, lead } = planLines(wires, boxes);
    expect(wires).toHaveLength(N);
    expect(d.filter(Boolean)).toHaveLength(N);
    expect(lead).toEqual(wires.map((_, i) => i));
  });
});
