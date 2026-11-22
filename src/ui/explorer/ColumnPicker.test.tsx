import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { describe, vi } from 'vitest';
import type { Aggregation } from '../../model/aggregation';
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

describe('the Count Unique row', () => {
  const none = { aggregations: [], dateTrunc: [] };
  const openUnique = async (visible: string[], agg: Aggregation = none, unique: string | null = 'id') => {
    const onChange = vi.fn();
    render(<TooltipProvider><ColumnPicker title="Orders" fields={fields} main visible={visible} locked={() => false} onChange={onChange} unique={unique ?? undefined} agg={agg} /></TooltipProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Fields of Orders' }));
    return onChange;
  };

  test('is the first row, left out of Select all and the counts, and absent without a key', async () => {
    await openUnique(['name']);
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual(['Count Unique', 'id', 'name', 'city']);
    expect(screen.getByRole('button', { name: 'Select all 3' })).toBeInTheDocument();
    expect(screen.getByText('Displaying 1')).toBeInTheDocument();
    cleanup();
    await openUnique(['name'], none, null);
    expect(screen.queryByRole('option', { name: 'Count Unique' })).toBeNull();
  });

  test('ticking it shows the key and counts it, in one edit', async () => {
    const onChange = await openUnique(['name']);
    await userEvent.click(screen.getByRole('option', { name: 'Count Unique' }));
    const [cols, more] = onChange.mock.calls.at(-1)!;
    expect(cols).toEqual(['id', 'name']);
    expect(more(none)).toEqual({ aggregations: [{ column: 'id', function: 'COUNT_DISTINCT' }], dateTrunc: [] });
  });

  test('is ticked when the key is shown with Count Unique, and unticking removes the key and the function', async () => {
    const agg: Aggregation = { aggregations: [{ column: 'id', function: 'COUNT_DISTINCT' }], dateTrunc: [] };
    const onChange = await openUnique(['id', 'name'], agg);
    expect(screen.getByRole('option', { name: 'Count Unique' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('option', { name: 'Count Unique' }));
    const [cols, more] = onChange.mock.calls.at(-1)!;
    expect(cols).toEqual(['name']);
    expect(more(agg)).toEqual({ aggregations: [], dateTrunc: [] });
  });

  test('a key shown without the function is not ticked, and ticking only adds the function', async () => {
    const onChange = await openUnique(['id', 'name']);
    expect(screen.getByRole('option', { name: 'Count Unique' })).toHaveAttribute('aria-selected', 'false');
    await userEvent.click(screen.getByRole('option', { name: 'Count Unique' }));
    expect(onChange.mock.calls.at(-1)![0]).toEqual(['id', 'name']);
  });
});
