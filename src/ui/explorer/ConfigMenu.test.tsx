import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { Hash, Plus } from 'lucide-react';
import { vi } from 'vitest';
import type { Field } from '../../model/types';
import type { MenuItem } from '../../charts/ChartMenu';
import { ConfigMenu, type ConfigMart } from './ConfigMenu';

afterEach(cleanup);

const f = (name: string, description?: string) => ({ name, type: 'STRING', category: 'string', description }) as Field;
const mart = (path: string, title: string, names: string[], extra: Partial<ConfigMart> = {}): ConfigMart => ({
  path, title, main: path === '', fields: names.map((n) => f(n)), locked: () => false, ...extra,
});
const ORDERS = ['id', 'name', 'city'];
const CUSTOMERS = ['customers__email', 'customers__tier'];
const REGIONS = ['regions__code', 'regions__zone'];
const PRODUCTS = ['products__sku', 'products__price'];
const SUPPLIERS = ['suppliers__name', 'suppliers__country'];

type Setup = { visible?: string[]; chartItems?: MenuItem[]; onRemove?: () => void; spy?: (cols: string[]) => void; strict?: boolean };
/** The menu with a grid behind it: `onChange` feeds `visible`, and the data marts with a column are the ones in `marts`. */
function Harness({ visible: start = ['id', 'customers__email'], chartItems, onRemove, spy }: Setup) {
  const [visible, setVisible] = useState(start);
  const all: ConfigMart[] = [
    mart('', 'Orders', ORDERS),
    mart('customers', 'Customers', CUSTOMERS, { description: 'Who bought', remove: { onRemove: onRemove ?? (() => undefined) }, unique: { on: false, onToggle: () => undefined } }),
    mart('regions', 'Regions', REGIONS),
    mart('products', 'Products', PRODUCTS),
    mart('products.suppliers', 'Suppliers', SUPPLIERS),
  ];
  const has = (m: ConfigMart) => m.fields.some((x) => visible.includes(x.name));
  const shown = all.filter((m) => m.main || has(m));
  const marts = [...shown, ...all.filter((m) => m.path === 'regions' && !shown.includes(m))];
  const under: Record<string, string[]> = { '': ['products'], products: ['products.suppliers'] };
  const joinable = (path: string) => (under[path] ?? []).map((p) => all.find((m) => m.path === p)!).filter((m) => !marts.includes(m));
  return (
    <TooltipProvider>
      <ConfigMenu marts={marts} joinable={joinable} visible={visible} chartItems={chartItems}
        onChange={(cols) => { spy?.(cols); setVisible(cols); }} />
      <output data-testid="visible">{visible.join(',')}</output>
    </TooltipProvider>
  );
}
const setup = (p: Setup = {}) => render(p.strict ? <StrictMode><Harness {...p} /></StrictMode> : <Harness {...p} />);
const openMenu = async () => { await userEvent.click(screen.getByRole('button', { name: 'Configure data' })); return screen.findByRole('menu', { name: 'Configure data' }); };
const openRow = async (name: string, inside: HTMLElement) => {
  await userEvent.click(within(inside).getByRole('menuitem', { name }));
  return screen.findByRole('dialog', { name });
};
const visibleNow = () => screen.getByTestId('visible').textContent;

describe('the button', () => {
  test('is a Settings button with the config marker, closed until clicked', async () => {
    setup();
    const b = screen.getByRole('button', { name: 'Configure data' });
    expect(b).toHaveAttribute('data-config-button');
    expect(b).toHaveClass('dm-menu-dots');
    expect(b).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
    await openMenu();
    expect(b).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('the rows', () => {
  test('list the shown data marts first, then the ones on a path with no column, with a separator between', async () => {
    setup();
    const menu = await openMenu();
    expect(within(menu).getAllByRole('menuitem').map((r) => r.textContent)).toEqual(['Orders', 'Customers', 'Regions']);
    const seps = menu.querySelectorAll('[role="separator"]');
    expect(seps).toHaveLength(1);
    expect(seps[0]!.previousElementSibling).toBe(within(menu).getByRole('menuitem', { name: 'Customers' }));
  });

  test('every data mart has its icon before its label, and a (?) only when it has a description', async () => {
    setup();
    const menu = await openMenu();
    for (const row of within(menu).getAllByRole('menuitem')) {
      const glyph = row.querySelector('.dm-menu-glyph svg');
      const label = row.querySelector('.dm-menu-label')!;
      expect(glyph).not.toBeNull();
      expect(glyph!.closest('.dm-menu-glyph')!.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    const customers = within(menu).getByRole('menuitem', { name: 'Customers' });
    expect(customers.querySelector('.dm-hint-slot')).not.toBeNull();
    expect(customers).toHaveAttribute('aria-description', 'Who bought');
    expect(customers.querySelector('[aria-hidden="true"][aria-label="About Customers"]')).not.toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Orders' }).querySelector('.dm-hint-slot')).toBeNull();
  });

  test('chart items come first, then a separator, and only when they are passed', async () => {
    const pick = vi.fn();
    const items: MenuItem[] = [{ kind: 'radio', label: 'Add chart', icon: Plus, value: '', options: [{ value: 'bar', label: 'Bar' }], onPick: pick }];
    setup({ chartItems: items });
    const menu = await openMenu();
    expect(within(menu).getAllByRole('menuitem').map((r) => r.textContent)).toEqual(['Add chart', 'Orders', 'Customers', 'Regions']);
    expect(within(menu).getAllByRole('menuitem')[0]!.nextElementSibling).toHaveAttribute('role', 'separator');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Add chart' }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Bar' }));
    expect(pick).toHaveBeenCalledWith('bar');
    expect(screen.queryByRole('menu')).toBeNull();
    cleanup();
    setup();
    expect(within(await openMenu()).queryByRole('menuitem', { name: 'Add chart' })).toBeNull();
  });

  test('a group row opens a submenu of rows, and its check rows keep the menu open', async () => {
    const toggle = vi.fn();
    const items: MenuItem[] = [{ kind: 'group', label: 'Charts', icon: Hash, items: [{ kind: 'check', label: 'Sparklines', icon: Hash, checked: true, onToggle: toggle }] }];
    setup({ chartItems: items });
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Charts' }));
    const tick = await screen.findByRole('menuitemcheckbox', { name: 'Sparklines' });
    expect(tick).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(tick);
    expect(toggle).toHaveBeenCalledOnce();
    expect(screen.getByRole('menu', { name: 'Configure data' })).toBeInTheDocument();
    expect(screen.getByRole('menu', { name: 'Charts' })).toBeInTheDocument();
  });
});

describe('a data mart panel', () => {
  test('lists the shown fields first in the grid order, then the rest in schema order, and a tick never moves a row', async () => {
    setup({ visible: ['city', 'customers__email'] });
    const menu = await openMenu();
    const panel = await openRow('Orders', menu);
    const names = () => within(panel).getAllByRole('option').map((o) => o.getAttribute('aria-label'));
    expect(names()).toEqual(['city', 'id', 'name']);
    await userEvent.click(within(panel).getByLabelText('name'));
    expect(names()).toEqual(['city', 'id', 'name']);
  });

  test('ticking a field of the main mart keeps the schema order', async () => {
    const spy = vi.fn();
    setup({ visible: ['city', 'customers__email'], spy });
    await openRow('Orders', await openMenu());
    await userEvent.click(screen.getByLabelText('id'));
    expect(spy).toHaveBeenLastCalledWith(['id', 'city', 'customers__email']);
  });

  test('ticking a field of a joined mart puts it last', async () => {
    const spy = vi.fn();
    setup({ spy });
    await openRow('Customers', await openMenu());
    await userEvent.click(screen.getByLabelText('customers__tier'));
    expect(spy).toHaveBeenLastCalledWith(['id', 'customers__email', 'customers__tier']);
  });

  test('ticking a field of a mart on a path with no column adds the column', async () => {
    const spy = vi.fn();
    setup({ spy });
    await openRow('Regions', await openMenu());
    await userEvent.click(screen.getByLabelText('regions__zone'));
    expect(spy).toHaveBeenLastCalledWith(['id', 'customers__email', 'regions__zone']);
  });

  test('a joinable mart is listed under a heading, and ticking its field joins it', async () => {
    const spy = vi.fn();
    setup({ spy });
    const orders = await openRow('Orders', await openMenu());
    expect(within(orders).getByText('Joinable Data Marts')).toBeInTheDocument();
    const products = await openRow('Products', orders);
    await userEvent.click(within(products).getByLabelText('products__price'));
    expect(spy).toHaveBeenLastCalledWith(['id', 'customers__email', 'products__price']);
  });

  test('the row and its panel stay where they were after the mart moves into the report', async () => {
    setup();
    const menu = await openMenu();
    const orders = await openRow('Orders', menu);
    const products = await openRow('Products', orders);
    await userEvent.click(within(products).getByLabelText('products__price'));
    expect(visibleNow()).toContain('products__price');
    expect(screen.getByRole('dialog', { name: 'Products' })).toBe(products);
    expect(within(orders).getByRole('menuitem', { name: 'Products' })).toBeInTheDocument();
    expect(within(menu).getAllByRole('menuitem').map((r) => r.textContent)).toEqual(['Orders', 'Customers', 'Regions']);
    // Its fields are live: the tick shows.
    expect(within(products).getByRole('option', { name: 'products__price' })).toHaveAttribute('aria-selected', 'true');
  });

  test('a joinable mart lists its own joinable marts', async () => {
    const spy = vi.fn();
    setup({ spy });
    const orders = await openRow('Orders', await openMenu());
    const products = await openRow('Products', orders);
    const suppliers = await openRow('Suppliers', products);
    await userEvent.click(within(suppliers).getByLabelText('suppliers__name'));
    expect(spy).toHaveBeenLastCalledWith(['id', 'customers__email', 'suppliers__name']);
  });

  test('has no heading when nothing is joinable', async () => {
    setup();
    const customers = await openRow('Customers', await openMenu());
    expect(within(customers).queryByText('Joinable Data Marts')).toBeNull();
  });

  test('has the Unique Count lead row on top', async () => {
    setup();
    const customers = await openRow('Customers', await openMenu());
    expect(within(customers).getAllByRole('option')[0]).toHaveAttribute('aria-label', 'Unique Count');
  });

  test('never leaves the grid with no column', async () => {
    const spy = vi.fn();
    setup({ visible: ['id'], spy });
    await openRow('Orders', await openMenu());
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(spy).not.toHaveBeenCalled();
    expect(visibleNow()).toBe('id');
  });

  test('unticking the last field of a joined mart commits when the panel closes, not before', async () => {
    const spy = vi.fn();
    setup({ spy });
    const panel = await openRow('Customers', await openMenu());
    await userEvent.click(within(panel).getByLabelText('customers__email'));
    expect(spy).not.toHaveBeenCalled();
    expect(within(panel).getByRole('option', { name: 'customers__email' })).toHaveAttribute('aria-selected', 'false');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Customers' })).toBeNull();
    expect(spy).toHaveBeenCalledOnce();
    expect(visibleNow()).toBe('id');
  });

  test('a new tick after the last one went keeps the mart, with no commit on close', async () => {
    const spy = vi.fn();
    setup({ spy });
    const panel = await openRow('Customers', await openMenu());
    await userEvent.click(within(panel).getByLabelText('customers__email'));
    await userEvent.click(within(panel).getByLabelText('customers__tier'));
    expect(spy).toHaveBeenCalledOnce();
    expect(visibleNow()).toBe('id,customers__tier');
    await userEvent.keyboard('{Escape}');
    expect(spy).toHaveBeenCalledOnce();
  });

  test('a mart with nothing shown leaves nothing pending, and StrictMode commits nothing on mount', async () => {
    const spy = vi.fn();
    setup({ spy, strict: true });
    await openRow('Regions', await openMenu());
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await userEvent.keyboard('{Escape}');
    expect(spy).not.toHaveBeenCalled();
  });

  test('Remove from report runs and closes the menu', async () => {
    const onRemove = vi.fn();
    setup({ onRemove });
    const panel = await openRow('Customers', await openMenu());
    expect(within(panel).getAllByRole('menuitem').at(-1)).toHaveAccessibleName('Remove from report');
    await userEvent.click(within(panel).getByRole('menuitem', { name: 'Remove from report' }));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('has no Remove row when the mart cannot be removed', async () => {
    setup();
    const panel = await openRow('Orders', await openMenu());
    expect(within(panel).queryByRole('menuitem', { name: 'Remove from report' })).toBeNull();
  });
});

describe('dismissal', () => {
  test('Escape closes the deepest panel first, then the menu', async () => {
    setup();
    const orders = await openRow('Orders', await openMenu());
    const products = await openRow('Products', orders);
    await openRow('Suppliers', products);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Suppliers' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Products' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Products' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Orders' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('menu', { name: 'Configure data' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Configure data' })).toHaveFocus();
  });

  test('a press outside closes everything, and a press in a panel does not', async () => {
    setup();
    const orders = await openRow('Orders', await openMenu());
    fireEvent.pointerDown(within(orders).getByRole('listbox'));
    expect(screen.getByRole('menu', { name: 'Configure data' })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a scroll of what holds the button closes everything', async () => {
    setup();
    await openMenu();
    fireEvent.scroll(document);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test("a field's column menu opens, takes Escape and takes a press without closing the config menu", async () => {
    setup();
    const orders = await openRow('Orders', await openMenu());
    await userEvent.click(within(orders).getAllByRole('button', { name: 'Column menu id' })[0]!);
    const column = await screen.findByRole('menu', { name: 'Menu of id' });
    fireEvent.pointerDown(column);
    expect(screen.getByRole('dialog', { name: 'Orders' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Menu of id' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Orders' })).toBeInTheDocument();
    expect(screen.getByRole('menu', { name: 'Configure data' })).toBeInTheDocument();
  });
});

describe('the keyboard', () => {
  test('Right opens a mart panel and Left closes it', async () => {
    setup();
    const menu = await openMenu();
    const row = within(menu).getByRole('menuitem', { name: 'Orders' });
    row.focus();
    await userEvent.keyboard('{ArrowRight}');
    const panel = await screen.findByRole('dialog', { name: 'Orders' });
    expect(panel.contains(document.activeElement)).toBe(true);
    // From a field row.
    within(panel).getByRole('option', { name: 'id' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(row).toHaveFocus();
  });

  test('Left on a joinable row closes the deepest panel', async () => {
    setup();
    const orders = await openRow('Orders', await openMenu());
    const row = within(orders).getByRole('menuitem', { name: 'Products' });
    row.focus();
    await userEvent.keyboard('{ArrowRight}');
    const products = await screen.findByRole('dialog', { name: 'Products' });
    within(products).getByRole('menuitem', { name: 'Suppliers' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.queryByRole('dialog', { name: 'Products' })).toBeNull();
    expect(row).toHaveFocus();
  });

  test('the joinable rows and Remove are Tab stops of the panel', async () => {
    setup();
    const menu = await openMenu();
    const customers = await openRow('Customers', menu);
    expect(within(customers).getByRole('menuitem', { name: 'Remove from report' })).toHaveAttribute('tabindex', '0');
    const orders = await openRow('Orders', menu);
    expect(within(orders).getByRole('menuitem', { name: 'Products' })).toHaveAttribute('tabindex', '0');
  });

  test('arrows move through the rows of the menu', async () => {
    setup();
    const menu = await openMenu();
    const rows = within(menu).getAllByRole('menuitem');
    rows[0]!.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(rows[1]).toHaveFocus();
  });
});

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

test('a hover on another mart waits while the search box of the open panel holds focus', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    setup();
    const menu = await openMenu();
    const customers = within(menu).getByRole('menuitem', { name: 'Customers' });
    fireEvent.mouseEnter(customers);
    await advance(10);
    const panel = screen.getByRole('dialog', { name: 'Customers' });
    const box = document.createElement('input');
    panel.appendChild(box);
    box.focus();
    fireEvent.mouseEnter(within(menu).getByRole('menuitem', { name: 'Regions' }));
    await advance(400);
    expect(screen.getByRole('dialog', { name: 'Customers' })).toBeInTheDocument();
    box.blur();
    fireEvent.mouseEnter(within(menu).getByRole('menuitem', { name: 'Orders' }));
    await advance(400);
    expect(screen.queryByRole('dialog', { name: 'Customers' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Orders' })).toBeInTheDocument();
  } finally { vi.useRealTimers(); }
});
