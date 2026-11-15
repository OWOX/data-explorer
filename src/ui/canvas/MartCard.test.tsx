import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MartCardView } from './MartCard';
import type { CardData } from './MartCard';

const base: CardData = {
  mart: { id: 'o', title: 'Orders', description: 'All orders', icon: 'orders', storageId: 's', contextIds: ['c1'], dataLastUpdatedAt: '2026-11-14T10:00:00Z', accessible: true },
  contexts: [{ id: 'c1', name: 'Sales', icon: 'revenue' }],
  count: { state: 'ok', value: 12400 },
  dq: { state: 'PASSED' },
  selected: false,
  onOpenApp: vi.fn(),
  onRetryCount: vi.fn(),
};

test('shows title, count badge, context chip, DQ and freshness labels', () => {
  render(<MartCardView data={base} />);
  expect(screen.getByText('Orders')).toBeInTheDocument();
  expect(screen.getByText('12.4K')).toBeInTheDocument();
  expect(screen.getByText('Sales')).toBeInTheDocument();
  expect(screen.getByLabelText('Data quality: Passed')).toBeInTheDocument();
  expect(screen.getByLabelText(/Data updated/)).toBeInTheDocument();
  expect(screen.getByLabelText('Description')).toBeInTheDocument();
});

test('the app link calls onOpenApp and does not bubble to the card', async () => {
  const onCardClick = vi.fn();
  render(<div onClick={onCardClick}><MartCardView data={base} /></div>);
  await userEvent.click(screen.getByLabelText('Open in OWOX'));
  expect(base.onOpenApp).toHaveBeenCalled();
  expect(onCardClick).not.toHaveBeenCalled();
});

test('no description, no (i); loading count shows a spinner; error shows a dash', () => {
  const { rerender } = render(<MartCardView data={{ ...base, mart: { ...base.mart, description: null }, count: { state: 'loading' } }} />);
  expect(screen.queryByLabelText('Description')).toBeNull();
  expect(screen.getByLabelText('Counting rows')).toBeInTheDocument();
  rerender(<MartCardView data={{ ...base, count: { state: 'error', message: 'nope' } }} />);
  expect(screen.getByText('—')).toBeInTheDocument();
});

test('an inaccessible mart renders muted with a no-access label', () => {
  render(<MartCardView data={{ ...base, mart: { ...base.mart, accessible: false } }} />);
  expect(screen.getByText('No access')).toBeInTheDocument();
});

test('a field hit is shown', () => {
  render(<MartCardView data={{ ...base, fieldHit: 'customer_id' }} />);
  expect(screen.getByText('customer_id')).toBeInTheDocument();
});
