import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { Hash, Plus } from 'lucide-react';
import { vi } from 'vitest';
import type { Field } from '../../model/types';
import type { MenuItem } from '../../charts/ChartMenu';
import { ConfigMenu, type ConfigMart } from './ConfigMenu';
import { HOVER_MS } from './MenuParts';

afterEach(cleanup);

const f = (name: string, description?: string) => ({ name, type: 'STRING', category: 'string', description }) as Field;
const mart = (path: string, title: string, names: string[], extra: Partial<ConfigMart> = {}): ConfigMart => ({
  path, title, main: path === '', shown: false, fields: names.map((n) => f(n)), locked: () => false, ...extra,
});
const ORDERS = ['id', 'name', 'city'];
const CUSTOMERS = ['customers__email', 'customers__tier'];
const REGIONS = ['regions__code', 'regions__zone'];
const PRODUCTS = ['products__sku', 'products__price', 'products__a', 'products__b', 'products__c', 'products__d', 'products__e', 'products__f'];
const SUPPLIERS = ['suppliers__name', 'suppliers__country'];

type Setup = { visible?: string[]; chartItems?: MenuItem[]; onRemove?: () => void; spy?: (cols: string[]) => void; strict?: boolean; unique?: boolean };
/** The menu with a grid behind it: `onChange` feeds `visible`, and the data marts with a column are the ones in `marts`. */
function Harness({ visible: start = ['id', 'customers__email'], chartItems, onRemove, spy, unique = false }: Setup) {
  const [visible, setVisible] = useState(start);
  const [uniqueOn, setUniqueOn] = useState(unique);
  const has = (m: ConfigMart) => m.fields.some((x) => visible.includes(x.name));
  const remove = { onRemove: onRemove ?? (() => undefined) };
  const base: ConfigMart[] = [
    mart('', 'Orders', ORDERS),
    mart('customers', 'Customers', CUSTOMERS, { description: 'Who bought', unique: { on: uniqueOn, onToggle: () => setUniqueOn((v) => !v) } }),
    mart('regions', 'Regions', REGIONS),
    mart('products', 'Products', PRODUCTS),
    mart('products.suppliers', 'Suppliers', SUPPLIERS),
  ];
  const all = base.map((m) => ({ ...m, shown: m.main || has(m) || !!m.unique?.on, remove: has(m) && (m.path === 'customers' || m.path === 'products') ? remove : undefined }));
  const shown = all.filter((m) => m.shown);
  const marts = [...shown, ...all.filter((m) => m.path === 'regions' && !shown.includes(m))];
  const under: Record<string, string[]> = { '': ['products', 'customers'], products: ['products.suppliers'] };
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
  test('is a labelled button with the config marker, closed until clicked', async () => {
    setup();
    const b = screen.getByRole('button', { name: 'Configure data' });
    expect(b).toHaveAttribute('data-config-button');
    expect(b).toHaveTextContent(/^Configure$/);
    expect(b).toHaveClass('dm-band-btn');
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

const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

test('a hover on another mart waits while the real search box of the open panel holds focus', async () => {
  setup({ visible: ['id', 'products__sku'] });
  const menu = await openMenu();
  fireEvent.mouseEnter(within(menu).getByRole('menuitem', { name: 'Products' }));
  await wait(0);
  const panel = await screen.findByRole('dialog', { name: 'Products' });
  const box = within(panel).getByRole('searchbox');
  await userEvent.click(box);
  expect(box).toHaveFocus();
  fireEvent.mouseEnter(within(menu).getByRole('menuitem', { name: 'Regions' }));
  await wait(HOVER_MS + 100);
  expect(screen.getByRole('dialog', { name: 'Products' })).toBeInTheDocument();
  box.blur();
  fireEvent.mouseEnter(within(menu).getByRole('menuitem', { name: 'Orders' }));
  await wait(HOVER_MS + 100);
  expect(screen.queryByRole('dialog', { name: 'Products' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Orders' })).toBeInTheDocument();
});

describe('fix round 1', () => {
  test('Tab walks a fields panel through the controls, the list stop, the joinable rows and Remove, and back with Shift+Tab', async () => {
    setup({ visible: ['id', 'products__sku'] });
    const panel = await openRow('Products', await openMenu());
    const row = screen.getByRole('menuitem', { name: 'Products' });
    const at = () => document.activeElement;
    expect(at()).toBe(within(panel).getByRole('button', { name: /^Select all/ }));
    await userEvent.tab();
    expect(at()).toBe(within(panel).getByRole('button', { name: 'Clear' }));
    await userEvent.tab();
    expect(at()).toBe(within(panel).getByRole('searchbox'));
    await userEvent.tab();
    expect(at()?.getAttribute('role')).toBe('option');
    await userEvent.tab();
    expect(at()).toBe(within(panel).getByRole('menuitem', { name: 'Suppliers' }));
    await userEvent.tab();
    expect(at()).toBe(within(panel).getByRole('menuitem', { name: 'Remove from report' }));
    await userEvent.tab();
    expect(at()).toBe(row);
    // And back.
    await userEvent.click(row);
    within(panel).getByRole('menuitem', { name: 'Remove from report' }).focus();
    await userEvent.tab({ shift: true });
    expect(at()).toBe(within(panel).getByRole('menuitem', { name: 'Suppliers' }));
    await userEvent.tab({ shift: true });
    expect(at()?.getAttribute('role')).toBe('option');
    await userEvent.tab({ shift: true });
    expect(at()).toBe(within(panel).getByRole('searchbox'));
    await userEvent.tab({ shift: true });
    expect(at()).toBe(within(panel).getByRole('button', { name: 'Clear' }));
    await userEvent.tab({ shift: true });
    expect(at()).toBe(within(panel).getByRole('button', { name: /^Select all/ }));
    await userEvent.tab({ shift: true });
    expect(at()).toBe(row);
  });

  test('Tab from Clear reaches the list of a short panel', async () => {
    setup();
    const panel = await openRow('Regions', await openMenu());
    await userEvent.tab();
    expect(document.activeElement).toBe(within(panel).getByRole('button', { name: 'Clear' }));
    await userEvent.tab();
    expect(document.activeElement?.getAttribute('role')).toBe('option');
  });

  test('a joinable list taken when the menu opened survives opening another panel and coming back', async () => {
    setup();
    const menu = await openMenu();
    const orders = await openRow('Orders', menu);
    const products = await openRow('Products', orders);
    await userEvent.click(within(products).getByLabelText('products__price'));
    await openRow('Customers', menu);
    const again = await openRow('Orders', menu);
    expect(within(again).getByRole('menuitem', { name: 'Products' })).toBeInTheDocument();
  });

  test('a mart emptied from the root is not listed again as joinable', async () => {
    setup({ visible: ['id', 'products__sku'] });
    const menu = await openMenu();
    const products = await openRow('Products', menu);
    await userEvent.click(within(products).getByLabelText('products__sku'));
    await userEvent.keyboard('{Escape}');
    const orders = await openRow('Orders', menu);
    expect(within(orders).queryByRole('menuitem', { name: 'Products' })).toBeNull();
  });

  test('a mart that left the report offers no Remove from a stale closure', async () => {
    const onRemove = vi.fn();
    setup({ onRemove });
    const menu = await openMenu();
    const customers = await openRow('Customers', menu);
    await userEvent.click(within(customers).getByLabelText('customers__email'));
    await openRow('Orders', menu);
    expect(visibleNow()).toBe('id');
    const again = await openRow('Customers', menu);
    expect(within(again).queryByRole('menuitem', { name: 'Remove from report' })).toBeNull();
    expect(onRemove).not.toHaveBeenCalled();
  });

  test('two panels emptied together leave as one change when the menu closes', async () => {
    const spy = vi.fn();
    setup({ spy });
    const menu = await openMenu();
    const orders = await openRow('Orders', menu);
    const products = await openRow('Products', orders);
    await userEvent.click(within(products).getByLabelText('products__sku'));
    const suppliers = await openRow('Suppliers', products);
    await userEvent.click(within(suppliers).getByLabelText('suppliers__name'));
    expect(visibleNow()).toBe('id,customers__email,products__sku,suppliers__name');
    spy.mockClear();
    await userEvent.click(within(products).getByLabelText('products__sku'));
    await userEvent.click(within(suppliers).getByLabelText('suppliers__name'));
    expect(spy).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(['id', 'customers__email']);
    expect(visibleNow()).toBe('id,customers__email');
  });

  test('a panel emptied and then replaced by a hover commits its own change when it goes', async () => {
    const spy = vi.fn();
    setup({ spy });
    const menu = await openMenu();
    const customers = await openRow('Customers', menu);
    await userEvent.click(within(customers).getByLabelText('customers__email'));
    expect(spy).not.toHaveBeenCalled();
    fireEvent.mouseEnter(within(menu).getByRole('menuitem', { name: 'Regions' }));
    await wait(HOVER_MS + 100);
    expect(screen.queryByRole('dialog', { name: 'Customers' })).toBeNull();
    expect(spy).toHaveBeenCalledOnce();
    expect(visibleNow()).toBe('id');
  });

  test('a panel emptied and the menu then closed commits once', async () => {
    const spy = vi.fn();
    setup({ spy });
    const menu = await openMenu();
    const customers = await openRow('Customers', menu);
    await userEvent.click(within(customers).getByLabelText('customers__email'));
    await userEvent.click(screen.getByRole('button', { name: 'Configure data' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(spy).toHaveBeenCalledOnce();
    expect(visibleNow()).toBe('id');
  });

  test('Remove from report after emptying is one edit: the pending change is dropped', async () => {
    const spy = vi.fn();
    const onRemove = vi.fn();
    setup({ spy, onRemove });
    const customers = await openRow('Customers', await openMenu());
    await userEvent.click(within(customers).getByLabelText('customers__email'));
    await userEvent.click(within(customers).getByRole('menuitem', { name: 'Remove from report' }));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(spy).not.toHaveBeenCalled();
  });

  test('a press on another control of the config panel closes an open field menu and leaves the config menu', async () => {
    setup();
    const orders = await openRow('Orders', await openMenu());
    await userEvent.click(within(orders).getAllByRole('button', { name: 'Column menu id' })[0]!);
    await screen.findByRole('menu', { name: 'Menu of id' });
    fireEvent.pointerDown(within(orders).getByRole('option', { name: 'city' }));
    expect(screen.queryByRole('menu', { name: 'Menu of id' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Orders' })).toBeInTheDocument();
    expect(screen.getByRole('menu', { name: 'Configure data' })).toBeInTheDocument();
  });

  test('an edit in the config panel does not stop the field menu from switching submenus on hover', async () => {
    setup({ visible: ['id', 'products__sku'] });
    const panel = await openRow('Products', await openMenu());
    fireEvent.change(within(panel).getByRole('searchbox'), { target: { value: 'sku' } });
    await userEvent.click(within(panel).getAllByRole('button', { name: 'Column menu products__sku' })[0]!);
    const column = await screen.findByRole('menu', { name: 'Menu of products__sku' });
    fireEvent.mouseEnter(within(column).getByRole('menuitem', { name: 'Filter' }));
    await wait(0);
    await screen.findByRole('dialog', { name: 'Filter of products__sku' });
    fireEvent.mouseEnter(within(column).getByRole('menuitem', { name: 'Sort' }));
    await wait(HOVER_MS + 100);
    expect(screen.queryByRole('dialog', { name: 'Filter of products__sku' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Sort products__sku' })).toBeInTheDocument();
  });

  test('hovering Remove closes the open joinable panel', async () => {
    setup({ visible: ['id', 'products__sku'] });
    const panel = await openRow('Products', await openMenu());
    await openRow('Suppliers', panel);
    fireEvent.mouseEnter(within(panel).getByRole('menuitem', { name: 'Remove from report' }));
    await wait(HOVER_MS + 100);
    expect(screen.queryByRole('dialog', { name: 'Suppliers' })).toBeNull();
  });

  test('the separator follows the shown flag, not the columns', async () => {
    const marts = [{ ...mart('', 'Orders', ORDERS), shown: true }, { ...mart('a', 'Counted', ['a1']), shown: true }, mart('b', 'Waiting', ['b1'])];
    render(<TooltipProvider><ConfigMenu marts={marts} joinable={() => []} visible={['id']} onChange={() => undefined} /></TooltipProvider>);
    const menu = await openMenu();
    expect(within(menu).getAllByRole('menuitem').map((r) => r.textContent)).toEqual(['Orders', 'Counted', 'Waiting']);
    expect(menu.querySelector('[role="separator"]')!.previousElementSibling).toBe(within(menu).getByRole('menuitem', { name: 'Counted' }));
  });

  test('a root mart that left gets a fresh Unique Count from the main path, not the one of the render that opened it', async () => {
    setup({ unique: true });
    const menu = await openMenu();
    const panel = await openRow('Customers', menu);
    expect(within(panel).getByRole('option', { name: 'Unique Count' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(within(panel).getByRole('option', { name: 'Unique Count' }));
    await userEvent.click(within(panel).getByLabelText('customers__email'));
    await userEvent.keyboard('{Escape}');
    expect(visibleNow()).toBe('id');
    const again = await openRow('Customers', menu);
    expect(within(again).getByRole('option', { name: 'Unique Count' })).toHaveAttribute('aria-selected', 'false');
  });

  test('a root mart that left gets a fresh locked from the data marts that can join', async () => {
    const gone = (locked: (n: string) => boolean): ConfigMart => ({ ...mart('p', 'Partners', ['p1', 'p2']), locked });
    const props = (marts: ConfigMart[], joinable: ConfigMart[]) => <TooltipProvider><ConfigMenu marts={marts} joinable={(p) => (p === '' ? joinable : [])} visible={['id', 'p1']} onChange={() => undefined} /></TooltipProvider>;
    const main = { ...mart('', 'Orders', ORDERS), shown: true };
    const listed = { ...gone(() => false), shown: true };
    const { rerender } = render(props([main, listed], []));
    await userEvent.click(screen.getByRole('button', { name: 'Configure data' }));
    await screen.findByRole('menu', { name: 'Configure data' });
    rerender(props([main], [gone((n) => n === 'p1')]));
    const panel = await openRow('Partners', screen.getByRole('menu', { name: 'Configure data' }));
    expect(within(panel).getByRole('option', { name: 'p1' })).toHaveAttribute('aria-disabled', 'true');
  });

  describe('a closing subtree settles in one change', () => {
    const deep = async (spy: (c: string[]) => void, strict = false) => {
      setup({ spy, strict });
      const menu = await openMenu();
      const orders = await openRow('Orders', menu);
      const products = await openRow('Products', orders);
      await userEvent.click(within(products).getByLabelText('products__sku'));
      const suppliers = await openRow('Suppliers', products);
      await userEvent.click(within(suppliers).getByLabelText('suppliers__name'));
      await userEvent.click(within(products).getByLabelText('products__sku'));
      await userEvent.click(within(suppliers).getByLabelText('suppliers__name'));
      return menu;
    };
    const settled = async (spy: ReturnType<typeof vi.fn>, before: number) => {
      await wait(0);
      expect(spy).toHaveBeenCalledTimes(before + 1);
      expect(spy).toHaveBeenLastCalledWith(['id', 'customers__email']);
      expect(visibleNow()).toBe('id,customers__email');
    };
    for (const strict of [false, true]) {
      test(`a click on another root row${strict ? ' (StrictMode)' : ''}`, async () => {
        const spy = vi.fn();
        const menu = await deep(spy, strict);
        const before = spy.mock.calls.length;
        await userEvent.click(within(menu).getByRole('menuitem', { name: 'Customers' }));
        await settled(spy, before);
      });

      test(`a hover on another root row${strict ? ' (StrictMode)' : ''}`, async () => {
        const spy = vi.fn();
        const menu = await deep(spy, strict);
        const before = spy.mock.calls.length;
        fireEvent.mouseEnter(within(menu).getByRole('menuitem', { name: 'Customers' }));
        await wait(HOVER_MS + 100);
        await settled(spy, before);
      });

      test(`Escape with focus on the root${strict ? ' (StrictMode)' : ''}`, async () => {
        const spy = vi.fn();
        const menu = await deep(spy, strict);
        const before = spy.mock.calls.length;
        within(menu).getByRole('menuitem', { name: 'Orders' }).focus();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).toBeNull();
        await settled(spy, before);
      });

      test(`unmounting the menu${strict ? ' (StrictMode)' : ''}`, async () => {
        const spy = vi.fn();
        await deep(spy, strict);
        const before = spy.mock.calls.length;
        cleanup();
        await wait(0);
        expect(spy).toHaveBeenCalledTimes(before + 1);
        expect(spy).toHaveBeenLastCalledWith(['id', 'customers__email']);
      });
    }
  });

  test('the third level of one chart submenu does not open by itself in the next one', async () => {
    const axis = (label: string, prefix: string): MenuItem => ({
      kind: 'radio', label, icon: Hash, value: '', onPick: () => undefined, options: [],
      groups: [{ title: `${prefix} Orders`, options: [{ value: 'a', label: 'A' }] }, { title: `${prefix} Customers`, options: [{ value: 'b', label: 'B' }] }],
    });
    setup({ chartItems: [axis('X axis', 'X'), axis('Y axis', 'Y')] });
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'X axis' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'X Orders' }));
    await screen.findByRole('menu', { name: 'X Orders' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Y axis' }));
    await screen.findByRole('menu', { name: 'Y axis' });
    expect(screen.queryByRole('menu', { name: 'Y Orders' })).toBeNull();
  });

  test("a value typed in a field menu's filter keeps the panel it was opened from while the pointer rests on another root row", async () => {
    setup({ visible: ['id', 'products__sku'] });
    const menu = await openMenu();
    const panel = await openRow('Products', menu);
    await userEvent.click(within(panel).getAllByRole('button', { name: 'Column menu products__sku' })[0]!);
    const column = await screen.findByRole('menu', { name: 'Menu of products__sku' });
    await userEvent.click(within(column).getByRole('menuitem', { name: 'Filter' }));
    const filter = await screen.findByRole('dialog', { name: 'Filter of products__sku' });
    await userEvent.type(within(filter).getByLabelText('Value'), 'x');
    fireEvent.mouseEnter(within(menu).getByRole('menuitem', { name: 'Regions' }));
    await wait(HOVER_MS + 100);
    expect(screen.getByRole('dialog', { name: 'Products' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Regions' })).toBeNull();
  });

  test('from a field menu icon, Tab goes on in the panel order and Shift+Tab to the list stop', async () => {
    setup();
    const panel = await openRow('Regions', await openMenu());
    const row = screen.getByRole('menuitem', { name: 'Regions' });
    const icons = within(panel).getAllByRole('button', { name: /^Column menu/ });
    icons[1]!.focus();
    await userEvent.tab({ shift: true });
    expect(document.activeElement?.getAttribute('role')).toBe('option');
    expect(panel.contains(document.activeElement)).toBe(true);
    icons[1]!.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(row);
  });
});

describe('the chart rows', () => {
  const add = (options: string[]): MenuItem => ({ kind: 'radio', label: 'Add chart', icon: Plus, value: '', options: options.map((o) => ({ value: o, label: o })), onPick: () => undefined });
  const charts: MenuItem = { kind: 'group', label: 'Charts', icon: Hash, items: [{ kind: 'check', label: 'Sparklines', icon: Hash, checked: true, onToggle: () => undefined }] };
  const ui = (chartItems: MenuItem[]) => <TooltipProvider><ConfigMenu marts={[mart('', 'Orders', ORDERS, { shown: true })]} joinable={() => []} visible={['id']} onChange={() => undefined} chartItems={chartItems} /></TooltipProvider>;

  test('are found by their label: an open one stays when the row before it goes', async () => {
    const { rerender } = render(ui([add(['Pie']), charts]));
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Charts' }));
    await screen.findByRole('menu', { name: 'Charts' });
    rerender(ui([charts]));
    expect(screen.getByRole('menu', { name: 'Charts' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Charts', expanded: true })).toBeInTheDocument();
  });
});


describe('a panel keeps the rows it had when it opened', () => {
  const REMOVE = 'Remove from report';
  /** Orders and Customers, with Customers in the report or joinable under Orders. Orders and Customers offer Unique Count and Remove only while `live` is true: what ticking a joinable data mart brings. */
  const view = (live: boolean) => {
    const offer = { unique: { on: false, onToggle: () => undefined }, remove: { onRemove: () => undefined } };
    const orders: ConfigMart = { ...mart('', 'Orders', ORDERS), shown: true, ...(live ? offer : {}) };
    const customers: ConfigMart = { ...mart('customers', 'Customers', CUSTOMERS), shown: live, ...(live ? offer : {}) };
    return (
      <TooltipProvider>
        <ConfigMenu marts={live ? [orders, customers] : [orders]} joinable={(p) => (p === '' && !live ? [customers] : [])} visible={['id']} onChange={() => undefined} />
      </TooltipProvider>
    );
  };
  const unique = (panel: HTMLElement) => within(panel).queryByRole('option', { name: 'Unique Count' });
  const remove = (panel: HTMLElement) => within(panel).queryByRole('menuitem', { name: REMOVE });
  const openOrders = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Configure data' }));
    return openRow('Orders', await screen.findByRole('menu', { name: 'Configure data' }));
  };

  test('a row it did not have does not appear, in the ticked data mart and in its parent', async () => {
    const { rerender } = render(view(false));
    const orders = await openOrders();
    const customers = await openRow('Customers', orders);
    for (const panel of [orders, customers]) { expect(unique(panel)).toBeNull(); expect(remove(panel)).toBeNull(); }
    rerender(view(true));
    for (const panel of [orders, customers]) { expect(unique(panel)).toBeNull(); expect(remove(panel)).toBeNull(); }
  });

  test.each(['Orders', 'Customers'])('a row it had stays and goes disabled while its action is not available, in %s', async (title) => {
    const { rerender } = render(view(true));
    await userEvent.click(screen.getByRole('button', { name: 'Configure data' }));
    const panel = await openRow(title, await screen.findByRole('menu', { name: 'Configure data' }));
    expect(unique(panel)).not.toHaveAttribute('aria-disabled');
    expect(remove(panel)).toBeEnabled();
    rerender(view(false));
    expect(unique(panel)).toHaveAttribute('aria-disabled', 'true');
    expect(remove(panel)).toBeDisabled();
  });
});
