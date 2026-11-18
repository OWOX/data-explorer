import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';
import { SheetsChecklist, type ChecklistItem } from './SheetsChecklist';

const items: ChecklistItem[] = [
  { value: 'a', text: 'Alpha' }, { value: 'b', text: 'Beta' }, { value: 'c', text: 'Gamma' }, { value: 'd', text: 'Alphabet' },
];

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
  render(<Harness initial={['b']} />);
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
  render(<Harness initial={[]} />);
  await userEvent.type(screen.getByRole('searchbox'), 'zzz');
  expect(screen.getByText('Displaying 0')).toBeInTheDocument();
  expect(screen.getByText('No matches')).toBeInTheDocument();
});

test('typing keeps focus in the search box', async () => {
  render(<Harness initial={[]} />);
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
  render(<Harness initial={[]} />);
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
