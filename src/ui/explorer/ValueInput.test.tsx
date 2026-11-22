import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import type { Field } from '../../model/types';
import { FilterEditor } from './FilterEditor';
import { ValueInput, type ValueSource } from './ValueInput';

const country: Field = { name: 'country', alias: 'Country', type: 'STRING', category: 'string', description: null, isPrimaryKey: false };
const source = (load: ValueSource['load'], key = 'k'): ValueSource => ({ key, load, cache: new Map() });
const loadOf = (values: string[]) => vi.fn(() => Promise.resolve(values));

function Harness({ op = 'eq', src, start = '' }: { op?: string; src: ValueSource; start?: string }) {
  const [v, setV] = useState(start);
  return <ValueInput op={op} value={v} onChange={setV} source={src} className="" />;
}
const input = () => screen.getByLabelText('Value') as HTMLInputElement;
const options = () => screen.queryAllByRole('option').map((o) => o.textContent);

test('the values load on first focus, once, and list under the input', async () => {
  const load = loadOf(['US', 'DE']);
  render(<Harness src={source(load)} />);
  expect(load).not.toHaveBeenCalled();
  await userEvent.click(input());
  await waitFor(() => expect(options()).toEqual(['US', 'DE']));
  expect(load).toHaveBeenCalledTimes(1);
  await userEvent.tab();
  await userEvent.click(input());
  expect(load).toHaveBeenCalledTimes(1);
});

test('shows a loading row while the read runs', async () => {
  let done!: (v: string[]) => void;
  render(<Harness src={source(() => new Promise((r) => { done = r; }))} />);
  await userEvent.click(input());
  expect(await screen.findByRole('status')).toHaveTextContent('Loading values');
  done(['US']);
  await waitFor(() => expect(options()).toEqual(['US']));
});

test('a failed read shows nothing', async () => {
  const load = vi.fn(() => Promise.reject(new Error('boom')));
  render(<Harness src={source(load)} />);
  await userEvent.click(input());
  await waitFor(() => expect(load).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(screen.queryByText(/boom|error/i)).toBeNull();
});

test('clicking picks: the value is added with a comma, the input keeps focus, and a second pick adds another', async () => {
  render(<Harness src={source(loadOf(['US', 'DE', 'FR']))} />);
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'DE' }));
  expect(input().value).toBe('DE, ');
  expect(input()).toHaveFocus();
  await userEvent.click(await screen.findByRole('option', { name: 'US' }));
  expect(input().value).toBe('DE, US, ');
  expect(input()).toHaveFocus();
  expect(options()).toEqual(['FR']);
});

test('what is typed stays: a pick adds after it', async () => {
  render(<Harness src={source(loadOf(['US', 'DE']))} start="FR, " />);
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'US' }));
  expect(input().value).toBe('FR, US, ');
});

test('typing narrows by the text after the last comma, ignoring case', async () => {
  render(<Harness src={source(loadOf(['United States', 'Ukraine', 'Germany']))} />);
  await userEvent.click(input());
  await screen.findAllByRole('option');
  await userEvent.type(input(), 'Germany, U');
  expect(options()).toEqual(['United States', 'Ukraine']);
  await userEvent.type(input(), 'k');
  expect(options()).toEqual(['Ukraine']);
});

test('arrow keys move, Enter picks, Escape closes the list without closing anything else', async () => {
  const outer = vi.fn();
  render(<div onKeyDown={(e) => { if (e.key === 'Escape') outer(); }}><Harness src={source(loadOf(['US', 'DE', 'FR']))} /></div>);
  await userEvent.click(input());
  await screen.findAllByRole('option');
  await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
  expect(input().value).toBe('DE, ');
  await userEvent.keyboard('{ArrowUp}{Enter}');
  expect(input().value).toBe('DE, FR, ');
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(outer).not.toHaveBeenCalled();
  await userEvent.keyboard('{Escape}');
  expect(outer).toHaveBeenCalledTimes(1);
});

test('Enter with nothing highlighted is left to the form', async () => {
  const onApply = vi.fn();
  render(<FilterEditor field={country} value={undefined} onApply={onApply} onClear={vi.fn()} values={source(loadOf(['US', 'DE']))} />);
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'eq');
  await userEvent.click(input());
  await screen.findAllByRole('option');
  await userEvent.type(input(), 'US{Enter}');
  expect(onApply).toHaveBeenCalledWith({ field: 'country', op: 'eq', value: 'US' });
});

const form = (onApply = vi.fn()) => {
  render(<FilterEditor field={country} value={undefined} onApply={onApply} onClear={vi.fn()} values={source(loadOf(['United States', 'Ukraine', 'Germany']))} />);
  return onApply;
};
const op = () => screen.getByLabelText('Operator') as HTMLSelectElement;

test('under contains a pick keeps the list and focus, and one pick stays contains with that value', async () => {
  const onApply = form();
  await userEvent.selectOptions(op(), 'contains');
  await userEvent.type(input(), 'un');
  await userEvent.click(await screen.findByRole('option', { name: 'United States' }));
  expect(input().value).toBe('United States, ');
  expect(input()).toHaveFocus();
  expect(op().value).toBe('contains');
  expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Ukraine', 'Germany']);
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'country', op: 'contains', value: 'United States' });
});

test('under contains the second pick switches to is any of', async () => {
  const onApply = form();
  await userEvent.selectOptions(op(), 'contains');
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'Ukraine' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Germany' }));
  expect(input().value).toBe('Ukraine, Germany, ');
  expect(input()).toHaveFocus();
  expect(op().value).toBe('eq');
  expect(op().selectedOptions[0]!.textContent).toBe('is any of');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'country', op: 'eq', value: 'Ukraine, Germany, ', list: true });
});

test('under does not contain the second pick switches to is none of', async () => {
  form();
  await userEvent.selectOptions(op(), 'not_contains');
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'Ukraine' }));
  expect(op().value).toBe('not_contains');
  await userEvent.click(await screen.findByRole('option', { name: 'Germany' }));
  expect(op().value).toBe('neq');
  expect(op().selectedOptions[0]!.textContent).toBe('is none of');
});

test('under contains a pick, some typing and another pick still make a list', async () => {
  form();
  await userEvent.selectOptions(op(), 'contains');
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'Ukraine' }));
  await userEvent.type(input(), 'Ger');
  expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Germany']);
  await userEvent.click(await screen.findByRole('option', { name: 'Germany' }));
  expect(input().value).toBe('Ukraine, Germany, ');
  expect(op().value).toBe('eq');
});

test('a reopened contains filter: a pick adds to the saved value', async () => {
  render(<FilterEditor field={country} value={{ field: 'country', op: 'contains', value: 'Ukraine' }} onApply={vi.fn()} onClear={vi.fn()} values={source(loadOf(['United States', 'Ukraine', 'Germany']))} />);
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'Germany' }));
  expect(input().value).toBe('Ukraine, Germany, ');
  expect(op().value).toBe('eq');
});

test('a reopened contains value with a comma is sent as it was, and a pick does not make it a list', async () => {
  const onApply = vi.fn();
  render(<FilterEditor field={country} value={{ field: 'country', op: 'contains', value: 'a,b' }} onApply={onApply} onClear={vi.fn()} values={source(loadOf(['a,bc', 'Ukraine']))} />);
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'country', op: 'contains', value: 'a,b' });
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'a,bc' }));
  expect(op().value).toBe('contains');
  expect(input().value).toBe('a,bc');
});

test('a comma typed by hand under contains does not switch the operator', async () => {
  const onApply = form();
  await userEvent.selectOptions(op(), 'contains');
  await userEvent.type(input(), 'a, b');
  expect(op().value).toBe('contains');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'country', op: 'contains', value: 'a, b' });
});

test('no suggestions on a number column', async () => {
  const load = loadOf(['1']);
  render(<FilterEditor field={{ ...country, type: 'INT64', category: 'number' }} value={undefined} onApply={vi.fn()} onClear={vi.fn()} values={source(load)} />);
  await userEvent.click(input());
  expect(load).not.toHaveBeenCalled();
});

test('the suggestion wrapper is no menu, and aria-controls points at the listbox only once it exists', async () => {
  let done!: (v: string[]) => void;
  render(<Harness src={source(() => new Promise((r) => { done = r; }))} />);
  await userEvent.click(input());
  await screen.findByRole('status');
  expect(input()).not.toHaveAttribute('aria-controls');
  done(['US']);
  const box = await screen.findByRole('listbox', { name: 'Suggested values' });
  expect(input()).toHaveAttribute('aria-controls', box.id);
  expect(screen.queryByRole('menu')).toBeNull();
});
