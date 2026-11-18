import { render, screen, within } from '@testing-library/react';
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

test('the Fields hint is a pointer shortcut: not in the Tab order, and the option carries the description', async () => {
  const described = [{ name: 'id', description: 'The order key' }, { name: 'name' }, { name: 'city' }] as Field[];
  render(<TooltipProvider><ColumnPicker title="Orders" fields={described} main visible={['id']} locked={() => false} onChange={vi.fn()} /></TooltipProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Fields of Orders' }));
  const list = await screen.findByRole('listbox', { name: 'Fields of Orders' });
  const option = within(list).getByRole('option', { name: 'id' });
  expect(option).toHaveAttribute('aria-description', 'The order key');
  const hint = list.querySelector('.dm-hint-slot') as HTMLElement;
  expect(hint).not.toBeNull();
  const tabbable = Array.from(hint.querySelectorAll<HTMLElement>('button, [tabindex]')).filter((e) => e.getAttribute('tabindex') !== '-1');
  expect(tabbable).toEqual([]);
  expect(hint.closest('[aria-hidden="true"]') ?? hint.querySelector('[aria-hidden="true"]')).not.toBeNull();
});
