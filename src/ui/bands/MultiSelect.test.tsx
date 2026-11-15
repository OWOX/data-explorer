import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MultiSelect } from './MultiSelect';

const options = [{ value: 'a', label: 'Alpha', count: 3 }, { value: 'b', label: 'Beta', count: 1200 }];
const mount = (selected: string[]) => {
  const onChange = vi.fn();
  render(<MultiSelect label="Storage" options={options} selected={selected} onChange={onChange} />);
  return onChange;
};

test('the summary says All, None, or how many are ticked', () => {
  const { unmount } = render(<MultiSelect label="Storage" options={options} selected={['a', 'b']} onChange={() => {}} />);
  expect(screen.getByText('All')).toBeInTheDocument();
  unmount();
  const none = render(<MultiSelect label="Storage" options={options} selected={[]} onChange={() => {}} />);
  expect(screen.getByText('None')).toBeInTheDocument();
  none.unmount();
  render(<MultiSelect label="Storage" options={options} selected={['b']} onChange={() => {}} />);
  expect(screen.getByText('1')).toBeInTheDocument();
});

test('rows show their label and count', () => {
  mount(['a', 'b']);
  expect(screen.getByText('Alpha')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
  expect(screen.getByText((1200).toLocaleString())).toBeInTheDocument();
});

test('unticking a ticked row removes it', async () => {
  const onChange = mount(['a', 'b']);
  await userEvent.click(screen.getByRole('checkbox', { name: /Alpha/ }));
  expect(onChange).toHaveBeenLastCalledWith(['b']);
});

test('ticking an unticked row adds it', async () => {
  const onChange = mount(['b']);
  await userEvent.click(screen.getByRole('checkbox', { name: /Alpha/ }));
  expect(onChange).toHaveBeenLastCalledWith(['b', 'a']);
});

test('Select all toggles between every option and none', async () => {
  const all = mount(['a', 'b']);
  await userEvent.click(screen.getByLabelText('Select all'));
  expect(all).toHaveBeenLastCalledWith([]);
});

test('Select all from a partial or empty menu ticks everything', async () => {
  const onChange = mount([]);
  await userEvent.click(screen.getByLabelText('Select all'));
  expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
});

test('only narrows to one option', async () => {
  const onChange = mount(['a', 'b']);
  await userEvent.click(screen.getByRole('button', { name: 'Only Beta' }));
  expect(onChange).toHaveBeenLastCalledWith(['b']);
});

test('Select all is indeterminate when only some rows are ticked', () => {
  const { unmount } = render(<MultiSelect label="Storage" options={options} selected={['a']} onChange={() => {}} />);
  expect((screen.getByLabelText('Select all') as HTMLInputElement).indeterminate).toBe(true);
  unmount();
  render(<MultiSelect label="Storage" options={options} selected={['a', 'b']} onChange={() => {}} />);
  const box = screen.getByLabelText('Select all') as HTMLInputElement;
  expect(box.indeterminate).toBe(false);
  expect(box.checked).toBe(true);
});

test('no options, no control', () => {
  const { container } = render(<MultiSelect label="Storage" options={[]} selected={[]} onChange={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});
