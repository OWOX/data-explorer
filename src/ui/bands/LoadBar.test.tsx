import { render } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { advance, CREEP_TO, LoadBar, resetLoadBar } from './LoadBar';

beforeEach(resetLoadBar);

test('while a step is pending the bar keeps creeping toward the cap and never reaches it', () => {
  advance(1, 0.3);
  let last = 0;
  for (let t = 100; t <= 60_000; t += 100) {
    const v = advance(t, 0.3);
    expect(v).toBeGreaterThanOrEqual(last);
    last = v;
  }
  expect(last).toBeGreaterThan(0.85);
  expect(last).toBeLessThanOrEqual(CREEP_TO);
  // still moving a few seconds in: it does not freeze
  const a = advance(61_000, 0.3);
  advance(61_000, 0.3);
  expect(advance(65_000, 0.3)).toBeGreaterThan(0.3);
  expect(a).toBeLessThanOrEqual(CREEP_TO);
});

test('it never moves back when the real fraction dips', () => {
  advance(1, 0.5);
  const high = advance(2000, 0.5);
  expect(advance(2100, 0.2)).toBeGreaterThanOrEqual(high);
});

test('a finished read runs the bar out to the end', () => {
  advance(1, 0.4);
  advance(500, 0.4);
  let v = 0;
  for (let t = 600; t <= 1500; t += 50) v = advance(t, 1);
  expect(v).toBeGreaterThan(0.999);
  expect(v).toBeLessThanOrEqual(1);
});

test('the bar bearing the aria value follows the real fraction and is not reset by a re-render', () => {
  const { container, rerender } = render(<LoadBar fraction={0.4} />);
  const bar = container.querySelector('[role=progressbar]')!;
  expect(bar).toHaveAttribute('aria-valuenow', '40');
  const fill = bar.querySelector('span') as HTMLElement;
  advance(1, 0.4);
  let v = 0;
  for (let t = 100; t <= 6000; t += 100) v = advance(t, 0.4);
  rerender(<LoadBar fraction={0.4} />);
  expect(parseFloat(fill.style.width)).toBeCloseTo(v * 100, 1);
  expect(v).toBeGreaterThan(0.4);
  rerender(<LoadBar fraction={1} />);
  expect(container.querySelector('.dm-loadbar-done')).not.toBeNull();
});
