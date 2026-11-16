import { render, screen } from '@testing-library/react';
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
