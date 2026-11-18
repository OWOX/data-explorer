import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { vi } from 'vitest';
import type { Field } from '../../model/types';
import { ColumnPicker } from './ColumnPicker';

const fields = ['id', 'name', 'city'].map((name) => ({ name }) as Field);
const open = async (visible: string[], locked: (n: string) => boolean = () => false) => {
  const onChange = vi.fn();
  render(<TooltipProvider><ColumnPicker title="Orders" fields={fields} main visible={visible} locked={locked} onChange={onChange} /></TooltipProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Fields of Orders' }));
  return onChange;
};

test('Select all shows every field in schema order', async () => {
  const onChange = await open(['city']);
  await userEvent.click(screen.getByRole('button', { name: 'Select all 3' }));
  expect(onChange).toHaveBeenLastCalledWith(['id', 'name', 'city']);
});

test('Clear never hides the last visible column', async () => {
  const onChange = await open(['id', 'name', 'city']);
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(onChange).toHaveBeenLastCalledWith(['id']);
});

test('Clear keeps a locked field', async () => {
  const onChange = await open(['id', 'name', 'city'], (n) => n === 'name');
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(onChange).toHaveBeenLastCalledWith(['name']);
});
