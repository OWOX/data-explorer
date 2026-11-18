import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { describeFilter } from '../../filters/catalogue';
import { FilterEditor } from './FilterEditor';
import { HOVER_MS } from './MenuParts';
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

const rows = () => [...screen.getByRole('group', { name: /^Filter / }).querySelectorAll('[role^="menuitem"]')].map((b) => b.textContent);
const flyout = async (name: 'Last…' | 'This…') => { await userEvent.click(screen.getByRole('menuitemradio', { name })); return screen.findByRole('menu', { name }); };

test('a date column opens on one list: Today, Yesterday, the Last… and This… flyouts, Custom range, then the other operators', () => {
  open(ts);
  expect(rows()).toEqual(['Today', 'Yesterday', 'Last…', 'This…', 'Custom range…', 'Before…', 'After…', 'Is blank', 'Is not blank']);
  expect(screen.getByRole('menuitemradio', { name: 'Last…' })).toHaveAttribute('aria-haspopup', 'menu');
  expect(screen.queryByLabelText('Operator')).toBeNull();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.querySelector('[role="separator"]')).not.toBeNull();
});

test('a DATE column also offers On', () => {
  open(day);
  expect(rows()).toEqual(['Today', 'Yesterday', 'Last…', 'This…', 'Custom range…', 'On…', 'Before…', 'After…', 'Is blank', 'Is not blank']);
});

test('Last… opens a panel of presets then the Last [n] [unit] form; This… lists four presets', async () => {
  open(ts);
  const last = await flyout('Last…');
  expect(within(last).getAllByRole('menuitemradio').map((b) => b.textContent)).toEqual(['Last 7 days', 'Last 14 days', 'Last 30 days', 'Last 90 days', 'Last week', 'Last month', 'Last quarter', 'Last 12 months']);
  expect(within(last).getByLabelText('Unit')).toHaveValue('days');
  expect(within(last).getAllByRole('option').map((o) => o.textContent)).toEqual(['days', 'weeks', 'months', 'quarters', 'years']);
  expect(within(last).getByRole('button', { name: 'Apply' })).toBeVisible();
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'This…' }));
  const thisMenu = await screen.findByRole('menu', { name: 'This…' });
  expect(within(thisMenu).getAllByRole('menuitemradio').map((b) => b.textContent)).toEqual(['This week', 'This month', 'This quarter', 'This year']);
  expect(screen.queryByRole('menu', { name: 'Last…' })).toBeNull();
});

test.each([
  ['Today', { kind: 'today' }, null], ['Yesterday', { kind: 'yesterday' }, null],
  ['Last 7 days', { kind: 'last_n_days', n: 7 }, 'Last…'], ['Last 14 days', { kind: 'last_n_days', n: 14 }, 'Last…'], ['Last 30 days', { kind: 'last_n_days', n: 30 }, 'Last…'], ['Last 90 days', { kind: 'last_n_days', n: 90 }, 'Last…'],
  ['Last week', { kind: 'last_week' }, 'Last…'], ['Last month', { kind: 'last_month' }, 'Last…'], ['Last quarter', { kind: 'last_quarter' }, 'Last…'], ['Last 12 months', { kind: 'last_n_months', n: 12 }, 'Last…'],
  ['This week', { kind: 'this_week' }, 'This…'], ['This month', { kind: 'this_month' }, 'This…'], ['This quarter', { kind: 'this_quarter' }, 'This…'], ['This year', { kind: 'this_year' }, 'This…'],
] as const)('clicking "%s" applies it at once as a relative rule', async (label, rule, group) => {
  const { onApply } = open(ts);
  if (group) await flyout(group);
  await userEvent.click(screen.getByRole('menuitemradio', { name: label, checked: false }));
  expect(onApply).toHaveBeenCalledWith({ field: 'created_at', op: 'relative', value: rule });
});

test('the active preset is checked in its panel, and its group row is checked too', async () => {
  const { onClear } = open(ts, { field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 30 } });
  expect(screen.getByRole('menuitemradio', { name: 'Last…' })).toBeChecked();
  expect(screen.getByRole('menuitemradio', { name: 'This…' })).not.toBeChecked();
  expect(screen.getByRole('menuitemradio', { name: 'Today' })).not.toBeChecked();
  await flyout('Last…');
  expect(screen.getByRole('menuitemradio', { name: 'Last 30 days' })).toBeChecked();
  expect(screen.getByRole('menuitemradio', { name: 'Last 7 days' })).not.toBeChecked();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Clear' }));
  expect(onClear).toHaveBeenCalled();
});

test('Last [n] [unit]: days apply as days, weeks as 7n days, quarters and years as months', async () => {
  const { onApply } = open(ts);
  const last = await flyout('Last…');
  const n = within(last).getByLabelText('N');
  expect(n).toHaveAttribute('max', '3650');
  await userEvent.clear(n);
  await userEvent.type(n, '4000');
  expect(within(last).getByRole('button', { name: 'Apply' })).toBeDisabled();
  await userEvent.clear(n);
  await userEvent.type(n, '45');
  await userEvent.click(within(last).getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenLastCalledWith({ field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 45 } });
  await userEvent.clear(n);
  await userEvent.type(n, '3');
  const unit = within(last).getByLabelText('Unit');
  await userEvent.selectOptions(unit, 'weeks');
  await userEvent.click(within(last).getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenLastCalledWith({ field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 21 } });
  await userEvent.selectOptions(unit, 'months');
  await userEvent.click(within(last).getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenLastCalledWith({ field: 'created_at', op: 'relative', value: { kind: 'last_n_months', n: 3 } });
  await userEvent.selectOptions(unit, 'quarters');
  await userEvent.click(within(last).getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenLastCalledWith({ field: 'created_at', op: 'relative', value: { kind: 'last_n_months', n: 9 } });
  await userEvent.selectOptions(unit, 'years');
  await userEvent.click(within(last).getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenLastCalledWith({ field: 'created_at', op: 'relative', value: { kind: 'last_n_months', n: 36 } });
});

test('the limit applies to the converted count: 600 weeks is 4200 days, so Apply is off', async () => {
  open(ts);
  const last = await flyout('Last…');
  await userEvent.selectOptions(within(last).getByLabelText('Unit'), 'weeks');
  expect(within(last).getByLabelText('N')).toHaveAttribute('max', '521');
  await userEvent.clear(within(last).getByLabelText('N'));
  await userEvent.type(within(last).getByLabelText('N'), '600');
  expect(within(last).getByRole('button', { name: 'Apply' })).toBeDisabled();
});

test.each([
  [{ kind: 'last_n_days', n: 21 }, '3', 'weeks'], [{ kind: 'last_n_days', n: 45 }, '45', 'days'],
  [{ kind: 'last_n_months', n: 24 }, '2', 'years'], [{ kind: 'last_n_months', n: 6 }, '2', 'quarters'], [{ kind: 'last_n_months', n: 5 }, '5', 'months'],
] as const)('a saved %j reopens as %s %s', async (rule, n, unit) => {
  open(ts, { field: 'created_at', op: 'relative', value: rule });
  const last = await flyout('Last…');
  expect(within(last).getByLabelText('N')).toHaveValue(Number(n));
  expect(within(last).getByLabelText('Unit')).toHaveValue(unit);
});

test('Escape in the Last… panel closes only that panel; Left does too', async () => {
  open(ts);
  await flyout('Last…');
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('menu', { name: 'Last…' })).toBeNull();
  expect(screen.getByRole('menuitemradio', { name: 'Last…' })).toHaveFocus();
  screen.getByRole('menuitemradio', { name: 'Last…' }).focus();
  await userEvent.keyboard('{ArrowRight}');
  const last = await screen.findByRole('menu', { name: 'Last…' });
  await waitFor(() => expect(within(last).getByRole('menuitemradio', { name: 'Last 7 days' })).toHaveFocus());
  await userEvent.keyboard('{ArrowLeft}');
  expect(screen.queryByRole('menu', { name: 'Last…' })).toBeNull();
});

test('the flyout stays while the pointer rests on its own rows, and closes after it rests on another first-level row', async () => {
  open(ts);
  const last = await flyout('Last…');
  await userEvent.hover(within(last).getByRole('menuitemradio', { name: 'Last 30 days' }));
  await new Promise((r) => setTimeout(r, HOVER_MS + 150));
  expect(screen.getByRole('menu', { name: 'Last…' })).toBeInTheDocument();
  await userEvent.hover(screen.getByRole('menuitemradio', { name: 'Today' }));
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Last…' })).toBeNull());
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
  expect(rows()).toHaveLength(9);
});

test('Is blank applies at once; a saved range reopens on its own form', async () => {
  const blank = open(ts);
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'Is blank' }));
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
  expect(screen.queryByRole('group', { name: 'Date presets' })).toBeNull();
});

test('describeFilter reads an applied filter in words', () => {
  expect(describeFilter(num, { op: 'gte', value: '10' })).toBe('≥ 10');
  expect(describeFilter(num, { op: 'between', value: { from: 1, to: 5 } })).toBe('between 1 and 5');
  expect(describeFilter(ts, { op: 'is_blank' })).toBe('is blank');
});

test('Is blank shows its checked state', () => {
  open(ts, { field: 'created_at', op: 'is_blank' });
  expect(screen.getByRole('menuitemradio', { name: 'Is blank' })).toBeChecked();
  expect(screen.getByRole('menuitemradio', { name: 'Is not blank' })).not.toBeChecked();
});

test('there is no title row, and a select draws our own chevron over a native select with no arrow', () => {
  const { container, unmount } = render(<FilterEditor field={num} value={undefined} onApply={vi.fn()} onClear={vi.fn()} />);
  expect(container.querySelector('.dm-popover-title')).toBeNull();
  const select = screen.getByLabelText('Operator');
  expect(select.className).toContain('appearance-none');
  expect(select.parentElement!.querySelector('svg')).not.toBeNull();
  unmount();
  const day = render(<FilterEditor field={ts} value={undefined} onApply={vi.fn()} onClear={vi.fn()} />);
  expect(day.container.querySelector('.dm-popover-title')).toBeNull();
});

const fieldOf = (type: string, category: Field['category']): Field => ({ ...num, name: 'v', type, category });
test.each(['NUMERIC', 'BIGNUMERIC', 'FLOAT64', 'FLOAT', 'INT64', 'INTEGER', 'DECIMAL', 'BIGINT', 'DOUBLE'])('%s column: ">" and "100" apply', async (type) => {
  const onApply = vi.fn();
  render(<FilterEditor field={fieldOf(type, 'number')} value={undefined} onApply={onApply} onClear={vi.fn()} />);
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'gt');
  await userEvent.type(screen.getByLabelText('Value'), '100');
  expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'v', op: 'gt', value: '100' });
});

test('Enter in the value box applies a number filter', async () => {
  const onApply = vi.fn();
  render(<FilterEditor field={num} value={undefined} onApply={onApply} onClear={vi.fn()} />);
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'gt');
  await userEvent.type(screen.getByLabelText('Value'), '100{Enter}');
  expect(onApply).toHaveBeenCalledWith({ field: 'amount', op: 'gt', value: '100' });
});

test('a string column: contains "abc" applies', async () => {
  const onApply = vi.fn();
  render(<FilterEditor field={fieldOf('STRING', 'string')} value={undefined} onApply={onApply} onClear={vi.fn()} />);
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'eq');
  await userEvent.type(screen.getByLabelText('Value'), 'abc');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'v', op: 'eq', value: 'abc' });
});

test('a date column: After… with a day applies', async () => {
  const onApply = vi.fn();
  render(<FilterEditor field={day} value={undefined} onApply={onApply} onClear={vi.fn()} />);
  await userEvent.click(screen.getByRole('menuitem', { name: 'After…' }));
  const box = screen.getByLabelText('Value');
  await userEvent.type(box, '2026-01-02');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'day', op: 'after', value: '2026-01-02' });
});
