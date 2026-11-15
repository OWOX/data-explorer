import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { TooltipProvider } from '../Tooltip';
import { MartCardView as Card } from './MartCard';
import type { CardData } from './MartCard';

const MartCardView = (p: { data: CardData }) => <TooltipProvider><Card {...p} /></TooltipProvider>;

const base: CardData = {
  mart: { id: 'o', title: 'Orders', description: 'All orders', icon: 'orders', storageId: 's', contextIds: ['c1'], dataLastUpdatedAt: '2026-11-14T10:00:00Z', accessible: true, sourceKey: null },
  count: { state: 'ok', value: 12400 },
  dq: { state: 'PASSED' },
  selected: false,
  onOpenApp: vi.fn(),
  onRetryCount: vi.fn(),
};

test('shows title, count badge, DQ and freshness labels; contexts are not on the card', () => {
  render(<MartCardView data={base} />);
  expect(screen.getByText('Orders')).toBeInTheDocument();
  expect(screen.getByText('12.4K')).toBeInTheDocument();
  expect(screen.queryByText('Sales')).toBeNull();
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

test('no freshness icon when the update time is unknown', () => {
  render(<MartCardView data={{ ...base, mart: { ...base.mart, dataLastUpdatedAt: null } }} />);
  expect(screen.queryByLabelText(/Data updated/)).toBeNull();
});

test('the card carries the data quality tone and a pressed state when selected', () => {
  const { container, rerender } = render(<MartCardView data={base} />);
  const card = container.querySelector('.dm-node')!;
  expect(card).toHaveAttribute('data-tone', 'ok');
  expect(card).toHaveAttribute('aria-pressed', 'false');
  rerender(<MartCardView data={{ ...base, selected: true, dq: { state: 'EXECUTION_FAILED' } }} />);
  expect(container.querySelector('.dm-node')).toHaveAttribute('data-tone', 'bad');
  expect(container.querySelector('.dm-node')).toHaveAttribute('aria-pressed', 'true');
});

test('the external link sits immediately before the description icon', () => {
  render(<MartCardView data={base} />);
  const link = screen.getByLabelText('Open in OWOX');
  expect(link.nextElementSibling).toBe(screen.getByLabelText('Description'));
});
