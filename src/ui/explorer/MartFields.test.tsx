import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { describe, vi } from 'vitest';
import type { Field } from '../../model/types';
import { MartFields, type ConfigMart } from './MartFields';

const fields = ['id', 'name', 'city'].map((name) => ({ name, type: 'STRING', category: 'string' }) as Field);
const orders = (extra: Partial<ConfigMart> = {}): ConfigMart => ({ path: '', title: 'Orders', main: true, shown: true, fields, ...extra });
const open = async (visible: string[]) => {
  const onChange = vi.fn();
  render(<TooltipProvider><MartFields mart={orders()} visible={visible} onChange={onChange} /></TooltipProvider>);
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

test('Clear on the main mart leaves only the other marts\' columns', async () => {
  const onChange = await open(['id', 'name', 'cus_a']);
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(onChange).toHaveBeenLastCalledWith(['cus_a']);
});

test('the last own column of the main mart can be unticked while a joined mart is shown', async () => {
  const onChange = await open(['name', 'cus_a']);
  const option = within(await screen.findByRole('listbox', { name: 'Fields of Orders' })).getByRole('option', { name: 'name' });
  expect(option).not.toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(option);
  expect(onChange).toHaveBeenLastCalledWith(['cus_a']);
});

test('Clear on a joined mart commits at once and leaves the other marts\' columns', async () => {
  const onChange = vi.fn();
  const joined = ['cus_a', 'cus_b'].map((name) => ({ name, type: 'STRING', category: 'string' }) as Field);
  render(<TooltipProvider><MartFields mart={{ path: 'customers', title: 'Customers', main: false, shown: true, fields: joined }} visible={['id', 'cus_a', 'cus_b']} onChange={onChange} /></TooltipProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(onChange).toHaveBeenCalledOnce();
  expect(onChange).toHaveBeenLastCalledWith(['id']);
});

test('Clear on a joined mart with no column changes nothing', async () => {
  const onChange = vi.fn();
  const joined = ['cus_a'].map((name) => ({ name, type: 'STRING', category: 'string' }) as Field);
  render(<TooltipProvider><MartFields mart={{ path: 'customers', title: 'Customers', main: false, shown: true, fields: joined }} visible={['id']} onChange={onChange} /></TooltipProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(onChange).not.toHaveBeenCalled();
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

test('lists every field in ascending order of the label, shown or not', async () => {
  const mixed = ['zeta', 'Beta', 'alpha', 'Delta', 'gamma'].map((name) => ({ name, type: 'STRING', category: 'string' }) as Field);
  render(<TooltipProvider><MartFields mart={orders({ fields: mixed })} visible={['zeta', 'Delta']} onChange={vi.fn()} /></TooltipProvider>);
  expect(screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual(['alpha', 'Beta', 'Delta', 'gamma', 'zeta']);
});

describe('the Unique Count row', () => {
  const openUnique = async (visible: string[], unique: { on: boolean; onToggle: () => void } | null) => {
    const onChange = vi.fn();
    render(<TooltipProvider><MartFields mart={orders({ unique: unique ?? undefined })} visible={visible} onChange={onChange} /></TooltipProvider>);
    return onChange;
  };

  test('is the first row, left out of Select all and the counts, and absent when the mart offers no metric', async () => {
    await openUnique(['name'], { on: false, onToggle: () => undefined });
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual(['Unique Count', 'city', 'id', 'name']);
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
