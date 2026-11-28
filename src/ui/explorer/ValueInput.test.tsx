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

function Harness({ op = 'in', src, start = '' }: { op?: string; src: ValueSource; start?: string }) {
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
  expect(input().value).toBe('DE');
  expect(input()).toHaveFocus();
  await userEvent.click(await screen.findByRole('option', { name: 'US' }));
  expect(input().value).toBe('DE, US');
  expect(input()).toHaveFocus();
  expect(options()).toEqual(['FR']);
});

test('what is typed stays: a pick adds after it', async () => {
  render(<Harness src={source(loadOf(['US', 'DE']))} start="FR, " />);
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'US' }));
  expect(input().value).toBe('FR, US');
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
  expect(input().value).toBe('DE');
  await userEvent.keyboard('{ArrowUp}{Enter}');
  expect(input().value).toBe('DE, FR');
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
  expect(input().value).toBe('United States');
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
  expect(input().value).toBe('Ukraine, Germany');
  expect(input()).toHaveFocus();
  expect(op().value).toBe('in');
  expect(op().selectedOptions[0]!.textContent).toBe('is any of');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'country', op: 'in', value: 'Ukraine, Germany' });
});

test('under does not contain the second pick switches to is none of', async () => {
  form();
  await userEvent.selectOptions(op(), 'not_contains');
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'Ukraine' }));
  expect(op().value).toBe('not_contains');
  await userEvent.click(await screen.findByRole('option', { name: 'Germany' }));
  expect(op().value).toBe('not_in');
  expect(op().selectedOptions[0]!.textContent).toBe('is none of');
});

test('under contains a pick, some typing and another pick still make a list', async () => {
  form();
  await userEvent.selectOptions(op(), 'contains');
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'Ukraine' }));
  await userEvent.type(input(), ', Ger');
  expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Germany']);
  await userEvent.click(await screen.findByRole('option', { name: 'Germany' }));
  expect(input().value).toBe('Ukraine, Germany');
  expect(op().value).toBe('in');
});

test('a reopened contains filter: a pick adds to the saved value', async () => {
  render(<FilterEditor field={country} value={{ field: 'country', op: 'contains', value: 'Ukraine' }} onApply={vi.fn()} onClear={vi.fn()} values={source(loadOf(['United States', 'Ukraine', 'Germany']))} />);
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'Germany' }));
  expect(input().value).toBe('Ukraine, Germany');
  expect(op().value).toBe('in');
});

test('a reopened contains filter: typing a second value after the saved one keeps the suggestions', async () => {
  render(<FilterEditor field={country} value={{ field: 'country', op: 'contains', value: 'Ukraine' }} onApply={vi.fn()} onClear={vi.fn()} values={source(loadOf(['United States', 'Ukraine', 'Germany']))} />);
  await userEvent.click(input());
  await userEvent.type(input(), ', Ger');
  await userEvent.click(await screen.findByRole('option', { name: 'Germany' }));
  expect(op().value).toBe('in');
  expect(input().value).toBe('Ukraine, Germany');
});

const reopened = (v: string, onApply = vi.fn(), opId: 'contains' | 'not_contains' = 'contains', src = source(loadOf(['United States', 'Ukraine', 'Germany']))) => {
  render(<FilterEditor field={country} value={{ field: 'country', op: opId, value: v }} onApply={onApply} onClear={vi.fn()} values={src} />);
  return onApply;
};

test('a reopened contains fragment that is not a suggestion stays plain contains: a pick replaces it and is not a list', async () => {
  const onApply = reopened('Ukr');
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'Ukraine' }));
  expect(op().value).toBe('contains');
  expect(input().value).toBe('Ukraine');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'country', op: 'contains', value: 'Ukraine' });
});

test('a reopened contains value that is a suggestion: typing a second value and picking makes a list', async () => {
  reopened('Ukraine');
  await userEvent.click(input());
  await userEvent.type(input(), ', Ger');
  await userEvent.click(await screen.findByRole('option', { name: 'Germany' }));
  expect(op().value).toBe('in');
  expect(op().selectedOptions[0]!.textContent).toBe('is any of');
  expect(input().value).toBe('Ukraine, Germany');
});

test('a pick plus a typed second value: Apply sends the list form', async () => {
  const onApply = form();
  await userEvent.selectOptions(op(), 'contains');
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'Ukraine' }));
  await userEvent.type(input(), ', Germany');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'country', op: 'in', value: 'Ukraine, Germany' });
});

test('a pick plus a typed second value: Enter sends the list form', async () => {
  const onApply = form();
  await userEvent.selectOptions(op(), 'contains');
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'Ukraine' }));
  await userEvent.type(input(), ', Germany');
  await userEvent.keyboard('{Escape}{Enter}');
  expect(onApply).toHaveBeenCalledWith({ field: 'country', op: 'in', value: 'Ukraine, Germany' });
});

test('under does not contain a typed second value sends is none of', async () => {
  const onApply = form();
  await userEvent.selectOptions(op(), 'not_contains');
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'Ukraine' }));
  await userEvent.type(input(), ', Germany');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'country', op: 'not_in', value: 'Ukraine, Germany' });
});

test('a reopened suggestion plus a typed second value sends the list form', async () => {
  const onApply = reopened('Ukraine');
  await userEvent.click(input());
  await screen.findAllByRole('option');
  await userEvent.type(input(), ', Germany');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'country', op: 'in', value: 'Ukraine, Germany' });
});

test('typing before the suggestions load still seeds pick mode once they arrive', async () => {
  let done!: (v: string[]) => void;
  const onApply = reopened('Ukraine', vi.fn(), 'contains', source(() => new Promise<string[]>((r) => { done = r; })));
  await userEvent.click(input());
  await userEvent.type(input(), ', Germany');
  done(['United States', 'Ukraine', 'Germany']);
  await waitFor(() => expect(op().selectedOptions[0]!.textContent).toBe('is any of'));
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'country', op: 'in', value: 'Ukraine, Germany' });
});

test('the operator shows what Apply will send: "is any of" for two values, "contains" for one', async () => {
  form();
  await userEvent.selectOptions(op(), 'contains');
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'Ukraine' }));
  expect(op().selectedOptions[0]!.textContent).toBe('contains');
  await userEvent.type(input(), ', Germany');
  expect(op().selectedOptions[0]!.textContent).toBe('is any of');
});

test('a comma typed after a pick keeps pick mode and sends no trailing separator', async () => {
  const onApply = form();
  await userEvent.selectOptions(op(), 'contains');
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'Ukraine' }));
  await userEvent.type(input(), ',');
  expect(input().value).toBe('Ukraine,');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenLastCalledWith({ field: 'country', op: 'contains', value: 'Ukraine' });
  await userEvent.type(input(), ' Ger');
  await userEvent.click(await screen.findByRole('option', { name: 'Germany' }));
  expect(op().value).toBe('in');
});

test('spaces before the comma keep pick mode', async () => {
  form();
  await userEvent.selectOptions(op(), 'contains');
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'Ukraine' }));
  await userEvent.keyboard(' , Ger');
  expect(input().value).toBe('Ukraine , Ger');
  await userEvent.click(await screen.findByRole('option', { name: 'Germany' }));
  expect(op().value).toBe('in');
  expect(input().value).toBe('Ukraine, Germany');
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

test('the values of the loaded rows show at once, and the server values merge after them without duplicates', async () => {
  let done!: (v: string[]) => void;
  const src: ValueSource = { ...source(() => new Promise((r) => { done = r; })), loaded: ['US', 'DE'] };
  render(<Harness src={src} />);
  await userEvent.click(input());
  expect(options()).toEqual(['US', 'DE']);
  expect(screen.queryByRole('status')).toBeNull();
  done(['FR', 'DE', 'US']);
  await waitFor(() => expect(options()).toEqual(['US', 'DE', 'FR']));
});

test('loaded rows narrow by the typed text like server values do', async () => {
  const src: ValueSource = { ...source(loadOf([])), loaded: ['Spain', 'Sweden', 'Italy'] };
  render(<Harness src={src} />);
  await userEvent.click(input());
  await userEvent.type(input(), 'S');
  await waitFor(() => expect(options()).toEqual(['Spain', 'Sweden']));
});

test('without a read, the loaded rows are still offered, and there is no reload row', async () => {
  const src: ValueSource = { key: 'k', loaded: ['US'], cache: new Map() };
  render(<Harness src={src} />);
  await userEvent.click(input());
  expect(options()).toEqual(['US']);
  expect(screen.queryByRole('button', { name: /Reload values/ })).toBeNull();
});

test('values already in the cache are not read again, and Reload values drops them and reads once more', async () => {
  const load = vi.fn().mockResolvedValue(['US', 'DE']);
  const src = source(load);
  src.cache.set('k', ['US']);
  render(<Harness src={src} />);
  await userEvent.click(input());
  expect(load).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: /Reload values/ }));
  await waitFor(() => expect(options()).toEqual(['US', 'DE']));
  expect(load).toHaveBeenCalledTimes(1);
  expect(src.cache.get('k')).toEqual(['US', 'DE']);
  expect(input()).toHaveFocus();
});

test('the reload row is not shown while the values are still loading', async () => {
  const src: ValueSource = { ...source(() => new Promise(() => undefined)), loaded: ['US'] };
  render(<Harness src={src} />);
  await userEvent.click(input());
  expect(options()).toEqual(['US']);
  expect(screen.queryByRole('button', { name: /Reload values/ })).toBeNull();
});

test('typed text that matches no value keeps the panel open with a note and the reload row', async () => {
  const load = vi.fn().mockResolvedValueOnce(['US', 'DE']).mockResolvedValueOnce(['US', 'DE', 'ZA']);
  render(<Harness src={source(load)} />);
  await userEvent.click(input());
  await waitFor(() => expect(options()).toEqual(['US', 'DE']));
  await userEvent.type(input(), 'ZA');
  expect(options()).toEqual([]);
  expect(screen.getByRole('status')).toHaveTextContent('No matching values');
  await userEvent.click(screen.getByRole('button', { name: /Reload values/ }));
  // The reloaded values hold ZA: the typed text now narrows to it, so the note goes.
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  expect(options()).toEqual(['ZA']);
  expect(load).toHaveBeenCalledTimes(2);
});

test('an empty list from the server still offers the reload row', async () => {
  render(<Harness src={source(loadOf([]))} />);
  await userEvent.click(input());
  expect(await screen.findByText('No matching values')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Reload values/ })).toBeInTheDocument();
});

test('ArrowDown past the last option reaches the reload row, and Enter reloads', async () => {
  const load = vi.fn().mockResolvedValueOnce(['US', 'DE']).mockResolvedValueOnce(['US', 'DE', 'FR']);
  render(<Harness src={source(load)} />);
  await userEvent.click(input());
  await waitFor(() => expect(options()).toEqual(['US', 'DE']));
  await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
  const reload = screen.getByRole('button', { name: /Reload values/ });
  expect(reload).toHaveAttribute('data-hot');
  expect(input()).toHaveAttribute('aria-activedescendant', reload.id);
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(options()).toEqual(['US', 'DE', 'FR']));
  expect(load).toHaveBeenCalledTimes(2);
  expect(input().value).toBe('');
});

test('the reload row is reachable by keyboard when nothing matches', async () => {
  const load = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(['US']);
  render(<Harness src={source(load)} />);
  await userEvent.click(input());
  await screen.findByText('No matching values');
  await userEvent.keyboard('{ArrowDown}{Enter}');
  await waitFor(() => expect(options()).toEqual(['US']));
});

test('the panel closes once the typed text is a known value, and comes back when it matches nothing', async () => {
  render(<Harness op="starts_with" src={source(loadOf(['US', 'DE']))} />);
  await userEvent.click(input());
  await waitFor(() => expect(options()).toEqual(['US', 'DE']));
  await userEvent.type(input(), 'US');
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByRole('button', { name: /Reload values/ })).toBeNull();
  await userEvent.type(input(), 'X');
  expect(screen.getByRole('status')).toHaveTextContent('No matching values');
  expect(screen.getByRole('button', { name: /Reload values/ })).toBeInTheDocument();
});

test('a picked value in a single-value operator closes the panel', async () => {
  render(<Harness op="starts_with" src={source(loadOf(['US', 'DE']))} />);
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'US' }));
  expect(input().value).toBe('US');
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByRole('button', { name: /Reload values/ })).toBeNull();
});

test('in list mode the panel closes once every value is picked', async () => {
  render(<Harness op="in" src={source(loadOf(['US', 'DE']))} />);
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'US' }));
  expect(options()).toEqual(['DE']);
  await userEvent.click(screen.getByRole('option', { name: 'DE' }));
  expect(input().value).toBe('US, DE');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByRole('button', { name: /Reload values/ })).toBeNull();
  await userEvent.type(input(), ', ZZ');
  expect(screen.getByRole('status')).toHaveTextContent('No matching values');
});

test('Enter does not reload when the pointer, not the arrow keys, put the reload row under the cursor', async () => {
  const load = vi.fn().mockResolvedValue([]);
  const apply = vi.fn();
  render(<form onSubmit={(e) => { e.preventDefault(); apply(); }}><Harness src={source(load)} /></form>);
  await userEvent.click(input());
  const reload = await screen.findByRole('button', { name: /Reload values/ });
  await userEvent.hover(reload);
  expect(reload).toHaveAttribute('data-hot');
  await userEvent.keyboard('{Enter}');
  expect(load).toHaveBeenCalledTimes(1);
  expect(apply).toHaveBeenCalledTimes(1);
});

test('a reload is not repeated by a second Enter, nor by Enter after the input is left and refocused', async () => {
  const load = vi.fn().mockResolvedValue([]);
  render(<Harness src={source(load)} />);
  await userEvent.click(input());
  await screen.findByText('No matching values');
  await userEvent.keyboard('{ArrowDown}{Enter}');
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await userEvent.keyboard('{Enter}');
  expect(load).toHaveBeenCalledTimes(2);
  await userEvent.keyboard('{ArrowDown}');
  await userEvent.tab();
  await userEvent.tab({ shift: true });
  await userEvent.keyboard('{Enter}');
  expect(load).toHaveBeenCalledTimes(2);
});

test('the no-match note and Reload sit in the editor\'s flow next to the input, not in the floating panel', async () => {
  render(<Harness src={source(loadOf(['US', 'DE']))} />);
  await userEvent.click(input());
  await waitFor(() => expect(options()).toEqual(['US', 'DE']));
  expect(screen.getByRole('listbox').closest('.dm-suggest')).not.toBeNull();
  await userEvent.type(input(), 'ZZ');
  const note = screen.getByRole('status');
  expect(note).toHaveTextContent('No matching values');
  expect(note.closest('.dm-suggest')).toBeNull();
  expect(screen.getByRole('button', { name: /Reload values/ }).closest('.dm-suggest')).toBeNull();
  expect(input().parentElement).toContainElement(note);
});

test('in a list, typed text narrows by its last piece and the panel closes when nothing is left', async () => {
  render(<Harness op="in" src={source(loadOf(['paid', 'paid_late', 'open']))} />);
  await userEvent.click(input());
  await waitFor(() => expect(options()).toEqual(['paid', 'paid_late', 'open']));
  await userEvent.type(input(), 'paid');
  expect(options()).toEqual(['paid', 'paid_late']);
  await userEvent.type(input(), '_late, ');
  expect(options()).toEqual(['paid', 'open']);
  await userEvent.type(input(), 'paid, open, ');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
});

test('typing US with US and USA known and clicking USA gives USA', async () => {
  render(<Harness op="in" src={source(loadOf(['US', 'USA', 'DE']))} />);
  await userEvent.click(input());
  await screen.findAllByRole('option');
  await userEvent.type(input(), 'US');
  expect(options()).toEqual(['US', 'USA']);
  await userEvent.click(screen.getByRole('option', { name: 'USA' }));
  expect(input().value).toBe('USA');
});

test('a reopened "A, B" is finished: the next pick adds a third', async () => {
  render(<Harness op="in" start="US, DE" src={source(loadOf(['US', 'DE', 'FR']))} />);
  await userEvent.click(input());
  await waitFor(() => expect(options()).toEqual(['FR']));
  await userEvent.click(screen.getByRole('option', { name: 'FR' }));
  expect(input().value).toBe('US, DE, FR');
});

test('in a list the first pick has no comma, the second adds ", ", and a third is still offered', async () => {
  render(<Harness op="in" src={source(loadOf(['US', 'DE', 'FR']))} />);
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'US' }));
  expect(input().value).toBe('US');
  expect(options()).toEqual(['DE', 'FR']);
  await userEvent.click(screen.getByRole('option', { name: 'DE' }));
  expect(input().value).toBe('US, DE');
  expect(options()).toEqual(['FR']);
  await userEvent.click(screen.getByRole('option', { name: 'FR' }));
  expect(input().value).toBe('US, DE, FR');
});

test('is: a pick replaces the text and a comma stays in it', async () => {
  render(<Harness op="eq" src={source(loadOf(['US', 'DE']))} />);
  await userEvent.click(input());
  await userEvent.click(await screen.findByRole('option', { name: 'US' }));
  expect(input().value).toBe('US');
  await userEvent.type(input(), ', x');
  expect(input().value).toBe('US, x');
});

test('a slot of the same structure sits under the input whether idle, loading or with no match, focused or not', async () => {
  let done!: (v: string[]) => void;
  const { container } = render(<><Harness src={source(() => new Promise((r) => { done = r; }))} /><button>Apply</button></>);
  const slot = () => container.querySelectorAll('.dm-suggest-slot');
  const idle = slot()[0]!;
  expect(slot()).toHaveLength(1);
  expect(idle.parentElement).toBe(input().parentElement);
  await userEvent.click(input());
  expect(await screen.findByText('Loading values…')).toBeInTheDocument();
  expect(slot()).toHaveLength(1);
  expect(slot()[0]).toBe(idle);
  done(['US']);
  await userEvent.type(input(), 'ZZ');
  expect(screen.getByText('No matching values').closest('.dm-suggest-slot')).toBe(idle);
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(slot()[0]).toBe(idle);
  expect(screen.getByText('No matching values')).toBeInTheDocument();
});

test('in a list a typed word that differs only by case still offers the value that fixes it', async () => {
  render(<Harness op="eq" src={source(loadOf(['paid', 'open']))} />);
  await userEvent.click(input());
  await userEvent.type(input(), 'Paid');
  expect(options()).toEqual(['paid']);
});

test('the first read asks for a kept answer, a reload asks for a fresh one', async () => {
  const load = vi.fn((...args: [AbortSignal, boolean]) => { void args; return Promise.resolve(['US']); });
  render(<Harness src={source(load)} />);
  await userEvent.click(input());
  await waitFor(() => expect(options()).toEqual(['US']));
  expect(load.mock.calls[0]![1]).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: /Reload values/ }));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  expect(load.mock.calls[1]![1]).toBe(true);
});
