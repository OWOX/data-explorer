import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { FilterEditor } from './FilterPopover';
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

test('date: relative last N days', async () => {
  const onApply = vi.fn();
  render(<FilterEditor field={ts} value={undefined} onApply={onApply} onClear={vi.fn()} />);
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'relative');
  await userEvent.selectOptions(screen.getByLabelText('Period'), 'last_n_days');
  await userEvent.clear(screen.getByLabelText('N'));
  await userEvent.type(screen.getByLabelText('N'), '7');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 7 } });
});

test('Clear calls onClear', async () => {
  const onClear = vi.fn();
  render(<FilterEditor field={num} value={{ field: 'amount', op: 'gt', value: '1' }} onApply={vi.fn()} onClear={onClear} />);
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(onClear).toHaveBeenCalled();
});

test('timestamp fields use datetime-local inputs, time fields time inputs, DATE a date input', async () => {
  const { rerender } = render(<FilterEditor field={ts} value={undefined} onApply={vi.fn()} onClear={vi.fn()} />);
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'after');
  expect(screen.getByLabelText('Value')).toHaveAttribute('type', 'datetime-local');
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'between');
  expect(screen.getByLabelText('From')).toHaveAttribute('type', 'datetime-local');
  rerender(<FilterEditor key="t" field={{ ...ts, name: 'at', type: 'TIME', category: 'time' }} value={undefined} onApply={vi.fn()} onClear={vi.fn()} />);
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'after');
  expect(screen.getByLabelText('Value')).toHaveAttribute('type', 'time');
  rerender(<FilterEditor key="d" field={{ ...ts, name: 'day', type: 'DATE' }} value={undefined} onApply={vi.fn()} onClear={vi.fn()} />);
  expect(screen.getByLabelText('Value')).toHaveAttribute('type', 'date');
});

test('the relative N input is capped at 3650', async () => {
  render(<FilterEditor field={ts} value={undefined} onApply={vi.fn()} onClear={vi.fn()} />);
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'relative');
  await userEvent.selectOptions(screen.getByLabelText('Period'), 'last_n_days');
  expect(screen.getByLabelText('N')).toHaveAttribute('max', '3650');
  await userEvent.clear(screen.getByLabelText('N'));
  await userEvent.type(screen.getByLabelText('N'), '4000');
  expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
});
