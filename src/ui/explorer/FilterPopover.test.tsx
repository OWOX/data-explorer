import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { FilterEditor, FilterPopover } from './FilterPopover';
import type { ColumnFilter } from '../../filters/build';
import type { Field } from '../../model/types';

const num: Field = { name: 'amount', alias: 'Amount', type: 'NUMERIC', category: 'number', description: null, isPrimaryKey: false };
const ts: Field = { ...num, name: 'created_at', type: 'TIMESTAMP', category: 'date' };

test('number: choose ≥, type a value, apply', async () => {
  const onApply = vi.fn();
  render(<FilterEditor field={num} value={undefined} onApply={onApply} onClear={vi.fn()} />);
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'gte');
  await userEvent.type(screen.getByLabelText('Value'), '10');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'amount', op: 'gte', value: '10' });
});

test('Apply is disabled while incomplete', async () => {
  render(<FilterEditor field={num} value={undefined} onApply={vi.fn()} onClear={vi.fn()} />);
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'between');
  await userEvent.type(screen.getByLabelText('From'), '1');
  expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
});

const day: Field = { ...ts, name: 'day', type: 'DATE' };
const open = (field: Field, value?: ColumnFilter) => {
  const onApply = vi.fn();
  const onClear = vi.fn();
  render(<FilterEditor field={field} value={value} onApply={onApply} onClear={onClear} />);
  return { onApply, onClear };
};

test('a date column opens on the presets, in order, then Custom range and the other operators below a divider', () => {
  open(ts);
  const names = screen.getAllByRole('menuitemradio').map((b) => b.textContent);
  expect(names).toEqual(['Today', 'Yesterday', 'Last 7 days', 'Last 14 days', 'Last 30 days', 'Last 90 days', 'This week', 'Last week', 'This month', 'Last month', 'This quarter', 'Last quarter', 'This year', 'Last 12 months']);
  expect(screen.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Custom range…', 'Before…', 'After…', 'Is blank', 'Is not blank']);
  expect(screen.queryByLabelText('Operator')).toBeNull();
  expect(document.querySelector('hr')).not.toBeNull();
});

test('a DATE column also offers On', () => {
  open(day);
  expect(screen.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Custom range…', 'On…', 'Before…', 'After…', 'Is blank', 'Is not blank']);
});

test.each([
  ['Today', { kind: 'today' }], ['Yesterday', { kind: 'yesterday' }],
  ['Last 7 days', { kind: 'last_n_days', n: 7 }], ['Last 14 days', { kind: 'last_n_days', n: 14 }], ['Last 30 days', { kind: 'last_n_days', n: 30 }], ['Last 90 days', { kind: 'last_n_days', n: 90 }],
  ['This week', { kind: 'this_week' }], ['Last week', { kind: 'last_week' }], ['This month', { kind: 'this_month' }], ['Last month', { kind: 'last_month' }],
  ['This quarter', { kind: 'this_quarter' }], ['Last quarter', { kind: 'last_quarter' }], ['This year', { kind: 'this_year' }], ['Last 12 months', { kind: 'last_n_months', n: 12 }],
])('clicking "%s" applies it at once as a relative rule', async (label, rule) => {
  const { onApply } = open(ts);
  await userEvent.click(screen.getByRole('menuitemradio', { name: label }));
  expect(onApply).toHaveBeenCalledWith({ field: 'created_at', op: 'relative', value: rule });
});

test('the active preset is highlighted when reopened', () => {
  open(ts, { field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 30 } });
  expect(screen.getByRole('menuitemradio', { name: 'Last 30 days' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('menuitemradio', { name: 'Last 7 days' })).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
});

test('Last N days takes any N, up to 3650', async () => {
  const { onApply } = open(ts);
  expect(screen.getByLabelText('N')).toHaveAttribute('max', '3650');
  await userEvent.clear(screen.getByLabelText('N'));
  await userEvent.type(screen.getByLabelText('N'), '4000');
  expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  await userEvent.clear(screen.getByLabelText('N'));
  await userEvent.type(screen.getByLabelText('N'), '45');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 45 } });
});

test('Custom range opens from and to inputs and applies between', async () => {
  const { onApply } = open(day);
  await userEvent.click(screen.getByRole('menuitem', { name: 'Custom range…' }));
  expect(screen.getByLabelText('From')).toHaveAttribute('type', 'date');
  await userEvent.type(screen.getByLabelText('From'), '2026-01-01');
  await userEvent.type(screen.getByLabelText('To'), '2026-01-31');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'day', op: 'between', value: { from: '2026-01-01', to: '2026-01-31' } });
});

test('a timestamp range uses datetime-local inputs, and Presets goes back', async () => {
  open(ts);
  await userEvent.click(screen.getByRole('menuitem', { name: 'After…' }));
  expect(screen.getByLabelText('Value')).toHaveAttribute('type', 'datetime-local');
  expect(screen.getByLabelText('Operator')).toHaveValue('after');
  await userEvent.click(screen.getByRole('button', { name: '← Presets' }));
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(14);
});

test('Is blank applies at once; a saved range reopens on its own form', async () => {
  const blank = open(ts);
  await userEvent.click(screen.getByRole('menuitem', { name: 'Is blank' }));
  expect(blank.onApply).toHaveBeenCalledWith({ field: 'created_at', op: 'is_blank' });
  document.body.innerHTML = '';
  open(ts, { field: 'created_at', op: 'between', value: { from: '2026-01-01T00:00', to: '2026-01-31T00:00' } });
  expect(screen.getByLabelText('From')).toHaveValue('2026-01-01T00:00');
});

test('Clear calls onClear', async () => {
  const onClear = vi.fn();
  render(<FilterEditor field={num} value={{ field: 'amount', op: 'gt', value: '1' }} onApply={vi.fn()} onClear={onClear} />);
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(onClear).toHaveBeenCalled();
});

test('time fields use time inputs and have no presets', async () => {
  render(<FilterEditor field={{ ...ts, name: 'at', type: 'TIME', category: 'time' }} value={undefined} onApply={vi.fn()} onClear={vi.fn()} />);
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'after');
  expect(screen.getByLabelText('Value')).toHaveAttribute('type', 'time');
  expect(screen.queryByRole('menuitemradio')).toBeNull();
});

test('the column filter control shows the preset name, and nothing for other filters', () => {
  const { rerender } = render(<FilterPopover field={ts} value={{ field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 30 } }} onChange={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Filter Amount' })).toHaveTextContent('Last 30 days');
  rerender(<FilterPopover field={ts} value={{ field: 'created_at', op: 'is_blank' }} onChange={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Filter Amount' })).toHaveTextContent('');
});
