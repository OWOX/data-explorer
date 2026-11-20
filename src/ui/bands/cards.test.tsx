import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Database } from 'lucide-react';
import { vi } from 'vitest';
import type { Mart, Source } from '../../model/types';
import { TooltipProvider } from '../Tooltip';
import { Band } from './Band';
import { MartCard, SourceCard, martElementId, sourceElementId } from './cards';

// The Contexts row is judged by comparing two widths; jsdom has no layout, so give the row room.
let restoreWidth: () => void = () => {};
const setRowWidth = (width: number) => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
};
beforeAll(() => {
  const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  restoreWidth = () => {
    if (own) Object.defineProperty(HTMLElement.prototype, 'clientWidth', own);
    else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  };
  setRowWidth(5000);
});
afterAll(() => restoreWidth());

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
    selected: false,
    lit: false,
    onSelect: vi.fn(),
    onOpenApp: vi.fn(),
    onRetryCount: vi.fn(),
    onNeedCount: vi.fn(),
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
    const { container } = render(<TooltipProvider><SourceCard source={source} selected={false} lit={false} onSelect={onSelect} /></TooltipProvider>);
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
    const { container } = render(<TooltipProvider><SourceCard source={{ ...source, logo: null, martIds: ['a'] }} selected lit onSelect={vi.fn()} /></TooltipProvider>);
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

  test('the open link and the (i) of a card sit in a reveal wrapper (shown by hover or focus of the card, still focusable)', () => {
    const { container } = renderMart();
    expect(screen.getByLabelText('Description').closest('.dm-card-reveal')).not.toBeNull();
    expect(screen.getByLabelText('Description').closest('article')).toBe(container.querySelector('article'));
  });

  test('title, id, tone, description hint, quality and freshness', () => {
    const { container } = renderMart();
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(container.querySelector('article')).toHaveAttribute('id', 'dm-m1');
    expect(container.querySelector('article')).toHaveAttribute('data-tone', 'ok');
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByLabelText('Passed')).toBeInTheDocument();
    expect(screen.getByLabelText(/Data updated/)).toBeInTheDocument();
  });

  test('no description, no hint', () => {
    renderMart({ mart: { ...mart, description: null } });
    expect(screen.queryByLabelText('Description')).toBeNull();
  });

  test('count states: value, spinner, dash with retry', async () => {
    const { rerender, props } = renderMart();
    expect(screen.getByText('12.4K records')).toBeInTheDocument();
    rerender(<TooltipProvider><MartCard {...props} count={{ state: 'loading' }} /></TooltipProvider>);
    expect(screen.getByLabelText('Counting records')).toBeInTheDocument();
    rerender(<TooltipProvider><MartCard {...props} count={{ state: 'error', message: 'nope' }} /></TooltipProvider>);
    await userEvent.click(screen.getByText('—'));
    expect(props.onRetryCount).toHaveBeenCalledTimes(1);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  test('a card waiting for its count shows a dash that says why', async () => {
    for (const state of ['idle', 'queued'] as const) {
      const { unmount } = renderMart({ count: { state } });
      const badge = screen.getByLabelText('Waiting to count records');
      expect(badge).toHaveTextContent('—');
      await userEvent.hover(badge);
      expect((await screen.findAllByText('Waiting to count records. Up to 4 data marts count at a time.')).length).toBeGreaterThan(0);
      unmount();
    }
  });

  test('a count that cannot be made shows a dash that says why', async () => {
    renderMart({ count: { state: 'ok', value: null } });
    await userEvent.hover(screen.getByText('—'));
    expect((await screen.findAllByText("Can't count records: this data mart has no primary key and no text or boolean field.")).length).toBeGreaterThan(0);
  });

  test('a ghost card and an inaccessible card show no count badge', () => {
    renderMart({ ghost: true, count: { state: 'idle' } });
    expect(screen.queryByText('—')).toBeNull();
    cleanup();
    renderMart({ mart: { ...mart, accessible: false }, count: { state: 'idle' } });
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.getByText('No access')).toBeInTheDocument();
  });

  test('a count of one is a record, not records', () => {
    renderMart({ count: { state: 'ok', value: 1 } });
    expect(screen.getByText('1 record')).toBeInTheDocument();
  });

  test('a quality state with no sentence of its own names itself once', () => {
    renderMart({ quality: undefined });
    expect(screen.getByLabelText('No data quality info')).toBeInTheDocument();
  });

  test('context chips name each context in the shared tooltip', async () => {
    renderMart({ contexts: [{ id: 'c1', name: 'Sales', icon: null }, { id: 'c2', name: 'Finance', icon: null }] });
    expect(screen.queryByTitle('Context: Sales')).toBeNull();
    await userEvent.hover(screen.getAllByText('Sales').at(-1)!);
    expect((await screen.findAllByText('Context: Sales')).length).toBeGreaterThan(0);
  });

  test('contexts that do not fit fold into one counted chip naming them all', () => {
    setRowWidth(0);
    try {
      renderMart({ contexts: [{ id: 'c1', name: 'Sales', icon: null }, { id: 'c2', name: 'Finance', icon: null }] });
      const chip = screen.getByLabelText('2 contexts');
      expect(chip).toHaveTextContent('2');
    } finally {
      setRowWidth(5000);
    }
  });

  test('a count error message that ends in a period is not doubled', async () => {
    renderMart({ count: { state: 'error', message: 'Query failed.' } });
    await userEvent.hover(screen.getByText('—'));
    expect((await screen.findAllByText('Query failed. Click to retry.')).length).toBeGreaterThan(0);
  });

  test('aside is carried onto the card next to lit', () => {
    const { container } = renderMart({ lit: true, aside: true });
    expect(container.querySelector('article')).toHaveClass('lit', 'aside');
  });

  test('the OWOX link is not on the card until the title bubble opens, then it opens the app and does not select', async () => {
    const { props } = renderMart();
    expect(screen.queryByLabelText('Open in OWOX')).toBeNull();
    await userEvent.hover(screen.getByText('Orders'));
    await userEvent.click(await screen.findByLabelText('Open in OWOX'));
    expect(props.onOpenApp).toHaveBeenCalledTimes(1);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  test('the keyboard twin of the link opens the app', async () => {
    const { props } = renderMart();
    await userEvent.click(screen.getByLabelText('Open Orders in OWOX'));
    expect(props.onOpenApp).toHaveBeenCalledTimes(1);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  test('the title bubble stays 500 ms after the pointer leaves the title, and while the pointer is on it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { container } = renderMart();
      const title = container.querySelector<HTMLElement>('.dm-node-title')!;
      await user.hover(title);
      expect(await screen.findByLabelText('Open in OWOX')).toBeInTheDocument();
      await user.unhover(title);
      // Radix judges the pointer's exit from the bubble's grace area on the next pointer move.
      fireEvent.pointerMove(document.body, { clientX: 900, clientY: 900 });
      act(() => { vi.advanceTimersByTime(400); });
      expect(screen.getByLabelText('Open in OWOX')).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(200); });
      await waitFor(() => expect(screen.queryByLabelText('Open in OWOX')).toBeNull());
      // Moving onto the bubble before the delay ends keeps it open.
      await user.hover(title);
      const link = await screen.findByLabelText('Open in OWOX');
      await user.unhover(title);
      fireEvent.pointerMove(link, { clientX: 5, clientY: 5 });
      await user.hover(link);
      act(() => { vi.advanceTimersByTime(1500); });
      expect(screen.getByLabelText('Open in OWOX')).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
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
    render(<TooltipProvider><Band id="band-data" icon={<Database />} title="Data marts" total={1200} hint="All of them" folded={folded} onFold={onFold}><p>cards</p></Band></TooltipProvider>);

  test('open: shows children, total and aria-expanded', () => {
    renderBand(false);
    expect(screen.getByText('cards')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide Data marts' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('folded: keeps children mounted but hidden; the chevron calls onFold', async () => {
    const onFold = vi.fn();
    renderBand(true, onFold);
    expect(screen.getByText('cards', { exact: true })).not.toBeVisible();
    expect(screen.queryByRole('paragraph')).toBeNull();
    const button = screen.getByRole('button', { name: 'Show Data marts' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    expect(onFold).toHaveBeenCalledTimes(1);
  });

  test('grid={false} renders children outside the card grid', () => {
    const { container } = render(<TooltipProvider><Band id="b" icon={<Database />} title="Row" hint="h" folded={false} onFold={vi.fn()} grid={false}><p>direct</p></Band></TooltipProvider>);
    expect(container.querySelector('.dm-band-grid')).toBeNull();
    expect(screen.getByText('direct')).toBeInTheDocument();
  });
});

describe('lazy count request', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('a card asks for its count only once it intersects the viewport, and only once', () => {
    let fire: (e: Partial<IntersectionObserverEntry>[]) => void = () => {};
    const observe = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: typeof fire) { fire = cb; }
      observe = observe;
      unobserve() {}
      disconnect() {}
    });
    const props = martProps();
    render(<TooltipProvider><MartCard {...props} /></TooltipProvider>);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(props.onNeedCount).not.toHaveBeenCalled();
    const target = observe.mock.calls[0]![0] as Element;
    fire([{ target, isIntersecting: false }]);
    expect(props.onNeedCount).not.toHaveBeenCalled();
    fire([{ target, isIntersecting: true }]);
    fire([{ target, isIntersecting: true }]);
    expect(props.onNeedCount).toHaveBeenCalledTimes(1);
  });

  test('the observer is rooted at the scrolling container, with the 200px margin', () => {
    const made: { root: Element | null; rootMargin: string }[] = [];
    vi.stubGlobal('IntersectionObserver', class {
      constructor(_cb: unknown, o: { root: Element | null; rootMargin: string }) { made.push(o); }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const props = martProps();
    const { container } = render(<div data-scroll-root=""><TooltipProvider><MartCard {...props} /></TooltipProvider></div>);
    expect(made).toHaveLength(1);
    expect(made[0]!.root).toBe(container.firstElementChild);
    expect(made[0]!.rootMargin).toBe('200px');
  });
});

describe('tooltips', () => {
  test('a hint opens the shared bubble in a portal on the body, outside the card', async () => {
    const { container } = renderMart();
    await userEvent.hover(screen.getByLabelText('Description'));
    const bubble = (await screen.findAllByText(mart.description!)).find((e) => e.classList.contains('dm-hint-body'))!;
    expect(bubble).toBeTruthy();
    expect(container.contains(bubble)).toBe(false);
    expect(bubble.closest('article')).toBeNull();
  });

  test('a status mark says its lines in the same bubble', async () => {
    renderMart();
    await userEvent.hover(screen.getByLabelText(/Data updated/));
    expect((await screen.findAllByText(/Data updated/)).some((e) => e.closest('.dm-hint-body'))).toBe(true);
  });
});
