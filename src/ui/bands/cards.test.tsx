import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Database } from 'lucide-react';
import { vi } from 'vitest';
import type { Mart, Source } from '../../model/types';
import { TooltipProvider } from '../Tooltip';
import { Band } from './Band';
import { MartCard, SourceCard, martElementId, sourceElementId } from './cards';

// The Contexts row is judged by comparing two widths; jsdom has no layout, so give the row room.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 5000 });
});

const mart: Mart = {
  id: 'm1', title: 'Orders', description: 'All orders', icon: null, storageId: 's',
  contextIds: [], dataLastUpdatedAt: '2026-11-14T10:00:00Z', accessible: true, sourceKey: null,
};

function martProps(over: Partial<React.ComponentProps<typeof MartCard>> = {}) {
  return {
    mart,
    contexts: [],
    count: { state: 'ok', value: 12400 } as const,
    quality: { state: 'PASSED' },
    freshness: mart.dataLastUpdatedAt,
    fieldHit: undefined,
    selected: false,
    lit: false,
    onSelect: vi.fn(),
    onOpenApp: vi.fn(),
    onRetryCount: vi.fn(),
    ...over,
  };
}
const renderMart = (over?: Partial<React.ComponentProps<typeof MartCard>>) => {
  const props = martProps(over);
  return { props, ...render(<TooltipProvider><MartCard {...props} /></TooltipProvider>) };
};

describe('SourceCard', () => {
  const source: Source = { key: 'Facebook Ads', name: 'Facebook Ads', logo: 'data:image/png;base64,AAAA', martIds: ['a', 'b', 'c'] };

  test('shows the name, the mart count and a logo; selects on click and Enter', async () => {
    const onSelect = vi.fn();
    const { container } = render(<SourceCard source={source} selected={false} lit={false} onSelect={onSelect} />);
    expect(screen.getByText('Facebook Ads')).toBeInTheDocument();
    expect(screen.getByText('3 data marts')).toBeInTheDocument();
    expect(container.querySelector('img.dm-logo')).toHaveAttribute('src', source.logo);
    expect(container.querySelector('article')).toHaveAttribute('id', 'src-facebook-ads');
    await userEvent.click(screen.getByText('Facebook Ads'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    screen.getByRole('article').focus();
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  test('without a logo it draws the plug glyph; one mart is singular', () => {
    const { container } = render(<SourceCard source={{ ...source, logo: null, martIds: ['a'] }} selected lit onSelect={vi.fn()} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('span.dm-logo svg')).not.toBeNull();
    expect(screen.getByText('1 data mart')).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('article')).toHaveClass('lit');
  });

  test('element ids are sanitised the way Data Flow does', () => {
    expect(sourceElementId('Google  Ads/v2')).toBe('src-google-ads-v2');
    expect(martElementId('abc-1')).toBe('dm-abc-1');
  });
});

describe('MartCard', () => {
  test('draws the picked icon only when one is set', () => {
    const { container, rerender, props } = renderMart();
    expect(container.querySelector('.dm-logo')).toBeNull();
    rerender(<TooltipProvider><MartCard {...props} mart={{ ...mart, icon: 'orders' }} /></TooltipProvider>);
    expect(container.querySelector('.dm-logo svg')).not.toBeNull();
  });

  test('title, id, tone, description hint, quality and freshness', () => {
    const { container } = renderMart();
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(container.querySelector('article')).toHaveAttribute('id', 'dm-m1');
    expect(container.querySelector('article')).toHaveAttribute('data-tone', 'ok');
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByLabelText('Data quality: Passed')).toBeInTheDocument();
    expect(screen.getByLabelText(/Data updated/)).toBeInTheDocument();
  });

  test('no description, no hint', () => {
    renderMart({ mart: { ...mart, description: null } });
    expect(screen.queryByLabelText('Description')).toBeNull();
  });

  test('count states: value, spinner, dash with retry', async () => {
    const { rerender, props } = renderMart();
    expect(screen.getByText('12.4K')).toBeInTheDocument();
    rerender(<TooltipProvider><MartCard {...props} count={{ state: 'loading' }} /></TooltipProvider>);
    expect(screen.getByLabelText('Counting rows')).toBeInTheDocument();
    rerender(<TooltipProvider><MartCard {...props} count={{ state: 'error', message: 'nope' }} /></TooltipProvider>);
    await userEvent.click(screen.getByText('—'));
    expect(props.onRetryCount).toHaveBeenCalledTimes(1);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  test('shows the field hit as a badge', () => {
    renderMart({ fieldHit: 'customer_id' });
    expect(screen.getByText('customer_id')).toBeInTheDocument();
  });

  test('context chips name each context', () => {
    renderMart({ contexts: [{ id: 'c1', name: 'Sales', icon: null }, { id: 'c2', name: 'Finance', icon: null }] });
    expect(screen.getAllByTitle('Context: Sales').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('Context: Finance').length).toBeGreaterThan(0);
  });

  test('the OWOX link opens the app and does not select', async () => {
    const { props } = renderMart();
    await userEvent.click(screen.getByLabelText('Open in OWOX'));
    expect(props.onOpenApp).toHaveBeenCalledTimes(1);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  test('click and Enter select', async () => {
    const { props } = renderMart();
    await userEvent.click(screen.getByText('Orders'));
    screen.getByRole('article').focus();
    await userEvent.keyboard('{Enter}');
    expect(props.onSelect).toHaveBeenCalledTimes(2);
  });

  test('an inaccessible mart is muted and says so', () => {
    const { container } = renderMart({ mart: { ...mart, accessible: false } });
    expect(screen.getByText('No access')).toBeInTheDocument();
    expect(container.querySelector('article')).toHaveClass('dm-noaccess');
  });
});

describe('Band', () => {
  const renderBand = (folded: boolean, onFold = vi.fn()) =>
    render(<Band id="band-data" icon={Database} title="Data marts" total={1200} hint="All of them" folded={folded} onFold={onFold}><p>cards</p></Band>);

  test('open: shows children, total and aria-expanded', () => {
    renderBand(false);
    expect(screen.getByText('cards')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide Data marts' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('folded: hides children; the chevron calls onFold', async () => {
    const onFold = vi.fn();
    renderBand(true, onFold);
    expect(screen.queryByText('cards')).toBeNull();
    const button = screen.getByRole('button', { name: 'Show Data marts' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    expect(onFold).toHaveBeenCalledTimes(1);
  });

  test('grid={false} renders children outside the card grid; loading shows a bar', () => {
    const { container, rerender } = render(<Band id="b" icon={Database} title="Row" hint="h" folded={false} onFold={vi.fn()} grid={false}><p>direct</p></Band>);
    expect(container.querySelector('.dm-band-grid')).toBeNull();
    expect(screen.getByText('direct')).toBeInTheDocument();
    rerender(<Band id="b" icon={Database} title="Row" hint="h" folded={false} onFold={vi.fn()} loading={0.5}><p>direct</p></Band>);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.queryByText('direct')).toBeNull();
  });
});
