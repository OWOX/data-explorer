import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { describeFilter } from '../../filters/catalogue';
import { TooltipProvider } from '../Tooltip';
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
  const names = within(screen.getByRole('group', { name: 'Date presets' })).getAllByRole('button').map((b) => b.textContent);
  expect(names).toEqual(['Today', 'Yesterday', 'Last 7 days', 'Last 14 days', 'Last 30 days', 'Last 90 days', 'This week', 'Last week', 'This month', 'Last month', 'This quarter', 'Last quarter', 'This year', 'Last 12 months']);
  expect(screen.getAllByRole('button', { pressed: undefined }).filter((b) => !b.closest('[aria-label="Date presets"]') && b.hasAttribute('type') && !['Apply', 'Clear'].includes(b.textContent!)).map((b) => b.textContent)).toEqual(['Custom range…', 'Before…', 'After…', 'Is blank', 'Is not blank']);
  expect(screen.queryByLabelText('Operator')).toBeNull();
  expect(document.querySelector('hr')).not.toBeNull();
});

test('a DATE column also offers On', () => {
  open(day);
  expect(screen.getAllByRole('button', { pressed: undefined }).filter((b) => !b.closest('[aria-label="Date presets"]') && b.hasAttribute('type') && !['Apply', 'Clear'].includes(b.textContent!)).map((b) => b.textContent)).toEqual(['Custom range…', 'On…', 'Before…', 'After…', 'Is blank', 'Is not blank']);
});

test.each([
  ['Today', { kind: 'today' }], ['Yesterday', { kind: 'yesterday' }],
  ['Last 7 days', { kind: 'last_n_days', n: 7 }], ['Last 14 days', { kind: 'last_n_days', n: 14 }], ['Last 30 days', { kind: 'last_n_days', n: 30 }], ['Last 90 days', { kind: 'last_n_days', n: 90 }],
  ['This week', { kind: 'this_week' }], ['Last week', { kind: 'last_week' }], ['This month', { kind: 'this_month' }], ['Last month', { kind: 'last_month' }],
  ['This quarter', { kind: 'this_quarter' }], ['Last quarter', { kind: 'last_quarter' }], ['This year', { kind: 'this_year' }], ['Last 12 months', { kind: 'last_n_months', n: 12 }],
])('clicking "%s" applies it at once as a relative rule', async (label, rule) => {
  const { onApply } = open(ts);
  await userEvent.click(screen.getByRole('button', { name: label, pressed: false }));
  expect(onApply).toHaveBeenCalledWith({ field: 'created_at', op: 'relative', value: rule });
});

test('the active preset is highlighted when reopened', () => {
  open(ts, { field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 30 } });
  expect(screen.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute('aria-pressed', 'false');
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
  await userEvent.click(screen.getByRole('button', { name: 'Custom range…' }));
  expect(screen.getByLabelText('From')).toHaveAttribute('type', 'date');
  await userEvent.type(screen.getByLabelText('From'), '2026-01-01');
  await userEvent.type(screen.getByLabelText('To'), '2026-01-31');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'day', op: 'between', value: { from: '2026-01-01', to: '2026-01-31' } });
});

test('a timestamp range uses datetime-local inputs, and Presets goes back', async () => {
  open(ts);
  await userEvent.click(screen.getByRole('button', { name: 'After…' }));
  expect(screen.getByLabelText('Value')).toHaveAttribute('type', 'datetime-local');
  expect(screen.getByLabelText('Operator')).toHaveValue('after');
  await userEvent.click(screen.getByRole('button', { name: '← Presets' }));
  expect(within(screen.getByRole('group', { name: 'Date presets' })).getAllByRole('button')).toHaveLength(14);
});

test('Is blank applies at once; a saved range reopens on its own form', async () => {
  const blank = open(ts);
  await userEvent.click(screen.getByRole('button', { name: 'Is blank' }));
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

test('the column filter control shows only a mark, never the filter text; the description is in the tooltip', async () => {
  const { rerender, container } = render(<TooltipProvider><FilterPopover field={ts} value={undefined} onChange={vi.fn()} /></TooltipProvider>);
  const outline = container.querySelector('button svg')!.innerHTML;
  rerender(<TooltipProvider><FilterPopover field={ts} value={{ field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 30 } }} onChange={vi.fn()} /></TooltipProvider>);
  const button = screen.getByRole('button', { name: 'Filter Amount' });
  expect(button).toHaveTextContent('');
  expect(button).toHaveClass('dm-ctl-on');
  // the filled funnel, not the outline one
  expect(button.querySelector('svg')!.innerHTML).not.toBe(outline);
  expect(button.querySelector('path')!.getAttribute('d')).toMatch(/^M4\.25 5\.61/);
  await userEvent.hover(button);
  expect((await screen.findAllByText('Filter: Last 30 days')).length).toBeGreaterThan(0);
  rerender(<TooltipProvider><FilterPopover field={ts} value={{ field: 'created_at', op: 'is_blank' }} onChange={vi.fn()} /></TooltipProvider>);
  expect(screen.getByRole('button', { name: 'Filter Amount' })).toHaveTextContent('');
});

test('describeFilter reads an applied filter in words', () => {
  expect(describeFilter(num, { op: 'gte', value: '10' })).toBe('≥ 10');
  expect(describeFilter(num, { op: 'between', value: { from: 1, to: 5 } })).toBe('between 1 and 5');
  expect(describeFilter(ts, { op: 'is_blank' })).toBe('is blank');
});

test('the panel is a group of buttons, not a menu; Is blank shows its active state', () => {
  open(ts, { field: 'created_at', op: 'is_blank' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.getByRole('button', { name: 'Is blank' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Is not blank' })).toHaveAttribute('aria-pressed', 'false');
});

test('the title row says "Filter", not the field name, and a select draws our own chevron over a native select with no arrow', () => {
  const { container, unmount } = render(<FilterEditor field={num} value={undefined} onApply={vi.fn()} onClear={vi.fn()} />);
  const title = container.querySelector('.dm-popover-title')!;
  expect(title).toHaveTextContent(/^Filter$/);
  const select = screen.getByLabelText('Operator');
  expect(select.className).toContain('appearance-none');
  expect(select.parentElement!.querySelector('svg')).not.toBeNull();
  unmount();
  const day = render(<FilterEditor field={ts} value={undefined} onApply={vi.fn()} onClear={vi.fn()} />);
  expect(day.container.querySelector('.dm-popover-title')).toHaveTextContent(/^Filter$/);
});
