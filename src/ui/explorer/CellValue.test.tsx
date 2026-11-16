import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  expect(screen.getByText('7')).not.toHaveClass('text-primary');
});

test('an array value (a one-to-many joined field) shows its values joined with a comma, and a string shows as it comes', () => {
  view(<><CellValue row={{ tags: ['red', 'blue', 3] }} field="tags" /><CellValue row={{ city: 'Lisbon' }} field="city" /></>);
  expect(screen.getByText('red, blue, 3')).toBeInTheDocument();
  expect(screen.getByText('Lisbon')).toBeInTheDocument();
});
