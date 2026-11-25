import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { describe, vi } from 'vitest';
import type { Field } from '../../model/types';
import { MartFields, type ConfigMart } from './MartFields';

const fields = ['id', 'name', 'city'].map((name) => ({ name, type: 'STRING', category: 'string' }) as Field);
const orders = (extra: Partial<ConfigMart> = {}): ConfigMart => ({ path: '', title: 'Orders', main: true, shown: true, fields, locked: () => false, ...extra });
const open = async (visible: string[], locked: (n: string) => boolean = () => false) => {
  const onChange = vi.fn();
  render(<TooltipProvider><MartFields mart={orders({ locked })} visible={visible} onChange={onChange} /></TooltipProvider>);
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
  const described = [{ name: 'id', type: 'STRING', category: 'string', description: 'The order key' }, { name: 'name', type: 'STRING', category: 'string' }, { name: 'city', type: 'STRING', category: 'string' }] as Field[];
  render(<TooltipProvider><MartFields mart={orders({ fields: described })} visible={['id']} onChange={vi.fn()} /></TooltipProvider>);
  const list = await screen.findByRole('listbox', { name: 'Fields of Orders' });
  const option = within(list).getByRole('option', { name: 'id' });
  expect(option).toHaveAttribute('aria-description', 'The order key');
  const hint = list.querySelector('.dm-hint-slot') as HTMLElement;
  expect(hint).not.toBeNull();
  const tabbable = Array.from(hint.querySelectorAll<HTMLElement>('button, [tabindex]')).filter((e) => e.getAttribute('tabindex') !== '-1');
  expect(tabbable).toEqual([]);
  expect(hint.closest('[aria-hidden="true"]') ?? hint.querySelector('[aria-hidden="true"]')).not.toBeNull();
});

test('main mart: unticking keeps the order the grid has', async () => {
  const onChange = await open(['city', 'id', 'name']);
  await userEvent.click(screen.getByLabelText('id'));
  expect(onChange).toHaveBeenLastCalledWith(['city', 'name']);
});

test('main mart: a ticked field goes after the nearest schema predecessor that is shown, else first', async () => {
  const a = await open(['city', 'id']);
  await userEvent.click(screen.getByLabelText('name'));
  expect(a).toHaveBeenLastCalledWith(['city', 'id', 'name']);
});

test('main mart: a field before every shown one goes first', async () => {
  const onChange = await open(['city', 'name']);
  await userEvent.click(screen.getByLabelText('id'));
  expect(onChange).toHaveBeenLastCalledWith(['id', 'city', 'name']);
});

test('main mart: a never-reordered grid ends up in schema order', async () => {
  const onChange = await open(['id', 'city']);
  await userEvent.click(screen.getByLabelText('name'));
  expect(onChange).toHaveBeenLastCalledWith(['id', 'name', 'city']);
});

test('Displaying is the number of columns of the mart visible in the grid', async () => {
  await open(['id', 'city']);
  expect(screen.getByText('Displaying 2')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Select all 3' })).toBeInTheDocument();
});

describe('the Unique Count row', () => {
  const openUnique = async (visible: string[], unique: { on: boolean; onToggle: () => void } | null) => {
    const onChange = vi.fn();
    render(<TooltipProvider><MartFields mart={orders({ unique: unique ?? undefined })} visible={visible} onChange={onChange} /></TooltipProvider>);
    return onChange;
  };

  test('is the first row, left out of Select all and the counts, and absent when the mart offers no metric', async () => {
    await openUnique(['name'], { on: false, onToggle: () => undefined });
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual(['Unique Count', 'name', 'id', 'city']);
    expect(screen.getByRole('button', { name: 'Select all 3' })).toBeInTheDocument();
    expect(screen.getByText('Displaying 1')).toBeInTheDocument();
    cleanup();
    await openUnique(['name'], null);
    expect(screen.queryByRole('option', { name: 'Unique Count' })).toBeNull();
  });

  test('ticking it toggles the metric and changes no field', async () => {
    const onToggle = vi.fn();
    const onChange = await openUnique(['name'], { on: false, onToggle });
    await userEvent.click(screen.getByRole('option', { name: 'Unique Count' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('is ticked while the metric is on', async () => {
    await openUnique(['name'], { on: true, onToggle: () => undefined });
    expect(screen.getByRole('option', { name: 'Unique Count' })).toHaveAttribute('aria-selected', 'true');
  });
});
