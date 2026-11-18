import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ActionForm } from './ActionForm';

function setup() {
  const onAction = vi.fn();
  const onSubmit = vi.fn();
  render(
    <div onSubmit={onSubmit}>
      <ActionForm onAction={onAction} role="search">
        <input aria-label="Value" />
        <textarea aria-label="Note" />
        <button type="button" onClick={onAction}>Apply</button>
      </ActionForm>
    </div>,
  );
  return { onAction, onSubmit };
}

test('Enter in an input and a click on Apply both run the action, with no submit event', async () => {
  const { onAction, onSubmit } = setup();
  await userEvent.type(screen.getByLabelText('Value'), 'x{Enter}');
  expect(onAction).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onAction).toHaveBeenCalledTimes(2);
  expect(onSubmit).not.toHaveBeenCalled();
});

test('Enter is ignored in a textarea, on a button, and during IME composition', async () => {
  const { onAction } = setup();
  await userEvent.type(screen.getByLabelText('Note'), '{Enter}');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Apply' }), { key: 'Enter' });
  fireEvent.keyDown(screen.getByLabelText('Value'), { key: 'Enter', isComposing: true });
  expect(onAction).not.toHaveBeenCalled();
});

test('an Enter a child already handled is left alone', () => {
  const onAction = vi.fn();
  render(<ActionForm onAction={onAction}><input aria-label="Value" onKeyDown={(e) => e.preventDefault()} /></ActionForm>);
  fireEvent.keyDown(screen.getByLabelText('Value'), { key: 'Enter' });
  expect(onAction).not.toHaveBeenCalled();
});
