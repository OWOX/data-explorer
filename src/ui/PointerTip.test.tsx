import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { PointerTip } from './Tooltip';

test('a line tip says its name only, and "More" on the next line opens the description below it', () => {
  render(<PointerTip text="Landing Page" more="The landing page as it lives now" x={100} y={100} />);
  const tip = screen.getByRole('tooltip');
  expect(tip).toHaveTextContent(/^Landing PageMore$/);
  expect(tip).not.toHaveTextContent('The landing page as it lives now');
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(tip).toHaveTextContent('The landing page as it lives now');
  expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
});

test('a line tip with nothing more has no link and lets the pointer through', () => {
  render(<PointerTip text="Customers" x={100} y={100} />);
  expect(screen.getByRole('tooltip')).toHaveTextContent(/^Customers$/);
  expect(screen.getByRole('tooltip')).not.toHaveClass('dm-tip-interactive');
  expect(screen.queryByRole('button')).toBeNull();
});
