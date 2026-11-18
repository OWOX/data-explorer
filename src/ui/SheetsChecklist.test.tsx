import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';
import { SheetsChecklist, type ChecklistItem } from './SheetsChecklist';

const items: ChecklistItem[] = [
  { value: 'a', text: 'Alpha' }, { value: 'b', text: 'Beta' }, { value: 'c', text: 'Gamma' }, { value: 'd', text: 'Alphabet' },
];

const filler: ChecklistItem[] = Array.from({ length: 5 }, (_, i) => ({ value: `z${i}`, text: `Row ${i}` }));
const many: ChecklistItem[] = [...items, ...filler];

function Harness({ initial, list = items, spy }: { initial: string[]; list?: ChecklistItem[]; spy?: (n: string[]) => void }) {
  const [sel, setSel] = useState(initial);
  return <SheetsChecklist label="Things" items={list} selected={sel} onChange={(n) => { spy?.(n); setSel(n); }} />;
}
const selected = () => screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true').map((o) => o.getAttribute('aria-label'));

test('a listbox of options; a chosen one is aria-selected', () => {
  render(<Harness initial={['b']} />);
  expect(screen.getByRole('listbox', { name: 'Things' })).toHaveAttribute('aria-multiselectable', 'true');
  expect(selected()).toEqual(['Beta']);
});

test('the top row counts the rows on show', () => {
  render(<Harness initial={[]} />);
  expect(screen.getByRole('button', { name: 'Select all 4' })).toBeInTheDocument();
  expect(screen.getByText('Displaying 4')).toBeInTheDocument();
});

test('Select all and Clear act on everything without a search', async () => {
  render(<Harness initial={['b']} />);
  await userEvent.click(screen.getByRole('button', { name: 'Select all 4' }));
  expect(selected()).toEqual(['Alpha', 'Beta', 'Gamma', 'Alphabet']);
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(selected()).toEqual([]);
});

test('with a search, the counts and both links only touch the matches', async () => {
  render(<Harness initial={['b']} list={many} />);
  await userEvent.type(screen.getByRole('searchbox'), 'alpha');
  expect(screen.getAllByRole('option')).toHaveLength(2);
  expect(screen.getByText('Displaying 2')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Select all 2' }));
  await userEvent.clear(screen.getByRole('searchbox'));
  expect(selected()).toEqual(['Alpha', 'Beta', 'Alphabet']);
  await userEvent.type(screen.getByRole('searchbox'), 'alpha');
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  await userEvent.clear(screen.getByRole('searchbox'));
  expect(selected()).toEqual(['Beta']);
});

test('a search with no match says so and counts zero', async () => {
  render(<Harness initial={[]} list={many} />);
  await userEvent.type(screen.getByRole('searchbox'), 'zzz');
  expect(screen.getByText('Displaying 0')).toBeInTheDocument();
  expect(screen.getByText('No matches')).toBeInTheDocument();
});

test('typing keeps focus in the search box', async () => {
  render(<Harness initial={[]} list={many} />);
  const box = screen.getByRole('searchbox');
  await userEvent.type(box, 'be');
  expect(box).toHaveFocus();
});

test('click toggles a row', async () => {
  const spy = vi.fn();
  render(<Harness initial={[]} spy={spy} />);
  await userEvent.click(screen.getByRole('option', { name: 'Gamma' }));
  expect(spy).toHaveBeenLastCalledWith(['c']);
  await userEvent.click(screen.getByRole('option', { name: 'Gamma' }));
  expect(spy).toHaveBeenLastCalledWith([]);
});

test('Down from the search box enters the list, Up and Down move, Space and Enter toggle', async () => {
  render(<Harness initial={[]} list={many} />);
  await userEvent.click(screen.getByRole('searchbox'));
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('option', { name: 'Alpha' })).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('option', { name: 'Beta' })).toHaveFocus();
  await userEvent.keyboard(' ');
  expect(selected()).toEqual(['Beta']);
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(selected()).toEqual(['Beta', 'Gamma']);
  await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
  expect(screen.getByRole('searchbox')).toHaveFocus();
});

test('a disabled selected row stays selected through Clear and a click', async () => {
  const list = items.map((i) => (i.value === 'b' ? { ...i, disabled: true } : i));
  render(<Harness initial={['a', 'b']} list={list} />);
  await userEvent.click(screen.getByRole('option', { name: 'Beta' }));
  expect(selected()).toEqual(['Alpha', 'Beta']);
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(selected()).toEqual(['Beta']);
});

test('the search box shows from 8 rows up', () => {
  const { unmount } = render(<Harness initial={[]} />);
  expect(screen.queryByRole('searchbox')).toBeNull();
  unmount();
  render(<Harness initial={[]} list={many} />);
  expect(screen.getByRole('searchbox')).toBeInTheDocument();
});

test('the Tab stop follows the last focused row', async () => {
  render(<Harness initial={[]} />);
  const [a, b] = screen.getAllByRole('option') as [HTMLElement, HTMLElement];
  expect(a).toHaveAttribute('tabindex', '0');
  act(() => b.focus());
  expect(b).toHaveAttribute('tabindex', '0');
  expect(a).toHaveAttribute('tabindex', '-1');
});

test('typing a character on a row moves it to the search box', async () => {
  render(<Harness initial={[]} list={many} />);
  screen.getByRole('option', { name: 'Row 3' }).focus();
  await userEvent.keyboard('r');
  expect(screen.getByRole('searchbox')).toHaveFocus();
  expect(screen.getByRole('searchbox')).toHaveValue('r');
});

test('an extra beside a row does not toggle it, and the listbox holds only groups of options', async () => {
  const spy = vi.fn();
  const list = [{ value: 'a', text: 'Alpha', extra: <button type="button">About Alpha</button> }, ...items.slice(1)];
  render(<Harness initial={[]} list={list} spy={spy} />);
  await userEvent.click(screen.getByRole('button', { name: 'About Alpha' }));
  expect(spy).not.toHaveBeenCalled();
  expect(screen.getByRole('option', { name: 'Alpha' }).querySelector('button')).toBeNull();
});

test('"only" picks one row by its button or by Shift+Enter, and is not a Tab stop', async () => {
  const spy = vi.fn();
  const list = items.map((i) => ({ ...i, only: () => spy(i.value) }));
  render(<Harness initial={['a', 'b']} list={list} />);
  const btn = screen.getByRole('button', { name: 'Only Gamma' });
  expect(btn).toHaveAttribute('tabindex', '-1');
  await userEvent.click(btn);
  expect(spy).toHaveBeenLastCalledWith('c');
  screen.getByRole('option', { name: 'Beta' }).focus();
  await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
  expect(spy).toHaveBeenLastCalledWith('b');
});
