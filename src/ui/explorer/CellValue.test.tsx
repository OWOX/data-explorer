import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { stubCtx } from '../../api/test-ctx';
import { AppServices } from '../../state/store';
import { TooltipProvider } from '../Tooltip';
import { CellValue } from './CellValue';

const view = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);
const medium = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

test('a TIMESTAMP cell shows local date and time, and the stored value in the tooltip', async () => {
  view(<CellValue row={{ at: '2026-03-12T10:45:30.000Z' }} field="at" type="TIMESTAMP" />);
  const cell = screen.getByText(medium.format(new Date('2026-03-12T10:45:30.000Z')));
  await userEvent.hover(cell);
  expect((await screen.findAllByText('2026-03-12T10:45:30.000Z')).length).toBeGreaterThan(0);
});

test('a DATE cell shows the calendar day', () => {
  view(<CellValue row={{ day: '2026-03-12' }} field="day" type="DATE" />);
  expect(screen.getByText(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(2026, 2, 12)))).toBeInTheDocument();
});

test('an unreadable value, a null and a field with no type show raw', () => {
  view(<><CellValue row={{ at: 'soon' }} field="at" type="TIMESTAMP" /><CellValue row={{ at: null }} field="at" type="TIMESTAMP" /><CellValue row={{ x: '2026-03-12' }} field="x" /></>);
  expect(screen.getByText('soon')).toBeInTheDocument();
  expect(screen.getByText('2026-03-12')).toBeInTheDocument();
});

const truncating = (el: HTMLElement) => { Object.defineProperty(el, 'scrollWidth', { configurable: true, value: 300 }); Object.defineProperty(el, 'clientWidth', { configurable: true, value: 100 }); };

test('a value is one clipped line, and a truncated one shows in full on hover', async () => {
  view(<CellValue row={{ id: 'a-very-long-session-identifier-0123456789' }} field="id" />);
  const cell = screen.getByText('a-very-long-session-identifier-0123456789');
  expect(cell).toHaveClass('truncate');
  truncating(cell);
  await userEvent.hover(cell);
  await waitFor(() => expect(screen.getAllByText('a-very-long-session-identifier-0123456789').length).toBeGreaterThan(1));
});

test('a value that fits has no tooltip', async () => {
  view(<CellValue row={{ id: 'short' }} field="id" />);
  await userEvent.hover(screen.getByText('short'));
  await new Promise((r) => setTimeout(r, 400));
  expect(screen.queryByRole('tooltip')).toBeNull();
});

test('a cell is never a button, whatever the field is', () => {
  view(<CellValue row={{ customer_id: 7 }} field="customer_id" type="INT64" />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByText('7')).not.toHaveClass('dm-ctl-on');
});

test('an array value (a one-to-many joined field) shows its values joined with a comma, and a string shows as it comes', () => {
  view(<><CellValue row={{ tags: ['red', 'blue', 3] }} field="tags" /><CellValue row={{ city: 'Lisbon' }} field="city" /></>);
  expect(screen.getByText('red, blue, 3')).toBeInTheDocument();
  expect(screen.getByText('Lisbon')).toBeInTheDocument();
});

const URL_TEXT = 'https://owox.com/pricing?ref=grid';
const linked = (ui: React.ReactElement) => { const ctx = stubCtx(); render(<AppServices ctx={ctx}><TooltipProvider>{ui}</TooltipProvider></AppServices>); return ctx.ui.openExternal; };

test.each([['grid', false], ['Row band', true]])('a URL is a link in the %s and opens in a new tab through the host', (_, wrap) => {
  const open = linked(<CellValue row={{ page: URL_TEXT }} field="page" type="STRING" wrap={wrap} />);
  const link = screen.getByRole('link', { name: URL_TEXT });
  expect(link).toHaveAttribute('href', URL_TEXT);
  expect(link).toHaveAttribute('target', '_blank');
  // Cancelled: the frame's own popup must not open next to the host's tab.
  expect(fireEvent.click(link)).toBe(false);
  expect(open).toHaveBeenCalledExactlyOnceWith(URL_TEXT);
});

test('a shift-click on a URL stretches a selection, so it opens nothing', () => {
  const open = linked(<CellValue row={{ page: URL_TEXT }} field="page" type="STRING" />);
  expect(fireEvent.click(screen.getByRole('link'), { shiftKey: true })).toBe(false);
  expect(open).not.toHaveBeenCalled();
});

test('a clipped URL shows in full on hover', async () => {
  linked(<CellValue row={{ page: URL_TEXT }} field="page" type="STRING" />);
  const link = screen.getByRole('link');
  truncating(link.closest<HTMLElement>('.truncate')!);
  await userEvent.hover(link);
  await waitFor(() => expect(screen.getAllByText(URL_TEXT).length).toBeGreaterThan(1));
});

test('text that only contains a URL is no link', () => {
  linked(<CellValue row={{ note: `see ${URL_TEXT}` }} field="note" type="STRING" />);
  expect(screen.queryByRole('link')).toBeNull();
});
